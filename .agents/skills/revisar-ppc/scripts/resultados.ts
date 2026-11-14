/**
 * Validação do JSON de resultados dos sub-agentes (porte de
 * `validar_resultados_subagents`, `validar_alertas_transversais` e
 * `validar_resultados_rodada` do antigo `gerar_relatorio_html.py`), usada por
 * `validar-resultados` e por `gerar-relatorio-html` (`relatorio-html.ts`).
 */
import path from "node:path";
import { compararTexto } from "@simplifica-if/kb/texto";
import {
  ehNumeroPy,
  ehObjetoPy,
  intPy,
  iterarPy,
  numeroPy,
  obrigatorio,
  obter,
  type ObjetoPy,
  ou,
  strPy,
  textoOuVazioPy,
  verdadeiro,
} from "@simplifica-if/kb/python/valores";
import { aparar } from "@simplifica-if/kb/texto";
import { listarArquivos } from "./arquivos.ts";
import { type CaminhosAnalise, caminhosPadrao } from "./caminhos.ts";
import { caminhosRodada, existe, lerJsonPy } from "./rodada.ts";
import { carregarFichasOrdenadas, STATUS_FUNDAMENTACAO_NORMATIVA } from "./subagents.ts";

export class ErroResultadosSubagents extends Error {
  override name = "ErroResultadosSubagents";
}

const ESTADOS_PERMITIDOS = new Set(["ATENDE", "NAO_ATENDE", "INCONCLUSIVO", "NAO_APLICAVEL"]);
const STATUS_NORMATIVOS = new Set(STATUS_FUNDAMENTACAO_NORMATIVA);

/** `str(valor or "").strip()`. */
function texto(valor: unknown): string {
  return aparar(textoOuVazioPy(valor));
}

/** `str(a or b or ... or "").strip()`. */
function primeiroTexto(objeto: ObjetoPy, ...chaves: string[]): string {
  return texto(ou(...chaves.map((chave) => obter(objeto, chave)), ""));
}

/** `resultados_path` absoluto, em `arquivos-suporte/` quando existe lá, ou na raiz da rodada. */
export function resolverResultadosPath(rodada: string, resultados: string): string {
  if (path.isAbsolute(resultados)) return resultados;
  const caminhos = caminhosRodada(rodada);
  const noSuporte = path.join(caminhos.suporteDir, resultados);
  return existe(noSuporte) ? noSuporte : path.join(rodada, resultados);
}

/** Fichas por `id` (`str`), na ordem do id. */
export function catalogoFichas(fichasDir?: string): Map<string, ObjetoPy> {
  return new Map(carregarFichasOrdenadas(fichasDir).map((ficha) => [strPy(obrigatorio(ficha, "id")), ficha]));
}

/** Validações cruzadas por `id`. */
export function catalogoValidacoes(validacoesDir?: string): Map<string, ObjetoPy> {
  const diretorio = validacoesDir ?? caminhosPadrao().validacoesCruzadasDir;
  const validacoes = listarArquivos(diretorio, ".json")
    .map((arquivo) => lerJsonPy(arquivo))
    .filter(ehObjetoPy);
  return new Map(validacoes.map((item) => [strPy(obrigatorio(item, "id")), item]));
}

/** Blocos de resultados: `grupos[]`, ou `resultados[]` como um bloco só. */
export function blocosResultados(payload: ObjetoPy): unknown[] {
  const grupos = obter(payload, "grupos");
  if (Array.isArray(grupos)) return grupos;
  const resultados = obter(payload, "resultados");
  if (Array.isArray(resultados)) {
    return [{ grupo_id: strPy(ou(obter(payload, "grupo_id"), "grupo-unico")), resultados }];
  }
  throw new ErroResultadosSubagents("O JSON precisa conter `grupos[]` ou `resultados[]`.");
}

function normalizarFundamentacaoNormativa(fichaId: string, item: ObjetoPy): ObjetoPy[] {
  const bruto = obter(item, "fundamentacao_normativa");
  if (bruto === null) return [];
  if (!Array.isArray(bruto)) {
    throw new ErroResultadosSubagents(`\`fundamentacao_normativa\` precisa ser lista para ${fichaId}.`);
  }
  return bruto.map((achado, posicao) => {
    const indice = posicao + 1;
    if (!ehObjetoPy(achado)) {
      throw new ErroResultadosSubagents(`Achado normativo ${indice} de ${fichaId} precisa ser objeto JSON.`);
    }
    const status = texto(obter(achado, "status"));
    if (!STATUS_NORMATIVOS.has(status)) {
      throw new ErroResultadosSubagents(`Status de fundamentação normativa inválido para ${fichaId}: ${status}`);
    }
    const normalizado: Record<string, string> = {
      status,
      trecho_ppc: primeiroTexto(achado, "trecho_ppc", "trecho"),
      norma: primeiroTexto(achado, "norma"),
      fonte: primeiroTexto(achado, "fonte", "fonte_consultada"),
      dispositivo: primeiroTexto(achado, "dispositivo"),
      evidencia: primeiroTexto(achado, "evidencia", "evidência"),
      analise: primeiroTexto(achado, "analise", "análise"),
      recomendacao: primeiroTexto(achado, "recomendacao", "recomendação"),
    };
    if (!Object.entries(normalizado).some(([chave, valor]) => chave !== "status" && valor)) {
      throw new ErroResultadosSubagents(`Achado normativo ${indice} de ${fichaId} não traz conteúdo verificável.`);
    }
    return normalizado;
  });
}

function normalizarAnchor(valor: unknown): ObjetoPy {
  if (!ehObjetoPy(valor)) return {};
  const blockId = primeiroTexto(valor, "block_id", "id");
  const quote = primeiroTexto(valor, "quote", "trecho");
  if (!blockId && !quote) return {};
  return { block_id: blockId, quote };
}

function normalizarEvidencia(fichaId: string, valor: unknown, indice: number): ObjetoPy {
  let normalizada: ObjetoPy;
  if (ehObjetoPy(valor)) {
    normalizada = {
      trecho: primeiroTexto(valor, "trecho", "texto", "evidencia"),
      secao: primeiroTexto(valor, "secao", "seção"),
      localizador: primeiroTexto(valor, "localizador", "pagina", "linha"),
      fonte: texto(ou(obter(valor, "fonte"), "PPC.md")),
      artefato: primeiroTexto(valor, "artefato"),
    };
    const anchor = normalizarAnchor(obter(valor, "anchor"));
    if (verdadeiro(anchor)) normalizada.anchor = anchor;
  } else {
    normalizada = { trecho: texto(valor), secao: "", localizador: "", fonte: "PPC.md", artefato: "" };
  }
  const temConteudo =
    ["trecho", "secao", "localizador", "artefato", "anchor"].some((chave) => verdadeiro(obter(normalizada, chave))) ||
    !["", "PPC.md"].includes(normalizada.fonte as string);
  if (!temConteudo) {
    throw new ErroResultadosSubagents(`Evidência ${indice} de ${fichaId} não traz conteúdo verificável.`);
  }
  return normalizada;
}

function normalizarEvidencias(fichaId: string, evidencias: unknown): ObjetoPy[] {
  if (!Array.isArray(evidencias))
    throw new ErroResultadosSubagents(`\`evidencias\` precisa ser lista para ${fichaId}.`);
  return evidencias
    .map((valor, posicao) => normalizarEvidencia(fichaId, valor, posicao + 1))
    .filter((normalizada) => Object.values(normalizada).some(verdadeiro));
}

function normalizarEvidenciaTransversal(alertaId: string, valor: unknown, indice: number): ObjetoPy {
  let normalizada: ObjetoPy;
  if (ehObjetoPy(valor)) {
    normalizada = {
      trecho: primeiroTexto(valor, "trecho", "texto", "evidencia"),
      secao: primeiroTexto(valor, "secao", "seção"),
      localizador: primeiroTexto(valor, "localizador", "pagina", "linha"),
      papel: primeiroTexto(valor, "papel"),
      fonte: texto(ou(obter(valor, "fonte"), "PPC.md")),
    };
    const anchor = normalizarAnchor(obter(valor, "anchor"));
    if (verdadeiro(anchor)) normalizada.anchor = anchor;
  } else {
    normalizada = { trecho: texto(valor), secao: "", localizador: "", papel: "", fonte: "PPC.md" };
  }
  if (!["trecho", "secao", "localizador", "papel", "anchor"].some((chave) => verdadeiro(obter(normalizada, chave)))) {
    throw new ErroResultadosSubagents(`Evidência transversal ${indice} de ${alertaId} não traz conteúdo verificável.`);
  }
  return normalizada;
}

export type ResultadoNormalizado = {
  grupo_id: string;
  ficha_id: string;
  estado: string;
  criticidade: string;
  revisao_humana_obrigatoria: boolean;
  [chave: string]: unknown;
};

/** `validar_resultados_subagents`: um resultado válido por ficha do catálogo, ordenados por ficha. */
export function validarResultadosSubagents(
  payload: ObjetoPy,
  fichasPorId: Map<string, ObjetoPy>,
): ResultadoNormalizado[] {
  const vistos = new Set<string>();
  const normalizados: ResultadoNormalizado[] = [];
  const duplicados: string[] = [];
  const desconhecidos: string[] = [];

  for (const bloco of blocosResultados(payload)) {
    if (!ehObjetoPy(bloco)) throw new Error("AttributeError: bloco de resultados não é objeto JSON");
    const grupoId = texto(obter(bloco, "grupo_id"));
    const resultados = obter(bloco, "resultados");
    if (!grupoId) throw new ErroResultadosSubagents("Um bloco de resultados não contém `grupo_id`.");
    if (!Array.isArray(resultados))
      throw new ErroResultadosSubagents(`O bloco ${grupoId} não contém \`resultados[]\`.`);
    for (const item of resultados) {
      if (!ehObjetoPy(item)) {
        throw new ErroResultadosSubagents(`O bloco ${grupoId} contém item que não é objeto JSON.`);
      }
      const fichaId = texto(obter(item, "ficha_id"));
      if (!fichaId) throw new ErroResultadosSubagents(`O bloco ${grupoId} contém item sem \`ficha_id\`.`);
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
      const estado = texto(obter(item, "estado"));
      if (!ESTADOS_PERMITIDOS.has(estado))
        throw new ErroResultadosSubagents(`Estado inválido para ${fichaId}: ${estado}`);
      const confianca = obter(item, "confianca");
      if (!ehNumeroPy(confianca) || !(numeroPy(confianca) >= 0 && numeroPy(confianca) <= 1)) {
        throw new ErroResultadosSubagents(`Confiança inválida para ${fichaId}: ${strPy(confianca)}`);
      }
      const justificativa = texto(obter(item, "justificativa"));
      if (!justificativa) throw new ErroResultadosSubagents(`\`justificativa\` ausente para ${fichaId}.`);
      const feedbackAutores = texto(obter(item, "feedback_autores"));
      const feedbackConfig = obter(ficha, "feedback_autores");
      if (ehObjetoPy(feedbackConfig)) {
        const estadosComFeedback = new Set(iterarPy(obter(feedbackConfig, "obrigatorio_quando_estado", [])).map(strPy));
        if (estadosComFeedback.has(estado) && !feedbackAutores) {
          throw new ErroResultadosSubagents(
            `\`feedback_autores\` ausente para ${fichaId}; obrigatório quando estado=${estado}.`,
          );
        }
      }
      const evidencias = normalizarEvidencias(fichaId, obter(item, "evidencias"));
      const evidenciaMinima = intPy(obter(ficha, "evidencia_minima", 1));
      if (evidencias.length < evidenciaMinima) {
        throw new ErroResultadosSubagents(
          `${fichaId} trouxe ${evidencias.length} evidências; mínimo exigido: ${evidenciaMinima}.`,
        );
      }
      const lacunas = obter(item, "lacunas");
      const revisao = obter(item, "revisao_humana_obrigatoria");
      if (!Array.isArray(lacunas)) throw new ErroResultadosSubagents(`\`lacunas\` precisa ser lista para ${fichaId}.`);
      if (typeof revisao !== "boolean") {
        throw new ErroResultadosSubagents(`\`revisao_humana_obrigatoria\` precisa ser booleano para ${fichaId}.`);
      }
      normalizados.push({
        grupo_id: grupoId,
        ficha_id: fichaId,
        titulo: strPy(ou(obter(ficha, "titulo"), fichaId)),
        dominio: textoOuVazioPy(obter(ficha, "dominio")),
        criticidade: textoOuVazioPy(obter(ficha, "criticidade")),
        topicos_tematicos: iterarPy(ou(obter(ficha, "topicos_tematicos"), [])),
        tipo_escopo: textoOuVazioPy(obter(ficha, "tipo_escopo")),
        estado,
        confianca: numeroPy(confianca),
        justificativa,
        evidencias,
        lacunas: lacunas.map((valor) => aparar(strPy(valor))).filter(Boolean),
        revisao_humana_obrigatoria: revisao,
        feedback_autores: feedbackAutores,
        fundamentacao_normativa: normalizarFundamentacaoNormativa(fichaId, item),
      });
    }
  }

  const unicosOrdenados = (itens: string[]) => [...new Set(itens)].sort(compararTexto).join(", ");
  if (duplicados.length) throw new ErroResultadosSubagents(`Fichas duplicadas: ${unicosOrdenados(duplicados)}`);
  if (desconhecidos.length)
    throw new ErroResultadosSubagents(`Fichas desconhecidas: ${unicosOrdenados(desconhecidos)}`);
  const faltantes = [...fichasPorId.keys()].filter((fichaId) => !vistos.has(fichaId)).sort(compararTexto);
  if (faltantes.length) throw new ErroResultadosSubagents(`Fichas sem resultado: ${faltantes.join(", ")}`);
  return normalizados.sort((a, b) => compararTexto(a.ficha_id, b.ficha_id));
}

/** `validar_alertas_transversais`: alertas da síntese transversal ligados a validações cruzadas conhecidas. */
export function validarAlertasTransversais(
  payload: ObjetoPy,
  fichasPorId: Map<string, ObjetoPy>,
  validacoesPorId: Map<string, ObjetoPy>,
): ObjetoPy[] {
  let bruto = obter(payload, "alertas_transversais");
  const sintese = obter(payload, "sintese_transversal");
  if (bruto === null && ehObjetoPy(sintese)) bruto = obter(sintese, "alertas_transversais");
  if (bruto === null) return [];
  if (!Array.isArray(bruto)) throw new ErroResultadosSubagents("`alertas_transversais` precisa ser uma lista.");
  const alertas: ObjetoPy[] = [];
  const vistos = new Set<string>();
  bruto.forEach((item, posicao) => {
    const indice = posicao + 1;
    if (!ehObjetoPy(item)) throw new ErroResultadosSubagents("Cada alerta transversal precisa ser objeto JSON.");
    const alertaId = aparar(strPy(ou(obter(item, "id"), `ALERTA-${String(indice).padStart(3, "0")}`)));
    if (vistos.has(alertaId)) throw new ErroResultadosSubagents(`Alerta transversal duplicado: ${alertaId}`);
    vistos.add(alertaId);
    const titulo = texto(obter(item, "titulo"));
    const validacaoId = texto(obter(item, "validacao_id"));
    const descricao = texto(obter(item, "descricao"));
    const criticidade = aparar(strPy(ou(obter(item, "criticidade"), "OBRIG")));
    const fichasRelacionadas = ou(obter(item, "fichas_relacionadas"), []);
    const evidencias = ou(obter(item, "evidencias"), []);
    const revisao = obter(item, "revisao_humana_obrigatoria");
    if (!titulo || !descricao) {
      throw new ErroResultadosSubagents(`Alerta transversal ${alertaId} precisa de título e descrição.`);
    }
    if (!validacaoId) throw new ErroResultadosSubagents(`Alerta transversal ${alertaId} precisa de \`validacao_id\`.`);
    const validacao = validacoesPorId.get(validacaoId);
    if (!validacao) {
      throw new ErroResultadosSubagents(`Alerta ${alertaId} referencia validação cruzada desconhecida: ${validacaoId}`);
    }
    if (!["BLOQ", "OBRIG", "REC"].includes(criticidade)) {
      throw new ErroResultadosSubagents(`Criticidade inválida para ${alertaId}: ${criticidade}`);
    }
    if (!Array.isArray(fichasRelacionadas)) {
      throw new ErroResultadosSubagents(`\`fichas_relacionadas\` precisa ser lista para ${alertaId}.`);
    }
    const desconhecidas = fichasRelacionadas.filter((fichaId) => !fichasPorId.has(strPy(fichaId)));
    if (desconhecidas.length) {
      throw new ErroResultadosSubagents(
        `Alerta ${alertaId} referencia fichas desconhecidas: ${desconhecidas.map(strPy).join(", ")}`,
      );
    }
    if (!Array.isArray(evidencias))
      throw new ErroResultadosSubagents(`\`evidencias\` precisa ser lista para ${alertaId}.`);
    const evidenciasNormalizadas = evidencias.map((valor, i) => normalizarEvidenciaTransversal(alertaId, valor, i + 1));
    if (typeof revisao !== "boolean") {
      throw new ErroResultadosSubagents(`\`revisao_humana_obrigatoria\` precisa ser booleano para ${alertaId}.`);
    }
    alertas.push({
      id: alertaId,
      validacao_id: validacaoId,
      validacao_titulo: strPy(ou(obter(validacao, "titulo"), validacaoId)),
      titulo,
      criticidade,
      descricao,
      fichas_relacionadas: fichasRelacionadas.map(strPy),
      evidencias: evidenciasNormalizadas,
      revisao_humana_obrigatoria: revisao,
    });
  });
  return alertas;
}

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

/** Situação geral da rodada pelos estados e criticidades. */
export function situacao(resultados: ResultadoNormalizado[]): SituacaoRevisao {
  if (resultados.some((item) => item.criticidade === "BLOQ" && item.estado === "NAO_ATENDE")) {
    return "REVISAO_SUBSTANCIAL";
  }
  if (resultados.some((item) => item.criticidade === "OBRIG" && item.estado === "NAO_ATENDE")) {
    return "AJUSTES_NECESSARIOS";
  }
  if (resultados.some((item) => item.estado === "INCONCLUSIVO" || item.revisao_humana_obrigatoria)) {
    return "APTO_COM_RESSALVAS";
  }
  return "APTO_PARA_SUBMISSAO";
}

function contagem(valores: string[]): ObjetoPy {
  const total = new Map<string, number>();
  for (const valor of valores) total.set(valor, (total.get(valor) ?? 0) + 1);
  const saida: ObjetoPy = {};
  for (const chave of [...total.keys()].sort(compararTexto)) saida[chave] = total.get(chave)!;
  return saida;
}

/** `validar_resultados_rodada`: valida o JSON de resultados e devolve o resumo, sem gerar HTML. */
export function validarResultadosRodada(
  rodada: string,
  resultados: string,
  caminhos: CaminhosAnalise = caminhosPadrao(),
): ObjetoPy {
  const rodadaDir = caminhosRodada(rodada).rodadaDir;
  const caminhoResultados = resolverResultadosPath(rodadaDir, resultados);
  const payload = lerJsonPy(caminhoResultados);
  if (!ehObjetoPy(payload)) throw new Error("AttributeError: o JSON de resultados precisa ser objeto");
  const fichasPorId = catalogoFichas(caminhos.fichasDir);
  const validacoesPorId = catalogoValidacoes(caminhos.validacoesCruzadasDir);
  const normalizados = validarResultadosSubagents(payload, fichasPorId);
  const alertas = validarAlertasTransversais(payload, fichasPorId, validacoesPorId);
  const grupos = blocosResultados(payload);
  return {
    resultados_path: caminhoResultados,
    valido: true,
    total_fichas: normalizados.length,
    total_fichas_esperadas: fichasPorId.size,
    total_grupos: grupos.length,
    total_alertas_transversais: alertas.length,
    situacao: situacao(normalizados),
    contagem_estado: contagem(normalizados.map((item) => item.estado)),
    contagem_criticidade: contagem(normalizados.map((item) => item.criticidade)),
    grupos: grupos.map((grupo) => {
      const g = ehObjetoPy(grupo) ? grupo : {};
      return {
        grupo_id: textoOuVazioPy(obter(g, "grupo_id")),
        total_resultados: iterarPy(ou(obter(g, "resultados"), [])).length,
      };
    }),
  };
}
