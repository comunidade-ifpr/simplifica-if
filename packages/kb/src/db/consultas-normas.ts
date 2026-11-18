/**
 * Consultas às tabelas da fase 5 no `kb.sqlite` (dispositivos, vigências, transições e
 * correspondências), pelo `SqlClient`, com as linhas decodificadas por Effect Schema na borda. As
 * regras não são reescritas aqui: a deduplicação vem gravada (`canonico`), e a herança da
 * correspondência, os descendentes e a situação da transição numa data usam as mesmas funções da
 * API de arquivos (`correspondenciaEm`, `descendentesEm`, `situacaoNaData`). `base.test.ts` confere
 * que banco e arquivos dão o mesmo resultado.
 *
 * Exports: `obterDispositivo`, `descendentes`, `paraTrecho`, `trechoDoDispositivo`,
 * `dispositivoOuAncestral`, `tabelasCorrespondencia`, `carregarFonteCorrespondencia`,
 * `vigenciaNaData`, `sqlForaDeVigencia` (pura), `transicoesDosAtos`; tipos `DispositivoDoBanco`,
 * `TrechoDispositivo`, `VigenciaNoBanco`, `TransicaoNoBanco`. As relações e a `data_referencia`
 * vêm de `FontesNormativas`.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/sql/SqlClient";
import type { FonteCorrespondencia, TabelaCorrespondencia } from "../normas/correspondencia.ts";
import { descendentesEm, type Dispositivo, TIPOS_DISPOSITIVO, TIPOS_NOTA } from "../normas/estrutura.ts";
import { idDoAto } from "../normas/ids.ts";
import { type DatasTransicao, type Situacao, STATUS_VIGENCIA, situacaoNaData } from "../normas/vigencia.ts";
import * as Sql from "./sql.ts";

const Texto = Schema.String;
const TextoNulo = Schema.NullOr(Schema.String);
const Inteiro = Schema.Int;
const ListaTextos = Schema.Array(Schema.String);

/* ============================================================== dispositivos */

const COLUNAS_DISPOSITIVO =
  "rowid, id, ato_id, norma_id, dispositivo, tipo, rotulo, pai, ordem, texto, caput_json, texto_com_caput, estrutura_json, notas_json, revogado, vetado, canonico, path, linha_inicio, linha_fim";

const LinhaDispositivo = Schema.Struct({
  rowid: Inteiro,
  id: Texto,
  ato_id: Texto,
  norma_id: Texto,
  dispositivo: Texto,
  tipo: Schema.Literals(TIPOS_DISPOSITIVO),
  rotulo: Texto,
  pai: TextoNulo,
  ordem: Inteiro,
  texto: Texto,
  caput_json: Schema.fromJsonString(ListaTextos),
  texto_com_caput: Texto,
  estrutura_json: Schema.fromJsonString(ListaTextos),
  notas_json: Schema.fromJsonString(Schema.Array(Schema.Struct({ tipo: Schema.Literals(TIPOS_NOTA), texto: Texto }))),
  revogado: Inteiro,
  vetado: Inteiro,
  canonico: Inteiro,
  path: Texto,
  linha_inicio: Inteiro,
  linha_fim: Inteiro,
});
const linhasDispositivo = Sql.todas(LinhaDispositivo);
const primeiroDispositivo = Sql.primeira(LinhaDispositivo);

/** Dispositivo do banco: o `Dispositivo` da API de arquivos, mais o arquivo (relativo à raiz) e o rowid. */
export interface DispositivoDoBanco {
  disp: Dispositivo;
  /** Markdown, relativo à raiz do repositório. */
  path: string;
  rowid: number;
  texto_com_caput: string;
}

function paraDispositivo(l: typeof LinhaDispositivo.Type): DispositivoDoBanco {
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
      caput: [...l.caput_json],
      estrutura: [...l.estrutura_json],
      notas: l.notas_json.map((n) => ({ tipo: n.tipo, texto: n.texto })),
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

// sem span: chamada por dispositivo (ancestrais, correspondência, busca textual)
const uma = Effect.fnUntraced(function* (sql: string, parametros: ReadonlyArray<string>) {
  const linha = yield* primeiroDispositivo(sql, parametros);
  return linha ? paraDispositivo(linha) : undefined;
});

/**
 * Dispositivo pelo ID, com a regra de `obterDispositivo` (`normas/estrutura.ts`): pelo ID do ato, o
 * dispositivo canônico (o texto integral prevalece sobre a compilação); pelo ID do arquivo com
 * variante (`br/lei/1996/9394~compilacao#art36`), aquele dispositivo.
 */
export const obterDispositivo = Effect.fn("consultasNormas.obterDispositivo")(function* (id: string) {
  const [norma, sufixo] = id.split("#") as [string, string | undefined];
  if (!sufixo) return undefined;
  const ato = idDoAto(norma);
  const direto = yield* uma(
    `SELECT ${COLUNAS_DISPOSITIVO} FROM dispositivos WHERE ato_id = ? AND dispositivo = ? AND canonico = 1`,
    [ato, `#${sufixo}`],
  );
  if (direto && (norma === direto.disp.ato || norma === direto.disp.norma)) return direto;
  if (norma !== ato) return yield* uma(`SELECT ${COLUNAS_DISPOSITIVO} FROM dispositivos WHERE id = ?`, [id]);
  return direto;
});

/** Descendentes de um dispositivo (pelo ID do arquivo), em ordem: `descendentesEm` sobre o arquivo dele. */
export const descendentes = Effect.fn("consultasNormas.descendentes")(function* (id: string) {
  const lista = (yield* linhasDispositivo(
    `SELECT ${COLUNAS_DISPOSITIVO} FROM dispositivos WHERE norma_id = (SELECT norma_id FROM dispositivos WHERE id = ?) ORDER BY ordem`,
    [id],
  )).map(paraDispositivo);
  const porId = new Map(lista.map((d) => [d.disp.id, d]));
  return descendentesEm(
    lista.map((d) => d.disp),
    id,
  ).map((d) => porId.get(d.id)!);
});

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

/** Trecho para citar de um dispositivo já lido; com `subordinados`, lê os descendentes dele. */
export const paraTrecho = Effect.fn("consultasNormas.paraTrecho")(function* (
  d: DispositivoDoBanco,
  opcoes: { subordinados?: boolean } = {},
) {
  const filhos = opcoes.subordinados ? yield* descendentes(d.disp.id) : [];
  const trecho: TrechoDispositivo = {
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
  return trecho;
});

/** Trecho de um dispositivo pelo ID; `null` se o dispositivo não está no texto da base. */
export const trechoDoDispositivo = Effect.fn("consultasNormas.trechoDoDispositivo")(function* (
  id: string,
  opcoes: { subordinados?: boolean } = {},
) {
  const d = yield* obterDispositivo(id);
  return d ? yield* paraTrecho(d, opcoes) : null;
});

/** Dispositivo pedido ou, se ele não está no texto, o ancestral mais próximo pelo ID (`#art28-par1-iv` → `#art28-par1` → `#art28`). */
export const dispositivoOuAncestral = Effect.fn("consultasNormas.dispositivoOuAncestral")(function* (id: string) {
  const [norma, sufixo] = id.split("#") as [string, string | undefined];
  if (!sufixo) return undefined;
  const partes = sufixo.split("-");
  for (let n = partes.length; n > 0; n -= 1) {
    const achado = yield* obterDispositivo(`${norma}#${partes.slice(0, n).join("-")}`);
    if (achado) return achado;
  }
  return undefined;
});

/* ========================================================== correspondência */

const LinhaTabela = Schema.Struct({
  arquivo: Texto,
  origem: Texto,
  destino: Texto,
  status: Schema.Literals(["rascunho", "revisado"]),
  elaborado_em: Texto,
  revisado_por: TextoNulo,
  metodo: Texto,
});
const linhasTabela = Sql.todas(LinhaTabela);

const LinhaItem = Schema.Struct({
  tabela: Texto,
  origem: Texto,
  tipo: Schema.Literals(["equivalente", "parcial", "sem-equivalente"]),
  destino_json: Schema.fromJsonString(ListaTextos),
  nota: TextoNulo,
});
const linhasItem = Sql.todas(LinhaItem);

/** Tabelas de correspondência do banco, no formato de `carregarCorrespondencias`. */
export const tabelasCorrespondencia = Effect.fn("consultasNormas.tabelasCorrespondencia")(function* (origem?: string) {
  const tabelas = origem
    ? yield* linhasTabela("SELECT * FROM correspondencias_tabelas WHERE origem = ? ORDER BY arquivo", [origem])
    : yield* linhasTabela("SELECT * FROM correspondencias_tabelas ORDER BY arquivo");
  const saida: TabelaCorrespondencia[] = [];
  for (const t of tabelas) {
    const itens = (yield* linhasItem(
      "SELECT tabela, origem, tipo, destino_json, nota FROM correspondencias WHERE tabela = ? ORDER BY ordem",
      [t.arquivo],
    )).map((item) => ({
      origem: item.origem.slice(t.origem.length),
      tipo: item.tipo,
      destino: item.destino_json.map((d) => d.slice(t.destino.length)),
      ...(item.nota !== null ? { nota: item.nota } : {}),
    }));
    saida.push({
      origem: t.origem,
      destino: t.destino,
      status: t.status,
      elaborado_em: t.elaborado_em,
      ...(t.revisado_por !== null ? { revisado_por: t.revisado_por } : {}),
      metodo: t.metodo,
      itens,
      arquivo: t.arquivo,
    });
  }
  return saida;
});

const LinhaDispositivoCorrespondencia = Schema.Struct({ dispositivo: Texto, pai: TextoNulo, texto: Texto });
const linhasDispositivoCorrespondencia = Sql.todas(LinhaDispositivoCorrespondencia);
const linhasArtigo = Sql.todas(Schema.Struct({ dispositivo: Texto }));

/**
 * Fonte da correspondência (`correspondenciaEm`, `destinosDeOrigemEm`) sobre o banco, carregada de
 * uma vez: todas as tabelas de correspondência, os artigos canônicos dos atos de origem (na ordem
 * de antes: o texto integral primeiro, depois as variantes, por ordem no arquivo) e o pai e o texto
 * dos dispositivos canônicos dos atos de origem e de destino. A regra só pergunta por esses atos.
 */
export const carregarFonteCorrespondencia: Effect.Effect<
  FonteCorrespondencia,
  Sql.FalhaNaConsulta,
  SqlClient.SqlClient
> = Effect.gen(function* () {
  const tabelas = yield* tabelasCorrespondencia();
  const origens = [...new Set(tabelas.map((t) => t.origem))];
  const atos = [...new Set(tabelas.flatMap((t) => [t.origem, t.destino]))];
  const porOrigem = new Map<string, TabelaCorrespondencia[]>();
  for (const t of tabelas) porOrigem.set(t.origem, [...(porOrigem.get(t.origem) ?? []), t]);

  const dispositivos = new Map<string, { pai: string | null; texto: string }>();
  for (const ato of atos) {
    const linhas = yield* linhasDispositivoCorrespondencia(
      "SELECT dispositivo, pai, texto FROM dispositivos WHERE ato_id = ? AND canonico = 1 ORDER BY rowid",
      [ato],
    );
    // o primeiro por rowid, como o `.get()` da consulta por dispositivo
    for (const l of linhas) {
      const id = `${ato}${l.dispositivo}`;
      if (!dispositivos.has(id)) dispositivos.set(id, { pai: l.pai, texto: l.texto });
    }
  }

  const artigos = new Map<string, string[]>();
  for (const ato of origens) {
    const linhas = yield* linhasArtigo(
      "SELECT dispositivo FROM dispositivos WHERE ato_id = ? AND canonico = 1 AND tipo = 'artigo' ORDER BY norma_id <> ato_id, norma_id, ordem",
      [ato],
    );
    artigos.set(
      ato,
      linhas.map((l) => l.dispositivo),
    );
  }

  const fonte: FonteCorrespondencia = { tabelas: porOrigem, dispositivos, artigos };
  return fonte;
}).pipe(Effect.withSpan("consultasNormas.carregarFonteCorrespondencia"));

/* ================================================================= vigência */

const LinhaVigencia = Schema.Struct({
  alvo: Texto,
  de: TextoNulo,
  ate: TextoNulo,
  status: Schema.Literals(STATUS_VIGENCIA),
  certo: Inteiro,
  fonte: Texto,
});
const primeiraVigencia = Sql.primeira(LinhaVigencia);

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
export const vigenciaNaData = Effect.fn("consultasNormas.vigenciaNaData")(function* (id: string, data: string) {
  const v = yield* primeiraVigencia(
    "SELECT alvo, de, ate, status, certo, fonte FROM vigencias WHERE alvo = ? AND (de IS NULL OR de <= ?) AND (ate IS NULL OR ? < ate)",
    [idDoAto(id.split("#")[0]!), data, data],
  );
  if (v === undefined) return null;
  const vigencia: VigenciaNoBanco = { ...v, certo: v.certo === 1 };
  return vigencia;
});

/** Condição SQL: o ato de `coluna` está revogado ou ainda não vigente na data (dois parâmetros: a data). */
export function sqlForaDeVigencia(coluna: string): string {
  const ato = `CASE WHEN instr(${coluna}, '~') > 0 THEN substr(${coluna}, 1, instr(${coluna}, '~') - 1) ELSE ${coluna} END`;
  return `EXISTS (SELECT 1 FROM vigencias v WHERE v.alvo = ${ato} AND (v.de IS NULL OR v.de <= ?) AND (v.ate IS NULL OR ? < v.ate) AND v.status IN ('revogada', 'ainda-nao-vigente'))`;
}

/* =============================================================== transições */

const LinhaTransicao = Schema.Struct({
  id: Texto,
  norma_id: Texto,
  dispositivo: Texto,
  tipo: Texto,
  norma_anterior: TextoNulo,
  aplica_a: Texto,
  regra: Texto,
  inicio: Texto,
  fim: Texto,
  inicio_em: TextoNulo,
  inicio_minimo: TextoNulo,
  fim_em: TextoNulo,
  evidencia: Texto,
  path: Texto,
});
const linhasTransicao = Sql.todas(LinhaTransicao);

export type TransicaoNoBanco = typeof LinhaTransicao.Type & DatasTransicao & { situacao: Situacao };

/**
 * Regras de transição dos atos (que eles estabelecem ou que preservam efeitos deles, como
 * `transicoesAplicaveis`), na ordem do arquivo, com a situação na data (`situacaoNaData`).
 */
export const transicoesDosAtos = Effect.fn("consultasNormas.transicoesDosAtos")(function* (
  atos: readonly string[],
  data: string,
) {
  const vazio: TransicaoNoBanco[] = [];
  if (!atos.length) return vazio;
  const marcadores = atos.map(() => "?").join(", ");
  const linhas = yield* linhasTransicao(
    `SELECT id, norma_id, dispositivo, tipo, norma_anterior, aplica_a, regra, inicio, fim, inicio_em, inicio_minimo, fim_em, evidencia, path
           FROM transicoes WHERE norma_id IN (${marcadores}) OR norma_anterior IN (${marcadores}) ORDER BY rowid`,
    [...atos, ...atos],
  );
  return linhas.map((t): TransicaoNoBanco => ({ ...t, situacao: situacaoNaData(t, data) }));
});
