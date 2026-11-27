/**
 * O texto do critério na ficha da pendência (`conversa.ts`): lido uma vez por critério, completa a ficha na
 * caixa quando chega (⌘J, a coluna compacta) e, no envio, sai da lista da própria conversa, não da revisão
 * aberta na tela.
 */
import type { FichaCriterio, ListaPendencias } from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import { describe, expect, it } from "vite-plus/test";
import type { Api } from "../../conexao/api.ts";
import type { GerenteConversas } from "../../conversa/GerenteConversas.ts";
import { ControlePainel } from "../../painel/ControlePainel.ts";
import type { ControleRevisao } from "./ControleRevisao.ts";
import { carregarCriterio, origensDaRevisao, pedidoDaRevisao } from "./conversa.ts";

/** Uma lista com uma pendência `chave` do critério `ficha`, com o título da pendência `titulo`. */
const lista = (id: string, titulo: string): ListaPendencias =>
  ({
    id,
    arquivoOriginal: `/docs/${id}.docx`,
    arquivoAcompanhado: null,
    conversaAoLado: null,
    provider: null,
    resultado: { curso: { cnct: null, forma: null } },
    pendencias: [
      {
        chave: "p1",
        pendencia: {
          ficha: "CT-SUP-17",
          tituloFicha: "Formação pedagógica",
          titulo,
          explicacao: null,
          faltas: [],
          oQueFazer: "",
          secao: null,
          trecho: null,
        },
      },
    ],
  }) as unknown as ListaPendencias;

const ficha = (lista: string) =>
  ({
    id: "CT-SUP-17",
    titulo: "Formação pedagógica",
    criticidade: null,
    pergunta: `O que confere (${lista})`,
    atendido: null,
    naoAtendido: null,
    aConferir: null,
  }) as unknown as FichaCriterio;

/** A `Api` falsa: o critério (sem responder até `liberar`) e as listas; conta as leituras do critério. */
function apiFalsa(listas: ReadonlyArray<ListaPendencias>) {
  const leituras: string[] = [];
  let liberar: () => void = () => undefined;
  const pronto = new Promise<void>((resolver) => {
    liberar = resolver;
  });
  const api = {
    chamar: (chamada: (cliente: unknown) => Promise<unknown>) =>
      chamada({
        "revisaoPpc.criterio": async ({ lista }: { readonly lista: string }) => {
          leituras.push(lista);
          await pronto;
          return ficha(lista);
        },
        "revisaoPpc.lista": async ({ lista }: { readonly lista: string }) => listas.find((l) => l.id === lista),
        "revisaoPpc.conversarSobre": async () => ({ nova: false, conversa: "c1", ppc: null, docx: null }),
      }),
  } as unknown as Api;
  return { api, leituras, liberar: () => liberar() };
}

const revisaoCom = (aberta: ListaPendencias | undefined) =>
  ({ obter: () => ({ lista: aberta }), observar: () => () => undefined }) as unknown as ControleRevisao;

const conversas = { foiApagada: () => false } as unknown as GerenteConversas;

describe("o critério na ficha da pendência", () => {
  it("lido uma vez por critério, também de outra revisão", async () => {
    const { api, leituras, liberar } = apiFalsa([]);
    const um = carregarCriterio(api, "A", "CT-SUP-17");
    const dois = carregarCriterio(api, "B", "CT-SUP-17");
    liberar();
    expect(await um).toBe(await dois);
    expect(await carregarCriterio(api, "C", "CT-SUP-17")).toContain("O que confere (A)");
    expect(leituras).toEqual(["A"]);
    expect(await carregarCriterio(api, "A", "TRIAGEM")).toBeUndefined();
  });

  it("⌘J ou a coluna compacta: a ficha na caixa ganha o texto do critério quando ele chega", async () => {
    const { api, liberar } = apiFalsa([]);
    const painel = new ControlePainel();
    const apoio = { api, revisao: revisaoCom(lista("A", "Sem formação")), conversas, painel };
    painel.conversar(pedidoDaRevisao(apoio, "p1")!, { mostrar: false });
    const antes = painel.obter().conversa.fichas.find((f) => f.chave === "pendencia:p1")!;
    expect(antes.ficha).toBeUndefined();
    expect(antes.detalhe).toContain("Critério da revisão: Formação pedagógica");

    liberar();
    await carregarCriterio(api, "A", "CT-SUP-17");
    await Promise.resolve();
    const depois = painel.obter().conversa.fichas.find((f) => f.chave === "pendencia:p1")!;
    expect(depois.detalhe).toContain("O que confere: O que confere (A)");
    expect(depois.ficha).toEqual({ _tag: "texto", rotulo: "Pendência: Sem formação", texto: depois.detalhe });
    // A ficha do PPC continua.
    expect(painel.obter().conversa.fichas.map((f) => f.chave)).toEqual(["ppc:A", "pendencia:p1"]);
  });

  it("a caixa que passou a outra conversa não ganha a ficha", async () => {
    const { api, liberar } = apiFalsa([]);
    const painel = new ControlePainel();
    const apoio = { api, revisao: revisaoCom(lista("A", "Sem formação")), conversas, painel };
    painel.conversar(pedidoDaRevisao(apoio, "p1")!, { mostrar: false });
    painel.novaConversa();
    liberar();
    await carregarCriterio(api, "A", "CT-SUP-17");
    await Promise.resolve();
    expect(painel.obter().conversa.fichas).toEqual([]);
  });

  it("no envio, a pendência sai da lista da conversa, não da outra revisão aberta com a mesma chave", async () => {
    const a = lista("A", "Pendência da revisão A");
    const b = lista("B", "Pendência da revisão B");
    const { api, liberar } = apiFalsa([a, b]);
    liberar();
    const painel = new ControlePainel();
    const origens = origensDaRevisao({ api, revisao: revisaoCom(b), conversas, painel });
    const pronta = await origens.preparar(
      { chave: "revisao-ppc:A" },
      {
        conversa: "c1",
        fichas: [{ chave: "pendencia:p1", rotulo: "Pendência: Pendência da revisão A", tipo: "pendencia", tirar: "" }],
        ia: { provider: "claude" },
        texto: "e agora?",
      },
    );
    const texto = pronta!.fichas[0]!;
    expect(texto._tag === "texto" && texto.texto).toContain("Pendência da revisão A");
    expect(texto._tag === "texto" && texto.texto).not.toContain("revisão B");
    expect(texto._tag === "texto" && texto.texto).toContain("O que confere:");
  });
});
