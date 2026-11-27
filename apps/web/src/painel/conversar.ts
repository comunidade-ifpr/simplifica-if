/**
 * De onde nasce a conversa ao lado (`docs/plans/multitarefa.md`, "De onde nasce"): as fichas de um link da
 * base e de um trecho, o pedido de um link (o módulo troca o link que é dele, como o PPC em revisão, pelas
 * fichas dele) e o contexto da tela para ⌘J: o que a tela declarou, mais o documento aberto no Ler.
 */
import { linkAtual } from "../leitor/historico.ts";
import { nomeCurtoLink } from "../tarefas/textos.ts";
import type { ContextoApp } from "../contexto.tsx";
import type { FichaRascunho, PedidoConversa } from "./ControlePainel.ts";

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

/**
 * Junta pedidos: as fichas e as ofertas de todos, a origem e a conversa do primeiro que as tem. De dois
 * pedidos da mesma origem (a revisão na tela e o PPC dela no Ler, em outra pendência), vale o primeiro.
 */
export function juntarPedidos(...pedidos: ReadonlyArray<PedidoConversa | undefined>): PedidoConversa {
  const dados = pedidos.filter(
    (p, i): p is PedidoConversa =>
      p !== undefined &&
      (p.origem === undefined || !pedidos.slice(0, i).some((antes) => antes?.origem?.chave === p.origem?.chave)),
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
