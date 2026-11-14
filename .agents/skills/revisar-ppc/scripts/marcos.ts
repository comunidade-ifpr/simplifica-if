/**
 * Marcos normativos com os campos derivados (fase 5 do plano de arquitetura).
 *
 * `marcos-normativos.json` guarda só a identificação do tema (`id`, `tema`, `linha`, `aplica_a`,
 * fichas), a `transicao` e a `orientacao_analise`. A norma vigente, as substituídas, as
 * antecessoras históricas e os dispositivos revogados são calculados em tempo de leitura por
 * `derivarLinha` (`@simplifica-if/kb/normas/vigencia`), a partir de `base-conhecimento/relacoes.yaml`,
 * na `data_referencia` de `base-conhecimento/config/vigencia.yaml`.
 */
import path from "node:path";
import { type LinhaDerivada, dataReferencia, derivarLinha } from "@simplifica-if/kb/normas/vigencia";
import { type CaminhosAnalise, caminhosPadrao } from "./caminhos.ts";
import type { Marco, MarcoArquivo } from "./esquemas.ts";

/** Função que deriva vigente, substituídas etc. a partir da linha de um marco. */
export type Derivacao = (linha: readonly string[]) => LinhaDerivada;

/** Derivação sobre a base do checkout (relacoes.yaml na data de referência). */
export function derivacaoPadrao(caminhos: CaminhosAnalise = caminhosPadrao()): Derivacao {
  const raiz = path.dirname(caminhos.baseConhecimentoDir);
  const data = dataReferencia(raiz);
  return (linha) => derivarLinha(linha, data, raiz);
}

/**
 * Marco do arquivo com os campos derivados, na ordem de campos do formato anterior (consumida pelos
 * prompts dos sub-agentes e pelo índice). A `linha` não vai para a saída.
 */
export function derivarMarco(marco: MarcoArquivo, derivar: Derivacao): Marco {
  const derivado = derivar(marco.linha);
  return {
    id: marco.id,
    tema: marco.tema,
    vigente: derivado.vigente,
    aplica_a: marco.aplica_a,
    substitui: derivado.substitui,
    antecessoras_historicas: derivado.antecessoras_historicas,
    dispositivos_revogados: derivado.dispositivos_revogados,
    fichas_responsaveis: marco.fichas_responsaveis,
    fichas_base_legal: marco.fichas_base_legal,
    transicao: marco.transicao,
    orientacao_analise: marco.orientacao_analise,
  };
}
