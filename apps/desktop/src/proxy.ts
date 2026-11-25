// @effect-diagnostics nodeBuiltinImport:off -- processo principal do Electron, sem runtime Effect (ver README)
/**
 * A proxy que o Electron resolve para o feed (`session.resolveProxy`: a configuração do sistema, o
 * PAC e o WPAD) como as variáveis que o servidor lê (`HTTP_PROXY`, `HTTPS_PROXY`), para o download da
 * base e das CLIs gerenciadas passar pela proxy institucional como o navegador do sistema. Só a
 * primeira regra conta; `DIRECT` e SOCKS (que o `undici` não usa) não dão variável. As que o ambiente
 * já tem não mudam.
 */
export function proxyParaServidor(
  resolvida: string,
  ambiente: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const primeira = resolvida.split(";")[0]?.trim() ?? "";
  const partes = /^(PROXY|HTTPS)\s+(\S+)$/i.exec(primeira);
  if (partes === null) return {};
  const url = `${partes[1]!.toUpperCase() === "HTTPS" ? "https" : "http"}://${partes[2]}`;
  const definida = (nome: string) => (ambiente[nome] ?? ambiente[nome.toLowerCase()] ?? "") !== "";
  const saida: Record<string, string> = {};
  if (!definida("HTTPS_PROXY")) saida.HTTPS_PROXY = url;
  if (!definida("HTTP_PROXY")) saida.HTTP_PROXY = url;
  return saida;
}
