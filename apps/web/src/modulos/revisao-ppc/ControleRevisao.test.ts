/**
 * O `ControleRevisao` em Node, sem navegador:
 * - abrir uma lista, navegar para outra tela e voltar sem perder o stream nem o estado da revisão;
 * - conclusão incremental de blocos + conclusão final disparando uma única recarga (sem corrida de
 *   recarga dupla) e contagem exata de `novas` e `conclusao`, inclusive quando uma recarga anterior
 *   ainda está em curso (coalescência);
 * - recuperação unificada de `pedeArquivoDeNovo` para ações da lista (`abrirNoWord`, `trocarCurso`),
 *   ações da IA (`prepararIa`, `iniciarIa`) e ações por pendência (`sugerir`, `contestar`, `revisarDeNovo`).
 */
import type { EstadoProvider, Preferencias, Provider } from "@simplifica-if/contratos-app";
import type {
  BlocoRevisaoIa,
  EstadoRevisaoIa,
  EventoAcompanhamento,
  ListaPendencias,
  PendenciaViva,
} from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import { describe, expect, it, vi } from "vite-plus/test";
import type { Acompanhamento, Api } from "../../conexao/api.ts";
import { ControleRevisao, type EstadoRevisao } from "./ControleRevisao.ts";

const ARQUIVO = "/Users/servidora/PPC.docx";
const ERRO_ARQUIVO = {
  _tag: "FalhaRevisaoPpc",
  escolherDeNovo: true,
  message: "Escolha o arquivo de novo para continuar.",
};

function criarPendencia(chave: string, extra: Partial<PendenciaViva> = {}): PendenciaViva {
  return {
    chave,
    pendencia: {
      ficha: "CT-01",
      tituloFicha: "Critério de teste",
      tema: "Identificação",
      ordemTema: 1,
      estado: "nao_atende",
      titulo: `Pendência ${chave}`,
      explicacao: "Explicação",
      faltas: [],
      oQueFazer: "Corrigir.",
      trecho: "Trecho",
      secao: "1",
      fontes: [],
      tambemEm: [],
      noDocumento: "no-trecho",
      origem: "ia",
      dependeDoCurso: false,
    },
    situacao: "aberta",
    resolvidaPor: null,
    historico: [],
    sugestao: null,
    aceitaIa: true,
    julgadaPor: null,
    ...extra,
  };
}

function criarLista(
  id: string,
  chaves: ReadonlyArray<string>,
  extra: Partial<ListaPendencias["resultado"]> = {},
): ListaPendencias {
  return {
    id,
    arquivoOriginal: ARQUIVO,
    sha256: "sha256-0123456789abcdef",
    revisao: null,
    arquivoAcompanhado: null,
    conversaAoLado: null,
    criadaEm: "2026-11-24T09:00:00Z",
    atualizadaEm: "2026-11-24T09:00:00Z",
    provider: "claude",
    uso: { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0, custoUsd: 0 },
    resultado: {
      arquivoOriginal: ARQUIVO,
      arquivoComentado: "/Users/servidora/PPC - revisão prévia (Simplifica IF).docx",
      dataBase: "2026-11-24",
      curso: { cnct: null, forma: null, origem: "documento" },
      totalCriterios: 10,
      conferidos: 2,
      conferidosIa: 0,
      paraConferirIa: 0,
      leituraIa: "nenhuma",
      criterios: [],
      foraDaRevisao: [],
      ...extra,
    },
    pendencias: chaves.map((c) => criarPendencia(c)),
  };
}

function criarBloco(id: string, estado: BlocoRevisaoIa["estado"]): BlocoRevisaoIa {
  return {
    id,
    tipo: "focal",
    tema: `Tema ${id}`,
    ordemTema: id === "b1" ? 1 : 2,
    fichas: 2,
    titulosFichas: [`Critério ${id}`],
    estado,
    etapa: null,
    iniciadoEm: null,
    ultimaAtividadeEm: null,
    naoConferidas: 0,
    pendenciasEncontradas: estado === "pronto" ? 1 : 0,
    segundos: estado === "pronto" ? 12 : null,
  };
}

function criarEstadoIa(
  situacao: EstadoRevisaoIa["situacao"],
  blocos: ReadonlyArray<BlocoRevisaoIa>,
  extra: Partial<EstadoRevisaoIa> = {},
): EstadoRevisaoIa {
  return {
    id: "rev-ia-1",
    lista: "lista-1",
    arquivoOriginal: ARQUIVO,
    provider: "claude",
    modelo: "claude-sonnet-5-5",
    modo: "rapido",
    situacao,
    motivo: null,
    limite: false,
    blocoPausado: null,
    blocos,
    estimativa: {
      provider: "claude",
      blocos: blocos.length,
      fichas: 4,
      tokensEntrada: 1000,
      tokensSaida: 500,
      minutos: 2,
      custoUsd: null,
      percentualJanela: 5,
      limiteDoPlano: "do limite de 5 horas",
    },
    uso: { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0, custoUsd: 0 },
    resultado: null,
    criadaEm: "2026-11-24T09:00:00Z",
    atualizadaEm: "2026-11-24T09:00:00Z",
    ...extra,
  };
}

interface StreamControlado<A> {
  readonly emitir: (item: A) => void;
  readonly concluir: () => void;
  readonly falhar: (erro: unknown) => void;
  readonly cancelado: () => boolean;
}

function criarApiFake(handlers: Record<string, (entrada: unknown) => Promise<unknown>>) {
  const streamsIa: Array<StreamControlado<EstadoRevisaoIa>> = [];
  const streamsLista: Array<StreamControlado<EventoAcompanhamento>> = [];
  const chamadas: Array<{ readonly metodo: string; readonly entrada: unknown }> = [];
  const conexao = { fase: "conectada" as "conectada" | "reconectando", observadores: new Set<() => void>() };
  /** Muda a fase da conexão e avisa quem a observa. */
  const mudarConexao = (fase: "conectada" | "reconectando") => {
    conexao.fase = fase;
    for (const aviso of conexao.observadores) aviso();
  };

  const padrao: Record<string, (entrada: unknown) => Promise<unknown>> = {
    "providers.detectar": (entrada) => {
      const { provider } = entrada as { provider: Provider };
      const estado: EstadoProvider = {
        provider,
        instalado: provider === "claude",
        autenticado: provider === "claude",
        podeInstalar: false,
        podeEntrar: false,
      };
      return Promise.resolve(estado);
    },
    "preferencias.ler": () =>
      Promise.resolve<Preferencias>({
        avisoAceitoEm: "2026-11-24T08:00:00Z",
        boasVindasEm: "2026-11-24T08:00:00Z",
        iasDesligadas: [],
        avisosDoSistema: true,
      }),
    "revisaoPpc.listarIa": () => Promise.resolve([]),
  };

  const clienteProxy = new Proxy(
    {},
    {
      get(_alvo, prop: string) {
        return (entrada: unknown) => ({ metodo: prop, entrada });
      },
    },
  );

  const api: Api = {
    chamar: (chamada) => {
      const pedido = (chamada as unknown as (c: unknown) => { metodo: string; entrada: unknown })(clienteProxy);
      chamadas.push(pedido);
      const fn = handlers[pedido.metodo] ?? padrao[pedido.metodo];
      if (fn === undefined) return Promise.reject(new Error(`RPC não mockado: ${pedido.metodo}`));
      return fn(pedido.entrada) as Promise<never>;
    },
    acompanhar: (fluxo, aoItem) => {
      const pedido = (fluxo as unknown as (c: unknown) => { metodo: string; entrada: unknown })(clienteProxy);
      chamadas.push(pedido);
      let cancelado = false;
      let resolverFim!: (v: "concluido" | "cancelado") => void;
      let rejeitarFim!: (e: unknown) => void;
      const fim = new Promise<"concluido" | "cancelado">((res, rej) => {
        resolverFim = res;
        rejeitarFim = rej;
      });
      if (pedido.metodo === "revisaoPpc.acompanharIa") {
        streamsIa.push({
          emitir: (item) => {
            if (!cancelado) (aoItem as (i: EstadoRevisaoIa) => void)(item);
          },
          concluir: () => resolverFim("concluido"),
          falhar: (e) => rejeitarFim(e),
          cancelado: () => cancelado,
        });
      }
      if (pedido.metodo === "revisaoPpc.acompanharLista") {
        streamsLista.push({
          emitir: (item) => {
            if (!cancelado) (aoItem as (i: EventoAcompanhamento) => void)(item);
          },
          concluir: () => resolverFim("concluido"),
          falhar: (e) => rejeitarFim(e),
          cancelado: () => cancelado,
        });
      }
      const acompanhamento: Acompanhamento = {
        fim,
        cancelar: () => {
          cancelado = true;
          resolverFim("cancelado");
        },
      };
      return acompanhamento;
    },
    estado: {
      obter: () => ({ fase: conexao.fase }) as ReturnType<Api["estado"]["obter"]>,
      observar: (aviso) => {
        conexao.observadores.add(aviso);
        return () => conexao.observadores.delete(aviso);
      },
    },
    reconectarAgora: () => {},
  };

  return { api, chamadas, streamsIa, streamsLista, mudarConexao };
}

/** Espera o estado do controle satisfazer a condição. */
function esperar(controle: ControleRevisao, condicao: (e: EstadoRevisao) => boolean): Promise<EstadoRevisao> {
  return new Promise((resolve) => {
    const conferir = () => {
      const atual = controle.obter();
      if (condicao(atual)) {
        parar();
        resolve(atual);
      }
    };
    const parar = controle.observar(conferir);
    conferir();
  });
}

describe("ControleRevisao", () => {
  it("preserva lista, navegação e stream da IA ao sair e voltar para a mesma revisão", async () => {
    const lista = criarLista("lista-1", ["p0"]);
    const preparada = criarEstadoIa("preparada", [criarBloco("b1", "pendente"), criarBloco("b2", "pendente")]);
    const andando = criarEstadoIa("em_andamento", [criarBloco("b1", "em_andamento"), criarBloco("b2", "pendente")]);

    const { api, chamadas, streamsIa } = criarApiFake({
      "revisaoPpc.lista": () => Promise.resolve(lista),
      "revisaoPpc.prepararIa": () => Promise.resolve(preparada),
      "revisaoPpc.iniciarIa": () => Promise.resolve(andando),
    });

    const controle = new ControleRevisao(api);
    await controle.abrir("lista-1");
    await esperar(controle, (e) => e.ia.estado?.situacao === "preparada");

    controle.escolherTema(1);
    controle.alternarPendencia("p0");
    expect(await controle.iniciarIa()).toBe(true);
    expect(streamsIa).toHaveLength(1);

    // Simula navegar para Configurações/Explorar e voltar para `/revisao-ppc?id=lista-1`.
    await controle.abrir("lista-1");
    await controle.atualizarIas();

    expect(chamadas.filter((c) => c.metodo === "revisaoPpc.lista")).toHaveLength(1);
    expect(streamsIa).toHaveLength(1);
    expect(streamsIa[0]!.cancelado()).toBe(false);
    expect(controle.obter().tema).toBe(1);
    expect(controle.obter().aberta).toBe("p0");
    expect(controle.obter().ia.estado?.situacao).toBe("em_andamento");

    controle.encerrar();
  });

  it("na leitura pausada no limite, a IA conectada depois em Configurações passa a ser oferecida, sem preparar outra leitura", async () => {
    const lista = criarLista("lista-1", ["p0"]);
    const pausada = criarEstadoIa("pausada", [criarBloco("b1", "pronto"), criarBloco("b2", "pendente")], {
      limite: true,
      motivo: "O Claude avisou que o limite de uso do seu plano foi atingido por agora.",
    });
    let comGemini = false;
    const { api, chamadas } = criarApiFake({
      "revisaoPpc.lista": () => Promise.resolve(lista),
      "revisaoPpc.listarIa": () => Promise.resolve([pausada]),
      "providers.detectar": (entrada) => {
        const { provider } = entrada as { provider: Provider };
        const pronto = provider === "claude" || (comGemini && provider === "antigravity");
        return Promise.resolve<EstadoProvider>({
          provider,
          instalado: pronto,
          autenticado: pronto,
          podeInstalar: false,
          podeEntrar: false,
        });
      },
    });
    const controle = new ControleRevisao(api);
    await controle.abrir("lista-1");
    await esperar(controle, (e) => e.ia.estado?.situacao === "pausada" && e.ia.usaveis !== undefined);
    expect(controle.obter().ia.usaveis).toEqual(["claude"]);

    comGemini = true;
    await controle.atualizarIas();
    expect(controle.obter().ia.usaveis).toEqual(["claude", "antigravity"]);
    expect(controle.obter().ia.estado?.situacao).toBe("pausada");
    expect(chamadas.filter((c) => c.metodo === "revisaoPpc.prepararIa")).toHaveLength(0);
    controle.encerrar();
  });

  it("recarrega uma única vez na conclusão final (sem corrida de recarga dupla) e conta `novas` e `conclusao` com precisão", async () => {
    const listaInicial = criarLista("lista-1", ["p0"]);
    const listaAposB1 = criarLista("lista-1", ["p0", "p1", "p2"], {
      conferidosIa: 1,
      paraConferirIa: 1,
      leituraIa: "parcial",
    });
    const listaFinal = criarLista("lista-1", ["p0", "p1", "p2", "p3"], {
      conferidosIa: 2,
      paraConferirIa: 1,
      leituraIa: "completa",
    });

    let versaoLista = listaInicial;
    const { api, chamadas, streamsIa } = criarApiFake({
      "revisaoPpc.lista": () => Promise.resolve(versaoLista),
      "revisaoPpc.prepararIa": () =>
        Promise.resolve(criarEstadoIa("preparada", [criarBloco("b1", "pendente"), criarBloco("b2", "pendente")])),
      "revisaoPpc.iniciarIa": () =>
        Promise.resolve(
          criarEstadoIa("em_andamento", [criarBloco("b1", "em_andamento"), criarBloco("b2", "pendente")]),
        ),
    });

    const controle = new ControleRevisao(api);
    await controle.abrir("lista-1");
    await esperar(controle, (e) => e.ia.estado?.situacao === "preparada");
    controle.alternarPendencia("p0");
    await controle.iniciarIa();

    // Bloco 1 termina: 1 recarga incremental traz p1 e p2.
    versaoLista = listaAposB1;
    streamsIa[0]!.emitir(criarEstadoIa("em_andamento", [criarBloco("b1", "pronto"), criarBloco("b2", "em_andamento")]));
    const aposB1 = await esperar(controle, (e) => e.lista?.pendencias.length === 3);
    expect([...aposB1.novas]).toEqual(["p1", "p2"]);
    expect(aposB1.conclusao).toBeNull();
    // 1 abertura + 1 recarga do bloco 1.
    expect(chamadas.filter((c) => c.metodo === "revisaoPpc.lista")).toHaveLength(2);

    // Bloco 2 termina E conclui a revisão no mesmo evento: apenas UMA recarga (não duas).
    versaoLista = listaFinal;
    streamsIa[0]!.emitir(
      criarEstadoIa("concluida", [criarBloco("b1", "pronto"), criarBloco("b2", "pronto")], {
        resultado: listaFinal.resultado,
      }),
    );
    const concluida = await esperar(controle, (e) => e.conclusao !== null);

    expect(chamadas.filter((c) => c.metodo === "revisaoPpc.lista")).toHaveLength(3);
    expect([...concluida.novas]).toEqual(["p1", "p2", "p3"]);
    expect(concluida.conclusao).toBe("O Claude conferiu 3 critérios e encontrou mais 3 pontos.");
    expect(concluida.aberta).toBeNull();

    controle.encerrar();
  });

  it("serializa e coalesce recargas quando a conclusão chega enquanto a recarga anterior ainda está em curso", async () => {
    const listaInicial = criarLista("lista-1", ["p0"]);
    const listaAposB1 = criarLista("lista-1", ["p0", "p1"], { leituraIa: "parcial" });
    const listaFinal = criarLista("lista-1", ["p0", "p1", "p2"], {
      conferidosIa: 2,
      paraConferirIa: 0,
      leituraIa: "completa",
    });

    let abrirChamado = false;
    let emVoo = 0;
    let maxConcorrentes = 0;
    let liberarRecargaB1!: () => void;

    const { api, chamadas, streamsIa } = criarApiFake({
      "revisaoPpc.lista": async () => {
        if (!abrirChamado) {
          abrirChamado = true;
          return listaInicial;
        }
        emVoo += 1;
        maxConcorrentes = Math.max(maxConcorrentes, emVoo);
        try {
          if (chamadas.filter((c) => c.metodo === "revisaoPpc.lista").length === 2) {
            await new Promise<void>((res) => {
              liberarRecargaB1 = res;
            });
            return listaAposB1;
          }
          return listaFinal;
        } finally {
          emVoo -= 1;
        }
      },
      "revisaoPpc.prepararIa": () =>
        Promise.resolve(criarEstadoIa("preparada", [criarBloco("b1", "pendente"), criarBloco("b2", "pendente")])),
      "revisaoPpc.iniciarIa": () =>
        Promise.resolve(
          criarEstadoIa("em_andamento", [criarBloco("b1", "em_andamento"), criarBloco("b2", "pendente")]),
        ),
    });

    const controle = new ControleRevisao(api);
    await controle.abrir("lista-1");
    await esperar(controle, (e) => e.ia.estado?.situacao === "preparada");
    await controle.iniciarIa();

    // Emite bloco 1 (recarga fica em voo) e, antes dela voltar, emite a conclusão.
    streamsIa[0]!.emitir(criarEstadoIa("em_andamento", [criarBloco("b1", "pronto"), criarBloco("b2", "em_andamento")]));
    streamsIa[0]!.emitir(
      criarEstadoIa("concluida", [criarBloco("b1", "pronto"), criarBloco("b2", "pronto")], {
        resultado: listaFinal.resultado,
      }),
    );

    // Ainda há apenas 1 recarga em curso.
    expect(maxConcorrentes).toBe(1);
    liberarRecargaB1();

    const concluida = await esperar(controle, (e) => e.conclusao !== null);
    expect(maxConcorrentes).toBe(1);
    expect(chamadas.filter((c) => c.metodo === "revisaoPpc.lista")).toHaveLength(3);
    expect([...concluida.novas]).toEqual(["p1", "p2"]);
    expect(concluida.conclusao).toBe("O Claude conferiu 2 critérios e encontrou mais 2 pontos.");

    controle.encerrar();
  });

  it("unifica a recuperação de `pedeArquivoDeNovo` para ações da lista, da IA e de pendências", async () => {
    const lista = criarLista("lista-1", ["p1"]);
    const listaComSugestao = criarLista("lista-1", ["p1"]);
    const listaComSugestaoAtualizada: ListaPendencias = {
      ...listaComSugestao,
      pendencias: [
        criarPendencia("p1", {
          sugestao: { texto: "Texto sugerido.", naoConferidos: [], completar: [], observacao: "" },
        }),
      ],
    };
    const listaContestada: ListaPendencias = {
      ...lista,
      pendencias: [criarPendencia("p1", { situacao: "contestada_mantida" })],
    };
    const listaReconferida: ListaPendencias = {
      ...lista,
      pendencias: [criarPendencia("p1", { situacao: "resolvida", resolvidaPor: "revisarDeNovo" })],
    };
    const preparada = criarEstadoIa("preparada", [criarBloco("b1", "pendente")]);
    const andando = criarEstadoIa("em_andamento", [criarBloco("b1", "em_andamento")]);

    const tentativas: Record<string, number> = {};
    const falharNaPrimeira = <A>(nome: string, valor: A): Promise<A> => {
      tentativas[nome] = (tentativas[nome] ?? 0) + 1;
      if (tentativas[nome] === 1) return Promise.reject(ERRO_ARQUIVO);
      return Promise.resolve(valor);
    };

    const { api } = criarApiFake({
      "revisaoPpc.lista": () => Promise.resolve(lista),
      "revisaoPpc.prepararIa": () => falharNaPrimeira("prepararIa", preparada),
      "revisaoPpc.iniciarIa": () => falharNaPrimeira("iniciarIa", andando),
      "revisaoPpc.gerarCopia": () => falharNaPrimeira("gerarCopia", lista),
      "revisaoPpc.sugerir": () => falharNaPrimeira("sugerir", listaComSugestaoAtualizada),
      "revisaoPpc.contestar": () => falharNaPrimeira("contestar", listaContestada),
      "revisaoPpc.revisarDeNovo": () => falharNaPrimeira("revisarDeNovo", listaReconferida),
    });

    const controle = new ControleRevisao(api);
    await controle.abrir("lista-1");

    // 1. Ação da IA (`prepararIa`) falha com `pedeArquivoDeNovo`.
    await esperar(controle, (e) => e.origemArquivoDeNovo === "ia");
    expect(controle.obter().ia.erro?.texto).toContain("Escolha o arquivo de novo");
    // Escolher outro arquivo avisa e mantém a ação pendente.
    expect(await controle.escolherArquivoDeNovo(() => Promise.resolve("/outro/arquivo.docx"))).toBe(false);
    expect(controle.obter().ia.erro?.texto).toContain("Escolha o mesmo arquivo");
    // Escolher o mesmo arquivo repete `prepararIa` e prepara a estimativa.
    expect(await controle.escolherArquivoDeNovo(() => Promise.resolve(ARQUIVO))).toBe(true);
    expect(controle.obter().ia.estado?.situacao).toBe("preparada");
    expect(controle.obter().origemArquivoDeNovo).toBeUndefined();

    // 2. Ação da IA (`iniciarIa`) falha com `pedeArquivoDeNovo` e se recupera.
    expect(await controle.iniciarIa()).toBe(false);
    expect(controle.obter().origemArquivoDeNovo).toBe("ia");
    expect(await controle.escolherArquivoDeNovo(() => Promise.resolve(ARQUIVO))).toBe(true);
    expect(controle.obter().ia.estado?.situacao).toBe("em_andamento");
    expect(controle.obter().origemArquivoDeNovo).toBeUndefined();

    // 3. Ação da lista (`abrirNoWord` / `gerarCopia`) falha com `pedeArquivoDeNovo` e se recupera.
    const abertos: string[] = [];
    expect(await controle.abrirNoWord(async (caminho) => void abertos.push(caminho))).toBe(false);
    expect(controle.obter().origemArquivoDeNovo).toBe("lista");
    expect(await controle.escolherArquivoDeNovo(() => Promise.resolve(ARQUIVO))).toBe(true);
    expect(abertos).toEqual([lista.resultado.arquivoComentado]);
    expect(controle.obter().origemArquivoDeNovo).toBeUndefined();

    // 4. Ação de pendência: `sugerir`.
    expect(await controle.sugerir("p1")).toBe(false);
    expect(controle.obter().origemArquivoDeNovo).toEqual({ pendencia: "p1" });
    expect(controle.obter().erroPendencia?.chave).toBe("p1");
    expect(await controle.escolherArquivoDeNovo(() => Promise.resolve(ARQUIVO))).toBe(true);
    expect(controle.obter().lista?.pendencias[0]?.sugestao?.texto).toBe("Texto sugerido.");
    expect(controle.obter().erroPendencia).toBeUndefined();
    expect(controle.obter().origemArquivoDeNovo).toBeUndefined();

    // 5. Ação de pendência: `contestar`.
    expect(await controle.contestar("p1", "Já consta na seção 3.")).toBe(false);
    expect(controle.obter().origemArquivoDeNovo).toEqual({ pendencia: "p1" });
    expect(await controle.escolherArquivoDeNovo(() => Promise.resolve(ARQUIVO))).toBe(true);
    expect(controle.obter().lista?.pendencias[0]?.situacao).toBe("contestada_mantida");
    expect(controle.obter().origemArquivoDeNovo).toBeUndefined();

    // 6. Ação de pendência: `revisarDeNovo`.
    expect(await controle.revisarDeNovo("p1", "/Users/servidora/PPC-v2.docx")).toBe(false);
    expect(controle.obter().origemArquivoDeNovo).toEqual({ pendencia: "p1" });
    expect(await controle.escolherArquivoDeNovo(() => Promise.resolve(ARQUIVO))).toBe(true);
    expect(controle.obter().lista?.pendencias[0]?.situacao).toBe("resolvida");
    expect(controle.obter().origemArquivoDeNovo).toBeUndefined();

    controle.encerrar();
  });

  describe("conferência ao salvar", () => {
    const COPIA = "/Users/servidora/PPC - revisão prévia (Simplifica IF) 2026-11-27 10h00.docx";
    const acompanhada = (lista: ListaPendencias): ListaPendencias => ({ ...lista, arquivoAcompanhado: COPIA });

    it("'Acompanhar no Word' abre a cópia, abre o fluxo da lista; o salvamento conferido realça as resolvidas e marca as novas", async () => {
      vi.useFakeTimers();
      try {
        const lista = criarLista("lista-1", ["p0", "p1"]);
        const { api, chamadas, streamsLista } = criarApiFake({
          "revisaoPpc.lista": () => Promise.resolve(lista),
          "revisaoPpc.acompanhar": () => Promise.resolve(acompanhada(lista)),
          "revisaoPpc.gerarCopia": () => Promise.reject(new Error("não deve gerar outra cópia")),
        });
        const controle = new ControleRevisao(api);
        await controle.abrir("lista-1");
        expect(streamsLista).toHaveLength(0);

        const abertos: string[] = [];
        const abrir = async (caminho: string) => void abertos.push(caminho);
        expect(await controle.acompanharNoWord(undefined, abrir)).toBe(true);
        expect(abertos).toEqual([COPIA]);
        expect(chamadas.find((c) => c.metodo === "revisaoPpc.acompanhar")?.entrada).toEqual({ lista: "lista-1" });
        expect(streamsLista).toHaveLength(1);

        // O salvamento: p0 resolvida, p2 nova; a lista chega pelo mesmo fluxo.
        const depois = acompanhada({
          ...lista,
          pendencias: [
            criarPendencia("p0", { situacao: "resolvida", resolvidaPor: "revisarDeNovo" }),
            criarPendencia("p1"),
            criarPendencia("p2"),
          ],
        });
        streamsLista[0]!.emitir({ tipo: "lista", lista: depois });
        streamsLista[0]!.emitir({
          tipo: "conferido",
          em: "2026-11-27T14:32:00Z",
          resolvidas: ["p0"],
          novas: ["p2"],
          continuam: 1,
        });
        const estado = controle.obter();
        expect(estado.lista).toEqual(depois);
        expect([...estado.novas]).toEqual(["p2"]);
        expect([...estado.acompanhamento.realce]).toEqual(["p0"]);
        expect(estado.acompanhamento.ultima).toEqual({
          tipo: "conferido",
          em: "2026-11-27T14:32:00Z",
          resolvidas: 1,
          novas: 1,
        });
        // O realce é breve.
        vi.advanceTimersByTime(4000);
        expect(controle.obter().acompanhamento.realce.size).toBe(0);

        // Acompanhando, "Abrir no Word" abre o acompanhado, sem gravar uma cópia da cópia.
        expect(await controle.abrirNoWord(abrir)).toBe(true);
        expect(abertos).toEqual([COPIA, COPIA]);
        expect(chamadas.some((c) => c.metodo === "revisaoPpc.gerarCopia")).toBe(false);

        // O salvamento que não pôde ser conferido fica na linha, e a lista não muda.
        streamsLista[0]!.emitir({
          tipo: "falhou",
          em: "2026-11-27T14:40:00Z",
          motivo: "Este arquivo não parece o mesmo PPC.",
          escolherDeNovo: false,
        });
        expect(controle.obter().acompanhamento.ultima).toMatchObject({ tipo: "falhou" });
        expect(controle.obter().lista).toEqual(depois);

        // A janela ganhou foco: confere o acompanhado.
        controle.conferirAoFocar();
        expect(chamadas.at(-1)).toEqual({ metodo: "revisaoPpc.conferirAcompanhado", entrada: { lista: "lista-1" } });

        controle.sair();
        expect(streamsLista[0]!.cancelado()).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("a lista que já acompanha abre o fluxo; o acompanhado de outra execução é pedido de novo, à parte", async () => {
      const lista = acompanhada(criarLista("lista-1", ["p0"]));
      const { api, chamadas, streamsLista } = criarApiFake({
        "revisaoPpc.lista": () => Promise.resolve(lista),
        "revisaoPpc.acompanhar": (entrada) =>
          (entrada as { arquivo?: string }).arquivo === undefined
            ? Promise.reject(ERRO_ARQUIVO)
            : Promise.resolve(lista),
      });
      const controle = new ControleRevisao(api);
      await controle.abrir("lista-1");
      expect(streamsLista).toHaveLength(1);
      streamsLista[0]!.emitir({
        tipo: "falhou",
        em: "2026-11-27T14:00:00Z",
        motivo: "Escolha de novo.",
        escolherDeNovo: true,
      });
      expect(controle.obter().acompanhamento.pedeArquivo).toBe(true);
      expect(controle.obter().acompanhamento.ultima).toBeUndefined();

      const abertos: string[] = [];
      expect(
        await controle.escolherAcompanhadoDeNovo(
          async () => COPIA,
          async (c) => void abertos.push(c),
        ),
      ).toBe(true);
      expect(chamadas.filter((c) => c.metodo === "revisaoPpc.acompanhar").at(-1)?.entrada).toEqual({
        lista: "lista-1",
        arquivo: COPIA,
      });
      expect(controle.obter().acompanhamento.pedeArquivo).toBe(false);
      expect(abertos).toEqual([COPIA]);
      // O mesmo fluxo segue aberto: a lista não mudou.
      expect(streamsLista).toHaveLength(1);
    });

    it("'Reconferir com a IA' as da IA marcadas Feito, uma por vez, no arquivo acompanhado", async () => {
      const lista = acompanhada(criarLista("lista-1", ["a", "b"]));
      const pedidos: Array<{ chave: string; arquivo: string }> = [];
      let emCurso = 0;
      const { api } = criarApiFake({
        "revisaoPpc.lista": () => Promise.resolve(lista),
        "revisaoPpc.revisarDeNovo": async (entrada) => {
          const { chave, arquivo } = entrada as { chave: string; arquivo: string };
          emCurso += 1;
          expect(emCurso).toBe(1);
          pedidos.push({ chave, arquivo });
          await Promise.resolve();
          emCurso -= 1;
          return lista;
        },
      });
      const controle = new ControleRevisao(api);
      await controle.abrir("lista-1");
      expect(await controle.reconferirComIa(["a", "b"])).toBe(true);
      expect(pedidos).toEqual([
        { chave: "a", arquivo: COPIA },
        { chave: "b", arquivo: COPIA },
      ]);
      expect(controle.obter().acompanhamento.reconferindo).toBe(false);
    });

    it("'Acompanhar no Word' de outra execução: o servidor pede o original, e escolhido o original, repete", async () => {
      const lista = criarLista("lista-1", ["p0"]);
      let liberado = false;
      const { api, chamadas } = criarApiFake({
        "revisaoPpc.lista": () => Promise.resolve(lista),
        "revisaoPpc.acompanhar": () =>
          liberado ? Promise.resolve(acompanhada(lista)) : Promise.reject({ ...ERRO_ARQUIVO, arquivo: ARQUIVO }),
      });
      const controle = new ControleRevisao(api);
      await controle.abrir("lista-1");
      const abrir = async (_: string) => {};
      expect(await controle.acompanharNoWord(undefined, abrir)).toBe(false);
      expect(controle.obter().origemArquivoDeNovo).toBe("lista");

      // A cópia não é o que se pede: a frase nomeia o original.
      expect(await controle.escolherArquivoDeNovo(async () => COPIA)).toBe(false);
      expect(controle.obter().erro?.texto).toContain("“PPC.docx”");
      liberado = true;
      expect(await controle.escolherArquivoDeNovo(async () => ARQUIVO)).toBe(true);
      expect(chamadas.filter((c) => c.metodo === "revisaoPpc.acompanhar")).toHaveLength(2);
      expect(controle.obter().lista?.arquivoAcompanhado).toBe(COPIA);
    });

    it("'Reconferir com a IA' que falha mostra o erro no acompanhamento; o acompanhado sem liberação é pedido lá", async () => {
      const lista = acompanhada(criarLista("lista-1", ["a", "b"]));
      let falha: unknown = { _tag: "FalhaRevisaoPpc", message: "A cota acabou." };
      const { api } = criarApiFake({
        "revisaoPpc.lista": () => Promise.resolve(lista),
        "revisaoPpc.revisarDeNovo": () => Promise.reject(falha),
      });
      const controle = new ControleRevisao(api);
      await controle.abrir("lista-1");
      expect(await controle.reconferirComIa(["a", "b"])).toBe(false);
      expect(controle.obter().acompanhamento.erro?.texto).toContain("A cota acabou.");
      expect(controle.obter().acompanhamento.pedeArquivo).toBe(false);

      falha = { ...ERRO_ARQUIVO, arquivo: COPIA };
      expect(await controle.reconferirComIa(["a"])).toBe(false);
      expect(controle.obter().acompanhamento.pedeArquivo).toBe(true);
      expect(controle.obter().acompanhamento.erro).toBeUndefined();
      // Pela linha da pendência, "Escolher o arquivo de novo" aceita o acompanhado, que é o que se pediu.
      const { api: api2, chamadas } = criarApiFake({
        "revisaoPpc.lista": () => Promise.resolve(lista),
        "revisaoPpc.revisarDeNovo": () =>
          chamadas.filter((c) => c.metodo === "revisaoPpc.revisarDeNovo").length === 1
            ? Promise.reject({ ...ERRO_ARQUIVO, arquivo: COPIA })
            : Promise.resolve(lista),
      });
      const outro = new ControleRevisao(api2);
      await outro.abrir("lista-1");
      expect(await outro.revisarDeNovo("a", COPIA)).toBe(false);
      expect(await outro.escolherArquivoDeNovo(async () => COPIA)).toBe(true);
    });

    it("a lista que chega pelo fluxo marca 'novo' só as da IA (as do código vêm no `conferido`)", async () => {
      const lista = acompanhada(criarLista("lista-1", ["p0"]));
      const { api, streamsLista } = criarApiFake({ "revisaoPpc.lista": () => Promise.resolve(lista) });
      const controle = new ControleRevisao(api);
      await controle.abrir("lista-1");
      const codigo = criarPendencia("c1", {
        pendencia: { ...criarPendencia("c1").pendencia, origem: "codigo" },
      });
      streamsLista[0]!.emitir({
        tipo: "lista",
        lista: { ...lista, pendencias: [...lista.pendencias, criarPendencia("ia-nova"), codigo] },
      });
      expect([...controle.obter().novas]).toEqual(["ia-nova"]);
    });

    it("o fluxo que cai com a conexão volta: na hora, depois quando ela voltar; a volta à janela o reabre", async () => {
      const lista = acompanhada(criarLista("lista-1", ["p0"]));
      const { api, chamadas, streamsLista, mudarConexao } = criarApiFake({
        "revisaoPpc.lista": () => Promise.resolve(lista),
        "revisaoPpc.conferirAcompanhado": () => Promise.resolve(undefined),
      });
      const controle = new ControleRevisao(api);
      await controle.abrir("lista-1");
      const queda = { _tag: "RpcClientError", message: "A conexão caiu." };
      streamsLista[0]!.falhar(queda);
      await esperar(controle, () => streamsLista.length === 2);
      expect(controle.obter().acompanhamento.erro).toBeUndefined();

      // A segunda queda seguida espera a conexão voltar.
      mudarConexao("reconectando");
      streamsLista[1]!.falhar(queda);
      await Promise.resolve();
      await Promise.resolve();
      expect(streamsLista).toHaveLength(2);
      mudarConexao("conectada");
      expect(streamsLista).toHaveLength(3);

      // Um erro que não é queda fica na linha; a volta à janela reabre o fluxo (que confere ao abrir).
      streamsLista[2]!.falhar({ _tag: "FalhaRevisaoPpc", message: "A lista não pôde ser lida." });
      await esperar(controle, (e) => e.acompanhamento.erro !== undefined);
      controle.conferirAoFocar();
      expect(streamsLista).toHaveLength(4);
      expect(chamadas.some((c) => c.metodo === "revisaoPpc.conferirAcompanhado")).toBe(false);
      controle.conferirAoFocar();
      expect(chamadas.at(-1)?.metodo).toBe("revisaoPpc.conferirAcompanhado");
      controle.sair();
      expect(streamsLista[3]!.cancelado()).toBe(true);
    });
    it("a lista apagada fora daqui (o fluxo termina): a revisão sai e avisa; a troca de curso e o apagar daqui, não", async () => {
      const lista = acompanhada(criarLista("lista-1", ["p0"]));
      const nova = acompanhada(criarLista("lista-2", ["p0"]));
      let respostaTroca!: (lista: ListaPendencias) => void;
      const { api, streamsLista } = criarApiFake({
        "revisaoPpc.lista": () => Promise.resolve(lista),
        "revisaoPpc.trocarCurso": () => new Promise((resolver) => (respostaTroca = resolver)),
        "revisaoPpc.apagarLista": () => Promise.resolve(undefined),
      });
      const trocas: Array<readonly [string, string]> = [];
      const apagadas: string[] = [];
      const controle = new ControleRevisao(api, {
        aoTrocarLista: (antiga, outra) => trocas.push([antiga, outra]),
        aoApagarFora: (l) => apagadas.push(l.id),
      });
      await controle.abrir("lista-1");

      // "Qual é o curso?": o servidor apaga a lista antiga antes de responder, e o fluxo dela termina.
      const trocando = controle.trocarCurso("cnct-x");
      streamsLista[0]!.concluir();
      await Promise.resolve();
      respostaTroca(nova);
      expect(await trocando).toBe(true);
      expect(apagadas).toEqual([]);
      expect(trocas).toEqual([["lista-1", "lista-2"]]);
      expect(controle.obter().lista?.id).toBe("lista-2");

      // Apagada daqui: o fluxo sai antes.
      await controle.apagarLista();
      expect(streamsLista[1]!.cancelado()).toBe(true);
      expect(apagadas).toEqual([]);

      // Apagada em outra janela: o fluxo termina sozinho.
      await controle.abrir("lista-1");
      streamsLista.at(-1)!.concluir();
      await esperar(controle, (e) => e.fase === "entrada");
      expect(apagadas).toEqual(["lista-1"]);
      expect(controle.obter().erroEntrada?.texto).toBe("Esta revisão foi apagada.");
    });
  });
});
