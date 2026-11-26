/**
 * Os handlers do `GrupoApp`: casca fina sobre o `Motor` (providers), as `Conversas` (conversa), o
 * `CatalogoTarefas` (tarefas), o `Leitura` do `simplifica-mcp` (leitura, os mesmos handlers de
 * `@simplifica-if/mcp/rpc`) e, pelos handlers do próprio módulo, a revisão de PPC
 * (`modulos/revisao-ppc/handlers.ts`). Arquivo de composição: só ele, no núcleo dos handlers, cita o módulo.
 *
 * A conversa não pertence à conexão: os métodos de conversa recebem só o id dela (`sessao`), e uma
 * interface que recarrega volta à mesma conversa por `conversa.carregar` e `conversa.acompanhar`.
 *
 * Cada handler só chama um método de serviço; a tradução de erro é uma só para todos (`traduzir`, em
 * `traducao.ts`). As regras de produto, como o aviso de uso antes de mandar algo à IA (M1.8), ficam nos
 * serviços.
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Atualizador from "./Atualizador.ts";
import {
  GrupoAtualizacao,
  GrupoConversa,
  GrupoDiagnostico,
  GrupoPasta,
  GrupoPreferencias,
  GrupoProviders,
  GrupoRelato,
  GrupoTarefas,
} from "@simplifica-if/contratos-app";
import { layerHandlersRpc } from "@simplifica-if/mcp/rpc";
import * as Motor from "@simplifica-if/motor";
import * as CatalogoTarefas from "./CatalogoTarefas.ts";
import * as Conversas from "./Conversas.ts";
import * as Diagnostico from "./diagnostico/Diagnostico.ts";
import * as PastasTrabalho from "./PastasTrabalho.ts";
import * as Preferencias from "./persistencia/Preferencias.ts";
import * as Relatos from "./Relatos.ts";
import { traduzir, traduzirStream } from "./traducao.ts";
// Composição: o módulo `revisao-ppc`.
import * as HandlersRevisaoPpc from "./modulos/revisao-ppc/handlers.ts";

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
    // O canal é do `Atualizador`, que as `Conversas` não podem pedir (ver `layerTarefas`).
    const atualizador = yield* Atualizador.Atualizador;
    return GrupoConversa.of({
      "conversa.iniciar": (entrada) =>
        traduzir(
          "conversa.iniciar",
          atualizador.canal.pipe(
            Effect.flatMap((canal) => conversas.iniciar(entrada, canal)),
            Effect.map((sessao) => ({ sessao })),
          ),
        ),
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

/**
 * O catálogo no canal de "Atualizações": o canal é do `Atualizador`, que a pessoa troca com o servidor
 * aberto, e o `CatalogoTarefas` não pode pedi-lo (o `Atualizador` espera as `Conversas`, que pedem o
 * catálogo).
 */
const layerTarefas = GrupoTarefas.toLayer(
  Effect.gen(function* () {
    const catalogo = yield* CatalogoTarefas.CatalogoTarefas;
    const atualizador = yield* Atualizador.Atualizador;
    return GrupoTarefas.of({
      "tarefas.listar": () =>
        traduzir(
          "tarefas.listar",
          Effect.map(atualizador.canal, (canal) => catalogo.listar(canal)),
        ),
    });
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
 * Os handlers dos dez grupos; pede o `Motor`, as `Conversas`, os `Relatos`, o `Diagnostico`, o `CatalogoTarefas`, o
 * `Atualizador`, as `Preferencias`, o `Leitura` e os serviços do módulo `revisao-ppc`.
 */
export const layer = Layer.mergeAll(
  layerProviders,
  layerConversa,
  layerRelato,
  layerDiagnostico,
  layerTarefas,
  layerPasta,
  HandlersRevisaoPpc.layer,
  layerPreferencias,
  layerAtualizacao,
  layerHandlersRpc,
);
