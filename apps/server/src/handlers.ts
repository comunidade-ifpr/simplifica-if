/**
 * Os handlers do `GrupoApp`: casca fina sobre o `Motor` (providers), as `Conversas` (conversa), o
 * `CatalogoSkills` (skills), a `ListaViva` e a `RevisaoIa` (revisão prévia de PPC) e o `Leitura` do `simplifica-mcp`
 * (leitura, os mesmos handlers de `@simplifica-if/mcp/rpc`).
 *
 * A conversa não pertence à conexão: os métodos de conversa recebem só o id dela (`sessao`), e uma
 * interface que recarrega volta à mesma conversa por `conversa.carregar` e `conversa.acompanhar`.
 *
 * Cada handler só chama um método de serviço; a tradução de erro é uma só para todos (`traduzir`): o erro
 * inteiro vai para o log do servidor (stderr), e o `FalhaProvider` e a `FalhaPasta` chegam à interface sem o
 * `cause`, que pode trazer a pilha e caminhos do computador. Do `cause` do `FalhaProvider` sai só o texto
 * técnico de "Detalhes técnicos" (`tecnico`), curto e saneado. As regras de produto, como o aviso de uso
 * antes de mandar algo à IA (M1.8), ficam nos serviços.
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Atualizador from "./Atualizador.ts";
import {
  ehFalhaPasta,
  FalhaPasta,
  GrupoAtualizacao,
  GrupoConversa,
  GrupoPasta,
  GrupoPreferencias,
  GrupoProviders,
  GrupoRelato,
  GrupoRevisaoPpc,
  GrupoSkills,
} from "@simplifica-if/contratos-app";
import { layerHandlersRpc } from "@simplifica-if/mcp/rpc";
import * as Motor from "@simplifica-if/motor";
import * as CatalogoSkills from "./CatalogoSkills.ts";
import * as Conversas from "./Conversas.ts";
import * as PastasTrabalho from "./PastasTrabalho.ts";
import * as Preferencias from "./persistencia/Preferencias.ts";
import * as Relatos from "./Relatos.ts";
import * as ListaViva from "./revisao-ppc/ListaViva.ts";
import * as RevisaoIa from "./revisao-ppc/RevisaoIa.ts";

const ehFalhaProvider = Schema.is(Motor.FalhaProvider);

/** O texto técnico do `cause`, curto e saneado, ou nada se ele não tem texto. */
const tecnicoDe = (cause: unknown): { readonly tecnico?: string } => {
  const texto = Motor.textoDaCausa(cause);
  return texto === "" ? {} : { tecnico: Motor.textoTecnico(texto) };
};

/**
 * O erro como vai à interface: o `FalhaProvider` e a `FalhaPasta` sem o `cause`; o `FalhaProvider`
 * com o texto técnico dele.
 */
const paraInterface = <E>(erro: E): E =>
  ehFalhaProvider(erro)
    ? (new Motor.FalhaProvider({
        provider: erro.provider,
        operacao: erro.operacao,
        tipo: erro.tipo,
        ...tecnicoDe(erro.cause),
      }) as E)
    : ehFalhaPasta(erro)
      ? (new FalhaPasta({ motivo: erro.motivo }) as E)
      : erro;

const registrar = (metodo: string, erro: unknown) => Effect.logWarning(`RPC ${metodo} falhou`, erro);

/**
 * A tradução de erro do transporte, a mesma para todos os métodos de todos os grupos: registra no log
 * do servidor o erro inteiro, com o `cause`, e o manda à interface por `paraInterface`.
 */
const traduzir = <A, E, R>(metodo: string, efeito: Effect.Effect<A, E, R>) =>
  efeito.pipe(
    Effect.tapError((erro: E) => registrar(metodo, erro)),
    Effect.mapError((erro: E) => paraInterface(erro)),
  );

/** `traduzir` para os métodos que respondem em stream. */
const traduzirStream = <A, E, R>(metodo: string, stream: Stream.Stream<A, E, R>) =>
  stream.pipe(
    Stream.tapError((erro: E) => registrar(metodo, erro)),
    Stream.mapError((erro: E) => paraInterface(erro)),
  );

const layerProviders = GrupoProviders.toLayer(
  Effect.gen(function* () {
    const motor = yield* Motor.Motor;
    return GrupoProviders.of({
      "providers.detectar": ({ provider }) => traduzir("providers.detectar", motor.detectar(provider)),
      "providers.instalar": ({ provider }) => traduzirStream("providers.instalar", motor.instalar(provider)),
      "providers.entrar": ({ provider }) => traduzirStream("providers.entrar", motor.entrar(provider)),
    });
  }),
);

const layerConversa = GrupoConversa.toLayer(
  Effect.gen(function* () {
    const conversas = yield* Conversas.Conversas;
    return GrupoConversa.of({
      "conversa.iniciar": (entrada) =>
        traduzir("conversa.iniciar", conversas.iniciar(entrada).pipe(Effect.map((sessao) => ({ sessao })))),
      "conversa.enviar": ({ sessao, texto }) => traduzirStream("conversa.enviar", conversas.enviar(sessao, texto)),
      "conversa.responderAprovacao": ({ sessao, aprovacao, decisao }) =>
        traduzir("conversa.responderAprovacao", conversas.responderAprovacao(sessao, aprovacao, decisao)),
      "conversa.interromper": ({ sessao }) => traduzir("conversa.interromper", conversas.interromper(sessao)),
      "conversa.encerrar": ({ sessao }) => traduzir("conversa.encerrar", conversas.encerrar(sessao)),
      "conversa.listar": () => traduzir("conversa.listar", conversas.listar),
      "conversa.carregar": ({ sessao }) => traduzir("conversa.carregar", conversas.carregar(sessao)),
      "conversa.acompanhar": ({ sessao, depois }) =>
        traduzirStream("conversa.acompanhar", conversas.acompanhar(sessao, depois)),
      "conversa.avaliar": ({ sessao, turno, nota }) =>
        traduzir("conversa.avaliar", conversas.avaliar(sessao, turno, nota)),
    });
  }),
);

const layerSkills = GrupoSkills.toLayer(
  Effect.gen(function* () {
    const catalogo = yield* CatalogoSkills.CatalogoSkills;
    return GrupoSkills.of({ "skills.listar": () => traduzir("skills.listar", Effect.succeed(catalogo.resumos)) });
  }),
);

const layerPasta = GrupoPasta.toLayer(
  Effect.gen(function* () {
    const pastas = yield* PastasTrabalho.PastasTrabalho;
    const conversas = yield* Conversas.Conversas;
    return GrupoPasta.of({
      "pasta.criar": ({ titulo }) =>
        traduzir("pasta.criar", pastas.criar(titulo).pipe(Effect.map((pasta) => ({ pasta })))),
      "pasta.anexar": ({ pasta, arquivo }) => traduzir("pasta.anexar", pastas.anexar(pasta, arquivo)),
      "pasta.ver": ({ sessao }) => traduzir("pasta.ver", conversas.pasta(sessao)),
      "pasta.desfazer": ({ sessao, incluirForaDaConversa }) =>
        traduzir("pasta.desfazer", conversas.desfazer(sessao, incluirForaDaConversa === true)),
    });
  }),
);

/** "Isto está errado" (M1.12): o rascunho do relato e o registro local; nada vai à IA nem à rede. */
const layerRelato = GrupoRelato.toLayer(
  Effect.gen(function* () {
    const relatos = yield* Relatos.Relatos;
    return GrupoRelato.of({
      "relato.preparar": ({ sessao, turno }) => traduzir("relato.preparar", relatos.preparar(sessao, turno)),
      "relato.registrar": (entrada) => traduzir("relato.registrar", relatos.registrar(entrada)),
    });
  }),
);

/** O primeiro uso (M1.8): perfil, aviso de uso, boas-vindas e as IAs em uso, só neste computador. */
const layerPreferencias = GrupoPreferencias.toLayer(
  Effect.gen(function* () {
    const preferencias = yield* Preferencias.Preferencias;
    return GrupoPreferencias.of({
      "preferencias.ler": () => traduzir("preferencias.ler", preferencias.ler),
      "preferencias.gravarPerfil": ({ perfil }) =>
        traduzir("preferencias.gravarPerfil", preferencias.gravarPerfil(perfil)),
      "preferencias.apagarPerfil": () => traduzir("preferencias.apagarPerfil", preferencias.apagarPerfil),
      "preferencias.aceitarAviso": () => traduzir("preferencias.aceitarAviso", preferencias.aceitarAviso),
      "preferencias.concluirBoasVindas": () =>
        traduzir("preferencias.concluirBoasVindas", preferencias.concluirBoasVindas),
      "preferencias.usarIa": ({ provider, usar }) =>
        traduzir("preferencias.usarIa", preferencias.usarIa(provider, usar)),
    });
  }),
);

/** A revisão de PPC. O aviso de uso das ações que mandam o PPC à IA fica nos serviços (M1.8). */
const layerRevisaoPpc = GrupoRevisaoPpc.toLayer(
  Effect.gen(function* () {
    const ia = yield* RevisaoIa.RevisaoIa;
    const viva = yield* ListaViva.ListaViva;
    return GrupoRevisaoPpc.of({
      "revisaoPpc.revisar": (entrada) => traduzir("revisaoPpc.revisar", viva.revisar(entrada)),
      "revisaoPpc.prepararIa": (entrada) => traduzir("revisaoPpc.prepararIa", ia.preparar(entrada)),
      "revisaoPpc.iniciarIa": ({ revisao }) => traduzir("revisaoPpc.iniciarIa", ia.iniciar(revisao)),
      "revisaoPpc.pausarIa": ({ revisao }) => traduzir("revisaoPpc.pausarIa", ia.pausar(revisao)),
      "revisaoPpc.acompanharIa": ({ revisao }) => traduzirStream("revisaoPpc.acompanharIa", ia.acompanhar(revisao)),
      "revisaoPpc.listarIa": () => traduzir("revisaoPpc.listarIa", ia.listar),
      "revisaoPpc.apagarIa": ({ revisao }) => traduzir("revisaoPpc.apagarIa", ia.apagar(revisao)),
      "revisaoPpc.lista": ({ lista }) => traduzir("revisaoPpc.lista", viva.lista(lista)),
      "revisaoPpc.ultimaLista": () => traduzir("revisaoPpc.ultimaLista", viva.ultima),
      "revisaoPpc.apagarLista": ({ lista }) => traduzir("revisaoPpc.apagarLista", viva.apagar(lista)),
      "revisaoPpc.exportarDiscordancias": () =>
        traduzir("revisaoPpc.exportarDiscordancias", viva.exportarDiscordancias),
      "revisaoPpc.marcar": ({ lista, chave, situacao }) =>
        traduzir("revisaoPpc.marcar", viva.marcar(lista, chave, situacao)),
      "revisaoPpc.verParada": ({ lista, ordem }) => traduzir("revisaoPpc.verParada", viva.verParada(lista, ordem)),
      "revisaoPpc.estimarAcao": ({ lista, chave, acao, provider }) =>
        traduzir("revisaoPpc.estimarAcao", viva.estimar(lista, chave, acao, provider)),
      "revisaoPpc.contestar": ({ lista, chave, motivo, provider }) =>
        traduzir("revisaoPpc.contestar", viva.contestar(lista, chave, motivo, provider)),
      "revisaoPpc.sugerir": ({ lista, chave, provider }) =>
        traduzir("revisaoPpc.sugerir", viva.sugerir(lista, chave, provider)),
      "revisaoPpc.revisarDeNovo": ({ lista, chave, arquivo, provider }) =>
        traduzir("revisaoPpc.revisarDeNovo", viva.revisarDeNovo(lista, chave, arquivo, provider)),
      "revisaoPpc.gerarCopia": ({ lista }) => traduzir("revisaoPpc.gerarCopia", viva.gerarCopia(lista)),
    });
  }),
);

const layerAtualizacao = GrupoAtualizacao.toLayer(
  Effect.gen(function* () {
    const atualizador = yield* Atualizador.Atualizador;
    return GrupoAtualizacao.of({
      "atualizacao.estado": () => traduzir("atualizacao.estado", atualizador.estado),
      "atualizacao.procurar": () => traduzir("atualizacao.procurar", atualizador.procurar),
      "atualizacao.trocarCanal": ({ canal }) => traduzir("atualizacao.trocarCanal", atualizador.trocarCanal(canal)),
      "atualizacao.aplicar": () => traduzir("atualizacao.aplicar", atualizador.aplicar),
      "atualizacao.voltar": () => traduzir("atualizacao.voltar", atualizador.voltar),
      "atualizacao.novidadesVistas": () => traduzir("atualizacao.novidadesVistas", atualizador.novidadesVistas),
    });
  }),
);

/**
 * Os handlers dos nove grupos; pede o `Motor`, as `Conversas`, os `Relatos`, o `CatalogoSkills`, a
 * `RevisorPpc`, a `RevisaoIa`, o `Atualizador`, as `Preferencias` e o `Leitura`.
 */
export const layer = Layer.mergeAll(
  layerProviders,
  layerConversa,
  layerRelato,
  layerSkills,
  layerPasta,
  layerRevisaoPpc,
  layerPreferencias,
  layerAtualizacao,
  layerHandlersRpc,
);
