/**
 * O texto do critério na ficha da pendência (`conversa.ts`): lido uma vez por critério, completa a ficha na
 * caixa quando chega (⌘J, a coluna compacta) e, no envio, sai da lista da própria conversa, não da revisão
 * aberta na tela. E as várias conversas da revisão: uma origem por pendência e por conversa geral.
 */
import type { FichaCriterio, ListaPendencias } from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import { describe, expect, it, vi } from "vite-plus/test";
import type { Api } from "../../conexao/api.ts";
import type { GerenteConversas } from "../../conversa/GerenteConversas.ts";
import { ControlePainel } from "../../painel/ControlePainel.ts";
import type { ControleRevisao } from "./ControleRevisao.ts";
import { depoisDeTrocarCurso } from "./apagarRevisao.ts";
import {
  carregarCriterio,
  ehConversaDaRevisao,
  FICHA_PPC,
  lerOrigem,
  origensDaRevisao,
  pedidoDaConversa,
  pedidoDaRevisao,
  pedidoDeConversaNova,
} from "./conversa.ts";

/** Uma lista com uma pendência `chave` do critério `ficha`, com o título da pendência `titulo`. */
const lista = (id: string, titulo: string): ListaPendencias =>
  ({
    id,
    arquivoOriginal: `/docs/${id}.docx`,
    arquivoAcompanhado: null,
    conversas: [],
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
    expect(painel.obter().conversa.fichas.map((f) => f.chave)).toEqual([FICHA_PPC, "pendencia:p1"]);
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

describe("as conversas da revisão", () => {
  /** A lista com duas pendências e as conversas dadas. */
  const comConversas = (conversas: ListaPendencias["conversas"]): ListaPendencias => {
    const base = lista("A", "Sem formação");
    const outra = { ...base.pendencias[0]!, chave: "p2" };
    return { ...base, pendencias: [...base.pendencias, outra], conversas } as ListaPendencias;
  };

  it("cada pendência tem a sua origem; a que já tem conversa a retoma; a geral nova não cai na de uma pendência", () => {
    const { api } = apiFalsa([]);
    const painel = new ControlePainel();
    const aberta = comConversas([{ conversa: "c2", pasta: "/p2", pendencia: "p2", titulo: "Estágio" }]);
    const apoio = { api, revisao: revisaoCom(aberta), conversas, painel };

    const um = pedidoDaRevisao(apoio, "p1")!;
    expect(um.origem?.chave).toBe("revisao-ppc:A#p1");
    expect(um.conversa).toBeUndefined();
    expect(um.fichas?.map((f) => f.chave)).toEqual([FICHA_PPC, "pendencia:p1"]);
    expect(um.grupo).toBe("revisao-ppc:A");

    const dois = pedidoDaRevisao(apoio, "p2")!;
    expect(dois).toMatchObject({ conversa: "c2", origem: { chave: "revisao-ppc:A#p2" } });

    // Duas pendências no painel: duas conversas, não uma.
    painel.conversar(um);
    painel.conversar(dois);
    expect(painel.obter().conversa.id).toBe("c2");
    painel.conversar(um);
    expect(painel.obter().conversa.id).toBeUndefined();
    expect(painel.obter().conversa.origem?.chave).toBe("revisao-ppc:A#p1");

    // Sem pendência: uma geral nova, que não é a da pendência; e ⌘J de novo fica nela.
    const geral = pedidoDaRevisao(apoio, null)!;
    expect(lerOrigem(geral.origem!.chave)).toEqual({ lista: "A" });
    painel.conversar(geral);
    expect(painel.obter().conversa.fichas.map((f) => f.chave)).toEqual([FICHA_PPC]);
    painel.escreverTexto("sobre o curso");
    painel.conversar(pedidoDaRevisao(apoio, null)!);
    expect(painel.obter().conversa.texto).toBe("sobre o curso");
    // "Nova conversa sobre esta revisão" abre outra, com a pergunta já escrita.
    painel.conversar(pedidoDeConversaNova(apoio)!);
    expect(painel.obter().conversa.texto).toBe("sobre o curso");
    expect(painel.obter().conversa.origem?.chave).not.toBe(geral.origem?.chave);
  });

  it("uma conversa de 'Conversas desta revisão' abre pela origem dela, e o painel a reconhece como da revisão", () => {
    const { api } = apiFalsa([]);
    const painel = new ControlePainel();
    const aberta = comConversas([
      { conversa: "g", pasta: "/g", pendencia: null, titulo: "Geral" },
      { conversa: "c1", pasta: "/p1", pendencia: "p1", titulo: "Formação" },
    ]);
    const apoio = { api, revisao: revisaoCom(aberta), conversas, painel };
    painel.conversar(pedidoDaConversa(apoio, aberta.conversas[0]!)!);
    expect(painel.obter().conversa).toMatchObject({ id: "g", origem: { chave: "revisao-ppc:A~g" } });
    expect(ehConversaDaRevisao(painel.obter().conversa, aberta)).toBe(true);
    // A geral que o painel mostra é a do ⌘J sem pendência.
    expect(pedidoDaRevisao(apoio, null)).toMatchObject({ conversa: "g", origem: { chave: "revisao-ppc:A~g" } });
    painel.conversar(pedidoDaConversa(apoio, aberta.conversas[1]!)!);
    expect(painel.obter().conversa).toMatchObject({ id: "c1", origem: { chave: "revisao-ppc:A#p1" } });
    painel.novaConversa();
    expect(ehConversaDaRevisao(painel.obter().conversa, aberta)).toBe(false);
  });

  it("no envio, o servidor recebe a conversa do painel e a pendência da origem", async () => {
    const pedidos: unknown[] = [];
    const api = {
      chamar: (chamada: (cliente: unknown) => Promise<unknown>) =>
        chamada({
          "revisaoPpc.conversarSobre": async (entrada: unknown) => {
            pedidos.push(entrada);
            return { nova: false, conversa: "c1", ppc: null, docx: null };
          },
        }),
    } as unknown as Api;
    const origens = origensDaRevisao({ api, revisao: revisaoCom(undefined), conversas, painel: new ControlePainel() });
    const mensagem = { fichas: [], ia: { provider: "claude" as const }, texto: "oi" };
    await origens.preparar({ chave: "revisao-ppc:A#p1" }, { ...mensagem, conversa: undefined });
    await origens.preparar({ chave: "revisao-ppc:A~nova-1" }, { ...mensagem, conversa: "g" });
    expect(pedidos).toEqual([
      { lista: "A", pendencia: "p1", provider: "claude", ppc: false, docx: false },
      { lista: "A", conversa: "g", provider: "claude", ppc: false, docx: false },
    ]);
    expect(origens.preparar({ chave: "outra" }, { ...mensagem, conversa: undefined })).toBeUndefined();
  });

  it("'Qual é o curso?' troca o id da lista: a ficha do PPC que já estava na caixa continua pedindo o PPC", async () => {
    const pedidos: Array<{ readonly lista: string; readonly ppc: boolean }> = [];
    const api = {
      chamar: (chamada: (cliente: unknown) => Promise<unknown>) =>
        chamada({
          "revisaoPpc.conversarSobre": async (entrada: { readonly lista: string; readonly ppc: boolean }) => {
            pedidos.push(entrada);
            return { nova: false, conversa: "c1", ppc: null, docx: null };
          },
          "revisaoPpc.criterio": async () => Promise.reject(new Error("sem critério")),
          "revisaoPpc.lista": async () => Promise.reject(new Error("sem lista")),
        }),
    } as unknown as Api;
    const painel = new ControlePainel();
    const apoio = { api, revisao: revisaoCom(lista("A", "Sem formação")), conversas, painel };
    painel.conversar(pedidoDaRevisao(apoio, "p1")!);
    depoisDeTrocarCurso({ painel }, { esquecerPrefixo: () => undefined } as never, "A", "B");
    const { origem, fichas } = painel.obter().conversa;
    expect(origem?.chave).toBe("revisao-ppc:B#p1");
    await origensDaRevisao(apoio).preparar(origem!, {
      conversa: undefined,
      fichas,
      ia: { provider: "claude" },
      texto: "oi",
    });
    expect(pedidos).toMatchObject([{ lista: "B", ppc: true }]);
  });

  it("o tema da pasta vai junto: o critério da pendência aberta, ou o título da ficha se ela saiu da lista", async () => {
    const pedidos: unknown[] = [];
    const api = {
      chamar: (chamada: (cliente: unknown) => Promise<unknown>) =>
        chamada({
          "revisaoPpc.conversarSobre": async (entrada: unknown) => {
            pedidos.push(entrada);
            return { nova: false, conversa: "c1", ppc: null, docx: null };
          },
        }),
    } as unknown as Api;
    const origens = origensDaRevisao({
      api,
      revisao: revisaoCom(lista("A", "Sem formação")),
      conversas,
      painel: new ControlePainel(),
    });
    const mensagem = { conversa: undefined, ia: { provider: "claude" as const }, texto: "oi" };
    await origens.preparar({ chave: "revisao-ppc:A#p1" }, { ...mensagem, fichas: [] });
    await origens.preparar(
      { chave: "revisao-ppc:A#saiu" },
      {
        ...mensagem,
        fichas: [
          { chave: "pendencia:saiu", rotulo: "Pendência: Estágio supervisionado", tipo: "pendencia", tirar: "" },
        ],
      },
    );
    expect(pedidos).toMatchObject([
      { pendencia: "p1", tema: "Formação pedagógica" },
      { pendencia: "saiu", tema: "Estágio supervisionado" },
    ]);
  });

  it("a lista se relê depois do envio, não antes: a falha da leitura não derruba a mensagem, e o título chega", async () => {
    let falhar = true;
    const relida = {
      ...lista("A", "Sem formação"),
      conversas: [{ conversa: "c1", pasta: "/c1", pendencia: "p1", titulo: "Oi" }],
    };
    const leituras: string[] = [];
    const api = {
      chamar: (chamada: (cliente: unknown) => Promise<unknown>) =>
        chamada({
          "revisaoPpc.conversarSobre": async () => ({ nova: true, conversa: "c1", ppc: null, docx: null }),
          "revisaoPpc.lista": async ({ lista }: { readonly lista: string }) => {
            leituras.push(lista);
            if (falhar) throw new Error("sem conexão");
            return relida;
          },
        }),
    } as unknown as Api;
    const abertas: ListaPendencias[] = [];
    let aberta: ListaPendencias = lista("A", "Sem formação");
    const revisao = {
      obter: () => ({ lista: aberta }),
      observar: () => () => undefined,
      abrirLista: (l: ListaPendencias) => {
        abertas.push(l);
        aberta = l;
      },
    } as unknown as ControleRevisao;
    const origens = origensDaRevisao({ api, revisao, conversas, painel: new ControlePainel() });
    const origem = { chave: "revisao-ppc:A#p1" };
    const pronta = await origens.preparar(origem, {
      conversa: undefined,
      fichas: [],
      ia: { provider: "claude" },
      texto: "oi",
    });
    expect(pronta?.conversa).toBe("c1");
    expect(leituras).toEqual([]);
    // A leitura que falha fica para a próxima; a seguinte traz a conversa com o título.
    origens.depoisDoEnvio(origem, "c1");
    await Promise.resolve();
    falhar = false;
    origens.depoisDoEnvio(origem, "c1");
    await vi.waitFor(() => expect(abertas).toHaveLength(1));
    expect(abertas[0]!.conversas[0]!.titulo).toBe("Oi");
    // Com a conversa e o título na lista, não relê.
    origens.depoisDoEnvio(origem, "c1");
    expect(leituras).toEqual(["A", "A"]);
  });
});
