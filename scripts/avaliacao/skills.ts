// @effect-diagnostics nodeBuiltinImport:off -- carregador síncrono do caso, como os de carregar.ts
/**
 * Avaliação de uma skill do app (M0.5 e M1.11 do plano): o mesmo pedido sobre documentos sintéticos
 * com erros plantados, em condições com e sem a skill, e a pontuação contra o gabarito por alegação.
 *
 * - **Caso** (`avaliacao/skills/<skill>/caso.yaml`): o pedido, os documentos e, por documento, as
 *   alegações com o tipo (`erro` plantado ou `correta`), os status aceitos e as regex de conferência.
 * - **Pontuação automática** (`pontuarAutomatico`): sobre o relatório normalizado, se cada alegação foi
 *   tratada, se o problema certo foi apontado, quantos links `ifpr://`, quais rótulos de status e
 *   quais seções do formato da skill aparecem. Não depende de modelo.
 * - **Juiz** (`promptJuiz`, `lerVeredito`): um modelo lê o documento, o gabarito e o relatório e diz,
 *   por alegação, se ela foi tratada, que status o relatório lhe deu (um dos sete da skill, mesmo que o
 *   relatório use outras palavras) e se o problema plantado foi identificado. O acerto de status sai da
 *   comparação com `status_aceitos`, aqui, e não do juiz.
 *
 * O runner é `scripts/avaliar_skill.ts`.
 */
import { parse as interpretarYaml } from "yaml";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { ESTRITO } from "../esquema.ts";
import { RAIZ_REPOSITORIO, validar } from "./carregar.ts";
import { esquemaAncora, esquemaPadrao } from "./esquema.ts";
import { compilarPadrao, normalizarTexto } from "./normalizar.ts";

/* ----------------------------------------------------------------- caso */

/** Os sete status da classificação da skill, na ordem dela. */
export const STATUS = [
  "CONFIRMADA",
  "CONFIRMADA COM RESSALVA",
  "IMPRECISA",
  "SEM SUPORTE NA FONTE",
  "CONTRADITÓRIA",
  "FONTE AUSENTE OU NÃO CONSULTADA",
  "NÃO NORMATIVA",
] as const;
export type Status = (typeof STATUS)[number];

/** As condições do experimento. */
export const CONDICOES = ["sem-skill", "skill", "skill-antiga"] as const;
export type Condicao = (typeof CONDICOES)[number];

const texto = Schema.Trim.check(Schema.isMinLength(1));
const idKebab = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/u, { message: "id em kebab-case" }));

export const esquemaAlegacao = Schema.Struct({
  id: idKebab,
  tipo: Schema.Literals(["erro", "correta"]),
  /** O erro plantado, em uma linha (só em `erro`). */
  erro_plantado: Schema.optional(texto),
  /** Texto literal do documento; o teste confere. */
  trecho: texto,
  fonte: Schema.Struct({ ancora: esquemaAncora, arquivo: texto, trecho: texto }),
  explicacao: texto,
  status_aceitos: Schema.Array(Schema.Literals(STATUS)).check(Schema.isMinLength(1)),
  padroes_alegacao: Schema.Array(esquemaPadrao).check(Schema.isMinLength(1)),
  padroes_problema: Schema.optional(Schema.Array(esquemaPadrao).check(Schema.isMinLength(1))),
}).check(
  Schema.makeFilter((alegacao) => {
    if (alegacao.tipo === "erro" && (!alegacao.padroes_problema || !alegacao.erro_plantado))
      return "alegação de erro sem erro_plantado ou padroes_problema";
    if (alegacao.tipo === "correta" && alegacao.padroes_problema) return "alegação correta com padroes_problema";
    return true;
  }),
);
export type Alegacao = typeof esquemaAlegacao.Type;

export const esquemaDocumento = Schema.Struct({
  id: idKebab,
  /** Relativo à pasta do caso. */
  arquivo: texto,
  alegacoes: Schema.Array(esquemaAlegacao).check(Schema.isMinLength(1)),
});
export type Documento = typeof esquemaDocumento.Type;

export const esquemaCaso = Schema.Struct({
  versao: Schema.Literal(1),
  skill: idKebab,
  /** Commit da skill antes do enxugamento (condição `skill-antiga`). */
  rev_skill_antiga: Schema.String.check(Schema.isPattern(/^[0-9a-f]{7,40}$/u, { message: "hash de commit" })),
  /** O pedido ao agente; `{arquivo}` vira o nome do documento na pasta de trabalho. */
  pedido: texto.check(Schema.makeFilter((pedido: string) => pedido.includes("{arquivo}") || "pedido sem {arquivo}")),
  documentos: Schema.Array(esquemaDocumento).check(Schema.isMinLength(1)),
}).check(
  Schema.makeFilter((caso) => {
    const ids = caso.documentos.flatMap((documento) => documento.alegacoes.map((alegacao) => alegacao.id));
    const repetido = ids.find((id, indice) => ids.indexOf(id) !== indice);
    return repetido === undefined ? true : `id de alegação repetido: ${repetido}`;
  }),
);
export type Caso = typeof esquemaCaso.Type;

export interface CasoCarregado {
  readonly caso: Caso;
  /** Pasta do caso, absoluta. */
  readonly pasta: string;
}

/** Lê e valida `<pasta>/caso.yaml` (lança `ArquivoAvaliacaoInvalido`, como os de `carregar.ts`). */
export function carregarCaso(pasta: string): CasoCarregado {
  const absoluta = NodePath.resolve(RAIZ_REPOSITORIO, pasta);
  const caminho = NodePath.join(absoluta, "caso.yaml");
  const caso = validar(
    esquemaCaso,
    interpretarYaml(NodeFS.readFileSync(caminho, "utf-8")),
    NodePath.relative(RAIZ_REPOSITORIO, caminho),
  );
  return { caso, pasta: absoluta };
}

/** O pedido do caso para um documento. */
export function pedidoPara(caso: Caso, documento: Documento): string {
  return caso.pedido.replaceAll("{arquivo}", NodePath.basename(documento.arquivo));
}

/* ------------------------------------------------- pontuação automática */

const ROTULOS_NORMALIZADOS: ReadonlyArray<readonly [Status, RegExp]> = STATUS.map((status) => {
  const normal = normalizarTexto(status).replace(/ /gu, "\\s+");
  // "CONFIRMADA" não pode casar dentro de "CONFIRMADA COM RESSALVA"
  const fim = status === "CONFIRMADA" ? "(?!\\s+com\\s+ressalva)" : "";
  return [status, new RegExp(`(?<![a-z])${normal}${fim}(?![a-z])`, "u")] as const;
});

/** As seções do formato do relatório da skill (`references/relatorio.md`). */
export const SECOES_FORMATO = [
  ["sintese", /^#+\s.*sintese/mu],
  ["escopo", /^#+\s.*escopo/mu],
  ["fontes", /^#+\s.*fontes consultadas/mu],
  ["achados", /^#+\s.*achado/mu],
  ["lacunas", /^#+\s.*lacuna/mu],
  ["recomendacoes", /^#+\s.*(?:recomendac|redac(?:ao|oes) sugerida)/mu],
] as const;

export interface AlegacaoAutomatica {
  readonly id: string;
  readonly tipo: Alegacao["tipo"];
  /** Alguma regex de `padroes_alegacao` casou. */
  readonly tratada: boolean;
  /** Alguma regex de `padroes_problema` casou (`null` em alegação correta). */
  readonly problema_apontado: boolean | null;
}

export interface PontuacaoAutomatica {
  readonly alegacoes: ReadonlyArray<AlegacaoAutomatica>;
  readonly tratadas: number;
  readonly erros: number;
  readonly problemas_apontados: number;
  /** Links `ifpr://` distintos no relatório. */
  readonly links_ifpr: number;
  /** Rótulos da classificação da skill presentes no relatório. */
  readonly rotulos: ReadonlyArray<Status>;
  /** Seções do formato da skill presentes (de `SECOES_FORMATO`). */
  readonly secoes: ReadonlyArray<string>;
}

const casaAlgum = (padroes: ReadonlyArray<string>, alvo: string) =>
  padroes.some((padrao) => compilarPadrao(padrao).test(alvo));

/** Pontuação sem modelo de um relatório sobre `documento`. */
export function pontuarAutomatico(documento: Documento, relatorio: string): PontuacaoAutomatica {
  const normal = normalizarTexto(relatorio);
  const alegacoes = documento.alegacoes.map((alegacao): AlegacaoAutomatica => ({
    id: alegacao.id,
    tipo: alegacao.tipo,
    tratada: casaAlgum(alegacao.padroes_alegacao, normal),
    problema_apontado: alegacao.padroes_problema ? casaAlgum(alegacao.padroes_problema, normal) : null,
  }));
  const links = new Set(relatorio.match(/ifpr:\/\/[^\s)\]>`"'|]+/gu) ?? []);
  return {
    alegacoes,
    tratadas: alegacoes.filter((alegacao) => alegacao.tratada).length,
    erros: alegacoes.filter((alegacao) => alegacao.tipo === "erro").length,
    problemas_apontados: alegacoes.filter((alegacao) => alegacao.problema_apontado === true).length,
    links_ifpr: links.size,
    rotulos: ROTULOS_NORMALIZADOS.filter(([, regex]) => regex.test(normal)).map(([status]) => status),
    secoes: SECOES_FORMATO.filter(([, regex]) => regex.test(normal)).map(([nome]) => nome),
  };
}

/* ------------------------------------------------------------------ juiz */

export const esquemaVereditoAlegacao = Schema.Struct({
  id: Schema.String,
  tratada: Schema.Boolean,
  status: Schema.Literals([...STATUS, "NENHUM"]),
  problema_identificado: Schema.Boolean,
  justificativa: Schema.String,
});
export const esquemaVeredito = Schema.Struct({ alegacoes: Schema.Array(esquemaVereditoAlegacao) });
export type Veredito = typeof esquemaVeredito.Type;

/** O prompt do juiz: rubrica, documento, gabarito e relatório. Pede só um JSON. */
export function promptJuiz(documento: Documento, textoDocumento: string, relatorio: string): string {
  const gabarito = documento.alegacoes.map((alegacao) => ({
    id: alegacao.id,
    tipo: alegacao.tipo,
    trecho: alegacao.trecho,
    ...(alegacao.erro_plantado ? { erro_plantado: alegacao.erro_plantado } : {}),
    gabarito: alegacao.explicacao,
  }));
  return [
    "Você é avaliador de um teste. Um agente recebeu o DOCUMENTO abaixo e o pedido de conferir a fundamentação normativa dele, e escreveu o RELATÓRIO. O GABARITO lista as alegações do documento: as de tipo `erro` têm um erro plantado; as de tipo `correta` estão certas.",
    "",
    "Para cada alegação do gabarito, leia o relatório e responda:",
    "- `tratada`: o relatório analisa essa alegação especificamente (não basta citar a mesma norma a propósito de outra frase).",
    `- \`status\`: o veredito que o relatório dá a essa alegação, expresso como um destes rótulos: ${STATUS.map((s) => `"${s}"`).join(", ")}. Se o relatório usa esses rótulos, copie o que ele usou. Se usa outras palavras, escolha o rótulo que corresponde ao veredito dele (ex.: "correto", "ok", "conforme" → CONFIRMADA; "correto, mas convém precisar" → CONFIRMADA COM RESSALVA; "artigo errado", "o verbo deveria ser 'pode'" → IMPRECISA; "a norma diz o contrário", "a norma está revogada" → CONTRADITÓRIA; "não há base", "a norma não diz isso" → SEM SUPORTE NA FONTE; "PPC não é norma" → NÃO NORMATIVA). Use "NENHUM" se a alegação não foi tratada.`,
    '- `problema_identificado`: em alegação de tipo `erro`, true só se o relatório aponta o mesmo problema do gabarito (o motivo certo, não só "há um problema"); em alegação `correta`, true se o relatório aponta um problema que o gabarito não reconhece (falso alarme).',
    "- `justificativa`: uma frase, citando o relatório.",
    "",
    "Não avalie o estilo nem o tamanho. Não use conhecimento próprio sobre as normas: o gabarito decide.",
    "",
    'Responda só com um JSON, sem texto antes ou depois: {"alegacoes": [{"id": "...", "tratada": true, "status": "...", "problema_identificado": false, "justificativa": "..."}]}, com uma entrada por alegação do gabarito, na mesma ordem.',
    "",
    "## GABARITO",
    "",
    JSON.stringify(gabarito, null, 2),
    "",
    "## DOCUMENTO",
    "",
    textoDocumento.trim(),
    "",
    "## RELATÓRIO",
    "",
    relatorio.trim(),
  ].join("\n");
}

/** O primeiro objeto JSON da resposta do juiz (com ou sem cerca ```json). */
function extrairJson(resposta: string): string | undefined {
  const cerca = /```(?:json)?\s*\n([\s\S]*?)\n```/u.exec(resposta);
  if (cerca?.[1]) return cerca[1];
  const inicio = resposta.indexOf("{");
  const fim = resposta.lastIndexOf("}");
  return inicio >= 0 && fim > inicio ? resposta.slice(inicio, fim + 1) : undefined;
}

const decodificarVeredito = Schema.decodeUnknownExit(Schema.fromJsonString(esquemaVeredito));

/** O veredito do juiz, conferido contra as alegações do documento; `undefined` se não der para ler. */
export function lerVeredito(documento: Documento, resposta: string): Veredito | undefined {
  const json = extrairJson(resposta);
  if (json === undefined) return undefined;
  const resultado = decodificarVeredito(json, ESTRITO);
  if (Exit.isFailure(resultado)) return undefined;
  const ids = new Set(documento.alegacoes.map((alegacao) => alegacao.id));
  const alegacoes = resultado.value.alegacoes.filter((alegacao) => ids.has(alegacao.id));
  return alegacoes.length === ids.size ? { alegacoes } : undefined;
}

export interface AlegacaoJulgada {
  readonly id: string;
  readonly tipo: Alegacao["tipo"];
  readonly tratada: boolean;
  readonly status: Status | "NENHUM";
  readonly status_correto: boolean;
  /** Erro: o problema certo foi identificado. Correta: houve falso alarme. */
  readonly problema_identificado: boolean;
  readonly justificativa: string;
}

export interface PontuacaoJuiz {
  readonly alegacoes: ReadonlyArray<AlegacaoJulgada>;
  readonly tratadas: number;
  readonly status_corretos: number;
  /** Erros plantados com o problema certo identificado. */
  readonly erros_detectados: number;
  /** Alegações corretas com problema inexistente apontado ou status fora dos aceitos. */
  readonly falsos_alarmes: number;
}

/** Junta o veredito ao gabarito: o acerto de status é `status ∈ status_aceitos`. */
export function pontuarJuiz(documento: Documento, veredito: Veredito): PontuacaoJuiz {
  const porId = new Map(veredito.alegacoes.map((alegacao) => [alegacao.id, alegacao]));
  const alegacoes = documento.alegacoes.map((alegacao): AlegacaoJulgada => {
    const julgada = porId.get(alegacao.id);
    const tratada = julgada?.tratada ?? false;
    const status = tratada ? (julgada?.status ?? "NENHUM") : "NENHUM";
    return {
      id: alegacao.id,
      tipo: alegacao.tipo,
      tratada,
      status,
      status_correto: status !== "NENHUM" && (alegacao.status_aceitos as ReadonlyArray<string>).includes(status),
      problema_identificado: julgada?.problema_identificado ?? false,
      justificativa: julgada?.justificativa ?? "",
    };
  });
  return {
    alegacoes,
    tratadas: alegacoes.filter((alegacao) => alegacao.tratada).length,
    status_corretos: alegacoes.filter((alegacao) => alegacao.status_correto).length,
    erros_detectados: alegacoes.filter((alegacao) => alegacao.tipo === "erro" && alegacao.problema_identificado).length,
    falsos_alarmes: alegacoes.filter(
      (alegacao) =>
        alegacao.tipo === "correta" && alegacao.tratada && (alegacao.problema_identificado || !alegacao.status_correto),
    ).length,
  };
}

/* ------------------------------------------------------------- relatório */

export interface Execucao {
  readonly documento: string;
  readonly condicao: Condicao;
  readonly provider: string;
  readonly modelo: string | null;
  readonly duracao_ms: number;
  /** Nomes das ferramentas chamadas, na ordem (`ifpr.buscar_norma`, `Read`…). */
  readonly ferramentas: ReadonlyArray<string>;
  /** O agente leu o `SKILL.md` da skill. */
  readonly leu_skill: boolean;
  readonly tokens_entrada: number;
  readonly tokens_saida: number;
  readonly tokens_cache_leitura: number;
  readonly custo_usd: number | null;
  /** Motivo do `FimTurno`, ou `erro: <mensagem>`. */
  readonly desfecho: string;
  readonly resposta: string;
  readonly automatica: PontuacaoAutomatica;
  readonly juiz: PontuacaoJuiz | null;
  /** Resposta crua do juiz quando ela não pôde ser lida. */
  readonly juiz_bruto?: string;
}

export interface RelatorioSkill {
  readonly versao: 1;
  readonly skill: string;
  readonly iniciado_em: string;
  readonly concluido_em: string;
  readonly commit: string | null;
  readonly rev_skill_antiga: string;
  readonly modelo_juiz: string | null;
  readonly execucoes: ReadonlyArray<Execucao>;
}

const fracao = (parte: number, todo: number) => (todo === 0 ? "—" : `${parte}/${todo}`);

/** Totais de uma condição, somando os documentos. */
export function totaisCondicao(execucoes: ReadonlyArray<Execucao>, caso: Caso) {
  const porDocumento = new Map(caso.documentos.map((documento) => [documento.id, documento]));
  let alegacoes = 0;
  let erros = 0;
  let corretas = 0;
  for (const execucao of execucoes) {
    const documento = porDocumento.get(execucao.documento);
    if (!documento) continue;
    alegacoes += documento.alegacoes.length;
    erros += documento.alegacoes.filter((alegacao) => alegacao.tipo === "erro").length;
    corretas += documento.alegacoes.filter((alegacao) => alegacao.tipo === "correta").length;
  }
  const soma = (f: (execucao: Execucao) => number) => execucoes.reduce((total, execucao) => total + f(execucao), 0);
  const julgadas = execucoes.filter((execucao) => execucao.juiz !== null);
  return {
    execucoes: execucoes.length,
    alegacoes,
    erros,
    corretas,
    tratadas_auto: soma((e) => e.automatica.tratadas),
    problemas_auto: soma((e) => e.automatica.problemas_apontados),
    julgadas: julgadas.length,
    tratadas_juiz: soma((e) => e.juiz?.tratadas ?? 0),
    status_corretos: soma((e) => e.juiz?.status_corretos ?? 0),
    erros_detectados: soma((e) => e.juiz?.erros_detectados ?? 0),
    falsos_alarmes: soma((e) => e.juiz?.falsos_alarmes ?? 0),
    links_ifpr: soma((e) => e.automatica.links_ifpr),
    rotulos: soma((e) => e.automatica.rotulos.length),
    secoes: soma((e) => e.automatica.secoes.length),
    leu_skill: execucoes.filter((e) => e.leu_skill).length,
    ferramentas_ifpr: soma((e) => e.ferramentas.filter((nome) => nome.startsWith("ifpr.")).length),
    tokens_entrada: soma((e) => e.tokens_entrada + e.tokens_cache_leitura),
    tokens_saida: soma((e) => e.tokens_saida),
    custo_usd: soma((e) => e.custo_usd ?? 0),
    duracao_s: Math.round(soma((e) => e.duracao_ms) / 1000),
  };
}

/** Resumo em Markdown: a tabela por condição e o detalhe por alegação. */
export function resumoSkillMarkdown(relatorio: RelatorioSkill, caso: Caso): string {
  const condicoes = CONDICOES.filter((condicao) => relatorio.execucoes.some((e) => e.condicao === condicao));
  const totais = condicoes.map(
    (condicao) =>
      [
        condicao,
        totaisCondicao(
          relatorio.execucoes.filter((e) => e.condicao === condicao),
          caso,
        ),
      ] as const,
  );
  const linhas = [
    `# Avaliação da skill ${relatorio.skill}`,
    "",
    `Rodada de ${relatorio.iniciado_em} a ${relatorio.concluido_em}; commit ${relatorio.commit ?? "?"}; skill antiga em ${relatorio.rev_skill_antiga}; juiz: ${relatorio.modelo_juiz ?? "sem juiz"}.`,
    "",
    `| Métrica | ${condicoes.join(" | ")} |`,
    `|---|${condicoes.map(() => "---").join("|")}|`,
  ];
  const linha = (rotulo: string, valor: (t: ReturnType<typeof totaisCondicao>) => string) =>
    linhas.push(`| ${rotulo} | ${totais.map(([, t]) => valor(t)).join(" | ")} |`);
  linha("Execuções (documentos)", (t) => String(t.execucoes));
  linha("Leu o SKILL.md", (t) => fracao(t.leu_skill, t.execucoes));
  linha("Alegações tratadas (juiz)", (t) => (t.julgadas ? fracao(t.tratadas_juiz, t.alegacoes) : "—"));
  linha("Status corretos (juiz)", (t) => (t.julgadas ? fracao(t.status_corretos, t.alegacoes) : "—"));
  linha("Erros plantados detectados (juiz)", (t) => (t.julgadas ? fracao(t.erros_detectados, t.erros) : "—"));
  linha("Falsos alarmes em alegações corretas (juiz)", (t) =>
    t.julgadas ? fracao(t.falsos_alarmes, t.corretas) : "—",
  );
  linha("Alegações tratadas (regex)", (t) => fracao(t.tratadas_auto, t.alegacoes));
  linha("Problema certo apontado (regex)", (t) => fracao(t.problemas_auto, t.erros));
  linha("Links ifpr:// distintos", (t) => String(t.links_ifpr));
  linha("Rótulos da classificação usados", (t) => fracao(t.rotulos, t.execucoes * STATUS.length));
  linha("Seções do formato", (t) => fracao(t.secoes, t.execucoes * SECOES_FORMATO.length));
  linha("Chamadas de ferramentas ifpr", (t) => String(t.ferramentas_ifpr));
  linha("Tokens de entrada (com cache)", (t) => t.tokens_entrada.toLocaleString("pt-BR"));
  linha("Tokens de saída", (t) => t.tokens_saida.toLocaleString("pt-BR"));
  linha("Custo (US$)", (t) => t.custo_usd.toFixed(2));
  linha("Tempo (s)", (t) => String(t.duracao_s));

  linhas.push("", "## Detalhe por alegação", "");
  linhas.push(`| Documento | Alegação | Tipo | Aceitos | ${condicoes.join(" | ")} |`);
  linhas.push(`|---|---|---|---|${condicoes.map(() => "---").join("|")}|`);
  for (const documento of caso.documentos) {
    for (const alegacao of documento.alegacoes) {
      const celulas = condicoes.map((condicao) => {
        const execucao = relatorio.execucoes.find((e) => e.condicao === condicao && e.documento === documento.id);
        if (!execucao) return "—";
        const julgada = execucao.juiz?.alegacoes.find((a) => a.id === alegacao.id);
        const automatica = execucao.automatica.alegacoes.find((a) => a.id === alegacao.id);
        if (!julgada) return automatica?.tratada ? "tratada (regex)" : "não tratada (regex)";
        const marca = julgada.status_correto ? "✓" : "✗";
        const problema =
          alegacao.tipo === "erro" ? (julgada.problema_identificado ? ", problema ✓" : ", problema ✗") : "";
        return `${marca} ${julgada.status}${problema}`;
      });
      linhas.push(
        `| ${documento.id} | ${alegacao.id} | ${alegacao.tipo} | ${alegacao.status_aceitos.join(", ")} | ${celulas.join(" | ")} |`,
      );
    }
  }
  return `${linhas.join("\n")}\n`;
}

/** Confere que os trechos do gabarito existem no documento e na base (para o teste). */
export function conferirTrechos({ caso, pasta }: CasoCarregado): string[] {
  const problemas: string[] = [];
  for (const documento of caso.documentos) {
    const caminho = NodePath.join(pasta, documento.arquivo);
    const textoDocumento = NodeFS.readFileSync(caminho, "utf-8");
    for (const alegacao of documento.alegacoes) {
      if (!textoDocumento.includes(alegacao.trecho)) problemas.push(`${alegacao.id}: trecho fora do documento`);
      const fonte = NodePath.join(RAIZ_REPOSITORIO, alegacao.fonte.arquivo);
      if (!NodeFS.existsSync(fonte)) problemas.push(`${alegacao.id}: fonte inexistente ${alegacao.fonte.arquivo}`);
      else if (!NodeFS.readFileSync(fonte, "utf-8").includes(alegacao.fonte.trecho))
        problemas.push(`${alegacao.id}: trecho fora de ${alegacao.fonte.arquivo}`);
      if (!casaAlgum(alegacao.padroes_alegacao, normalizarTexto(alegacao.trecho)))
        problemas.push(`${alegacao.id}: padroes_alegacao não casam com o próprio trecho`);
    }
  }
  return problemas;
}
