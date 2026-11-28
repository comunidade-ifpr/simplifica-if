/**
 * De onde nasce a conversa ao lado (`docs/plans/multitarefa.md`, "De onde nasce"): as fichas de um link da
 * base e de um trecho, o pedido de um link (o módulo troca o link que é dele, como o PPC em revisão, pelas
 * fichas dele) e o contexto da tela para ⌘J e para o clique na aba Conversar com o rascunho intocado: o que
 * a tela declarou, mais o documento aberto no Ler. No rascunho de "Nova conversa", o convite da tela o leva.
 */
import { linkAtual } from "../leitor/historico.ts";
import { nomeCurtoLink } from "../tarefas/textos.ts";
import type { ContextoApp } from "../contexto.tsx";
import { type FichaRascunho, type PedidoConversa, rascunhoIntocado } from "./ControlePainel.ts";

/** Um documento (ou dispositivo) da base: a IA o lê pelas ferramentas `ifpr`. */
export function fichaDoLink(link: string, rotulo = nomeCurtoLink(link)): FichaRascunho {
  return {
    chave: `link:${link}`,
    rotulo,
    tipo: "documento",
    tirar: `Tirar “${rotulo}” do contexto`,
    detalhe: link,
    ficha: { _tag: "link", rotulo, link },
  };
}

/** Um trecho selecionado, com o dispositivo do começo da seleção, quando há. */
export function fichaDoTrecho(texto: string, link?: string): FichaRascunho {
  const onde = link === undefined ? "" : ` (${nomeCurtoLink(link)})`;
  const rotulo = `Trecho${onde}: “${texto.length > 60 ? `${texto.slice(0, 59)}…` : texto}”`;
  return {
    chave: `trecho:${link ?? ""}:${texto}`,
    rotulo,
    tipo: "trecho",
    tirar: "Tirar o trecho do contexto",
    detalhe: texto,
    ficha: { _tag: "texto", rotulo: link === undefined ? rotulo : `${rotulo} (${link})`, texto },
  };
}

/** O lugar de onde o pedido vem: o grupo dele, senão a origem. */
const grupoDe = (pedido: PedidoConversa | undefined) => pedido?.grupo ?? pedido?.origem?.chave;

/**
 * Junta pedidos: as fichas e as ofertas de todos, a origem e a conversa do primeiro que as tem. De dois
 * pedidos do mesmo lugar (a revisão na tela e o PPC dela no Ler, em outra pendência), vale o primeiro.
 */
export function juntarPedidos(...pedidos: ReadonlyArray<PedidoConversa | undefined>): PedidoConversa {
  const dados = pedidos.filter(
    (p, i): p is PedidoConversa =>
      p !== undefined &&
      (grupoDe(p) === undefined || !pedidos.slice(0, i).some((antes) => grupoDe(antes) === grupoDe(p))),
  );
  const origem = dados.find((p) => p.origem !== undefined);
  const texto = dados.find((p) => p.texto !== undefined)?.texto;
  const unicas = (fichas: ReadonlyArray<FichaRascunho>) =>
    fichas.filter((ficha, i) => fichas.findIndex((outra) => outra.chave === ficha.chave) === i);
  return {
    fichas: unicas(dados.flatMap((p) => p.fichas ?? [])),
    ofertas: unicas(dados.flatMap((p) => p.ofertas ?? [])),
    ...(origem?.origem === undefined ? {} : { origem: origem.origem }),
    ...(origem?.conversa === undefined ? {} : { conversa: origem.conversa }),
    ...(origem?.grupo === undefined ? {} : { grupo: origem.grupo }),
    ...(texto === undefined ? {} : { texto }),
  };
}

/** O pedido de um link: o do módulo que o conhece, ou a ficha do documento da base. */
export function pedidoDoLink(app: Pick<ContextoApp, "pedidoDoLink">, link: string): PedidoConversa {
  return app.pedidoDoLink(link) ?? { fichas: [fichaDoLink(link)] };
}

/** O documento aberto no Ler do painel, se o painel o mostra (e não é um dos de `exceto`). */
export function pedidoDoLer(
  app: Pick<ContextoApp, "painel" | "pedidoDoLink">,
  exceto: (link: string) => boolean = () => false,
): PedidoConversa | undefined {
  const estado = app.painel.obter();
  const lendo = estado.aberto && estado.aba === "ler" ? linkAtual(estado.historico) : undefined;
  return lendo === undefined || exceto(lendo) ? undefined : pedidoDoLink(app, lendo);
}

/** O contexto da tela à vista para ⌘J: o que ela declarou e o documento aberto no Ler do painel. */
export function contextoParaConversar(app: Pick<ContextoApp, "painel" | "pedidoDoLink">): PedidoConversa {
  return juntarPedidos(app.painel.contextoDaTela(), pedidoDoLer(app));
}

/**
 * O clique na aba Conversar (e a aba escolhida pelas setas): com o rascunho intocado (nada nele, e não o de
 * "Nova conversa"), a aba traz o contexto da tela, como ⌘J; senão, só mostra a aba. `focar: false` (as
 * setas): o foco fica na aba, em vez de ir à caixa.
 */
export function mostrarConversar(
  app: Pick<ContextoApp, "painel" | "pedidoDoLink">,
  opcoes: { readonly focar?: boolean } = {},
): void {
  if (rascunhoIntocado(app.painel.obter().conversa)) {
    const pedido = contextoParaConversar(app);
    if (pedido.origem !== undefined || (pedido.fichas ?? []).length > 0) {
      app.painel.conversar(pedido, opcoes);
      return;
    }
  }
  app.painel.mostrar("conversar");
}

/**
 * O convite do rascunho livre: a caixa leva o contexto da tela, com o que a pessoa já tinha escrito e posto
 * nela.
 */
export function aceitarConvite(app: Pick<ContextoApp, "painel" | "pedidoDoLink">): void {
  const atual = app.painel.obter().conversa;
  const pedido = contextoParaConversar(app);
  const juntas = (de: ReadonlyArray<FichaRascunho>, mais: ReadonlyArray<FichaRascunho>) => [
    ...de,
    ...mais.filter((ficha) => !de.some((outra) => outra.chave === ficha.chave)),
  ];
  app.painel.conversar({
    ...pedido,
    fichas: juntas(pedido.fichas ?? [], atual.fichas),
    ofertas: juntas(pedido.ofertas ?? [], atual.ofertas),
    ...(atual.texto === "" ? {} : { texto: atual.texto }),
  });
}
