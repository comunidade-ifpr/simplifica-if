/**
 * Regras da conversão que mudaram em relação à conversão antiga, em Python.
 *
 * A conversão antiga é o oráculo do diferencial (`scripts/diferencial-docx.ts`), e a nova a
 * reproduz byte a byte com todas as regras desligadas (`REGRAS_DO_PYTHON`). O padrão é
 * `REGRAS_DO_DOCUMENTO`, com todas ligadas. Cada regra é independente, para o diferencial medir
 * quantas linhas do `PPC.md` cada uma muda em cada documento.
 */
import type { Fidelidade } from "@simplifica-if/docx/leitor";

export type Regras = {
  /**
   * Leitura do DOCX (veja `Fidelidade` em `@simplifica-if/docx/leitor`): `documento` lê o texto de
   * alterações controladas, as linhas e células embrulhadas em `w:sdt`, a numeração automática e a
   * imagem legada; `python-docx` lê só o que a biblioteca via.
   */
  leitura: Fidelidade;
  /**
   * Parágrafo com estilo de título que é texto de corpo (frase longa, ou sem numeração e terminada
   * em ponto) sai como parágrafo. Desligada, todo parágrafo com estilo de título abre uma seção.
   */
  titulosDeCorpo: boolean;
  /**
   * Listas como no documento: a numeração automática do Word (`w:numPr`) faz itens de lista, o
   * número digitado é mantido (`2. texto`) e a alínea vira item com a letra (`- a) texto`).
   * Desligada, só o estilo e o marcador digitado fazem itens, todos renumerados como `1.`.
   */
  listas: boolean;
  /**
   * Trechos seguidos com a mesma formatação saem num marcador só (`**ab**`), com os espaços das
   * pontas fora dele. Desligada, cada run é marcado à parte e os runs em negrito colados saem como
   * `**a**b**`.
   */
  negritoUnido: boolean;
  /**
   * Só vira link o endereço `http`, `https` ou `mailto`, com parênteses e espaços escapados; o
   * resto fica como texto. Desligada, o endereço do documento vai cru para o Markdown.
   */
  linksSeguros: boolean;
  /**
   * Na matriz dividida em várias tabelas, o total que nenhuma delas declara é recalculado sobre
   * todas as partes, e o resumo traz `total_ha` e `total_hr` somados. Desligada, ficam os totais
   * calculados só sobre a última parte e os dois campos do resumo zerados.
   */
  totaisDaMatriz: boolean;
  /**
   * As seções começam em `##` (a seção "1" é `##`, a "1.1" é `###`), e `#` fica para o título do
   * documento: a convenção dos PPCs da base e da segmentação de seções do `kb`. Desligada, a seção
   * de primeiro nível sai como `#`, e o `kb` não a reconhece.
   */
  secoesNoNivel2: boolean;
};

export const REGRAS_DO_DOCUMENTO: Regras = {
  leitura: "documento",
  titulosDeCorpo: true,
  listas: true,
  negritoUnido: true,
  linksSeguros: true,
  totaisDaMatriz: true,
  secoesNoNivel2: true,
};

/** Reproduz a conversão em Python, com os defeitos dela. Só para o diferencial. */
export const REGRAS_DO_PYTHON: Regras = {
  leitura: "python-docx",
  titulosDeCorpo: false,
  listas: false,
  negritoUnido: false,
  linksSeguros: false,
  totaisDaMatriz: false,
  secoesNoNivel2: false,
};
