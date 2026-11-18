/**
 * Orçamento de texto de uma conversão: tetos que valem para o documento inteiro.
 *
 * Os limites por item (uma tabela, uma parte do ZIP) não fecham a conta: sessenta tabelas logo
 * abaixo do teto, ou um parágrafo com 80 mil tabulações num arquivo de 3 KB, custavam minutos. O
 * orçamento é conferido logo depois da leitura, antes de qualquer trabalho proporcional ao texto,
 * e recusa o documento com `ErroDocx`.
 *
 * Os padrões vêm dos 12 PPCs reais conferidos em 16/11/2026: o maior Markdown bruto tem 398 mil
 * caracteres; o maior parágrafo, 2,3 mil; a maior célula, 3,3 mil; a maior sequência de
 * caracteres sem letra nem dígito, 27.
 */
import { ErroDocx } from "@simplifica-if/docx/erro";
import type { Elemento } from "./elementos.ts";

export type LimitesDeTexto = {
  /**
   * Caracteres no documento: o texto das tabelas depois de expandidas (a mescla repete a célula) e
   * o Markdown gerado. Vinte vezes o maior PPC real.
   */
  caracteresNoDocumento: number;
  /** Caracteres num parágrafo, título ou célula. Quinze vezes a maior célula real. */
  caracteresPorBloco: number;
  /**
   * Caracteres seguidos sem letra nem dígito (espaços, tabulações, pontuação). As expressões
   * regulares da conversão e do normalizador que terminam em `\s*$` ou em pontuação custam o
   * quadrado de uma sequência dessas; com o teto, o custo fica desprezível.
   */
  sequenciaSemTexto: number;
};

export const LIMITES_DE_TEXTO: LimitesDeTexto = {
  caracteresNoDocumento: 8_000_000,
  caracteresPorBloco: 50_000,
  sequenciaSemTexto: 1_000,
};

const RE_LETRA_OU_DIGITO = /[\p{L}\p{N}]/u;

/** Tamanho da maior sequência de caracteres sem letra nem dígito. */
function maiorSequenciaSemTexto(texto: string): number {
  let maior = 0;
  let atual = 0;
  for (let i = 0; i < texto.length; i += 1) {
    const codigo = texto.charCodeAt(i);
    const alfanumerico =
      codigo < 0x80
        ? (codigo >= 0x30 && codigo <= 0x39) || (codigo >= 0x41 && codigo <= 0x5a) || (codigo >= 0x61 && codigo <= 0x7a)
        : // Metade de um par substituto conta como texto: o par é uma letra ou um símbolo, não pontuação repetida.
          (codigo >= 0xd800 && codigo <= 0xdfff) || RE_LETRA_OU_DIGITO.test(texto[i]!);
    if (alfanumerico) atual = 0;
    else {
      atual += 1;
      if (atual > maior) maior = atual;
    }
  }
  return maior;
}

export class Orcamento {
  readonly #limites: LimitesDeTexto;
  #gasto = 0;

  constructor(limites: Partial<LimitesDeTexto> = {}) {
    this.#limites = { ...LIMITES_DE_TEXTO, ...limites };
  }

  /** Desconta `caracteres` do orçamento do documento. */
  gastar(caracteres: number): void {
    this.#gasto += caracteres;
    if (this.#gasto > this.#limites.caracteresNoDocumento) {
      throw new ErroDocx({ motivo: "texto-demais", limite: this.#limites.caracteresNoDocumento });
    }
  }

  /** Confere um parágrafo, título ou célula. */
  #conferirBloco(texto: string, oQue: string): void {
    if (texto.length > this.#limites.caracteresPorBloco) {
      throw new ErroDocx({ motivo: "bloco-longo", bloco: oQue, limite: this.#limites.caracteresPorBloco });
    }
    if (maiorSequenciaSemTexto(texto) > this.#limites.sequenciaSemTexto) {
      throw new ErroDocx({ motivo: "sequencia-sem-texto", bloco: oQue, limite: this.#limites.sequenciaSemTexto });
    }
  }

  /** Confere os blocos de texto lidos do documento, antes de qualquer trabalho sobre eles. */
  conferirElementos(elementos: Elemento[]): void {
    for (const elemento of elementos) {
      if (elemento.tipo === "titulo") this.#conferirBloco(elemento.texto, "um título");
      else if (elemento.tipo === "paragrafo") {
        this.#conferirBloco(elemento.trechos.map((trecho) => trecho.texto).join(""), "um parágrafo");
      } else if (elemento.tipo === "tabela") {
        // A célula mesclada aparece várias vezes na grade, com o mesmo objeto: confere-se uma vez.
        const vistas = new Set<unknown>();
        for (const linha of elemento.linhas) {
          for (const celula of linha) {
            if (vistas.has(celula)) continue;
            vistas.add(celula);
            this.#conferirBloco(celula.texto, "uma célula de tabela");
          }
        }
      }
    }
  }
}
