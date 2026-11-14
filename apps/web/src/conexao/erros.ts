/**
 * O texto dos erros que chegam à interface. Os erros tipados do servidor já trazem `message` em
 * português; os do transporte (`RpcClientError`) e os defeitos ganham uma frase própria.
 */

function comMaiuscula(texto: string): string {
  return texto.length === 0 ? texto : `${texto[0]!.toUpperCase()}${texto.slice(1)}`;
}

function comPonto(texto: string): string {
  return /[.!?…]$/.test(texto) ? texto : `${texto}.`;
}

/** Uma frase para a pessoa que usa o app. */
export function mensagemDeErro(erro: unknown): string {
  if (typeof erro === "object" && erro !== null) {
    const registro = erro as { readonly _tag?: unknown; readonly message?: unknown };
    if (registro._tag === "RpcClientError") return "A conexão com o servidor local caiu durante o pedido.";
    if (typeof registro._tag === "string" && typeof registro.message === "string" && registro.message.length > 0) {
      return comPonto(comMaiuscula(registro.message));
    }
  }
  return "Algo deu errado no app. Tente de novo.";
}
