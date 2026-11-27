/**
 * Consultas do serviço `Normas` ao `kb.sqlite`: as normas, a busca textual nos metadados e nos
 * dispositivos, e as tabelas normativas (dispositivos, vigências, transições e correspondências), pelo
 * `SqlClient`, com as linhas decodificadas por Effect Schema na borda. As regras não são reescritas
 * aqui: a herança da
 * correspondência, os descendentes e a situação da transição numa data usam as mesmas funções da
 * API de arquivos (`correspondenciaEm`, `descendentesEm`, `situacaoNaData`). `base.test.ts` confere
 * que banco e arquivos dão o mesmo resultado.
 *
 * Exports: `obterNorma`, `buscarNormaDetalhada`, `obterDispositivo`, `descendentes`, `paraTrecho`, `trechoDoDispositivo`,
 * `dispositivoOuAncestral`, `tabelasCorrespondencia`, `carregarFonteCorrespondencia`,
 * `vigenciaNaData`, `sqlForaDeVigencia` (pura), `transicoesDosAtos`; tipos `DispositivoDoBanco`,
 * `TrechoDispositivo`, `VigenciaNoBanco`, `TransicaoNoBanco`, `NormaResumo`, `ResultadoNorma`,
 * `ResultadoBuscaNorma`. O registro do resolvedor, as relações e a `data_referencia` vêm de
 * `FontesNormativas`.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/sql/SqlClient";
import { conceitosDaConsulta, expressaoFts } from "../busca/fts.ts";
import * as FontesNormativas from "../FontesNormativas.ts";
import type { DispositivoDaFonte, FonteCorrespondencia, TabelaCorrespondencia } from "../normas/correspondencia.ts";
import { descendentesEm, type Dispositivo, TIPOS_DISPOSITIVO, TIPOS_NOTA } from "../normas/estrutura.ts";
import { resolverCitacao } from "../normas/resolver.ts";
import { type DatasTransicao, type Situacao, STATUS_VIGENCIA, situacaoNaData } from "../normas/vigencia.ts";
import { markdownDoArquivo } from "./consultas-documentos.ts";
import * as Sql from "./sql.ts";

const Texto = Schema.String;
const TextoNulo = Schema.NullOr(Schema.String);
const Inteiro = Schema.Int;
const ListaTextos = Schema.Array(Schema.String);

/* ============================================================== dispositivos */

const COLUNAS_DISPOSITIVO =
  "rowid, id, norma_id, dispositivo, tipo, rotulo, pai, ordem, texto, caput_json, texto_com_caput, estrutura_json, notas_json, revogado, vetado, path, linha_inicio, linha_fim";

const LinhaDispositivo = Schema.Struct({
  rowid: Inteiro,
  id: Texto,
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

/** Dispositivo pelo ID (`br/cne-cp/res/2026/2#art71-parunico`). */
export const obterDispositivo = Effect.fn("consultasNormas.obterDispositivo")(function* (id: string) {
  if (!id.includes("#")) return undefined;
  return yield* uma(`SELECT ${COLUNAS_DISPOSITIVO} FROM dispositivos WHERE id = ?`, [id]);
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
  /** ID da norma com o dispositivo (`br/cne-cp/res/2026/2#art28-vii`). */
  id: string;
  tipo: Dispositivo["tipo"];
  rotulo: string;
  /** Textos dos ancestrais, do artigo até o pai. */
  caput: string[];
  /** Divisões estruturais em que o dispositivo está (`CAPÍTULO V`…). */
  estrutura: string[];
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
    id: d.disp.id,
    tipo: d.disp.tipo,
    rotulo: d.disp.rotulo,
    caput: d.disp.caput,
    estrutura: d.disp.estrutura,
    texto: d.disp.texto,
    subordinados: filhos.map((f) => ({ id: f.disp.id, texto: f.disp.texto })),
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

const LinhaDispositivoCorrespondencia = Schema.Struct({
  dispositivo: Texto,
  tipo: Schema.Literals(TIPOS_DISPOSITIVO),
  rotulo: Texto,
  pai: TextoNulo,
  texto: Texto,
});
const linhasDispositivoCorrespondencia = Sql.todas(LinhaDispositivoCorrespondencia);

/**
 * Fonte da correspondência (`correspondenciaEm`, `destinosDeOrigemEm`, `alinhamentoEm`) sobre o banco,
 * carregada de uma vez: todas as tabelas de correspondência e, dos atos de origem e de destino, os
 * dispositivos (tipo, rótulo, pai e texto) na ordem do arquivo. A regra só pergunta por esses atos.
 */
export const carregarFonteCorrespondencia: Effect.Effect<
  FonteCorrespondencia,
  Sql.FalhaNaConsulta,
  SqlClient.SqlClient
> = Effect.gen(function* () {
  const tabelas = yield* tabelasCorrespondencia();
  const atos = [...new Set(tabelas.flatMap((t) => [t.origem, t.destino]))];
  const porOrigem = new Map<string, TabelaCorrespondencia[]>();
  for (const t of tabelas) porOrigem.set(t.origem, [...(porOrigem.get(t.origem) ?? []), t]);

  const dispositivos = new Map<string, DispositivoDaFonte>();
  const ordem = new Map<string, string[]>();
  for (const ato of atos) {
    const linhas = yield* linhasDispositivoCorrespondencia(
      "SELECT dispositivo, tipo, rotulo, pai, texto FROM dispositivos WHERE norma_id = ? ORDER BY ordem",
      [ato],
    );
    for (const { dispositivo, ...d } of linhas) dispositivos.set(`${ato}${dispositivo}`, d);
    ordem.set(
      ato,
      linhas.map((l) => l.dispositivo),
    );
  }

  const fonte: FonteCorrespondencia = { tabelas: porOrigem, dispositivos, ordem };
  return fonte;
}).pipe(Effect.withSpan("consultasNormas.carregarFonteCorrespondencia"));

/* ================================================================= vigência */

const LinhaVigencia = Schema.Struct({
  alvo: Texto,
  de: TextoNulo,
  ate: TextoNulo,
  status: Schema.Literals(STATUS_VIGENCIA),
  fonte: Texto,
});
const primeiraVigencia = Sql.primeira(LinhaVigencia);

export interface VigenciaNoBanco {
  alvo: string;
  status: (typeof STATUS_VIGENCIA)[number];
  /** Intervalo que contém a data ([de, ate), `null` = aberto) e o que o abre. */
  de: string | null;
  ate: string | null;
  fonte: string;
}

/** Status de um ato numa data, pelo intervalo gravado (o mesmo de `statusEm`); `null` para ato sem vigência. */
export const vigenciaNaData = Effect.fn("consultasNormas.vigenciaNaData")(function* (id: string, data: string) {
  const v = yield* primeiraVigencia(
    "SELECT alvo, de, ate, status, fonte FROM vigencias WHERE alvo = ? AND (de IS NULL OR de <= ?) AND (ate IS NULL OR ? < ate)",
    [id.split("#")[0]!, data, data],
  );
  if (v === undefined) return null;
  const vigencia: VigenciaNoBanco = v;
  return vigencia;
});

/** Condição SQL: o ato de `coluna` está revogado ou ainda não vigente na data (dois parâmetros: a data). */
export function sqlForaDeVigencia(coluna: string): string {
  return `EXISTS (SELECT 1 FROM vigencias v WHERE v.alvo = ${coluna} AND (v.de IS NULL OR v.de <= ?) AND (v.ate IS NULL OR ? < v.ate) AND v.status IN ('revogada', 'ainda-nao-vigente'))`;
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
    `SELECT id, norma_id, dispositivo, tipo, norma_anterior, aplica_a, regra, inicio, fim, inicio_em, fim_em, evidencia, path
           FROM transicoes WHERE norma_id IN (${marcadores}) OR norma_anterior IN (${marcadores}) ORDER BY rowid`,
    [...atos, ...atos],
  );
  return linhas.map((t): TransicaoNoBanco => ({ ...t, situacao: situacaoNaData(t, data) }));
});

/* ==================================================================== normas */

const LinhaNorma = Schema.Struct({
  id: Texto,
  situacao: Texto,
  titulo: Texto,
  status_vigencia: TextoNulo,
  assinada_em: TextoNulo,
  publicada_em: TextoNulo,
  ementa: TextoNulo,
  path: TextoNulo,
});
const primeiraNorma = Sql.primeira(LinhaNorma);

export interface NormaResumo {
  id: string;
  situacao: string;
  titulo: string;
  status_vigencia: string | null;
  /** Data do ato (assinatura). */
  assinada_em: string | null;
  /** Publicação oficial: data, "a confirmar" ou "aguardando publicação"; `null` no stub sem ela. */
  publicada_em: string | null;
  ementa: string | null;
  path: string | null;
}

const SQL_NORMA =
  "SELECT id, situacao, titulo, status_vigencia, assinada_em, publicada_em, ementa, path FROM normas WHERE id = ?";

/** Norma pelo ID; `null` se não registrada. */
export const obterNorma = Effect.fn("consultasNormas.obterNorma")(function* (id: string) {
  const linha: NormaResumo | undefined = yield* primeiraNorma(SQL_NORMA, [id]);
  return linha ?? null;
});

/** A busca de normas: os achados e os avisos (ID desconhecido, citação excluída pelos filtros). */
export interface ResultadoBuscaNorma {
  resultados: ResultadoNorma[];
  avisos: string[];
}

export interface ResultadoNorma {
  norma: NormaResumo;
  /** Dispositivo (ID canônico, caput herdado, texto literal, arquivo e linhas), quando o achado é um dispositivo. */
  dispositivo: TrechoDispositivo | null;
  /** Dispositivo citado que não está no texto da base, quando `dispositivo` é o ancestral mais próximo. */
  pedido: string | null;
  /** Metadados da norma (título, aliases, palavras-chave, ementa), quando o achado é a própria norma. */
  metadados: { texto: string; path: string; linha: number } | null;
  pontuacao: number | null;
  origem: "citacao-resolvida" | "busca-textual";
}

/** Opções de `buscarNormaDetalhada`. O registro do resolvedor e a `data_referencia` vêm de `FontesNormativas`. */
export interface OpcoesBuscaNorma {
  readonly limite?: number;
  readonly situacao?: string;
  readonly vigentes?: boolean;
  readonly em?: string;
}

const LinhaMetadados = Schema.Struct({
  rowid: Inteiro,
  norma_id: Texto,
  texto: Texto,
  path: Texto,
  linha: Inteiro,
});
const primeirosMetadados = Sql.primeira(LinhaMetadados);
const linhasMetadadosPontuados = Sql.todas(Schema.Struct({ ...LinhaMetadados.fields, pontuacao: Schema.Number }));
const linhasDispositivosPontuados = Sql.todas(
  Schema.Struct({ rowid: Inteiro, id: Texto, norma_id: Texto, pontuacao: Schema.Number }),
);
const primeiraForaDeVigencia = Sql.primeira(Schema.Struct({ fora: Inteiro }));

const metadadosDaNorma = Effect.fn("consultasNormas.metadadosDaNorma")(function* (normaId: string) {
  const m = yield* primeirosMetadados(
    "SELECT rowid, norma_id, texto, path, linha FROM normas_metadados WHERE norma_id = ?",
    [normaId],
  );
  if (!m) return null;
  const metadados: ResultadoNorma["metadados"] = { texto: m.texto, path: m.path, linha: m.linha };
  return metadados;
});

/** O ato está revogado ou ainda não vigente na data (intervalos de `vigencias`). */
const atoForaDeVigencia = Effect.fn("consultasNormas.atoForaDeVigencia")(function* (normaId: string, data: string) {
  const linha = yield* primeiraForaDeVigencia(
    `SELECT 1 AS fora FROM normas n WHERE n.id = ? AND ${sqlForaDeVigencia("n.id")}`,
    [normaId, data, data],
  );
  return linha !== undefined;
});

/**
 * Busca de normas.
 *
 * - Citação ("Res. CNE/CP 2/2026, art. 28, VII") ou ID (`br/cne-cp/res/2026/2#art28-vii`): o
 *   resolvedor de citações identifica a norma e os dispositivos, e a resposta é cada dispositivo da
 *   tabela `dispositivos` (ID canônico, caput herdado, texto com os subordinados, arquivo e linhas);
 *   dispositivo fora do texto da base cai no ancestral mais próximo (`pedido` guarda o citado).
 *   Norma sem dispositivo citado (ou stub sem texto): os metadados, e a busca textual continua.
 * - Termos: FTS5 por radicais em duas fontes, sem misturar as pontuações (BM25 de tabelas
 *   diferentes não se comparam): com todos os conceitos (AND), primeiro os metadados das normas
 *   (a consulta nomeia a norma), depois os dispositivos (`texto_com_caput`); com algum conceito
 *   (OR), primeiro os dispositivos, depois os metadados.
 * - `vigentes`: tira atos revogados ou ainda não vigentes na data `em` (padrão: `FontesNormativas.diaDaVigencia`),
 *   pelos intervalos de `vigencias`, e dispositivos revogados.
 * - `situacao` e `vigentes` valem também para a citação resolvida: a norma ou o dispositivo citado
 *   que eles excluem não volta, e a resposta fica vazia com um aviso explicando por quê (a busca
 *   textual não substitui a norma que a consulta nomeou).
 * - ID com a forma de norma (`br/…`, `ifpr/…`) que não está na base: resposta vazia com aviso de ID
 *   desconhecido, sem busca textual.
 */
export const buscarNormaDetalhada = Effect.fn("consultasNormas.buscarNormaDetalhada")(function* (
  consulta: string,
  opcoes: OpcoesBuscaNorma = {},
) {
  const fontes = yield* FontesNormativas.FontesNormativas;
  const limite = opcoes.limite ?? 10;
  const saida: ResultadoNorma[] = [];
  const avisos: string[] = [];
  const resposta = (): ResultadoBuscaNorma => ({ resultados: saida, avisos });
  const vazia = (): ResultadoBuscaNorma => ({ resultados: [], avisos });
  const data = opcoes.em ?? (yield* fontes.diaDaVigencia);
  const ehId = /^[a-z]+(\/[\w-]+)+(#[\w-]+)?$/.test(consulta.trim());
  const resolucao: { id: string | null; dispositivoId?: string | undefined; dispositivos?: string[] | undefined } = ehId
    ? {
        id: consulta.trim().split("#")[0]!,
        dispositivoId: consulta.includes("#") ? `#${consulta.split("#")[1]}` : undefined,
      }
    : resolverCitacao(consulta, fontes.registro);
  if (resolucao.id) {
    const norma = yield* obterNorma(resolucao.id);
    if (!norma && ehId && /^(br|ifpr)\//.test(resolucao.id)) {
      avisos.push(`ID desconhecido: ${resolucao.id} não está entre as normas da base`);
      return vazia();
    }
    if (norma) {
      if (opcoes.situacao && norma.situacao !== opcoes.situacao) {
        avisos.push(
          `${norma.id} (citada) tem situação ${norma.situacao}, fora do filtro --situacao ${opcoes.situacao}`,
        );
        return vazia();
      }
      if (opcoes.vigentes && (yield* atoForaDeVigencia(norma.id, data))) {
        avisos.push(
          `${norma.id} (citada) não está vigente em ${data} (${norma.status_vigencia ?? "sem status"}); ` +
            `sem vigentes ela volta, e a ficha da norma (ficha_norma, \`kb ficha-norma ${norma.id}\`) mostra as regras de transição`,
        );
        return vazia();
      }
      const pedidos = resolucao.dispositivos ?? (resolucao.dispositivoId ? [resolucao.dispositivoId] : []);
      const vistos = new Set<string>();
      for (const pedido of pedidos) {
        const achado = yield* dispositivoOuAncestral(`${norma.id}${pedido}`);
        if (!achado || vistos.has(achado.disp.id)) continue;
        vistos.add(achado.disp.id);
        const trecho = yield* paraTrecho(achado, { subordinados: true });
        if (opcoes.vigentes && trecho.revogado) {
          avisos.push(`${trecho.id} (citado) está revogado; sem --vigentes ele volta`);
          continue;
        }
        saida.push({
          norma,
          dispositivo: trecho,
          pedido: achado.disp.dispositivo === pedido ? null : `${norma.id}${pedido}`,
          metadados: null,
          pontuacao: null,
          origem: "citacao-resolvida",
        });
      }
      if (saida.length) return resposta();
      if (avisos.length) return vazia();
      const metadados = yield* metadadosDaNorma(norma.id);
      if (metadados) {
        saida.push({ norma, dispositivo: null, pedido: null, metadados, pontuacao: null, origem: "citacao-resolvida" });
      }
    }
  }

  const conceitos = conceitosDaConsulta(consulta, "radicais");
  const filtros = (colunaNorma: string) => {
    const condicoes: string[] = [];
    const parametros: Sql.Parametro[] = [];
    if (opcoes.situacao) {
      condicoes.push("n.situacao = ?");
      parametros.push(opcoes.situacao);
    }
    if (opcoes.vigentes) {
      condicoes.push(`NOT ${sqlForaDeVigencia(colunaNorma)}`);
      parametros.push(data, data);
    }
    return { sql: condicoes.map((c) => ` AND ${c}`).join(""), parametros };
  };
  const vistosMeta = new Set<number>();
  const vistosDisp = new Set<number>();
  // por etapa da busca textual (duas por operador), não por linha
  const metadados = Effect.fnUntraced(function* (expressao: string) {
    const f = filtros("m.norma_id");
    const linhasMeta = yield* linhasMetadadosPontuados(
      `SELECT m.rowid AS rowid, m.norma_id, m.texto, m.path, m.linha, bm25(normas_fts, 4.0, 1.0, 1.0) AS pontuacao
           FROM normas_fts JOIN normas_metadados m ON m.rowid = normas_fts.rowid JOIN normas n ON n.id = m.norma_id
           WHERE normas_fts MATCH ?${f.sql} ORDER BY pontuacao, m.rowid LIMIT ?`,
      [expressao, ...f.parametros, limite + vistosMeta.size],
    );
    for (const m of linhasMeta) {
      if (saida.length >= limite || vistosMeta.has(m.rowid)) continue;
      if (saida.some((r) => r.metadados && r.norma.id === m.norma_id)) continue;
      vistosMeta.add(m.rowid);
      saida.push({
        norma: (yield* obterNorma(m.norma_id))!,
        dispositivo: null,
        pedido: null,
        metadados: { texto: m.texto, path: m.path, linha: m.linha },
        pontuacao: Math.round(m.pontuacao * 1000) / 1000,
        origem: "busca-textual",
      });
    }
  });
  const dispositivos = Effect.fnUntraced(function* (expressao: string) {
    const f = filtros("d.norma_id");
    const achados = yield* linhasDispositivosPontuados(
      `SELECT d.rowid AS rowid, d.id, d.norma_id, bm25(dispositivos_fts, 1.0, 1.0) AS pontuacao
           FROM dispositivos_fts JOIN dispositivos d ON d.rowid = dispositivos_fts.rowid JOIN normas n ON n.id = d.norma_id
           WHERE dispositivos_fts MATCH ?${f.sql}${opcoes.vigentes ? " AND d.revogado = 0" : ""}
           ORDER BY pontuacao, d.rowid LIMIT ?`,
      [expressao, ...f.parametros, limite + vistosDisp.size],
    );
    for (const a of achados) {
      if (saida.length >= limite || vistosDisp.has(a.rowid)) continue;
      vistosDisp.add(a.rowid);
      const d = (yield* obterDispositivo(a.id))!;
      saida.push({
        norma: (yield* obterNorma(a.norma_id))!,
        dispositivo: yield* paraTrecho(d),
        pedido: null,
        metadados: null,
        pontuacao: Math.round(a.pontuacao * 1000) / 1000,
        origem: "busca-textual",
      });
    }
  });
  for (const operador of ["AND", "OR"] as const) {
    if (saida.length >= limite) break;
    if (operador === "OR" && conceitos.length < 2) break;
    const expressaoMeta = expressaoFts(conceitos, ["radicais"], operador);
    if (!expressaoMeta) break;
    const ordem = operador === "AND" ? [metadados, dispositivos] : [dispositivos, metadados];
    for (const etapa of ordem) yield* etapa(expressaoMeta);
  }
  return resposta();
});

/* ======================================================== catálogo e documento */

const LinhaNormaListada = Schema.Struct({
  id: Texto,
  situacao: Schema.Literals(["base", "stub", "externo"]),
  titulo: Texto,
  tipo_documento: TextoNulo,
  numero: TextoNulo,
  ano: Schema.NullOr(Inteiro),
  orgao: TextoNulo,
  status_vigencia: TextoNulo,
  ementa: TextoNulo,
  aliases_json: Schema.fromJsonString(ListaTextos),
  keywords_json: Schema.fromJsonString(ListaTextos),
});
const linhasNormasListadas = Sql.todas(LinhaNormaListada);

/** Uma norma da base, stub ou referência externa, com os apelidos e as palavras-chave publicados. */
export interface NormaListada {
  readonly id: string;
  readonly situacao: "base" | "stub" | "externo";
  readonly titulo: string;
  readonly tipo_documento: string | null;
  readonly numero: string | null;
  readonly ano: number | null;
  readonly orgao: string | null;
  readonly status_vigencia: string | null;
  readonly ementa: string | null;
  readonly aliases: ReadonlyArray<string>;
  readonly palavras_chave: ReadonlyArray<string>;
}

/**
 * O status de vigência da norma `normas.id` na data do parâmetro (duas vezes), pelos intervalos de
 * `vigencias`; sem intervalo (referência externa), o status publicado.
 */
const STATUS_NA_DATA = `COALESCE((SELECT v.status FROM vigencias v WHERE v.alvo = normas.id
  AND (v.de IS NULL OR v.de <= ?) AND (v.ate IS NULL OR ? < v.ate)), normas.status_vigencia)`;

/** Todas as normas da tabela `normas`, por ID, com o status no dia da vigência (`diaDaVigencia`). */
export const listarNormas = Effect.fn("consultasNormas.listarNormas")(function* () {
  const data = yield* (yield* FontesNormativas.FontesNormativas).diaDaVigencia;
  const linhas = yield* linhasNormasListadas(
    `SELECT id, situacao, titulo, tipo_documento, numero, ano, orgao, ${STATUS_NA_DATA} AS status_vigencia, ementa,
            aliases_json, keywords_json
       FROM normas ORDER BY id`,
    [data, data],
  );
  return linhas.map(({ aliases_json, keywords_json, ...n }): NormaListada => ({
    ...n,
    aliases: aliases_json,
    palavras_chave: keywords_json,
  }));
});

const primeiraNormaDoDocumento = Sql.primeira(
  Schema.Struct({ id: Texto, titulo: Texto, situacao: Texto, path: TextoNulo }),
);
const linhasAncoras = Sql.todas(
  Schema.Struct({
    dispositivo: Texto,
    tipo: Texto,
    rotulo: Texto,
    pai: TextoNulo,
    linha_inicio: Inteiro,
    linha_fim: Inteiro,
    revogado: Inteiro,
  }),
);

/** Um dispositivo do arquivo da norma, como âncora do leitor (sem o texto). */
export interface DispositivoDoDocumento {
  /** Com `#` (`#art28-xviii`). */
  readonly dispositivo: string;
  readonly tipo: string;
  readonly rotulo: string;
  /** ID do pai (`br/…/2#art28`), ou `null` no topo. */
  readonly pai: string | null;
  readonly linha_inicio: number;
  readonly linha_fim: number;
  readonly revogado: boolean;
}

/**
 * Uma norma como documento: os metadados e, só se ela tem o texto na base
 * (`situacao` `base` com `path`), os dispositivos do arquivo em ordem e o Markdown sem o front matter
 * (`null` se a tabela `documentos` não tem o arquivo).
 */
export interface DocumentoNorma {
  readonly id: string;
  readonly titulo: string;
  readonly situacao: string;
  readonly path: string | null;
  readonly dispositivos: ReadonlyArray<DispositivoDoDocumento>;
  readonly markdown: string | null;
}

/** A norma pelo ID do arquivo, como documento; `null` se a tabela `normas` não a tem. */
export const documentoDaNorma = Effect.fn("consultasNormas.documentoDaNorma")(function* (id: string) {
  const norma = yield* primeiraNormaDoDocumento("SELECT id, titulo, situacao, path FROM normas WHERE id = ?", [id]);
  if (!norma) return null;
  const comTexto = norma.situacao === "base" && norma.path !== null;
  const dispositivos = comTexto
    ? (yield* linhasAncoras(
        `SELECT dispositivo, tipo, rotulo, pai, linha_inicio, linha_fim, revogado
         FROM dispositivos WHERE norma_id = ? ORDER BY ordem`,
        [id],
      )).map((d): DispositivoDoDocumento => ({ ...d, revogado: d.revogado === 1 }))
    : [];
  const documento: DocumentoNorma = {
    ...norma,
    dispositivos,
    markdown: comTexto && norma.path !== null ? yield* markdownDoArquivo(norma.path) : null,
  };
  return documento;
});
