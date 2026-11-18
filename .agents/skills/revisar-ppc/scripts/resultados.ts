// @effect-diagnostics nodeBuiltinImport:off -- leitura e escrita síncronas dos arquivos da rodada, dentro dos Effects
/**
 * Leitura do JSON de resultados dos sub-agentes, usada por `validar-resultados` e por
 * `gerar-relatorio-html` (`relatorio-html.ts`), e mescla das reavaliações avulsas
 * (`mesclar-resultados-avulsos`).
 *
 * O JSON é decodificado uma vez pelo `esquemaResultadosSubagents` (os contratos de
 * `esquemas.ts`); o que o esquema não exprime (ficha conhecida e coberta uma vez, evidência com
 * conteúdo, mínimo de evidências, `feedback_autores` exigido pela ficha, validação cruzada
 * conhecida) é conferido depois, sobre os valores já tipados. Toda falha é um
 * `ErroResultadosSubagents` com a categoria e os IDs envolvidos.
 */
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { problemas } from "@simplifica-if/kb/esquema/mensagens";
import { ErroJsonTipado, serializarJsonTipado } from "@simplifica-if/kb/primitivas/json-tipado";
import type { Dicionario } from "@simplifica-if/kb/primitivas/valores";
import { aparar, compararTexto } from "@simplifica-if/kb/texto";
import { listarArquivos } from "./arquivos.ts";
import { type CaminhosAnalise, caminhosPadrao } from "./caminhos.ts";
import {
  aberto,
  type Criticidade,
  esquemaAlertaTransversal,
  esquemaFicha,
  esquemaResultadoFicha,
  esquemaValidacaoCruzada,
  type Estado,
  type Ficha,
} from "./esquemas.ts";
import { caminhosRodada, escreverJsonDaRodada, lerJsonDaRodada, sha256JsonPayload } from "./rodada.ts";
import { carregarFichasOrdenadas } from "./subagents.ts";

// ---------------------------------------------------------------- erro

const CATEGORIAS = [
  "arquivo-ausente",
  "arquivo-ilegivel",
  "json-invalido",
  "fora-do-contrato",
  "sem-resultados",
  "fichas-duplicadas",
  "fichas-desconhecidas",
  "fichas-sem-resultado",
  "justificativa-ausente",
  "feedback-ausente",
  "evidencia-sem-conteudo",
  "evidencias-insuficientes",
  "achado-normativo-sem-conteudo",
  "alerta-duplicado",
  "alerta-sem-titulo-ou-descricao",
  "alerta-sem-validacao",
  "validacao-desconhecida",
  "alerta-com-fichas-desconhecidas",
  "evidencia-transversal-sem-conteudo",
  "avulso-sem-resultados",
] as const;

/**
 * Um JSON de resultados (da rodada, a base da mescla ou o avulso) fora do contrato. Os atributos
 * são IDs, posições, contagens e os problemas do esquema (caminho e o que se esperava), nunca o
 * texto das evidências ou das justificativas.
 */
export class ErroResultadosSubagents extends Schema.TaggedError<ErroResultadosSubagents>()("ErroResultadosSubagents", {
  categoria: Schema.Literals(CATEGORIAS),
  /** Qual JSON, como sujeito da frase ("O resultado avulso"). */
  origem: Schema.String,
  /** Arquivo lido, nas falhas de leitura. */
  arquivo: Schema.optional(Schema.String),
  ficha: Schema.optional(Schema.String),
  alerta: Schema.optional(Schema.String),
  validacao: Schema.optional(Schema.String),
  /** Posição (a partir de 1) da evidência ou do achado. */
  posicao: Schema.optional(Schema.Number),
  ids: Schema.optional(Schema.Array(Schema.String)),
  estado: Schema.optional(Schema.String),
  encontradas: Schema.optional(Schema.Number),
  minimo: Schema.optional(Schema.Number),
  problemas: Schema.optional(Schema.Array(Schema.String)),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    const ids = (this.ids ?? []).join(", ");
    switch (this.categoria) {
      case "arquivo-ausente":
        return (
          `${this.origem} não foi encontrado: ${this.arquivo}. ` +
          "Confira o caminho ou peça ao sub-agente que grave o JSON nesse arquivo."
        );
      case "arquivo-ilegivel":
        return `${this.origem} não pôde ser lido: ${this.arquivo}.`;
      case "json-invalido":
        return (
          `${this.origem} não é um JSON válido: ${this.arquivo}. ` +
          "Peça ao sub-agente que devolva só o JSON, sem texto antes ou depois nem bloco de código."
        );
      case "fora-do-contrato":
        return `${this.origem} está fora do contrato:\n${(this.problemas ?? []).join("\n")}`;
      case "sem-resultados":
        return `${this.origem} precisa conter \`grupos[]\` ou \`resultados[]\`.`;
      case "fichas-duplicadas":
        return `Fichas duplicadas: ${ids}`;
      case "fichas-desconhecidas":
        return `Fichas desconhecidas: ${ids}`;
      case "fichas-sem-resultado":
        return `Fichas sem resultado: ${ids}`;
      case "justificativa-ausente":
        return `\`justificativa\` ausente para ${this.ficha}.`;
      case "feedback-ausente":
        return `\`feedback_autores\` ausente para ${this.ficha}; obrigatório quando estado=${this.estado}.`;
      case "evidencia-sem-conteudo":
        return `Evidência ${this.posicao} de ${this.ficha} não traz conteúdo verificável.`;
      case "evidencias-insuficientes":
        return `${this.ficha} trouxe ${this.encontradas} evidências; mínimo exigido: ${this.minimo}.`;
      case "achado-normativo-sem-conteudo":
        return `Achado normativo ${this.posicao} de ${this.ficha} não traz conteúdo verificável.`;
      case "alerta-duplicado":
        return `Alerta transversal duplicado: ${this.alerta}`;
      case "alerta-sem-titulo-ou-descricao":
        return `Alerta transversal ${this.alerta} precisa de título e descrição.`;
      case "alerta-sem-validacao":
        return `Alerta transversal ${this.alerta} precisa de \`validacao_id\`.`;
      case "validacao-desconhecida":
        return `Alerta ${this.alerta} referencia validação cruzada desconhecida: ${this.validacao}`;
      case "alerta-com-fichas-desconhecidas":
        return `Alerta ${this.alerta} referencia fichas desconhecidas: ${ids}`;
      case "evidencia-transversal-sem-conteudo":
        return `Evidência transversal ${this.posicao} de ${this.alerta} não traz conteúdo verificável.`;
      case "avulso-sem-resultados":
        return `${this.origem} não traz resultados.`;
    }
  }
}

export const ehErroResultadosSubagents = Schema.is(ErroResultadosSubagents);

type Atributos = Omit<ConstructorParameters<typeof ErroResultadosSubagents>[0], "categoria" | "origem">;

function falha(
  categoria: (typeof CATEGORIAS)[number],
  origem: string,
  atributos: Atributos = {},
): Result.Result<never, ErroResultadosSubagents> {
  return Result.fail(new ErroResultadosSubagents({ categoria, origem, ...atributos }));
}

/** Os três JSONs que esta leitura confere, como sujeito das mensagens. */
const ORIGEM = {
  rodada: "O JSON de resultados",
  base: "O JSON base",
  avulso: "O resultado avulso",
} as const;

/**
 * Lê um JSON de resultados. Arquivo ausente ou JSON inválido (o sub-agente que escreve texto em
 * volta do JSON) é `ErroResultadosSubagents`, não defeito.
 */
function lerJsonDeResultados(arquivo: string, origem: string) {
  return Effect.try({
    try: () => lerJsonDaRodada(arquivo),
    catch: (cause) =>
      new ErroResultadosSubagents({
        categoria:
          cause instanceof ErroJsonTipado
            ? "json-invalido"
            : Predicate.hasProperty(cause, "code") && cause.code === "ENOENT"
              ? "arquivo-ausente"
              : "arquivo-ilegivel",
        origem,
        arquivo,
        cause,
      }),
  });
}

// ---------------------------------------------------------------- contrato

/** Bloco de resultados de um sub-agente, como está em `grupos[]`. */
const esquemaBloco = aberto({
  grupo_id: Schema.String,
  resultados: Schema.Array(esquemaResultadoFicha),
});

const alertas = Schema.optionalKey(Schema.NullOr(Schema.Array(esquemaAlertaTransversal)));

/**
 * O JSON coletado dos sub-agentes: `grupos[]`, ou `resultados[]` (com `grupo_id` opcional) como um
 * bloco só, mais os alertas da síntese transversal, no topo ou em `sintese_transversal`, e a
 * `metadata` da mescla. Chaves a mais ficam no topo, no bloco, no resultado e no alerta; na evidência,
 * na âncora e no achado normativo são recusadas (`aberto`, em `esquemas.ts`).
 */
export const esquemaResultadosSubagents = aberto({
  grupos: Schema.optionalKey(Schema.Array(esquemaBloco)),
  grupo_id: Schema.optionalKey(Schema.String),
  resultados: Schema.optionalKey(Schema.Array(esquemaResultadoFicha)),
  alertas_transversais: alertas,
  sintese_transversal: Schema.optionalKey(aberto({ alertas_transversais: alertas })),
  metadata: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});
export type ResultadosSubagents = typeof esquemaResultadosSubagents.Type;
type Bloco = typeof esquemaBloco.Type;
type ResultadoFicha = typeof esquemaResultadoFicha.Type;
type AlertaTransversal = typeof esquemaAlertaTransversal.Type;

/** `$.grupos[0].resultados[1].estado`: o caminho de um problema no JSON. */
function caminhoJson(caminho: ReadonlyArray<PropertyKey>): string {
  return caminho.reduce<string>(
    (texto, chave) => (typeof chave === "number" ? `${texto}[${chave}]` : `${texto}.${String(chave)}`),
    "$",
  );
}

/** JSON simples de um valor do JSON tipado da rodada (fracionários viram números). */
const jsonSimples = (valor: unknown): unknown => JSON.parse(serializarJsonTipado(valor));

/** Decodifica um JSON de resultados, com todos os problemas do esquema. */
export function decodificarResultados(
  valor: unknown,
  origem: string,
): Result.Result<ResultadosSubagents, ErroResultadosSubagents> {
  const decodificado = Schema.decodeUnknownResult(esquemaResultadosSubagents)(jsonSimples(valor), {
    errors: "all",
    onExcessProperty: "error",
  });
  if (Result.isSuccess(decodificado)) return Result.succeed(decodificado.success);
  return falha("fora-do-contrato", origem, {
    problemas: problemas(decodificado.failure.issue).map(
      (p) => `${caminhoJson(p.caminho)}: ${p.mensagem.replace(/^Entrada inválida: /, "")}`,
    ),
  });
}

/** Blocos de resultados: `grupos[]`, ou `resultados[]` como um bloco só. */
export function blocosResultados(
  payload: ResultadosSubagents,
  origem: string,
): Result.Result<Bloco[], ErroResultadosSubagents> {
  if (payload.grupos) return Result.succeed([...payload.grupos]);
  if (payload.resultados) {
    return Result.succeed([{ grupo_id: payload.grupo_id || "grupo-unico", resultados: payload.resultados }]);
  }
  return falha("sem-resultados", origem);
}

// ---------------------------------------------------------------- catálogos

/** Fichas por `id`, na ordem do id, decodificadas pelo contrato da ficha. */
export function catalogoFichas(fichasDir?: string): Map<string, Ficha> {
  const decodificar = Schema.decodeUnknownSync(esquemaFicha);
  return new Map(
    carregarFichasOrdenadas(fichasDir).map((bruta) => {
      const ficha = decodificar(jsonSimples(bruta));
      return [ficha.id, ficha];
    }),
  );
}

/** Títulos das validações cruzadas por `id`. */
export function catalogoValidacoes(validacoesDir?: string): Map<string, { readonly titulo: string }> {
  const diretorio = validacoesDir ?? caminhosPadrao().validacoesCruzadasDir;
  const decodificar = Schema.decodeUnknownSync(esquemaValidacaoCruzada);
  return new Map(
    listarArquivos(diretorio, ".json").map((arquivo) => {
      const validacao = decodificar(jsonSimples(lerJsonDaRodada(arquivo)));
      return [validacao.id, { titulo: validacao.titulo }];
    }),
  );
}

// ---------------------------------------------------------------- normalização

export type Ancora = { block_id: string; quote: string };

export type EvidenciaNormalizada = {
  trecho: string;
  secao: string;
  localizador: string;
  fonte: string;
  artefato: string;
  anchor?: Ancora;
};

export type AchadoNormativo = {
  status: string;
  trecho_ppc: string;
  norma: string;
  fonte: string;
  dispositivo: string;
  evidencia: string;
  analise: string;
  recomendacao: string;
};

export type ResultadoNormalizado = {
  grupo_id: string;
  ficha_id: string;
  titulo: string;
  dominio: string;
  criticidade: string;
  topicos_tematicos: string[];
  tipo_escopo: string;
  estado: string;
  confianca: number;
  justificativa: string;
  evidencias: EvidenciaNormalizada[];
  lacunas: string[];
  revisao_humana_obrigatoria: boolean;
  feedback_autores: string;
  fundamentacao_normativa: AchadoNormativo[];
};

export type EvidenciaTransversal = {
  trecho: string;
  secao: string;
  localizador: string;
  papel: string;
  fonte: string;
  anchor?: Ancora;
};

export type AlertaNormalizado = {
  id: string;
  validacao_id: string;
  validacao_titulo: string;
  titulo: string;
  criticidade: Criticidade;
  descricao: string;
  fichas_relacionadas: string[];
  evidencias: EvidenciaTransversal[];
  revisao_humana_obrigatoria: boolean;
};

/** Âncora com bloco ou trecho; sem os dois, nenhuma. */
function normalizarAncora(ancora: { readonly block_id?: string; readonly quote?: string } | undefined) {
  const blockId = aparar(ancora?.block_id ?? "");
  const quote = aparar(ancora?.quote ?? "");
  return blockId || quote ? { anchor: { block_id: blockId, quote } } : {};
}

/** Fonte da evidência: `PPC.md` quando não informada. */
const fonteOuPpc = (fonte: string | undefined) => aparar(fonte || "PPC.md");

function normalizarEvidencia(evidencia: ResultadoFicha["evidencias"][number]): EvidenciaNormalizada {
  if (typeof evidencia === "string") {
    return { trecho: aparar(evidencia), secao: "", localizador: "", fonte: "PPC.md", artefato: "" };
  }
  return {
    trecho: aparar(evidencia.trecho ?? ""),
    secao: aparar(evidencia.secao ?? ""),
    localizador: aparar(evidencia.localizador ?? ""),
    fonte: fonteOuPpc(evidencia.fonte),
    artefato: aparar(evidencia.artefato ?? ""),
    ...normalizarAncora(evidencia.anchor),
  };
}

/** Evidência com algo para conferir: um campo preenchido, uma âncora ou uma fonte que não é o PPC. */
const temConteudo = (evidencia: EvidenciaNormalizada) =>
  Boolean(evidencia.trecho || evidencia.secao || evidencia.localizador || evidencia.artefato) ||
  evidencia.anchor !== undefined ||
  !["", "PPC.md"].includes(evidencia.fonte);

function normalizarAchado(achado: NonNullable<ResultadoFicha["fundamentacao_normativa"]>[number]): AchadoNormativo {
  return {
    status: achado.status,
    trecho_ppc: aparar(achado.trecho_ppc ?? ""),
    norma: aparar(achado.norma ?? ""),
    fonte: aparar(achado.fonte ?? ""),
    dispositivo: aparar(achado.dispositivo ?? ""),
    evidencia: aparar(achado.evidencia ?? ""),
    analise: aparar(achado.analise ?? ""),
    recomendacao: aparar(achado.recomendacao ?? ""),
  };
}

/** Resultado de uma ficha conhecida, conferido contra a ficha e normalizado. */
function normalizarResultado(
  grupoId: string,
  fichaId: string,
  item: ResultadoFicha,
  ficha: Ficha,
  origem: string,
): Result.Result<ResultadoNormalizado, ErroResultadosSubagents> {
  const justificativa = aparar(item.justificativa);
  if (!justificativa) return falha("justificativa-ausente", origem, { ficha: fichaId });
  const feedbackAutores = aparar(item.feedback_autores ?? "");
  const estadosComFeedback: ReadonlyArray<Estado> = ficha.feedback_autores?.obrigatorio_quando_estado ?? [];
  if (estadosComFeedback.includes(item.estado) && !feedbackAutores) {
    return falha("feedback-ausente", origem, { ficha: fichaId, estado: item.estado });
  }
  const evidencias = item.evidencias.map(normalizarEvidencia);
  const vazia = evidencias.findIndex((evidencia) => !temConteudo(evidencia));
  if (vazia >= 0) return falha("evidencia-sem-conteudo", origem, { ficha: fichaId, posicao: vazia + 1 });
  if (evidencias.length < ficha.evidencia_minima) {
    return falha("evidencias-insuficientes", origem, {
      ficha: fichaId,
      encontradas: evidencias.length,
      minimo: ficha.evidencia_minima,
    });
  }
  const fundamentacao = (item.fundamentacao_normativa ?? []).map(normalizarAchado);
  const semConteudo = fundamentacao.findIndex(
    ({ status: _status, ...conteudo }) => !Object.values(conteudo).some(Boolean),
  );
  if (semConteudo >= 0) {
    return falha("achado-normativo-sem-conteudo", origem, { ficha: fichaId, posicao: semConteudo + 1 });
  }
  return Result.succeed({
    grupo_id: grupoId,
    ficha_id: fichaId,
    titulo: ficha.titulo || fichaId,
    dominio: ficha.dominio,
    criticidade: ficha.criticidade,
    topicos_tematicos: [...ficha.topicos_tematicos],
    tipo_escopo: ficha.tipo_escopo,
    estado: item.estado,
    confianca: item.confianca,
    justificativa,
    evidencias,
    lacunas: item.lacunas.map((lacuna) => aparar(lacuna)).filter(Boolean),
    revisao_humana_obrigatoria: item.revisao_humana_obrigatoria,
    feedback_autores: feedbackAutores,
    fundamentacao_normativa: fundamentacao,
  });
}

/**
 * Confere e normaliza os resultados dos blocos: fichas conhecidas, sem repetição, cada resultado
 * com o contrato da ficha. Não exige que o catálogo inteiro esteja coberto.
 */
function normalizarBlocos(
  blocos: ReadonlyArray<Bloco>,
  fichasPorId: ReadonlyMap<string, Ficha>,
  origem: string,
): Result.Result<{ normalizados: ResultadoNormalizado[]; vistos: Set<string> }, ErroResultadosSubagents> {
  const vistos = new Set<string>();
  const normalizados: ResultadoNormalizado[] = [];
  const duplicados: string[] = [];
  const desconhecidos: string[] = [];
  for (const bloco of blocos) {
    for (const item of bloco.resultados) {
      const fichaId = aparar(item.ficha_id);
      if (vistos.has(fichaId)) {
        duplicados.push(fichaId);
        continue;
      }
      vistos.add(fichaId);
      const ficha = fichasPorId.get(fichaId);
      if (!ficha) {
        desconhecidos.push(fichaId);
        continue;
      }
      const normalizado = normalizarResultado(aparar(bloco.grupo_id), fichaId, item, ficha, origem);
      if (Result.isFailure(normalizado)) return Result.fail(normalizado.failure);
      normalizados.push(normalizado.success);
    }
  }
  const unicosOrdenados = (itens: string[]) => [...new Set(itens)].sort(compararTexto);
  if (duplicados.length) return falha("fichas-duplicadas", origem, { ids: unicosOrdenados(duplicados) });
  if (desconhecidos.length) return falha("fichas-desconhecidas", origem, { ids: unicosOrdenados(desconhecidos) });
  return Result.succeed({ normalizados, vistos });
}

/** Um resultado válido por ficha do catálogo, ordenados por ficha. */
export function validarResultadosSubagents(
  blocos: ReadonlyArray<Bloco>,
  fichasPorId: ReadonlyMap<string, Ficha>,
  origem: string,
): Result.Result<ResultadoNormalizado[], ErroResultadosSubagents> {
  return Result.flatMap(normalizarBlocos(blocos, fichasPorId, origem), ({ normalizados, vistos }) => {
    const faltantes = [...fichasPorId.keys()].filter((fichaId) => !vistos.has(fichaId)).sort(compararTexto);
    if (faltantes.length) return falha("fichas-sem-resultado", origem, { ids: faltantes });
    return Result.succeed(normalizados.sort((a, b) => compararTexto(a.ficha_id, b.ficha_id)));
  });
}

function normalizarEvidenciaTransversal(
  evidencia: NonNullable<AlertaTransversal["evidencias"]>[number],
): EvidenciaTransversal {
  if (typeof evidencia === "string") {
    return { trecho: aparar(evidencia), secao: "", localizador: "", papel: "", fonte: "PPC.md" };
  }
  return {
    trecho: aparar(evidencia.trecho ?? ""),
    secao: aparar(evidencia.secao ?? ""),
    localizador: aparar(evidencia.localizador ?? ""),
    papel: aparar(evidencia.papel ?? ""),
    fonte: fonteOuPpc(evidencia.fonte),
    ...normalizarAncora(evidencia.anchor),
  };
}

/** Alertas da síntese transversal ligados a validações cruzadas conhecidas. */
export function validarAlertasTransversais(
  payload: ResultadosSubagents,
  fichasPorId: ReadonlyMap<string, Ficha>,
  validacoesPorId: ReadonlyMap<string, { readonly titulo: string }>,
  origem: string,
): Result.Result<AlertaNormalizado[], ErroResultadosSubagents> {
  const brutos = payload.alertas_transversais ?? payload.sintese_transversal?.alertas_transversais ?? [];
  const normalizados: AlertaNormalizado[] = [];
  const vistos = new Set<string>();
  for (const [posicao, item] of brutos.entries()) {
    const alertaId = aparar(item.id || `ALERTA-${String(posicao + 1).padStart(3, "0")}`);
    if (vistos.has(alertaId)) return falha("alerta-duplicado", origem, { alerta: alertaId });
    vistos.add(alertaId);
    const titulo = aparar(item.titulo);
    const descricao = aparar(item.descricao);
    const validacaoId = aparar(item.validacao_id);
    if (!titulo || !descricao) return falha("alerta-sem-titulo-ou-descricao", origem, { alerta: alertaId });
    if (!validacaoId) return falha("alerta-sem-validacao", origem, { alerta: alertaId });
    const validacao = validacoesPorId.get(validacaoId);
    if (!validacao) return falha("validacao-desconhecida", origem, { alerta: alertaId, validacao: validacaoId });
    const fichasRelacionadas = [...(item.fichas_relacionadas ?? [])];
    const desconhecidas = fichasRelacionadas.filter((fichaId) => !fichasPorId.has(fichaId));
    if (desconhecidas.length) {
      return falha("alerta-com-fichas-desconhecidas", origem, { alerta: alertaId, ids: desconhecidas });
    }
    const evidencias = (item.evidencias ?? []).map(normalizarEvidenciaTransversal);
    const vazia = evidencias.findIndex(({ fonte: _fonte, ...conteudo }) => !Object.values(conteudo).some(Boolean));
    if (vazia >= 0) {
      return falha("evidencia-transversal-sem-conteudo", origem, { alerta: alertaId, posicao: vazia + 1 });
    }
    normalizados.push({
      id: alertaId,
      validacao_id: validacaoId,
      validacao_titulo: validacao.titulo || validacaoId,
      titulo,
      criticidade: item.criticidade ?? "OBRIG",
      descricao,
      fichas_relacionadas: fichasRelacionadas,
      evidencias,
      revisao_humana_obrigatoria: item.revisao_humana_obrigatoria,
    });
  }
  return Result.succeed(normalizados);
}

// ---------------------------------------------------------------- situação

/**
 * Situações da revisão prévia, da mais grave para a mais leve, com o rótulo do relatório. São a
 * conclusão de uma revisão antes da submissão à PROENS, não o resultado da análise oficial.
 */
export const SITUACOES_REVISAO = {
  REVISAO_SUBSTANCIAL: "Revisão substancial necessária",
  AJUSTES_NECESSARIOS: "Ajustes necessários",
  APTO_COM_RESSALVAS: "Apto com ressalvas",
  APTO_PARA_SUBMISSAO: "Apto para submissão",
} as const;

export type SituacaoRevisao = keyof typeof SITUACOES_REVISAO;

type FichaParaSituacao = Pick<ResultadoNormalizado, "criticidade" | "estado" | "revisao_humana_obrigatoria">;
type AlertaParaSituacao = Pick<AlertaNormalizado, "criticidade" | "revisao_humana_obrigatoria">;

/**
 * Situação geral da rodada pelos estados e criticidades das fichas e pelos alertas transversais.
 * Um alerta transversal é um problema encontrado: pesa como uma ficha `NAO_ATENDE` da mesma
 * criticidade (`BLOQ` → revisão substancial, `OBRIG` → ajustes necessários; `REC`, como a ficha
 * `REC` não atendida, não muda a situação) e, com revisão humana obrigatória, gera ressalva.
 */
export function situacao(
  resultados: ReadonlyArray<FichaParaSituacao>,
  alertasTransversais: ReadonlyArray<AlertaParaSituacao> = [],
): SituacaoRevisao {
  const alertaCom = (criticidade: Criticidade) =>
    alertasTransversais.some((alerta) => alerta.criticidade === criticidade);
  if (resultados.some((item) => item.criticidade === "BLOQ" && item.estado === "NAO_ATENDE") || alertaCom("BLOQ")) {
    return "REVISAO_SUBSTANCIAL";
  }
  if (resultados.some((item) => item.criticidade === "OBRIG" && item.estado === "NAO_ATENDE") || alertaCom("OBRIG")) {
    return "AJUSTES_NECESSARIOS";
  }
  if (
    resultados.some((item) => item.estado === "INCONCLUSIVO" || item.revisao_humana_obrigatoria) ||
    alertasTransversais.some((alerta) => alerta.revisao_humana_obrigatoria)
  ) {
    return "APTO_COM_RESSALVAS";
  }
  return "APTO_PARA_SUBMISSAO";
}

function contagem(valores: string[]): Dicionario {
  const total = new Map<string, number>();
  for (const valor of valores) total.set(valor, (total.get(valor) ?? 0) + 1);
  const saida: Dicionario = {};
  for (const chave of [...total.keys()].sort(compararTexto)) saida[chave] = total.get(chave)!;
  return saida;
}

// ---------------------------------------------------------------- arquivos da rodada

/** Caminho relativo a `arquivos-suporte/` quando não absoluto. */
function noSuporte(caminho: string, suporteDir: string): string {
  return NodePath.isAbsolute(caminho) ? caminho : NodePath.join(suporteDir, caminho);
}

/** Caminho do JSON de resultados: o absoluto como está; o relativo, em `arquivos-suporte/`. */
export function resolverResultadosPath(rodada: string, resultados: string): string {
  return noSuporte(resultados, caminhosRodada(rodada).suporteDir);
}

/** Resultados da rodada lidos, decodificados e conferidos contra as fichas e as validações. */
export type ResultadosDaRodada = {
  caminho: string;
  blocos: Bloco[];
  normalizados: ResultadoNormalizado[];
  alertas: AlertaNormalizado[];
  totalFichasEsperadas: number;
};

/** Lê e confere o JSON de resultados da rodada (`resultados` relativo a `arquivos-suporte/`). */
export const lerResultadosDaRodada = Effect.fn("resultados.lerResultadosDaRodada")(function* (
  rodada: string,
  resultados: string,
  caminhos: CaminhosAnalise = caminhosPadrao(),
) {
  const caminho = resolverResultadosPath(caminhosRodada(rodada).rodadaDir, resultados);
  const payload = yield* Effect.fromResult(
    decodificarResultados(yield* lerJsonDeResultados(caminho, ORIGEM.rodada), ORIGEM.rodada),
  );
  const fichasPorId = catalogoFichas(caminhos.fichasDir);
  const validacoesPorId = catalogoValidacoes(caminhos.validacoesCruzadasDir);
  const blocos = yield* Effect.fromResult(blocosResultados(payload, ORIGEM.rodada));
  const normalizados = yield* Effect.fromResult(validarResultadosSubagents(blocos, fichasPorId, ORIGEM.rodada));
  const alertasNormalizados = yield* Effect.fromResult(
    validarAlertasTransversais(payload, fichasPorId, validacoesPorId, ORIGEM.rodada),
  );
  const lidos: ResultadosDaRodada = {
    caminho,
    blocos,
    normalizados,
    alertas: alertasNormalizados,
    totalFichasEsperadas: fichasPorId.size,
  };
  return lidos;
});

/** Valida o JSON de resultados e devolve o resumo, sem gerar HTML. */
export const validarResultadosRodada = Effect.fn("resultados.validarResultadosRodada")(function* (
  rodada: string,
  resultados: string,
  caminhos: CaminhosAnalise = caminhosPadrao(),
) {
  const lidos = yield* lerResultadosDaRodada(rodada, resultados, caminhos);
  const resumo: Dicionario = {
    resultados_path: lidos.caminho,
    valido: true,
    total_fichas: lidos.normalizados.length,
    total_fichas_esperadas: lidos.totalFichasEsperadas,
    total_grupos: lidos.blocos.length,
    total_alertas_transversais: lidos.alertas.length,
    situacao: situacao(lidos.normalizados, lidos.alertas),
    contagem_estado: contagem(lidos.normalizados.map((item) => item.estado)),
    contagem_criticidade: contagem(lidos.normalizados.map((item) => item.criticidade)),
    grupos: lidos.blocos.map((bloco) => ({ grupo_id: bloco.grupo_id, total_resultados: bloco.resultados.length })),
  };
  return resumo;
});

/**
 * Grupos como estão no JSON tipado (com os fracionários preservados), para regravar: `grupos[]`, ou
 * `{grupo_id, resultados}` com o bloco único. Só se chama depois de a decodificação ter conferido
 * a forma.
 */
function gruposBrutos(bruto: Dicionario): Dicionario[] {
  if (Array.isArray(bruto.grupos)) return bruto.grupos as Dicionario[];
  return [{ grupo_id: (bruto.grupo_id as string | undefined) || "grupo-unico", resultados: bruto.resultados }];
}

/** Resultados de um grupo do JSON tipado, na ordem do arquivo. */
const resultadosBrutos = (grupo: Dicionario) => grupo.resultados as Dicionario[];

/**
 * Substitui no JSON base os resultados das fichas reavaliadas.
 *
 * O avulso é validado contra o contrato das fichas antes de qualquer escrita; se for inválido, a
 * mescla é recusada e a base fica intacta. A base é normalizada para `grupos[]` antes da mescla
 * (o formato `{"grupo_id", "resultados"}` vira um grupo), para que os resultados originais não se
 * percam ao lado do grupo de reavaliação. Os valores são regravados como estavam no arquivo.
 */
export const mesclarResultadosAvulsos = Effect.fn("resultados.mesclarResultadosAvulsos")(function* (
  rodada: string,
  resultadosBase: string,
  resultadosAvulsos: string,
  saida?: string,
  caminhosAnalise: CaminhosAnalise = caminhosPadrao(),
) {
  const caminhos = caminhosRodada(rodada);
  const saidaResolvida = noSuporte(saida || resultadosBase, caminhos.suporteDir);
  const baseBruta = (yield* lerJsonDeResultados(
    noSuporte(resultadosBase, caminhos.suporteDir),
    ORIGEM.base,
  )) as Dicionario;
  const avulsoBruto = (yield* lerJsonDeResultados(
    noSuporte(resultadosAvulsos, caminhos.suporteDir),
    ORIGEM.avulso,
  )) as Dicionario;
  const base = yield* Effect.fromResult(decodificarResultados(baseBruta, ORIGEM.base));
  const avulso = yield* Effect.fromResult(decodificarResultados(avulsoBruto, ORIGEM.avulso));
  yield* Effect.fromResult(blocosResultados(base, ORIGEM.base));
  const blocosAvulso = yield* Effect.fromResult(blocosResultados(avulso, ORIGEM.avulso));
  yield* Effect.fromResult(normalizarBlocos(blocosAvulso, catalogoFichas(caminhosAnalise.fichasDir), ORIGEM.avulso));
  const resultadosNovos = gruposBrutos(avulsoBruto).flatMap(resultadosBrutos);
  if (!resultadosNovos.length) {
    return yield* new ErroResultadosSubagents({ categoria: "avulso-sem-resultados", origem: ORIGEM.avulso });
  }

  const idsAvulsos = new Set(blocosAvulso.flatMap((bloco) => bloco.resultados.map((item) => item.ficha_id)));
  const idsOrdenados = [...idsAvulsos].sort(compararTexto);
  const gruposMesclados: Dicionario[] = [];
  for (const grupo of gruposBrutos(baseBruta)) {
    const restantes = resultadosBrutos(grupo).filter((item) => !idsAvulsos.has(item.ficha_id as string));
    if (restantes.length) gruposMesclados.push({ ...grupo, resultados: restantes });
  }
  gruposMesclados.push({
    grupo_id: avulso.grupo_id || `reavaliacao-${sha256JsonPayload(idsOrdenados).slice(0, 12)}`,
    tipo: "reavaliacao",
    resultados: resultadosNovos,
  });
  // A base no formato `{"grupo_id", "resultados"}` passa a ter esses campos no primeiro grupo.
  const { resultados: _resultados, grupo_id: _grupoId, ...semBlocoUnico } = baseBruta;
  const payload: Dicionario = Array.isArray(baseBruta.grupos)
    ? { ...baseBruta, grupos: gruposMesclados }
    : { ...semBlocoUnico, grupos: gruposMesclados };
  payload.metadata = { ...(payload.metadata as Dicionario | undefined), reavaliacoes_mescladas: idsOrdenados };
  escreverJsonDaRodada(saidaResolvida, payload);
  const mescla: Dicionario = {
    resultados_path: saidaResolvida,
    fichas_substituidas: idsOrdenados,
    total_grupos: gruposMesclados.length,
  };
  return mescla;
});
