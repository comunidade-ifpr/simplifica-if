/**
 * Os handlers do `GrupoApp`: casca fina sobre o `Motor` (providers), as `Conversas` (conversa), o
 * `CatalogoSkills` (skills), a `ListaViva` e a `RevisaoIa` (revisão prévia de PPC) e o `Leitura` do `simplifica-mcp`
 * (leitura, os mesmos handlers de `@simplifica-if/mcp/rpc`).
 *
 * A conversa não pertence à conexão: os métodos de conversa recebem só o id dela (`sessao`), e uma
 * interface que recarrega volta à mesma conversa por `conversa.carregar` e `conversa.acompanhar`.
 *
 * O `FalhaProvider` e a `FalhaPasta` chegam à interface sem o `cause`, que pode trazer a pilha e caminhos do computador;
 * o erro inteiro vai para o log do servidor (stderr). Do `cause` do `FalhaProvider` sai só o texto técnico de
 * "Detalhes técnicos" (`tecnico`), curto e saneado.
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

const registrarEMapear = <A, E, R>(efeito: Effect.Effect<A, E, R>) =>
  efeito.pipe(
    Effect.tapError((erro) => Effect.logWarning("RPC falhou", erro)),
    Effect.mapError(paraInterface),
  );

const registrarEMapearStream = <A, E, R>(stream: Stream.Stream<A, E, R>) =>
  stream.pipe(
    Stream.tapError((erro) => Effect.logWarning("RPC falhou", erro)),
    Stream.mapError(paraInterface),
  );

const layerProviders = GrupoProviders.toLayer(
  Effect.gen(function* () {
    const motor = yield* Motor.Motor;
    return GrupoProviders.of({
      "providers.detectar": ({ provider }) => motor.detectar(provider),
      "providers.instalar": ({ provider }) => registrarEMapearStream(motor.instalar(provider)),
      "providers.entrar": ({ provider }) => registrarEMapearStream(motor.entrar(provider)),
    });
  }),
);

const layerConversa = GrupoConversa.toLayer(
  Effect.gen(function* () {
    const conversas = yield* Conversas.Conversas;
    // Nada vai à IA antes do aviso de uso aceito (M1.8): iniciar, enviar e retomar recusam.
    const { exigirAviso } = yield* Preferencias.Preferencias;
    return GrupoConversa.of({
      "conversa.iniciar": (entrada) =>
        exigirAviso.pipe(
          Effect.andThen(registrarEMapear(conversas.iniciar(entrada))),
          Effect.map((sessao) => ({ sessao })),
        ),
      "conversa.enviar": ({ sessao, texto }) =>
        Stream.unwrap(Effect.as(exigirAviso, registrarEMapearStream(conversas.enviar(sessao, texto)))),
      "conversa.responderAprovacao": ({ sessao, aprovacao, decisao }) =>
        conversas.responderAprovacao(sessao, aprovacao, decisao),
      "conversa.interromper": ({ sessao }) => registrarEMapear(conversas.interromper(sessao)),
      "conversa.encerrar": ({ sessao }) => conversas.encerrar(sessao),
      "conversa.listar": () => conversas.listar,
      "conversa.carregar": ({ sessao }) => conversas.carregar(sessao),
      "conversa.acompanhar": ({ sessao, depois }) => conversas.acompanhar(sessao, depois),
      "conversa.retomar": ({ sessao }) => exigirAviso.pipe(Effect.andThen(registrarEMapear(conversas.retomar(sessao)))),
      "conversa.avaliar": ({ sessao, turno, nota }) => conversas.avaliar(sessao, turno, nota),
    });
  }),
);

const layerSkills = GrupoSkills.toLayer(
  Effect.gen(function* () {
    const catalogo = yield* CatalogoSkills.CatalogoSkills;
    return GrupoSkills.of({ "skills.listar": () => Effect.succeed(catalogo.resumos) });
  }),
);

const layerPasta = GrupoPasta.toLayer(
  Effect.gen(function* () {
    const pastas = yield* PastasTrabalho.PastasTrabalho;
    const conversas = yield* Conversas.Conversas;
    return GrupoPasta.of({
      "pasta.criar": ({ titulo }) => registrarEMapear(pastas.criar(titulo)).pipe(Effect.map((pasta) => ({ pasta }))),
      "pasta.anexar": ({ pasta, arquivo }) => registrarEMapear(pastas.anexar(pasta, arquivo)),
      "pasta.ver": ({ sessao }) => registrarEMapear(conversas.pasta(sessao)),
      "pasta.desfazer": ({ sessao, incluirForaDaConversa }) =>
        registrarEMapear(conversas.desfazer(sessao, incluirForaDaConversa === true)),
    });
  }),
);

/** "Isto está errado" (M1.12): o rascunho do relato e o registro local; nada vai à IA nem à rede. */
const layerRelato = GrupoRelato.toLayer(
  Effect.gen(function* () {
    const relatos = yield* Relatos.Relatos;
    return GrupoRelato.of({
      "relato.preparar": ({ sessao, turno }) => registrarEMapear(relatos.preparar(sessao, turno)),
      "relato.registrar": (entrada) => registrarEMapear(relatos.registrar(entrada)),
    });
  }),
);

/** O primeiro uso (M1.8): perfil, aviso de uso, boas-vindas e as IAs em uso, só neste computador. */
const layerPreferencias = GrupoPreferencias.toLayer(
  Effect.gen(function* () {
    const preferencias = yield* Preferencias.Preferencias;
    return GrupoPreferencias.of({
      "preferencias.ler": () => preferencias.ler,
      "preferencias.gravarPerfil": ({ perfil }) => preferencias.gravarPerfil(perfil),
      "preferencias.apagarPerfil": () => preferencias.apagarPerfil,
      "preferencias.aceitarAviso": () => preferencias.aceitarAviso,
      "preferencias.concluirBoasVindas": () => preferencias.concluirBoasVindas,
      "preferencias.usarIa": ({ provider, usar }) => preferencias.usarIa(provider, usar),
    });
  }),
);

const layerRevisaoPpc = GrupoRevisaoPpc.toLayer(
  Effect.gen(function* () {
    const ia = yield* RevisaoIa.RevisaoIa;
    // O que manda o PPC à IA espera o aviso de uso aceito (M1.8); a pré-conferência, não.
    const { exigirAviso } = yield* Preferencias.Preferencias;
    const comAviso = <A, E, R>(efeito: Effect.Effect<A, E, R>) => exigirAviso.pipe(Effect.andThen(efeito));
    const viva = yield* ListaViva.ListaViva;
    const registrar = <A, E, R>(efeito: Effect.Effect<A, E, R>) =>
      efeito.pipe(Effect.tapError((erro) => Effect.logWarning("revisão de PPC falhou", erro)));
    return GrupoRevisaoPpc.of({
      "revisaoPpc.revisar": (entrada) => viva.revisar(entrada).pipe(registrar),
      "revisaoPpc.prepararIa": (entrada) => comAviso(ia.preparar(entrada).pipe(registrar)),
      "revisaoPpc.iniciarIa": ({ revisao }) => comAviso(ia.iniciar(revisao).pipe(registrar)),
      "revisaoPpc.pausarIa": ({ revisao }) => ia.pausar(revisao).pipe(registrar),
      "revisaoPpc.acompanharIa": ({ revisao }) => ia.acompanhar(revisao),
      "revisaoPpc.listarIa": () => ia.listar,
      "revisaoPpc.apagarIa": ({ revisao }) => ia.apagar(revisao),
      "revisaoPpc.lista": ({ lista }) => viva.lista(lista),
      "revisaoPpc.ultimaLista": () => viva.ultima,
      "revisaoPpc.apagarLista": ({ lista }) => viva.apagar(lista),
      "revisaoPpc.exportarDiscordancias": () => viva.exportarDiscordancias,
      "revisaoPpc.marcar": ({ lista, chave, situacao }) => viva.marcar(lista, chave, situacao).pipe(registrar),
      "revisaoPpc.verParada": ({ lista, ordem }) => viva.verParada(lista, ordem),
      "revisaoPpc.estimarAcao": ({ lista, chave, acao, provider }) =>
        viva.estimar(lista, chave, acao, provider).pipe(registrar),
      "revisaoPpc.contestar": ({ lista, chave, motivo, provider }) =>
        comAviso(viva.contestar(lista, chave, motivo, provider).pipe(registrar)),
      "revisaoPpc.sugerir": ({ lista, chave, provider }) =>
        comAviso(viva.sugerir(lista, chave, provider).pipe(registrar)),
      "revisaoPpc.revisarDeNovo": ({ lista, chave, arquivo, provider }) =>
        comAviso(viva.revisarDeNovo(lista, chave, arquivo, provider).pipe(registrar)),
      "revisaoPpc.gerarCopia": ({ lista }) => viva.gerarCopia(lista).pipe(registrar),
    });
  }),
);

const layerAtualizacao = GrupoAtualizacao.toLayer(
  Effect.gen(function* () {
    const atualizador = yield* Atualizador.Atualizador;
    return GrupoAtualizacao.of({
      "atualizacao.estado": () => atualizador.estado,
      "atualizacao.procurar": () => atualizador.procurar,
      "atualizacao.trocarCanal": ({ canal }) => atualizador.trocarCanal(canal),
      "atualizacao.aplicar": () => atualizador.aplicar,
      "atualizacao.voltar": () => atualizador.voltar,
      "atualizacao.novidadesVistas": () => atualizador.novidadesVistas,
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
