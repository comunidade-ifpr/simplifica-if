/**
 * Os handlers do `GrupoApp`: casca fina sobre o `Motor` (providers), as `Conversas` (conversa), o
 * `CatalogoSkills` (skills), a `ListaViva` e a `RevisaoIa` (revisão prévia de PPC) e o `Leitura` do `simplifica-mcp`
 * (leitura, os mesmos handlers de `@simplifica-if/mcp/rpc`).
 *
 * A conversa não pertence à conexão: os métodos de conversa recebem só o id dela (`sessao`), e uma
 * interface que recarrega volta à mesma conversa por `conversa.carregar` e `conversa.acompanhar`.
 *
 * Cada handler só chama um método de serviço; a tradução de erro é uma só para todos (`traduzir`): a
 * causa, defeitos inclusive, vai para o log do servidor (stderr) com o código do erro (`codigoDoErro`, do
 * `traceId` do pedido), com o `cause` de cada erro tipado trocado pelo resumo dele (`resumoDaFalha`: o
 * tipo e um texto técnico curto, sem caminhos, que podem trazer o nome da pasta da tarefa ou de um anexo,
 * nem trecho do pedido ou da resposta); e o `FalhaProvider`, a `FalhaPasta` e o `FalhaDiagnostico` chegam
 * à interface sem o `cause`. Do `cause` do `FalhaProvider` sai só o texto técnico de "Detalhes técnicos"
 * (`tecnico`), curto e saneado. As regras de produto, como o aviso de uso
 * antes de mandar algo à IA (M1.8), ficam nos serviços.
 */
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Atualizador from "./Atualizador.ts";
import {
  codigoDoErro,
  ehFalhaDiagnostico,
  ehFalhaPasta,
  FalhaDiagnostico,
  FalhaPasta,
  GrupoAtualizacao,
  GrupoConversa,
  GrupoDiagnostico,
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
import * as Diagnostico from "./diagnostico/Diagnostico.ts";
import { resumoDaFalha } from "./observabilidade/resumoDaFalha.ts";
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
 * O erro como vai à interface: o `FalhaProvider`, a `FalhaPasta` e o `FalhaDiagnostico` sem o `cause`; o
 * `FalhaProvider` com o texto técnico dele.
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
      : ehFalhaDiagnostico(erro)
        ? (new FalhaDiagnostico({ motivo: erro.motivo }) as E)
        : erro;

/** Um campo `cause` presente: o erro tipado vai ao log com o resumo da causa no lugar dela. */
const temCausa = (erro: unknown): erro is { readonly cause: unknown } =>
  typeof erro === "object" && erro !== null && "cause" in erro && erro.cause !== undefined;

/**
 * O erro como vai ao log: o mesmo erro, com o `cause` trocado pelo resumo (`resumoDaFalha`), que não leva
 * caminho, nome de anexo nem texto do pedido ou da resposta.
 */
export const paraRegistro = <E>(erro: E): E => {
  if (!temCausa(erro)) return erro;
  const resumo = resumoDaFalha(erro.cause);
  if (ehFalhaProvider(erro))
    return new Motor.FalhaProvider({
      provider: erro.provider,
      operacao: erro.operacao,
      tipo: erro.tipo,
      cause: resumo,
    }) as E;
  if (ehFalhaPasta(erro)) return new FalhaPasta({ motivo: erro.motivo, cause: resumo }) as E;
  if (ehFalhaDiagnostico(erro)) return new FalhaDiagnostico({ motivo: erro.motivo, cause: resumo }) as E;
  return erro;
};

/** O log anotado com o código do erro (`codigoDoErro`), tirado do span do pedido, se houver um. */
const comCodigo = <A, E, R>(efeito: Effect.Effect<A, E, R>) =>
  Effect.flatMap(Effect.option(Effect.currentSpan), (span) =>
    Option.isSome(span) ? Effect.annotateLogs(efeito, { codigo: codigoDoErro(span.value.traceId) }) : efeito,
  );

/**
 * Registra a causa: o erro tipado como aviso, com o resumo do `cause` dele (`paraRegistro`), e o defeito
 * (um `orDie`, uma exceção) como erro. Interrupção não é erro.
 */
const registrar = (metodo: string, causa: Cause.Cause<unknown>) =>
  Cause.hasInterruptsOnly(causa)
    ? Effect.void
    : comCodigo(
        Cause.hasDies(causa)
          ? Effect.logError(`RPC ${metodo}: defeito`, Cause.map(causa, paraRegistro))
          : Effect.logWarning(`RPC ${metodo} falhou`, Cause.map(causa, paraRegistro)),
      );

/**
 * A tradução de erro do transporte, a mesma para todos os métodos de todos os grupos: registra no log
 * do servidor a causa inteira, defeitos inclusive, e manda o erro à interface por `paraInterface`.
 */
export const traduzir = <A, E, R>(metodo: string, efeito: Effect.Effect<A, E, R>) =>
  efeito.pipe(
    Effect.tapCause((causa) => registrar(metodo, causa)),
    Effect.mapError((erro: E) => paraInterface(erro)),
  );

/** `traduzir` para os métodos que respondem em stream. */
export const traduzirStream = <A, E, R>(metodo: string, stream: Stream.Stream<A, E, R>) =>
  stream.pipe(
    Stream.onError((causa) => registrar(metodo, causa)),
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
      "conversa.enviar": ({ sessao, texto }) => traduzir("conversa.enviar", conversas.enviar(sessao, texto)),
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
      "conversa.previaApagar": ({ sessao }) => traduzir("conversa.previaApagar", conversas.previaApagar(sessao)),
      "conversa.apagar": ({ sessao }) => traduzir("conversa.apagar", conversas.apagar(sessao)),
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

/** "Gerar diagnóstico": a prévia do pacote e o `.zip` em `Documentos/Simplifica IF/Diagnósticos/`. */
const layerDiagnostico = GrupoDiagnostico.toLayer(
  Effect.gen(function* () {
    const diagnostico = yield* Diagnostico.Diagnostico;
    return GrupoDiagnostico.of({
      "diagnostico.preparar": () => traduzir("diagnostico.preparar", diagnostico.preparar),
      "diagnostico.gerar": () => traduzir("diagnostico.gerar", diagnostico.gerar),
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
      "revisaoPpc.revisar": (entrada) => traduzirStream("revisaoPpc.revisar", viva.revisar(entrada)),
      "revisaoPpc.prepararIa": (entrada) => traduzir("revisaoPpc.prepararIa", ia.preparar(entrada)),
      "revisaoPpc.iniciarIa": ({ revisao }) => traduzir("revisaoPpc.iniciarIa", ia.iniciar(revisao)),
      "revisaoPpc.pausarIa": ({ revisao }) => traduzir("revisaoPpc.pausarIa", ia.pausar(revisao)),
      "revisaoPpc.acompanharIa": ({ revisao }) => traduzirStream("revisaoPpc.acompanharIa", ia.acompanhar(revisao)),
      "revisaoPpc.listarIa": () => traduzir("revisaoPpc.listarIa", ia.listar),
      "revisaoPpc.apagarIa": ({ revisao }) => traduzir("revisaoPpc.apagarIa", ia.apagar(revisao)),
      "revisaoPpc.lista": ({ lista }) => traduzir("revisaoPpc.lista", viva.lista(lista)),
      "revisaoPpc.listas": () => traduzir("revisaoPpc.listas", viva.todas),
      "revisaoPpc.trocarCurso": ({ lista, cnct, forma }) =>
        traduzir("revisaoPpc.trocarCurso", viva.trocarCurso(lista, cnct, forma)),
      "revisaoPpc.apagarLista": ({ lista }) => traduzir("revisaoPpc.apagarLista", viva.apagar(lista)),
      "revisaoPpc.exportarDiscordancias": () =>
        traduzir("revisaoPpc.exportarDiscordancias", viva.exportarDiscordancias),
      "revisaoPpc.marcar": ({ lista, chave, situacao }) =>
        traduzir("revisaoPpc.marcar", viva.marcar(lista, chave, situacao)),
      "revisaoPpc.estimarAcao": ({ lista, chave, acao, provider }) =>
        traduzir("revisaoPpc.estimarAcao", viva.estimar(lista, chave, acao, provider)),
      "revisaoPpc.contestar": ({ lista, chave, motivo, provider }) =>
        traduzir("revisaoPpc.contestar", viva.contestar(lista, chave, motivo, provider)),
      "revisaoPpc.sugerir": ({ lista, chave, provider }) =>
        traduzir("revisaoPpc.sugerir", viva.sugerir(lista, chave, provider)),
      "revisaoPpc.revisarDeNovo": ({ lista, chave, arquivo, provider }) =>
        traduzir("revisaoPpc.revisarDeNovo", viva.revisarDeNovo(lista, chave, arquivo, provider)),
      "revisaoPpc.revisarArquivoNovo": ({ lista, arquivo }) =>
        traduzir("revisaoPpc.revisarArquivoNovo", viva.revisarArquivoNovo(lista, arquivo)),
      "revisaoPpc.gerarCopia": ({ lista }) => traduzir("revisaoPpc.gerarCopia", viva.gerarCopia(lista)),
      "revisaoPpc.documento": ({ lista }) => traduzir("revisaoPpc.documento", viva.documento(lista)),
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
 * Os handlers dos dez grupos; pede o `Motor`, as `Conversas`, os `Relatos`, o `Diagnostico`, o `CatalogoSkills`, a
 * `RevisorPpc`, a `RevisaoIa`, o `Atualizador`, as `Preferencias` e o `Leitura`.
 */
export const layer = Layer.mergeAll(
  layerProviders,
  layerConversa,
  layerRelato,
  layerDiagnostico,
  layerSkills,
  layerPasta,
  layerRevisaoPpc,
  layerPreferencias,
  layerAtualizacao,
  layerHandlersRpc,
);
