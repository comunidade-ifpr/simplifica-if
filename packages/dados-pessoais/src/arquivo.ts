/**
 * O texto de um arquivo anexado, em segmentos com o lugar de cada um, para o detector
 * (`detector.ts`). Sem Node: recebe os bytes; quem lê o disco é o servidor, num `Worker`.
 *
 * - `.docx`: o corpo do documento pelo `@simplifica-if/docx` (com os limites contra arquivo hostil de
 *   `LIMITES_PADRAO`, e o arquivo recusado sai como "não conferido"), um segmento por parágrafo
 *   (`parágrafo 12`) e por linha de tabela (`tabela 2, linha 5`). Cabeçalho, rodapé, notas e
 *   comentários do Word não são lidos.
 * - `.md`, `.txt`, `.csv`, `.json`: UTF-8, um segmento por linha (`linha 40`).
 * - Os demais (PDF, planilha, apresentação, ODF, imagem): "não conferido". Não há leitor de PDF no
 *   repositório; a interface diz que o arquivo não foi conferido.
 */
import { ErroDocx } from "@simplifica-if/docx/erro";
import { lerDocx } from "@simplifica-if/docx/leitor";
import { textoDoParagrafo } from "@simplifica-if/docx/modelo";
import { resumirAchados, type ResumoAchados, type Segmento } from "./detector.ts";

export const EXTENSOES_TEXTO = [".md", ".txt", ".csv", ".json"] as const;
export const EXTENSOES_CONFERIDAS: ReadonlyArray<string> = [".docx", ...EXTENSOES_TEXTO];

export type ConferenciaArquivo =
  | ({ readonly situacao: "conferido" } & ResumoAchados)
  | { readonly situacao: "nao-conferido"; readonly motivo: string };

const extensao = (nome: string) => {
  const ponto = nome.lastIndexOf(".");
  return ponto < 0 ? "" : nome.slice(ponto).toLowerCase();
};

/** Por que um tipo de arquivo não é conferido, em português. */
export function motivoNaoConferido(nome: string): string {
  const ext = extensao(nome);
  if (ext === ".pdf") return "O app ainda não lê PDF para procurar dados pessoais.";
  if ([".png", ".jpg", ".jpeg"].includes(ext)) return "O app não lê o texto de imagens.";
  return "O app ainda não lê este tipo de arquivo para procurar dados pessoais.";
}

/** As linhas de um texto, numeradas a partir de 1. */
function* linhas(texto: string): Generator<Segmento> {
  let numero = 0;
  for (const linha of texto.split(/\r\n|\r|\n/)) {
    numero++;
    if (linha.trim() !== "") yield { onde: `linha ${numero}`, texto: linha };
  }
}

/** Os parágrafos e as linhas de tabela do corpo de um `.docx`. */
function* blocosDocx(bytes: Uint8Array): Generator<Segmento> {
  const documento = lerDocx(bytes);
  let paragrafo = 0;
  let tabela = 0;
  for (const bloco of documento.blocos) {
    if (bloco.tipo === "paragrafo") {
      paragrafo++;
      const texto = textoDoParagrafo(bloco);
      if (texto.trim() !== "") yield { onde: `parágrafo ${paragrafo}`, texto };
      continue;
    }
    tabela++;
    let linha = 0;
    for (const linhaTabela of bloco.linhas) {
      linha++;
      // As células da linha separadas por " | ": o trecho mostra a linha como se lê.
      const texto = linhaTabela.celulas
        .filter((celula) => celula.direta)
        .map((celula) => celula.textoProfundo.replace(/\s*\n\s*/g, " "))
        .join(" | ");
      if (texto.trim() !== "") yield { onde: `tabela ${tabela}, linha ${linha}`, texto };
    }
  }
}

/**
 * Confere um arquivo: o resumo dos achados, ou por que não foi conferido. Um `.docx` que o leitor
 * recusa (corrompido, protegido, grande demais) sai como "não conferido" com a mensagem do leitor.
 */
export function conferirArquivo(nome: string, bytes: Uint8Array): ConferenciaArquivo {
  const ext = extensao(nome);
  if (ext === ".docx") {
    try {
      return { situacao: "conferido", ...resumirAchados(blocosDocx(bytes)) };
    } catch (erro) {
      // `ErroDocx` traz a frase em português; um defeito do leitor não deve impedir o anexo.
      const mensagem = erro instanceof ErroDocx ? ` ${erro.message}` : "";
      return { situacao: "nao-conferido", motivo: `O app não conseguiu ler este documento do Word.${mensagem}` };
    }
  }
  if ((EXTENSOES_TEXTO as ReadonlyArray<string>).includes(ext)) {
    return { situacao: "conferido", ...resumirAchados(linhas(new TextDecoder("utf-8").decode(bytes))) };
  }
  return { situacao: "nao-conferido", motivo: motivoNaoConferido(nome) };
}
