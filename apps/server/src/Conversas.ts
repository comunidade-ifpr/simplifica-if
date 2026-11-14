/**
 * As conversas do app: o `Motor` com o MCP `ifpr` do servidor ligado a cada sessão.
 *
 * `iniciar` abre, num `Scope` só da sessão, uma sessão no servidor MCP HTTP (`abrirSessao`, com um
 * token próprio e a pasta de trabalho da conversa) e entrega ao provider o `ServidorMcp` HTTP com esse
 * token. Os `resultados` são as chamadas que o servidor MCP viu, filtradas pelo rótulo da sessão, para
 * o motor completar o resumo que o `agy` não manda pelo ACP (como em `packages/motor/scripts/mcp-http.ts`).
 * `encerrar` fecha a sessão do motor (o processo do provider morre) e depois o escopo (o token do MCP
 * é revogado). Ao fim da layer, as conversas abertas se encerram do mesmo jeito.
 *
 * Pontos de extensão do M1.2, ainda não implementados:
 * - **persistência:** `enviar` é por onde passam todos os eventos do turno; é ali que eles se gravam
 *   (`effect/sql` sobre `node:sqlite`), e `iniciar` registra a conversa;
 * - **retomada:** `iniciar` passa a aceitar uma conversa gravada e o id nativo do provider;
 * - **política de aprovação (M1.7):** em `enviar`, um `PedidoAprovacao` de ferramenta permitida pela
 *   política se responde aqui, sem chegar à interface;
 * - **skills:** `iniciar` monta as instruções da sessão e os arquivos da pasta de trabalho.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { type EntradaIniciar, PastaTrabalhoInvalida } from "@simplifica-if/contratos-app";
import * as McpHttp from "@simplifica-if/mcp/http";
import * as Motor from "@simplifica-if/motor";

/** O nome do servidor MCP na sessão do provider: as ferramentas chegam como `ifpr.<ferramenta>`. */
export const NOME_MCP = "ifpr";

export class Conversas extends Context.Service<
  Conversas,
  {
    readonly iniciar: (entrada: EntradaIniciar) => Effect.Effect<string, Motor.FalhaProvider | PastaTrabalhoInvalida>;
    readonly enviar: Motor.Motor["Service"]["enviarMensagem"];
    readonly responderAprovacao: Motor.Motor["Service"]["responderAprovacao"];
    readonly interromper: Motor.Motor["Service"]["interromper"];
    readonly encerrar: Motor.Motor["Service"]["encerrar"];
  }
>()("@simplifica-if/server/Conversas") {}

const make = Effect.gen(function* () {
  const motor = yield* Motor.Motor;
  const mcp = yield* McpHttp.ServidorMcpHttp;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  /** O escopo da sessão MCP de cada conversa aberta, pelo id da sessão do motor. */
  const escopos = new Map<string, Scope.Closeable>();
  let sequencia = 0;

  const fechar = (id: string, escopo: Scope.Closeable) =>
    motor
      .encerrar(id)
      .pipe(
        Effect.catchTags({ SessaoDesconhecida: () => Effect.void }),
        Effect.ensuring(Scope.close(escopo, Exit.void)),
      );

  yield* Effect.addFinalizer(() =>
    Effect.forEach([...escopos], ([id, escopo]) => fechar(id, escopo), { discard: true, concurrency: "unbounded" }),
  );

  /** O caminho real da pasta: absoluto, existente e pasta; senão, `PastaTrabalhoInvalida`. */
  const conferirPasta = Effect.fn("Conversas.conferirPasta")(function* (pasta: string) {
    const invalida = new PastaTrabalhoInvalida({ pasta });
    if (!path.isAbsolute(pasta)) return yield* invalida;
    const info = yield* fs.stat(pasta).pipe(Effect.mapError(() => invalida));
    if (info.type !== "Directory") return yield* invalida;
    return yield* fs.realPath(pasta).pipe(Effect.mapError(() => invalida));
  });

  const iniciar = Effect.fn("Conversas.iniciar")(function* (entrada: EntradaIniciar) {
    const pasta = yield* conferirPasta(entrada.pastaTrabalho);
    const escopo = yield* Scope.make();
    const rotulo = `conversa-${++sequencia}`;
    const sessaoMcp = yield* mcp.abrirSessao({ rotulo, pastaTrabalho: pasta }).pipe(Scope.provide(escopo));
    const servidor: Motor.ServidorMcpHttp = {
      tipo: "http",
      nome: NOME_MCP,
      url: sessaoMcp.url,
      cabecalhos: sessaoMcp.cabecalhos,
      preAprovado: true,
      resultados: mcp.chamadas.pipe(
        Stream.filter((chamada) => chamada.sessao === rotulo),
        Stream.map((chamada) => ({
          ferramenta: chamada.ferramenta,
          resumo: chamada.resumo ?? "",
          falhou: chamada.falhou,
        })),
      ),
    };
    const id = yield* motor
      .iniciarSessao({
        provider: entrada.provider,
        pastaTrabalho: pasta,
        servidoresMcp: [servidor],
        ...(entrada.modelo === undefined ? {} : { modelo: entrada.modelo }),
        ...(entrada.buscaWeb === undefined ? {} : { buscaWeb: entrada.buscaWeb }),
      })
      .pipe(Effect.onError(() => Scope.close(escopo, Exit.void)));
    escopos.set(id, escopo);
    yield* Effect.logInfo(`conversa ${id} (${rotulo}) aberta em ${pasta}`);
    return id;
  });

  const encerrar = Effect.fn("Conversas.encerrar")(function* (id: string) {
    const escopo = escopos.get(id);
    escopos.delete(id);
    yield* motor
      .encerrar(id)
      .pipe(Effect.ensuring(escopo === undefined ? Effect.void : Scope.close(escopo, Exit.void)));
  });

  return Conversas.of({
    iniciar,
    enviar: motor.enviarMensagem,
    responderAprovacao: motor.responderAprovacao,
    interromper: motor.interromper,
    encerrar,
  });
});

/** Pede o `Motor`, o `ServidorMcpHttp`, o `FileSystem` e o `Path`. */
export const layer = Layer.effect(Conversas, make);
