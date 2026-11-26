/**
 * O que acontece ao clicar no cartão de uma tarefa, para as aberturas que não são conversa: a rota de
 * cada módulo do app, o domínio de destino de um link e a abertura dele no navegador.
 */
import type { Modulo } from "@simplifica-if/contratos-app";
import type { MensagemErro } from "../conexao/erros.ts";
import { registrarErro, textoDoErro } from "../diagnostico.ts";
import { abrirExterno } from "../ponte-desktop.ts";

/**
 * A tela de cada módulo. Fica aqui, no código, e não no manifesto da tarefa: a rota tem o tipo do
 * roteador, e um módulo novo no app só compila com a rota dele nesta lista. Composição: uma linha por
 * módulo, com o nome dele.
 */
export const ROTAS_MODULO = { "revisao-ppc": "/revisao-ppc" } as const satisfies Record<Modulo, string>;

/**
 * O destino de um link (`suap.ifpr.edu.br`, `suap.ifpr.edu.br:8443`), para a pessoa ver aonde vai antes
 * de sair do app: o domínio e, se a URL traz uma, a porta. O `www.` da frente sai só quando ainda sobra
 * um domínio (dois rótulos): `www.com` fica como está.
 */
export function dominioDoLink(url: string): string {
  if (!URL.canParse(url)) return url;
  const { host } = new URL(url);
  return host.startsWith("www.") && host.slice(4).split(":")[0]!.split(".").length >= 2 ? host.slice(4) : host;
}

/**
 * Abre o link de uma tarefa pelo caminho de link externo do app (no desktop, o navegador do sistema).
 * A falha não some: vai para o log do app, só com o destino (a URL pode trazer consulta), e volta como a
 * frase que o cartão ou a página mostra. `undefined` quando abriu.
 */
export async function abrirLinkDaTarefa(url: string): Promise<MensagemErro | undefined> {
  const destino = dominioDoLink(url);
  try {
    if (await abrirExterno(url)) return undefined;
    registrarErro(`tarefa de link: o navegador bloqueou a aba de ${destino}`);
    return { texto: `O navegador bloqueou a abertura de ${destino}. Permita novas abas para o app e tente de novo.` };
  } catch (falha) {
    registrarErro(`tarefa de link: não abriu ${destino}: ${textoDoErro(falha)}`);
    return { texto: `Não foi possível abrir ${destino} no navegador. Tente de novo.` };
  }
}
