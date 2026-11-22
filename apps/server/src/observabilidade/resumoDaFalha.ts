/**
 * O resumo de uma falha para o log do servidor: o tipo e um texto técnico curto, sem o que pode trazer
 * conteúdo da pessoa. Os logs registram o id da conversa, nunca o caminho da pasta da tarefa (o nome dela
 * vem do pedido), o nome de um anexo, o texto do pedido ou o da resposta.
 *
 * - **Erro com tag** (`FalhaPasta`, `FalhaProvider`, `LeituraNaoFeita`, `CaminhoRecusado`…): a tag e os
 *   campos que são do código (`motivo`, `regra`, `provider`, `operacao`, `tipo`), nunca o `caminho` nem a
 *   `message`, que o cita; depois, o resumo do `cause`.
 * - **`PlatformError`**: o motivo, o método e a chamada do sistema (`NotFound em FileSystem.readFile
 *   (open)`), sem o caminho nem a descrição do Node, que o repete.
 * - **Outro erro** (o `cause` de um `FalhaProvider`, o defeito do Worker de textos): o nome e o texto
 *   técnico (`Motor.textoTecnico`: curto e saneado), com os caminhos absolutos trocados por `[caminho]`.
 */
import * as Motor from "@simplifica-if/motor";

/** Os campos de um erro com tag que vêm do código (literais ou frases do app), nunca da pessoa. */
const CAMPOS_DO_CODIGO = ["motivo", "regra", "provider", "operacao", "tipo"] as const;

/** Um caminho absoluto entre aspas ou parênteses (inteiro, com espaços) ou solto (até o espaço). */
const CAMINHO_ENTRE_ASPAS = /(["'`])(?:[A-Za-z]:[\\/]|\\\\|~?\/)[^"'`\r\n]{0,4096}?\1/g;
const CAMINHO_ENTRE_PARENTESES = /\((?:[A-Za-z]:[\\/]|\\\\|~?\/)[^()\r\n]{0,4096}\)/g;
const CAMINHO_SOLTO = /(?<![\w.~:/\\-])(?:[A-Za-z]:[\\/]|~?\/)[^\s"'`()]{0,4096}/g;

/** Os caminhos absolutos de um texto viram `[caminho]`. */
export function omitirCaminhos(texto: string): string {
  return texto
    .replace(CAMINHO_ENTRE_ASPAS, "$1[caminho]$1")
    .replace(CAMINHO_ENTRE_PARENTESES, "([caminho])")
    .replace(CAMINHO_SOLTO, "[caminho]");
}

/** O texto técnico (cortado antes, como no `textoTecnico`, para as expressões não varrerem um texto enorme). */
const texto = (valor: string) => Motor.textoTecnico(omitirCaminhos(valor.slice(0, 4000)));

const ehObjeto = (valor: unknown): valor is Record<string, unknown> => typeof valor === "object" && valor !== null;

/** O resumo de uma falha (ou de um defeito) para o log, numa linha. */
export function resumoDaFalha(falha: unknown, profundidade = 0): string {
  if (profundidade > 4) return "…";
  if (typeof falha === "string") return texto(falha);
  if (!ehObjeto(falha)) return typeof falha;
  const tag = typeof falha._tag === "string" ? falha._tag : undefined;
  if (tag === "PlatformError" && ehObjeto(falha.reason)) {
    const motivo = falha.reason;
    const chamada = typeof motivo.syscall === "string" ? ` (${motivo.syscall})` : "";
    return `PlatformError ${String(motivo._tag)} em ${String(motivo.module)}.${String(motivo.method)}${chamada}`;
  }
  if (tag !== undefined) {
    const campos = CAMPOS_DO_CODIGO.flatMap((campo) =>
      typeof falha[campo] === "string" ? [`${campo}=${String(falha[campo])}`] : [],
    );
    const causa = falha.cause === undefined ? "" : `: ${resumoDaFalha(falha.cause, profundidade + 1)}`;
    return `${tag}${campos.length === 0 ? "" : ` (${campos.join(", ")})`}${causa}`;
  }
  const nome = falha instanceof Error ? falha.name : "objeto";
  const codigo = typeof falha.code === "string" ? ` ${falha.code}` : "";
  const mensagem = falha instanceof Error ? texto(falha.message) : "";
  return `${nome}${codigo}${mensagem === "" ? "" : `: ${mensagem}`}`;
}
