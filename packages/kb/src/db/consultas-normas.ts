/**
 * Consultas às tabelas da fase 5 no `kb.sqlite` (dispositivos, relações, vigências, transições e
 * correspondências), com zod na fronteira. As regras não são reescritas aqui: a deduplicação vem
 * gravada (`canonico`), e a herança da correspondência, os descendentes e a situação da transição
 * numa data usam as mesmas funções da API de arquivos (`correspondenciaEm`, `descendentesEm`,
 * `situacaoNaData`). `base.test.ts` confere que banco e arquivos dão o mesmo resultado.
 */
import type { Database } from "bun:sqlite";
import { z } from "zod";
import type { FonteCorrespondencia, TabelaCorrespondencia } from "../normas/correspondencia.ts";
import { descendentesEm, type Dispositivo, TIPOS_DISPOSITIVO, TIPOS_NOTA } from "../normas/estrutura.ts";
import { idDoAto } from "../normas/ids.ts";
import type { Relacao } from "../normas/relacoes.ts";
import { type DatasTransicao, type Situacao, STATUS_VIGENCIA, situacaoNaData } from "../normas/vigencia.ts";

const texto = z.string();
const textoNulo = z.string().nullable();
const inteiro = z.number().int();

/* ============================================================== dispositivos */

const COLUNAS_DISPOSITIVO =
  "rowid, id, ato_id, norma_id, dispositivo, tipo, rotulo, pai, ordem, texto, caput_json, texto_com_caput, estrutura_json, notas_json, revogado, vetado, canonico, path, linha_inicio, linha_fim";

const esquemaLinha = z.strictObject({
  rowid: inteiro,
  id: texto,
  ato_id: texto,
  norma_id: texto,
  dispositivo: texto,
  tipo: z.enum(TIPOS_DISPOSITIVO),
  rotulo: texto,
  pai: textoNulo,
  ordem: inteiro,
  texto: texto,
  caput_json: texto,
  texto_com_caput: texto,
  estrutura_json: texto,
  notas_json: texto,
  revogado: inteiro,
  vetado: inteiro,
  canonico: inteiro,
  path: texto,
  linha_inicio: inteiro,
  linha_fim: inteiro,
});
type Linha = z.output<typeof esquemaLinha>;

const listaTextos = z.array(z.string());
const listaNotas = z.array(z.strictObject({ tipo: z.enum(TIPOS_NOTA), texto: z.string() }));

/** Dispositivo do banco: o `Dispositivo` da API de arquivos, mais o arquivo (relativo à raiz) e o rowid. */
export interface DispositivoDoBanco {
  disp: Dispositivo;
  /** Markdown, relativo à raiz do repositório. */
  path: string;
  rowid: number;
  texto_com_caput: string;
}

function paraDispositivo(l: Linha): DispositivoDoBanco {
  return {
    disp: {
      id: l.id,
      dispositivo: l.dispositivo,
      norma: l.norma_id,
      ato: l.ato_id,
      tipo: l.tipo,
      rotulo: l.rotulo,
      pai: l.pai,
      texto: l.texto,
      caput: listaTextos.parse(JSON.parse(l.caput_json)),
      estrutura: listaTextos.parse(JSON.parse(l.estrutura_json)),
      notas: listaNotas.parse(JSON.parse(l.notas_json)),
      revogado: l.revogado === 1,
      vetado: l.vetado === 1,
      linha_inicio: l.linha_inicio,
      linha_fim: l.linha_fim,
      ordem: l.ordem,
    },
    path: l.path,
    rowid: l.rowid,
    texto_com_caput: l.texto_com_caput,
  };
}

function uma(db: Database, sql: string, ...parametros: string[]): DispositivoDoBanco | undefined {
  const linha = db.query(sql).get(...parametros);
  return linha ? paraDispositivo(esquemaLinha.parse(linha)) : undefined;
}

/**
 * Dispositivo pelo ID, com a regra de `obterDispositivo` (`normas/estrutura.ts`): pelo ID do ato, o
 * dispositivo canônico (o texto integral prevalece sobre a compilação); pelo ID do arquivo com
 * variante (`br/lei/1996/9394~compilacao#art36`), aquele dispositivo.
 */
export function obterDispositivoBanco(db: Database, id: string): DispositivoDoBanco | undefined {
  const [norma, sufixo] = id.split("#") as [string, string | undefined];
  if (!sufixo) return undefined;
  const ato = idDoAto(norma);
  const direto = uma(
    db,
    `SELECT ${COLUNAS_DISPOSITIVO} FROM dispositivos WHERE ato_id = ? AND dispositivo = ? AND canonico = 1`,
    ato,
    `#${sufixo}`,
  );
  if (direto && (norma === direto.disp.ato || norma === direto.disp.norma)) return direto;
  if (norma !== ato) return uma(db, `SELECT ${COLUNAS_DISPOSITIVO} FROM dispositivos WHERE id = ?`, id);
  return direto;
}

/** Descendentes de um dispositivo (pelo ID do arquivo), em ordem: `descendentesEm` sobre o arquivo dele. */
export function descendentesBanco(db: Database, id: string): DispositivoDoBanco[] {
  const lista = z
    .array(esquemaLinha)
    .parse(
      db
        .query(
          `SELECT ${COLUNAS_DISPOSITIVO} FROM dispositivos WHERE norma_id = (SELECT norma_id FROM dispositivos WHERE id = ?) ORDER BY ordem`,
        )
        .all(id),
    )
    .map(paraDispositivo);
  const porId = new Map(lista.map((d) => [d.disp.id, d]));
  return descendentesEm(
    lista.map((d) => d.disp),
    id,
  ).map((d) => porId.get(d.id)!);
}

/** Texto literal de um dispositivo para citar: caput herdado, o próprio texto e, se pedido, os subordinados. */
export interface TrechoDispositivo {
  /** ID do ato com o dispositivo (`br/cne-cp/res/2026/2#art28-vii`). */
  id: string;
  /** ID do arquivo, quando o texto vem de uma variante (compilação). */
  arquivo_id: string;
  tipo: Dispositivo["tipo"];
  rotulo: string;
  /** Textos dos ancestrais, do artigo até o pai. */
  caput: string[];
  /** Texto do próprio dispositivo, com o rótulo. */
  texto: string;
  /** Incisos, alíneas, parágrafos… do dispositivo, em ordem (só com `subordinados`). */
  subordinados: { id: string; texto: string }[];
  notas: Dispositivo["notas"];
  revogado: boolean;
  vetado: boolean;
  /** Markdown, relativo à raiz do repositório, e linhas (até o último subordinado incluído). */
  path: string;
  linha_inicio: number;
  linha_fim: number;
}

export function paraTrecho(
  db: Database,
  d: DispositivoDoBanco,
  opcoes: { subordinados?: boolean } = {},
): TrechoDispositivo {
  const filhos = opcoes.subordinados ? descendentesBanco(db, d.disp.id) : [];
  return {
    id: `${d.disp.ato}${d.disp.dispositivo}`,
    arquivo_id: d.disp.id,
    tipo: d.disp.tipo,
    rotulo: d.disp.rotulo,
    caput: d.disp.caput,
    texto: d.disp.texto,
    subordinados: filhos.map((f) => ({ id: `${f.disp.ato}${f.disp.dispositivo}`, texto: f.disp.texto })),
    notas: d.disp.notas,
    revogado: d.disp.revogado,
    vetado: d.disp.vetado,
    path: d.path,
    linha_inicio: d.disp.linha_inicio,
    linha_fim: Math.max(d.disp.linha_fim, ...filhos.map((f) => f.disp.linha_fim)),
  };
}

/** Trecho de um dispositivo pelo ID; `null` se o dispositivo não está no texto da base. */
export function trechoDoDispositivo(
  db: Database,
  id: string,
  opcoes: { subordinados?: boolean } = {},
): TrechoDispositivo | null {
  const d = obterDispositivoBanco(db, id);
  return d ? paraTrecho(db, d, opcoes) : null;
}

/** Dispositivo pedido ou, se ele não está no texto, o ancestral mais próximo pelo ID (`#art28-par1-iv` → `#art28-par1` → `#art28`). */
export function dispositivoOuAncestral(db: Database, id: string): DispositivoDoBanco | undefined {
  const [norma, sufixo] = id.split("#") as [string, string | undefined];
  if (!sufixo) return undefined;
  const partes = sufixo.split("-");
  for (let n = partes.length; n > 0; n -= 1) {
    const achado = obterDispositivoBanco(db, `${norma}#${partes.slice(0, n).join("-")}`);
    if (achado) return achado;
  }
  return undefined;
}

/* ========================================================== correspondência */

const esquemaTabela = z.strictObject({
  arquivo: texto,
  origem: texto,
  destino: texto,
  status: z.enum(["rascunho", "revisado"]),
  elaborado_em: z.string(),
  revisado_por: textoNulo,
  metodo: texto,
});
const esquemaItem = z.strictObject({
  tabela: texto,
  origem: texto,
  tipo: z.enum(["equivalente", "parcial", "sem-equivalente"]),
  destino_json: texto,
  nota: textoNulo,
});

/** Tabelas de correspondência do banco, no formato de `carregarCorrespondencias`. */
export function tabelasCorrespondenciaBanco(db: Database, origem?: string): TabelaCorrespondencia[] {
  const tabelas = z
    .array(esquemaTabela)
    .parse(
      origem
        ? db.query("SELECT * FROM correspondencias_tabelas WHERE origem = ? ORDER BY arquivo").all(origem)
        : db.query("SELECT * FROM correspondencias_tabelas ORDER BY arquivo").all(),
    );
  return tabelas.map((t) => {
    const itens = z
      .array(esquemaItem)
      .parse(
        db
          .query(
            "SELECT tabela, origem, tipo, destino_json, nota FROM correspondencias WHERE tabela = ? ORDER BY ordem",
          )
          .all(t.arquivo),
      )
      .map((item) => ({
        origem: item.origem.slice(t.origem.length),
        tipo: item.tipo,
        destino: listaTextos.parse(JSON.parse(item.destino_json)).map((d) => d.slice(t.destino.length)),
        ...(item.nota !== null ? { nota: item.nota } : {}),
      }));
    return {
      origem: t.origem,
      destino: t.destino,
      status: t.status,
      elaborado_em: t.elaborado_em,
      ...(t.revisado_por !== null ? { revisado_por: t.revisado_por } : {}),
      metodo: t.metodo,
      itens,
      arquivo: t.arquivo,
    };
  });
}

/** Fonte da correspondência (`correspondenciaEm`) sobre o banco. */
export function fonteCorrespondenciaBanco(db: Database): FonteCorrespondencia {
  return {
    tabelas: (ato) => tabelasCorrespondenciaBanco(db, ato),
    dispositivo: (id) => {
      const d = obterDispositivoBanco(db, id);
      return d ? { pai: d.disp.pai, texto: d.disp.texto } : undefined;
    },
    artigos: (ato) =>
      z
        .array(z.strictObject({ dispositivo: texto }))
        .parse(
          db
            .query(
              "SELECT dispositivo FROM dispositivos WHERE ato_id = ? AND canonico = 1 AND tipo = 'artigo' ORDER BY norma_id <> ato_id, norma_id, ordem",
            )
            .all(ato),
        )
        .map((l) => l.dispositivo),
  };
}

/* ================================================================== relações */

const esquemaRelacao = z.strictObject({
  ordem: inteiro,
  tipo: z.enum(["revoga", "altera", "regulamenta", "fundamenta-se-em"]),
  origem: texto,
  operador: textoNulo,
  alvo: texto,
  alvo_dispositivo: textoNulo,
  alcance: textoNulo,
  efeito_de: texto,
  efeito_em: textoNulo,
  efeito_minimo: textoNulo,
  evidencia_em: texto,
  evidencia_trecho: texto,
  confirmado_em: z.string(),
  proposta: z.enum(["front-matter", "regex", "manual"]),
  nota: textoNulo,
  path: texto,
});

/** Relações do banco no formato de `carregarRelacoes` (ordem do arquivo). */
export function relacoesBanco(db: Database): Relacao[] {
  return z
    .array(esquemaRelacao)
    .parse(db.query("SELECT * FROM relacoes ORDER BY ordem").all())
    .map((r) => ({
      tipo: r.tipo,
      origem: r.origem,
      ...(r.operador !== null ? { operador: r.operador } : {}),
      alvo: r.alvo,
      ...(r.alvo_dispositivo !== null ? { alvo_dispositivo: r.alvo_dispositivo } : {}),
      ...(r.alcance !== null ? { alcance: r.alcance } : {}),
      efeito_de: r.efeito_de,
      evidencia: { em: r.evidencia_em, trecho: r.evidencia_trecho },
      confirmado_em: r.confirmado_em,
      proposta: r.proposta,
      ...(r.nota !== null ? { nota: r.nota } : {}),
    }));
}

/* ================================================================= vigência */

/** `data_referencia` gravada no banco (de `base-conhecimento/config/vigencia.yaml`). */
export function dataReferenciaBanco(db: Database): string {
  const linha = z
    .strictObject({ valor: texto })
    .parse(db.query("SELECT valor FROM meta WHERE chave = 'data_referencia'").get());
  return linha.valor;
}

const esquemaVigencia = z.strictObject({
  alvo: texto,
  de: textoNulo,
  ate: textoNulo,
  status: z.enum(STATUS_VIGENCIA),
  certo: inteiro,
  fonte: texto,
});

export interface VigenciaNoBanco {
  alvo: string;
  status: (typeof STATUS_VIGENCIA)[number];
  certo: boolean;
  /** Intervalo que contém a data ([de, ate), `null` = aberto) e o que o abre. */
  de: string | null;
  ate: string | null;
  fonte: string;
}

/** Status de um ato numa data, pelo intervalo gravado (o mesmo de `statusEm`); `null` para ato sem vigência. */
export function vigenciaNoBanco(db: Database, id: string, data: string): VigenciaNoBanco | null {
  const linha = db
    .query(
      "SELECT alvo, de, ate, status, certo, fonte FROM vigencias WHERE alvo = ? AND (de IS NULL OR de <= ?) AND (ate IS NULL OR ? < ate)",
    )
    .get(idDoAto(id.split("#")[0]!), data, data);
  if (!linha) return null;
  const v = esquemaVigencia.parse(linha);
  return { ...v, certo: v.certo === 1 };
}

/** Condição SQL: o ato de `coluna` está revogado ou ainda não vigente na data (dois parâmetros: a data). */
export function sqlForaDeVigencia(coluna: string): string {
  const ato = `CASE WHEN instr(${coluna}, '~') > 0 THEN substr(${coluna}, 1, instr(${coluna}, '~') - 1) ELSE ${coluna} END`;
  return `EXISTS (SELECT 1 FROM vigencias v WHERE v.alvo = ${ato} AND (v.de IS NULL OR v.de <= ?) AND (v.ate IS NULL OR ? < v.ate) AND v.status IN ('revogada', 'ainda-nao-vigente'))`;
}

/* =============================================================== transições */

const esquemaTransicao = z.strictObject({
  id: texto,
  norma_id: texto,
  dispositivo: texto,
  tipo: texto,
  norma_anterior: textoNulo,
  aplica_a: texto,
  regra: texto,
  inicio: texto,
  fim: texto,
  inicio_em: textoNulo,
  inicio_minimo: textoNulo,
  fim_em: textoNulo,
  evidencia: texto,
  path: texto,
});

export type TransicaoNoBanco = z.output<typeof esquemaTransicao> & DatasTransicao & { situacao: Situacao };

/**
 * Regras de transição dos atos (que eles estabelecem ou que preservam efeitos deles, como
 * `transicoesAplicaveis`), na ordem do arquivo, com a situação na data (`situacaoNaData`).
 */
export function transicoesNoBanco(db: Database, atos: readonly string[], data: string): TransicaoNoBanco[] {
  if (!atos.length) return [];
  const marcadores = atos.map(() => "?").join(", ");
  return z
    .array(esquemaTransicao)
    .parse(
      db
        .query(
          `SELECT id, norma_id, dispositivo, tipo, norma_anterior, aplica_a, regra, inicio, fim, inicio_em, inicio_minimo, fim_em, evidencia, path
           FROM transicoes WHERE norma_id IN (${marcadores}) OR norma_anterior IN (${marcadores}) ORDER BY rowid`,
        )
        .all(...atos, ...atos),
    )
    .map((t) => ({ ...t, situacao: situacaoNaData(t, data) }));
}
