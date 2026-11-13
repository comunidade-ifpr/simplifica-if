/**
 * Resolvedor de citações normativas (fase 2 do plano de arquitetura).
 *
 * `extrairCitacoes(texto)` encontra as citações de um texto longo (PPC, parecer) e resolve cada uma;
 * `resolverCitacao(texto)` resolve uma citação isolada (referência de ficha, pergunta de usuário).
 * Ambos devolvem `{ id, dispositivoId?, confianca, regra }`, além da situação do ID no registro.
 *
 * O ID é derivado do ato citado (tipo, órgão, ano e número), esteja a norma na base ou não. O
 * registro (`manifest.json` + `stubs.yaml`) completa citações incompletas: lei sem ano, órgão
 * ausente ou só "CNE", data por extenso. Cada caminho tem uma regra nomeada e uma confiança; nada é
 * corrigido em silêncio.
 *
 * Regras (confiança):
 * - `estrutural` (0,98): tipo, órgão, número e ano explícitos;
 * - `url-planalto`, `url-dou`, `url-mec` (0,95): endereço oficial do ato;
 * - `alias` (0,9): nome próprio sem número (LDB, Lei do Estágio...), do registro ou embutido;
 * - `tipo-implicito` (0,9): "CNE/CP nº 1/2021", sem "Resolução";
 * - `enumeracao` (0,9): "Leis nº 10.639/2003 e 11.645/2008" herda tipo e órgão;
 * - `sem-ano-registro` (0,9): "Lei nº 11.788", ano tirado do registro;
 * - `orgao-implicito-ifpr` (0,85): "Resolução IFPR nº 50/2017" → CONSUP;
 * - `data-registro` (0,85): "Resolução nº 1, de 5 de janeiro de 2021", sem órgão, casada pela data;
 * - `ano-divergente-registro` (0,8): lei com número do registro e ano diferente (erro de digitação);
 * - `orgao-incompleto-registro` (0,8): "Resolução CNE nº 6/2012", câmara única no registro;
 * - `dcnept-2021-orgao-incompleto` (0,8) e `dcnept-2021-orgao-trocado` (0,7): a DCN da EPT de 2021
 *   citada como "CNE nº 1/2021" ou "CNE/CEB nº 1/2021" seguida de "educação profissional" ou da data
 *   de 5 de janeiro (17 PPCs fazem isso). A CNE/CEB nº 1/2021 de fato existe (EJA, 28/05/2021);
 *   sem contexto de EPT, a citação fica com ela; `dcnept-2021-tipo-trocado` (0,7) cobre "Parecer CNE/CP
 *   nº 01/2021, que define as Diretrizes...";
 * - `orgao-no-documento` (0,85) e `ano-no-documento` (0,8): citação incompleta completada pelo ato
 *   que o mesmo documento cita por inteiro ("Resolução nº 54/2011" e, noutra linha, "Resolução
 *   CONSUP/IFPR nº 54/2011"), se a data não divergir;
 * - `orgao-contexto-ifpr` (0,75): "no IFPR, pela Resolução nº 56/2012", sem ato no registro;
 * - `orgao-ausente-registro` (0,7): "Resolução nº 50/2017", sem órgão, com um único ato no registro
 *   (não decide, `orgao-conflitante`, se o texto fala do IFPR e o registro aponta ato federal).
 * Sem ID (`id: null`): `orgao-ausente`, `orgao-ambiguo`, `orgao-conflitante`, `sem-ano`,
 * `ato-nao-federal`, `ato-local` (portaria de campus), `nao-reconhecida`.
 */
import { analisarDispositivos, dispositivoAntes, dispositivoDepois } from "./dispositivos.ts";
import { ehIdExterno, montarIdNorma, partesIdNorma } from "./ids.ts";
import { carregarRegistro, type Registro, type Situacao } from "./registro.ts";
import { normalizarComMapa, normalizarCitacao } from "./texto-citacao.ts";

export interface Resolucao {
  /** ID canônico do ato (norma, stub ou `externo:`); `null` quando a citação não identifica o ato. */
  id: string | null;
  /** Primeiro dispositivo citado (`#art28-xvi`). */
  dispositivoId?: string;
  /** Todos os dispositivos, quando a citação traz mais de um. */
  dispositivos?: string[];
  confianca: number;
  regra: string;
  situacao: Situacao | "nao-registrada" | "nao-resolvida";
}

export interface Citacao extends Resolucao {
  /** Posições no texto original (UTF-16), fim exclusivo. */
  inicio: number;
  fim: number;
  /** Linha (1-based) do início da citação. */
  linha: number;
  /** Trecho literal do texto original. */
  trecho: string;
}

/* ------------------------------------------------------------------ vocabulário */

const MESES = "janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro";
const NUMERO_MES: Readonly<Record<string, string>> = Object.fromEntries(
  MESES.split("|").map((mes, indice) => [mes, String(indice + 1).padStart(2, "0")]),
);

/** Tipo citado → segmento de tipo do ID. A ordem importa: formas compostas antes das simples. */
const TIPOS: readonly [RegExp, string][] = [
  [/^lei\s+complementar/, "lc"],
  [/^decretos?[\s-]+leis?/, "decreto-lei"],
  [/^decreto/, "decreto"],
  [/^lei/, "lei"],
  [/^medida\s+provisoria/, "mp"],
  [/^emenda\s+constitucional/, "ec"],
  [/^res/, "res"],
  [/^parecer/, "parecer"],
  [/^portaria/, "portaria"],
  [/^(?:instruc|in$)/, "in"],
  [/^nota/, "nt"],
  [/^deliberac/, "deliberacao"],
];
const RE_TIPO =
  /\b(?:leis?\s+complementar(?:es)?|decretos?[\s-]+leis?|decretos?|leis?|medidas?\s+provisorias?|emendas?\s+constitucion(?:al|ais)|resolucoes|resolucao|res\.|pareceres|parecer|portarias?(?:\s+normativas?)?|instrucoes\s+normativas|instrucao\s+normativa|in|notas?\s+tecnicas?|deliberacoes|deliberacao)(?![a-z])/g;
const TIPOS_SEM_ORGAO = new Set(["lei", "lc", "decreto", "decreto-lei", "mp", "ec"]);

interface Orgao {
  /** `nao-federal`: ato estadual ou municipal; `local`: ato de campus (portaria de diretor-geral). */
  jurisdicao: "br" | "ifpr" | "externo" | "nao-federal" | "local";
  /** Segmento do ID; `null` = órgão implícito (só "IFPR"); `"cne"` = câmara não informada. */
  orgao: string | null;
}

/** Conselhos profissionais citados pelo nome → sigla do `externo:`. */
const CONSELHOS_POR_NOME: readonly [string, string][] = [
  ["farmacia", "cff"],
  ["enfermagem", "cofen"],
  ["nutricionistas", "cfn"],
  ["medicina\\s+veterinaria", "cfmv"],
  ["quimica", "cfq"],
  ["engenharia\\s+e\\s+agronomia", "confea"],
  ["biologia", "cfbio"],
  ["contabilidade", "cfc"],
  ["administracao", "cfa"],
  ["educacao\\s+fisica", "confef"],
  ["psicologia", "cfp"],
  ["servico\\s+social", "cfess"],
  ["arquitetura\\s+e\\s+urbanismo", "cau"],
];

/** Órgãos reconhecidos, do mais específico ao mais genérico. */
const ORGAOS: readonly [RegExp, Orgao][] = [
  [
    /\bifpr\s*\/\s*campus\b|\/\s*dg\s*\/|\bdg\s*\/\s*[a-z]|\bdirecao[\s-]+geral\s+do\s+campus/,
    {
      jurisdicao: "local",
      orgao: null,
    },
  ],
  [/cne\s*\/\s*cp\b|\bcp\s*\/\s*cne\b|conselho\s+pleno/, { jurisdicao: "br", orgao: "cne-cp" }],
  [
    /cne\s*\/\s*c(?:eb|be)\b|\bceb\s*\/\s*cne\b|camara\s+de\s+educacao\s+basica/,
    { jurisdicao: "br", orgao: "cne-ceb" },
  ],
  [/cne\s*\/\s*ces\b|\bces\s*\/\s*cne\b|camara\s+de\s+educacao\s+superior/, { jurisdicao: "br", orgao: "cne-ces" }],
  [/\bcne\b|conselho\s+nacional\s+de\s+educacao/, { jurisdicao: "br", orgao: "cne" }],
  [/\bconsup\b|conselho\s+superior/, { jurisdicao: "ifpr", orgao: "consup" }],
  [/\bconsepe\b/, { jurisdicao: "ifpr", orgao: "consepe" }],
  [/\bproens\b|pro-?\s*reitoria\s+de\s+ensino/, { jurisdicao: "ifpr", orgao: "proens" }],
  [/\bproepi\b/, { jurisdicao: "ifpr", orgao: "proepi" }],
  [/\bproad\b/, { jurisdicao: "ifpr", orgao: "proad" }],
  [/\breitoria\b|\breitor\b/, { jurisdicao: "ifpr", orgao: "reitoria" }],
  [/\bifpr\b|instituto\s+federal\s+do\s+parana/, { jurisdicao: "ifpr", orgao: null }],
  [/\bsetec\b/, { jurisdicao: "br", orgao: "setec" }],
  [/\bmec\b|ministerio\s+da\s+educacao/, { jurisdicao: "br", orgao: "mec" }],
  [/\bcapes\b/, { jurisdicao: "br", orgao: "capes" }],
  [/\binep\b/, { jurisdicao: "br", orgao: "inep" }],
  [/\bfnde\b/, { jurisdicao: "br", orgao: "fnde" }],
  [/\bconaes\b|comissao\s+nacional\s+de\s+avaliacao\s+da\s+educacao\s+superior/, { jurisdicao: "br", orgao: "conaes" }],
  [/\bcft\b|conselho\s+federal\s+dos\s+tecnicos/, { jurisdicao: "externo", orgao: "cft" }],
  [
    /\b(cofen|coren|confea|crea|cfn|crn|cfmv|crmv|cfq|crq|cff|crf|cfbio|crbio|cfc|crc|cfa|cra|confef|cref|cfp|crp|coffito|crefito|cfess|cress|crt|cfta|contran|conama|anvisa|cfm|cfo|cofeci|cau)\b/,
    { jurisdicao: "externo", orgao: "$1" },
  ],
  ...CONSELHOS_POR_NOME.map(([nome, sigla]): [RegExp, Orgao] => [
    new RegExp(`conselho\\s+federal\\s+de\\s+${nome}`),
    { jurisdicao: "externo", orgao: sigla },
  ]),
  [
    /\bestadua(?:l|is)\b|\bmunicipa(?:l|is)\b|\bdistrita(?:l|is)\b|\bcee\b|\bseed\b/,
    {
      jurisdicao: "nao-federal",
      orgao: null,
    },
  ],
];

function orgaoEm(trecho: string): { orgao: Orgao; inicio: number; fim: number } | null {
  for (const [padrao, orgao] of ORGAOS) {
    const m = padrao.exec(trecho);
    if (!m) continue;
    const segmento = orgao.orgao === "$1" ? (m[1] ?? null) : orgao.orgao;
    return { orgao: { jurisdicao: orgao.jurisdicao, orgao: segmento }, inicio: m.index, fim: m.index + m[0].length };
  }
  return null;
}

/* ------------------------------------------------------------------ núcleo número/ano */

const MARCADOR = String.raw`(?:n(?:r|os|o)?\s*\.?\s*o?\s*\.?\s*:?\s*|numero\s*)`;
/**
 * Número do ato (com ponto ou vírgula de milhar, "9.394" ou "9,503") seguido do ano: "/2021",
 * "/96", ", de 5 de janeiro de 2021" (também "dejaneiro" e "aprovado em 8 de outubro de 2008"),
 * ", de 9/01/2001" ou " de 2008".
 */
const RE_NUCLEO = new RegExp(
  String.raw`(?<![\w./,$])(${MARCADOR})?(\d{1,3}(?:[.,]\d{3})+(?!\d)|\d+)(?:` +
    String.raw`\s*/\s*(\d{4}|\d{2})(?![\d/])` +
    String.raw`|\s*[,.]?\s*(?:(?:de|em|aprovad[oa]\s+em)\s*)?(?:(\d{1,2})\s*o?\s*(?:de\s*)?)?(${MESES})\s*(?:de\s*)?(\d{4})(?!\d)` +
    String.raw`|\s*,?\s*de\s+(\d{4})(?!\d)` +
    String.raw`|\s*,?\s*de\s+(\d{1,2})\s*/\s*(\d{1,2})\s*/\s*(\d{4})(?!\d)` +
    String.raw`)?`,
  "g",
);

interface Nucleo {
  inicio: number;
  fim: number;
  numero: string;
  ano: number | null;
  data: string | null;
  comMarcador: boolean;
}

function anoCompleto(ano: string): number {
  if (ano.length === 4) return Number(ano);
  const dois = Number(ano);
  return dois > 30 ? 1900 + dois : 2000 + dois;
}

function lerNucleo(m: RegExpExecArray): Nucleo | null {
  const numeroBruto = m[2]!;
  const numero = numeroBruto.replace(/[.,]/g, "").replace(/^0+(?=\d)/, "");
  if (numero === "0") return null;
  let ano: number | null = null;
  let data: string | null = null;
  if (m[3]) ano = anoCompleto(m[3]);
  else if (m[6]) {
    ano = Number(m[6]);
    data = m[4] ? `${m[6]}-${NUMERO_MES[m[5]!]}-${m[4].padStart(2, "0")}` : null;
  } else if (m[7]) ano = Number(m[7]);
  else if (m[10]) {
    ano = Number(m[10]);
    data = `${m[10]}-${m[9]!.padStart(2, "0")}-${m[8]!.padStart(2, "0")}`;
  }
  const comMarcador = Boolean(m[1]);
  if (ano === null && !comMarcador && !/[.,]/.test(numeroBruto)) return null;
  if (ano !== null && (ano < 1930 || ano > 2030)) return null;
  return { inicio: m.index, fim: m.index + m[0].length, numero, ano, data, comMarcador };
}

/* ------------------------------------------------------------------ aliases e URLs */

/** Nomes próprios embutidos (além dos aliases sem número do registro). */
const ALIASES_EMBUTIDOS: readonly [RegExp, string][] = [
  [/\bldben?\b/g, "br/lei/1996/9394"],
  [/\blei\s+de\s+diretrizes\s+e\s+bases(?:\s+da\s+educacao(?:\s+nacional)?)?/g, "br/lei/1996/9394"],
  [/\blei\s+do\s+estagio\b/g, "br/lei/2008/11788"],
  [/\blei\s+brasileira\s+de\s+inclusao\b|\bestatuto\s+da\s+pessoa\s+com\s+deficiencia\b/g, "br/lei/2015/13146"],
  [/\blei\s+de\s+cotas\b/g, "br/lei/2012/12711"],
];
/** Só para `resolverCitacao` (referências de ficha): catálogo, não norma. */
const ALIASES_ISOLADOS: readonly [RegExp, string][] = [
  [/^(?:o\s+)?(?:cnct|catalogo\s+nacional\s+de\s+cursos\s+tecnicos)\b/, "cnct:catalogo"],
];
/** Aliases do registro que não identificam um único ato. */
const ALIASES_AMBIGUOS = new Set(
  [
    "Diretrizes Curriculares Nacionais para a Educação Profissional e Tecnológica",
    "Novas DCN da EPT",
    "Educação Integral em Tempo Integral",
    "LDB - trechos relevantes",
    "Diretrizes Operacionais da EJA",
    "Diretrizes Operacionais Nacionais para a EJA",
    "Rede Nacional de Certificação Profissional",
    "Estatuto do IFPR",
    "Novo Estatuto do IFPR",
  ].map(normalizarCitacao),
);

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const cacheAliases = new WeakMap<Registro, [RegExp, string][]>();

function aliasesDoRegistro(registro: Registro): [RegExp, string][] {
  const emCache = cacheAliases.get(registro);
  if (emCache) return emCache;
  const lista: [RegExp, string][] = [...ALIASES_EMBUTIDOS];
  for (const entrada of registro.entradas) {
    if (entrada.situacao === "externo") continue;
    for (const alias of entrada.aliases) {
      const normalizado = normalizarCitacao(alias).trim();
      if (/\d/.test(normalizado) || normalizado.length < 3 || ALIASES_AMBIGUOS.has(normalizado)) continue;
      const fonte = escaparRegex(normalizado).replace(/\s+/g, "\\s+");
      lista.push([new RegExp(`(?<![a-z0-9])${fonte}(?![a-z0-9])`, "g"), entrada.id.split("~")[0]!]);
    }
  }
  cacheAliases.set(registro, lista);
  return lista;
}

const RE_URL = /\b(?:https?:\/\/)?(?:www\d?\.)?(planalto\.gov\.br|in\.gov\.br|portal\.mec\.gov\.br)\/[^\s)<>\]"'|]+/g;

function idDeUrl(url: string, registro: Registro): { id: string | null; regra: string } | null {
  if (url.includes("planalto.gov.br")) {
    const arquivo = /\/(lcp|del|l|d)(\d+)[a-z]*\.htm/.exec(url);
    if (!arquivo) return null;
    const tipo = { l: "lei", d: "decreto", lcp: "lc", del: "decreto-lei" }[arquivo[1] as "l" | "d" | "lcp" | "del"];
    const numero = arquivo[2]!.replace(/^0+(?=\d)/, "");
    const ano = /\/(\d{4})\/(?:lei|decreto|del|lcp|l|d)?/.exec(url.replace(/_ato\d{4}-\d{4}/, ""));
    if (ano)
      return {
        id: montarIdNorma({ jurisdicao: "br", orgao: null, tipo, ano: ano[1]!, numero }),
        regra: "url-planalto",
      };
    const candidatos = registro.atosPorNumero(tipo, numero);
    return candidatos.length === 1 ? { id: candidatos[0]!.id, regra: "url-planalto" } : null;
  }
  if (url.includes("in.gov.br")) {
    const m =
      /\/-\/(resolucao|portaria|lei|decreto|parecer|instrucao-normativa)(?:-([a-z]+))?(?:\/([a-z]+))?-n-(\d+)-de-?(\d+)-de-?([a-z]+?)-de-?(\d{4})/.exec(
        url,
      );
    if (!m) return null;
    const tipo =
      { resolucao: "res", portaria: "portaria", lei: "lei", decreto: "decreto", parecer: "parecer" }[
        m[1] as "resolucao"
      ] ?? "in";
    const numero = m[4]!;
    const ano = m[7]!;
    if (TIPOS_SEM_ORGAO.has(tipo)) {
      return { id: montarIdNorma({ jurisdicao: "br", orgao: null, tipo, ano, numero }), regra: "url-dou" };
    }
    if (m[2] === "cne" && m[3]) {
      return { id: montarIdNorma({ jurisdicao: "br", orgao: `cne-${m[3]}`, tipo, ano, numero }), regra: "url-dou" };
    }
    const data = `${ano}-${NUMERO_MES[m[6]!] ?? "00"}-${m[5]!.padStart(2, "0")}`;
    const candidatos = registro.normasPorData(tipo, numero, data);
    return candidatos.length === 1 ? { id: candidatos[0]!.id, regra: "url-dou" } : null;
  }
  const mec = /\/(r|p)(cp|ceb|ces)0*(\d+)_(\d{2,4})\.pdf/.exec(url);
  if (!mec) return null;
  return {
    id: montarIdNorma({
      jurisdicao: "br",
      orgao: `cne-${mec[2]}`,
      tipo: mec[1] === "r" ? "res" : "parecer",
      ano: anoCompleto(mec[4]!),
      numero: mec[3]!,
    }),
    regra: "url-mec",
  };
}

/* ------------------------------------------------------------------ resolução estrutural */

const CONFIANCA: Readonly<Record<string, number>> = {
  estrutural: 0.98,
  "url-planalto": 0.95,
  "url-dou": 0.95,
  "url-mec": 0.95,
  alias: 0.9,
  "tipo-implicito": 0.9,
  enumeracao: 0.9,
  "sem-ano-registro": 0.9,
  "orgao-implicito-ifpr": 0.85,
  "data-registro": 0.85,
  "ano-divergente-registro": 0.8,
  "orgao-incompleto-registro": 0.8,
  "dcnept-2021-orgao-incompleto": 0.8,
  "dcnept-2021-orgao-trocado": 0.7,
  "dcnept-2021-tipo-trocado": 0.7,
  "orgao-ausente-registro": 0.7,
  "orgao-contexto-ifpr": 0.75,
  "orgao-no-documento": 0.85,
  "ano-no-documento": 0.8,
};

/** Órgão implícito quando só "IFPR" aparece, por tipo de ato. */
const ORGAO_IFPR_POR_TIPO: Readonly<Record<string, string>> = {
  res: "consup",
  portaria: "reitoria",
  in: "reitoria",
  nt: "proens",
};

const RE_CONTEXTO_EPT =
  /educacao\s*-?\s*profissional|diretrizes\s+curriculares\s+nacionais\s+gerais|\bdcn\s*-?\s*ept\b/;
const RE_CONTEXTO_EJA = /jovens\s+e\s+adultos|\beja\b/;

interface Ato {
  tipo: string;
  orgao: Orgao | null;
  numero: string;
  ano: number | null;
  data: string | null;
  /** O texto logo antes da citação fala do IFPR ("no IFPR, pela Resolução nº 56/2012"). */
  contextoIfpr?: boolean;
}

function resultado(id: string | null, regra: string, registro: Registro): Resolucao {
  const situacao: Resolucao["situacao"] =
    id === null ? "nao-resolvida" : id.startsWith("cnct:") ? "externo" : registro.situacao(id);
  return { id, confianca: id === null ? 0 : (CONFIANCA[regra] ?? 0.5), regra, situacao };
}

/** Resolve um ato já decomposto. `depois` é o texto que segue a citação, para as regras de contexto. */
function resolverAto(ato: Ato, depois: string, registro: Registro, regraBase = "estrutural"): Resolucao {
  const { tipo, orgao, numero, ano, data } = ato;
  if (orgao?.jurisdicao === "nao-federal") return resultado(null, "ato-nao-federal", registro);
  if (orgao?.jurisdicao === "local") return resultado(null, "ato-local", registro);

  if (TIPOS_SEM_ORGAO.has(tipo)) {
    if (ano === null) {
      const candidatos = registro.atosPorNumero(tipo, numero);
      return candidatos.length === 1
        ? resultado(candidatos[0]!.id, "sem-ano-registro", registro)
        : resultado(null, "sem-ano", registro);
    }
    const id = montarIdNorma({ jurisdicao: "br", orgao: null, tipo, ano, numero });
    if (registro.situacao(id) === "nao-registrada") {
      const candidatos = registro.atosPorNumero(tipo, numero);
      if (candidatos.length === 1 && Math.abs(partesIdNorma(candidatos[0]!.id)!.ano - ano) <= 1) {
        return resultado(candidatos[0]!.id, "ano-divergente-registro", registro);
      }
    }
    return resultado(id, regraBase, registro);
  }

  if (ano === null) return resultado(null, "sem-ano", registro);

  // A DCN da EPT de 2021 citada como "Parecer CNE/CP nº 01/2021, que define as Diretrizes...".
  if (tipo === "parecer" && numero === "1" && ano === 2021 && orgao?.orgao === "cne-cp") {
    if (/^\W{0,6}(?:que\s+)?define\s+as\s+diretrizes/.test(depois) || RE_CONTEXTO_EPT.test(depois.slice(0, 160))) {
      return resultado("br/cne-cp/res/2021/1", "dcnept-2021-tipo-trocado", registro);
    }
  }

  // DCN da EPT de 2021 citada com o órgão trocado ou incompleto.
  if (numero === "1" && ano === 2021 && (orgao?.orgao === "cne-ceb" || orgao?.orgao === "cne") && tipo === "res") {
    const contexto = depois.slice(0, 220);
    const ept = data === "2021-01-05" || (RE_CONTEXTO_EPT.test(contexto) && !RE_CONTEXTO_EJA.test(contexto));
    if (ept) {
      return resultado(
        "br/cne-cp/res/2021/1",
        orgao.orgao === "cne" ? "dcnept-2021-orgao-incompleto" : "dcnept-2021-orgao-trocado",
        registro,
      );
    }
    if (orgao.orgao === "cne" && RE_CONTEXTO_EJA.test(contexto)) {
      return resultado("br/cne-ceb/res/2021/1", "orgao-incompleto-registro", registro);
    }
  }

  if (orgao === null) {
    if (data) {
      const porData = registro.normasPorData(tipo, numero, data);
      if (porData.length === 1) return resultado(porData[0]!.id, "data-registro", registro);
    }
    // Com data na citação, o ato do registro só serve se a data não divergir.
    const porChave = registro
      .normasPorChave(tipo, ano, numero)
      .filter((entrada) => !data || !entrada.data_publicacao || entrada.data_publicacao === data);
    const implicito = ORGAO_IFPR_POR_TIPO[tipo];
    if (porChave.length === 1) {
      // O registro aponta um ato federal, mas o texto fala do IFPR logo antes: não decide.
      if (ato.contextoIfpr && !porChave[0]!.id.startsWith("ifpr/"))
        return resultado(null, "orgao-conflitante", registro);
      return resultado(porChave[0]!.id, "orgao-ausente-registro", registro);
    }
    if (ato.contextoIfpr && implicito) {
      return resultado(
        montarIdNorma({ jurisdicao: "ifpr", orgao: implicito, tipo, ano, numero }),
        "orgao-contexto-ifpr",
        registro,
      );
    }
    return resultado(null, "orgao-ausente", registro);
  }

  if (orgao.jurisdicao === "externo") {
    const segmentoTipo = tipo === "res" ? "res" : tipo;
    return resultado(`externo:${orgao.orgao}/${segmentoTipo}/${ano}/${numero}`, regraBase, registro);
  }

  if (orgao.orgao === "cne") {
    const candidatos = registro
      .normasPorChave(tipo, ano, numero, "br")
      .filter((entrada) => /^br\/cne-/.test(entrada.id));
    const porData = data ? candidatos.filter((entrada) => entrada.data_publicacao === data) : [];
    if (porData.length === 1) return resultado(porData[0]!.id, "orgao-incompleto-registro", registro);
    if (candidatos.length === 1) return resultado(candidatos[0]!.id, "orgao-incompleto-registro", registro);
    return resultado(null, "orgao-ambiguo", registro);
  }

  // Resolução do IFPR é sempre de conselho: "IFPR. Reitoria. Resolução nº 58" é a do CONSUP.
  if (orgao.jurisdicao === "ifpr" && (orgao.orgao === null || (orgao.orgao === "reitoria" && tipo === "res"))) {
    const implicito = ORGAO_IFPR_POR_TIPO[tipo];
    if (!implicito) return resultado(null, "orgao-ambiguo", registro);
    return resultado(
      montarIdNorma({ jurisdicao: "ifpr", orgao: implicito, tipo, ano, numero }),
      "orgao-implicito-ifpr",
      registro,
    );
  }

  return resultado(
    montarIdNorma({ jurisdicao: orgao.jurisdicao, orgao: orgao.orgao, tipo, ano, numero }),
    regraBase,
    registro,
  );
}

function tipoDe(texto: string): string | null {
  const limpo = texto.replace(/\s+/g, " ");
  for (const [padrao, tipo] of TIPOS) if (padrao.test(limpo)) return tipo;
  return null;
}

/* ------------------------------------------------------------------ extração */

export interface OpcoesExtracao {
  /** Reconhece nomes próprios sem número (LDB, Lei do Estágio). Padrão: sim. */
  aliases?: boolean;
}

interface Achado extends Resolucao {
  inicioN: number;
  fimN: number;
  /** Ato decomposto, guardado para completar citações sem ID pelo restante do documento. */
  ato?: Ato;
  /** Trechos de dispositivo em volta da citação, reaplicados quando o ID é completado depois. */
  fragmentos?: (string | null)[];
}

/**
 * Completa, pelo próprio documento, citações que ficaram sem ID: "Resolução nº 54/2011" sem órgão
 * vira o único ato (res, 54, 2011) que o documento cita com órgão (`orgao-no-documento`); "Lei nº
 * 10.741" sem ano, o único ato (lei, 10741) citado com ano (`ano-no-documento`). Não completa
 * quando a data citada diverge da data do ato no documento ou no registro.
 */
function completarPeloDocumento(achados: Achado[], registro: Registro): void {
  const resolvidos = new Map<string, Set<string>>();
  const datas = new Map<string, Set<string>>();
  const anotar = (chave: string, id: string) => {
    const conjunto = resolvidos.get(chave) ?? new Set<string>();
    conjunto.add(id);
    resolvidos.set(chave, conjunto);
  };
  for (const achado of achados) {
    if (achado.id === null) continue;
    const id = achado.id.split("~")[0]!;
    const partes = partesIdNorma(id);
    if (!partes) continue;
    anotar(`ano|${partes.tipo}|${partes.ano}|${partes.numero}`, id);
    anotar(`num|${partes.tipo}|${partes.numero}`, id);
    anotar(`num|${partes.tipo}|${partes.orgao ?? ""}|${partes.numero}`, id);
    if (achado.ato?.data) datas.set(id, (datas.get(id) ?? new Set<string>()).add(achado.ato.data));
  }
  for (const achado of achados) {
    if (achado.id !== null || !achado.ato) continue;
    const { tipo, numero, ano, orgao, data } = achado.ato;
    let chave: string | null = null;
    let regra = "";
    if (achado.regra === "orgao-ausente" && ano !== null) {
      chave = `ano|${tipo}|${ano}|${numero}`;
      regra = "orgao-no-documento";
    } else if (achado.regra === "sem-ano") {
      const segmento = orgao?.orgao && orgao.orgao !== "cne" ? orgao.orgao : null;
      chave = segmento ? `num|${tipo}|${segmento}|${numero}` : `num|${tipo}|${numero}`;
      regra = "ano-no-documento";
    }
    const candidatos = chave ? resolvidos.get(chave) : undefined;
    if (!candidatos || candidatos.size !== 1) continue;
    const id = [...candidatos][0]!;
    if (data) {
      const conhecidas = new Set(datas.get(id));
      const doRegistro = registro.obter(id)?.data_publicacao;
      if (doRegistro) conhecidas.add(doRegistro);
      if (conhecidas.size > 0 && !conhecidas.has(data)) continue;
    }
    Object.assign(achado, comDispositivos(resultado(id, regra, registro), achado.fragmentos ?? []));
  }
}

/** Contexto herdável numa enumeração ("Leis nº 10.639/2003 e 11.645/2008"). */
interface Anterior {
  fimN: number;
  tipo: string;
  orgao: Orgao | null;
}

/** Nomes de órgão encadeados por pontuação, terminando no início do tipo do ato. */
const NOME_ORGAO = String.raw`(?:brasil|presidencia\s+da\s+republica|casa\s+civil|ministerio\s+da\s+educacao|mec|conselho\s+nacional\s+de\s+educacao|cne|camara\s+de\s+educacao\s+(?:basica|superior)|c[ep]b|ceb|ces|cp|conselho\s+pleno|instituto\s+federal(?:\s+de\s+educacao,?\s+ciencia\s+e\s+tecnologia)?\s+do\s+parana|ifpr|conselho\s+superior(?:\s+do\s+instituto\s+federal\s+do\s+parana)?|consup|consepe|reitoria|pro-?\s*reitoria\s+de\s+ensino|proens|comissao\s+nacional\s+de\s+avaliacao\s+da\s+educacao\s+superior|conaes|conselho\s+federal\s+de\s+[a-z]+(?:\s+[a-z]+){0,2})`;
const RE_CADEIA_ORGAOS = new RegExp(String.raw`(?:${NOME_ORGAO}\s*(?:\(\s*[a-z/]+\s*\))?\s*[.,:/-]?\s*)+$`);
const RE_CADEIA_INICIO = new RegExp(String.raw`^(?:${NOME_ORGAO}\s*(?:\(\s*[a-z/]+\s*\))?\s*[.,:/-]?\s*)+`);

const RE_SO_CONECTORES = /^\s*(?:,|;|\be\b|\bou\b|\be\s+(?:a|as|o|os|na|no|da|do)\b|\/)?\s*$/;
const RE_TIPO_PLURAL =
  /^(?:leis|decretos|resolucoes|pareceres|portarias|instrucoes|notas|deliberacoes|medidas|emendas)\b/;
const RE_CONTEXTO_IFPR = /\bifpr\b|instituto\s+federal\s+do\s+parana|conselho\s+superior|\bconsup\b/;
const JANELA_ANTES = 90;
const JANELA_MEIO = 60;
/** Alcance de um tipo no plural ("as Leis nº 10.048, ..., e 10.098") sobre números sem tipo. */
const JANELA_PLURAL = 320;

function comDispositivos(r: Resolucao, fragmentos: (string | null)[]): Resolucao {
  if (r.id === null) return r;
  const dispositivos = analisarFragmentos(fragmentos);
  if (dispositivos.length === 0) return r;
  return { ...r, dispositivoId: dispositivos[0]!, ...(dispositivos.length > 1 ? { dispositivos } : {}) };
}

/**
 * Dispositivos dos fragmentos antes e depois da citação. Se o de depois não começa por artigo
 * ("art. 24 da Lei nº 9.394/96, o inciso V, alínea e"), ele completa o artigo de antes.
 */
function analisarFragmentos(fragmentos: (string | null)[]): string[] {
  const [antes, depois] = fragmentos;
  if (antes && depois && !/^[\s,()-]*(?:arts?\b|artigos?\b)/.test(depois) && !/\bd[oa]s?\s+art/.test(depois)) {
    return [...new Set(analisarDispositivos(`${antes}, ${depois}`))];
  }
  return [...new Set(fragmentos.flatMap((fragmento) => (fragmento ? analisarDispositivos(fragmento) : [])))];
}

function achadosEstruturais(t: string, registro: Registro): Achado[] {
  const achados: Achado[] = [];
  let anterior: Anterior | null = null;
  let plural: (Anterior & { inicioN: number }) | null = null;
  let limite = 0;
  RE_NUCLEO.lastIndex = 0;
  for (let m = RE_NUCLEO.exec(t); m !== null; m = RE_NUCLEO.exec(t)) {
    const nucleo = lerNucleo(m);
    if (!nucleo) continue;
    const inicioJanela = Math.max(limite, nucleo.inicio - JANELA_ANTES);
    const janela = t.slice(inicioJanela, nucleo.inicio);

    // Tipo mais próximo do número, sem dígito nem ";" no meio.
    let tipo: string | null = null;
    let tipoPlural = false;
    let inicioCitacao = nucleo.inicio;
    let meio = "";
    for (const mt of janela.matchAll(RE_TIPO)) {
      const resto = janela.slice(mt.index + mt[0].length);
      if (resto.length > JANELA_MEIO || /[\d;]|\n\s*\n/.test(resto)) continue;
      if (mt[0] === "in" && !/^\s*$/.test(resto) && !orgaoEm(resto)) continue;
      tipo = tipoDe(mt[0]);
      tipoPlural = RE_TIPO_PLURAL.test(mt[0]);
      inicioCitacao = inicioJanela + mt.index;
      meio = resto;
    }

    let orgaoAntes = orgaoEm(meio);
    let regra = "estrutural";
    if (tipo === null) {
      // Órgão sem tipo, colado ao número: "CNE/CP nº 1/2021".
      const colado = /(?:cne\s*\/\s*c(?:p|eb|be|es)|consup(?:\s*\/\s*ifpr)?|ifpr\s*\/\s*consup)\W{0,4}$/.exec(janela);
      const entre = plural ? t.slice(plural.fimN, nucleo.inicio) : "";
      if (colado) {
        orgaoAntes = orgaoEm(colado[0]);
        tipo = "res";
        regra = "tipo-implicito";
        inicioCitacao = inicioJanela + colado.index;
      } else if (anterior && RE_SO_CONECTORES.test(t.slice(anterior.fimN, nucleo.inicio))) {
        tipo = anterior.tipo;
        orgaoAntes = anterior.orgao ? { orgao: anterior.orgao, inicio: 0, fim: 0 } : null;
        regra = "enumeracao";
      } else if (
        plural &&
        nucleo.inicio - plural.inicioN <= JANELA_PLURAL &&
        !/[;]|\n\s*\n/.test(entre) &&
        /(?:,|\be|\bou)\s*$/.test(t.slice(Math.max(0, nucleo.inicio - 6), nucleo.inicio))
      ) {
        // "Regulamenta as Leis nº 10.048, de 8 de novembro de 2000, que dá prioridade..., e 10.098".
        tipo = plural.tipo;
        orgaoAntes = plural.orgao ? { orgao: plural.orgao, inicio: 0, fim: 0 } : null;
        regra = "enumeracao";
      } else {
        continue;
      }
    }
    if (nucleo.ano === null && !TIPOS_SEM_ORGAO.has(tipo) && !nucleo.comMarcador) continue;

    // Órgão depois do número: "nº 54/2011 - CONSUP/IFPR", "(IFPR, 2017)", "do CNE/CEB".
    let fimCitacao = nucleo.fim;
    let orgao: Orgao | null = orgaoAntes?.orgao ?? null;
    if (orgao === null || orgao.orgao === null || orgao.orgao === "cne") {
      const aposta = t.slice(nucleo.fim, nucleo.fim + 70);
      const conector = /^\s*(?:[-,(/]\s*|\bd[oa]s?\s+|\bn[oa]\s+)(?:d[oa]s?\s+)?/.exec(aposta);
      if (conector) {
        const resto = aposta.slice(conector[0].length);
        const cadeia = RE_CADEIA_INICIO.exec(resto);
        const naCadeia = cadeia ? orgaoEm(cadeia[0]) : null;
        const direto = orgaoEm(resto);
        const encontrado =
          direto?.orgao.jurisdicao === "local" && direto.inicio === 0
            ? direto
            : naCadeia
              ? { ...naCadeia, inicio: 0, fim: cadeia![0].replace(/[\s.,:/-]+$/, "").length }
              : direto;
        if (encontrado && encontrado.inicio === 0 && encontrado.orgao.jurisdicao !== "nao-federal") {
          const maisEspecifico =
            orgao === null ||
            (orgao.orgao === "cne" && encontrado.orgao.orgao?.startsWith("cne-")) ||
            orgao.orgao === null;
          if (maisEspecifico) {
            orgao = encontrado.orgao;
            fimCitacao = nucleo.fim + conector[0].length + encontrado.fim;
            if (/^\s*,\s*\d{4}\s*\)/.test(t.slice(fimCitacao))) fimCitacao = t.indexOf(")", fimCitacao) + 1;
          }
        }
      }
    }

    // Órgão antes do tipo, em referência bibliográfica: "Conselho Nacional de Educação. Câmara de
    // Educação Básica. Parecer nº 12...", "INSTITUTO FEDERAL DO PARANÁ. Conselho Superior (CONSUP).
    // Resolução nº 17...". Só uma cadeia de nomes de órgão colada ao tipo, sem citação no meio.
    const antesDoTipo = t.slice(Math.max(limite, inicioCitacao - 160), inicioCitacao);
    if ((orgao === null || orgao.orgao === null || orgao.orgao === "cne") && regra === "estrutural") {
      const cadeia = RE_CADEIA_ORGAOS.exec(antesDoTipo);
      const encontrado = cadeia ? orgaoEm(cadeia[0]) : null;
      if (encontrado && encontrado.orgao.jurisdicao !== "nao-federal" && encontrado.orgao.jurisdicao !== "local") {
        const maisEspecifico =
          orgao === null ||
          (orgao.orgao === "cne" && encontrado.orgao.orgao?.startsWith("cne-")) ||
          (orgao.orgao === null && orgao.jurisdicao === encontrado.orgao.jurisdicao);
        if (maisEspecifico) orgao = encontrado.orgao;
      }
    }

    const ato: Ato = {
      tipo,
      orgao,
      numero: nucleo.numero,
      ano: nucleo.ano,
      data: nucleo.data,
      contextoIfpr: orgao === null && RE_CONTEXTO_IFPR.test(antesDoTipo.slice(-100)),
    };
    const fragmentos = [
      dispositivoAntes(t.slice(Math.max(0, inicioCitacao - 90), inicioCitacao)),
      dispositivoDepois(t.slice(fimCitacao, fimCitacao + 120)),
    ];
    const r = comDispositivos(resolverAto(ato, t.slice(nucleo.fim, nucleo.fim + 260), registro, regra), fragmentos);
    achados.push({ ...r, inicioN: inicioCitacao, fimN: fimCitacao, ato, fragmentos });
    anterior = { fimN: fimCitacao, tipo, orgao };
    if (regra === "estrutural") plural = tipoPlural ? { fimN: fimCitacao, tipo, orgao, inicioN: inicioCitacao } : null;
    else if (plural) plural.fimN = fimCitacao;
    limite = fimCitacao;
  }
  return achados;
}

/** Extrai e resolve todas as citações de um texto, na ordem em que aparecem. */
export function extrairCitacoes(
  original: string,
  registro: Registro = registroPadrao(),
  opcoes: OpcoesExtracao = {},
): Citacao[] {
  const { texto, origem } = normalizarComMapa(original);
  const achados: Achado[] = [];

  // URLs primeiro; depois são mascaradas para não virarem números soltos.
  let mascarado = texto;
  RE_URL.lastIndex = 0;
  for (const m of texto.matchAll(RE_URL)) {
    const url = idDeUrl(m[0], registro);
    mascarado = mascarado.slice(0, m.index) + " ".repeat(m[0].length) + mascarado.slice(m.index + m[0].length);
    if (url) achados.push({ ...resultado(url.id, url.regra, registro), inicioN: m.index, fimN: m.index + m[0].length });
  }

  const estruturais = achadosEstruturais(mascarado, registro);
  achados.push(...estruturais);
  completarPeloDocumento(achados, registro);

  if (opcoes.aliases ?? true) {
    for (const [padrao, id] of aliasesDoRegistro(registro)) {
      padrao.lastIndex = 0;
      for (const m of mascarado.matchAll(padrao)) {
        const inicio = m.index;
        const fim = inicio + m[0].length;
        if (estruturais.some((a) => a.inicioN < fim && inicio < a.fimN)) continue;
        if (achados.some((a) => a.regra === "alias" && a.inicioN < fim && inicio < a.fimN)) continue;
        let r = resultado(id, "alias", registro);
        r = comDispositivos(r, [
          dispositivoAntes(mascarado.slice(Math.max(0, inicio - 90), inicio)),
          dispositivoDepois(mascarado.slice(fim, fim + 120)),
        ]);
        achados.push({ ...r, inicioN: inicio, fimN: fim });
      }
    }
  }

  achados.sort((a, b) => a.inicioN - b.inicioN || a.fimN - b.fimN);
  const inicioLinhas = [0];
  for (let i = original.indexOf("\n"); i !== -1; i = original.indexOf("\n", i + 1)) inicioLinhas.push(i + 1);
  return achados.map(({ inicioN, fimN, ato: _ato, fragmentos: _fragmentos, ...r }) => {
    const inicio = origem[inicioN]!;
    const fim = origem[fimN]!;
    let baixo = 0;
    let alto = inicioLinhas.length - 1;
    while (baixo < alto) {
      const meio = (baixo + alto + 1) >> 1;
      if (inicioLinhas[meio]! <= inicio) baixo = meio;
      else alto = meio - 1;
    }
    return { ...r, inicio, fim, linha: baixo + 1, trecho: original.slice(inicio, fim) };
  });
}

/**
 * Resolve uma citação isolada ("Resolução CNE/CP nº 2/2026, art. 28, XVI", "LDB, arts. 61 a 63",
 * "CNCT"). Usa a primeira citação com ID do texto e lê os dispositivos do restante. Devolve
 * `id: null` com `regra: "nao-reconhecida"` quando nada é reconhecido.
 */
export function resolverCitacao(texto: string, registro: Registro = registroPadrao()): Resolucao {
  const citacoes = extrairCitacoes(texto, registro);
  const escolhida = citacoes.find((citacao) => citacao.id !== null) ?? citacoes[0];
  const normalizado = normalizarCitacao(texto).trim();
  if (escolhida) {
    const { id, confianca, regra, situacao, fim } = escolhida;
    const resto = normalizarCitacao(texto.slice(fim));
    return comDispositivos({ id, confianca, regra, situacao }, [
      dispositivoAntes(normalizarCitacao(texto.slice(0, escolhida.inicio))),
      /^\s*[,(-]?\s*(?:arts?\b|artigos?\b)/.test(resto) ? resto : dispositivoDepois(resto),
    ]);
  }
  for (const [padrao, id] of ALIASES_ISOLADOS) {
    if (padrao.test(normalizado)) return resultado(id, "alias", registro);
  }
  for (const entrada of registro.entradas) {
    if (!ehIdExterno(entrada.id)) continue;
    for (const alias of [entrada.title, ...entrada.aliases]) {
      if (normalizado.startsWith(normalizarCitacao(alias).trim())) return resultado(entrada.id, "alias", registro);
    }
  }
  return resultado(null, "nao-reconhecida", registro);
}

let padrao: Registro | null = null;

/** Registro do checkout (lido uma vez por processo). */
export function registroPadrao(): Registro {
  padrao ??= carregarRegistro();
  return padrao;
}
