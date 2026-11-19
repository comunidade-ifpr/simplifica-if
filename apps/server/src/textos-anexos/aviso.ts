/**
 * O aviso à IA do que a pessoa mexeu na pasta fora da conversa (`MudancasPasta`), acrescentado ao
 * pedido do turno. Até `NOMES_POR_GRUPO` nomes por grupo, e "e mais N".
 */
import type { ArquivoMudado, MudancasPasta } from "@simplifica-if/contratos-app";

const NOMES_POR_GRUPO = 10;

/** O nome numa linha só: o macOS aceita quebra de linha num nome de arquivo. */
const umaLinha = (texto: string) => texto.replace(/[\r\n]+/g, " ");

/** Código em linha do Markdown, com uma cerca maior que a maior sequência de crases do texto. */
function codigoEmLinha(texto: string): string {
  const maior = Math.max(0, ...[...texto.matchAll(/`+/g)].map((crases) => crases[0].length));
  const cerca = "`".repeat(maior + 1);
  const folga = texto.startsWith("`") || texto.endsWith("`") ? " " : "";
  return `${cerca}${folga}${texto}${folga}${cerca}`;
}

function linha(arquivo: ArquivoMudado, refeito: boolean): string {
  const nome = codigoEmLinha(umaLinha(arquivo.nome));
  if (arquivo.texto !== undefined)
    return `- ${nome}: leia a versão em texto${refeito ? " (refeita)" : ""}, ${codigoEmLinha(umaLinha(arquivo.texto))}`;
  if (arquivo.semTexto !== undefined) return `- ${nome}: sem versão em texto. ${arquivo.semTexto}`;
  return `- ${nome}`;
}

function grupo(titulo: string, linhas: ReadonlyArray<string>): ReadonlyArray<string> {
  if (linhas.length === 0) return [];
  const resto = linhas.length - NOMES_POR_GRUPO;
  return [titulo, ...linhas.slice(0, NOMES_POR_GRUPO), ...(resto > 0 ? [`- e mais ${resto}`] : [])];
}

/** O texto do aviso, para ir depois da mensagem da pessoa. */
export function avisoDasMudancas(mudancas: MudancasPasta): string {
  return [
    "Desde a sua última resposta, a pessoa mexeu na pasta da tarefa, fora da conversa:",
    ...grupo(
      "Arquivos novos:",
      mudancas.novos.map((arquivo) => linha(arquivo, false)),
    ),
    ...grupo(
      "Arquivos mudados (releia antes de responder sobre eles):",
      mudancas.mudados.map((arquivo) => linha(arquivo, true)),
    ),
    ...grupo(
      "Arquivos removidos:",
      mudancas.removidos.map((nome) => `- ${codigoEmLinha(umaLinha(nome))}`),
    ),
  ].join("\n");
}
