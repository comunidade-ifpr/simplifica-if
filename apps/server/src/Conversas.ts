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
 * **Conversas órfãs.** Cada conversa tem um dono: o cliente RPC (a conexão WebSocket) que a abriu ou
 * que a usou por último. Quando a conexão do dono cai (`clienteSaiu`, chamado pelo `onDisconnect` do
 * `RpcServer`), começa um prazo de tolerância (`TOLERANCIA_ORFA`); se nenhum cliente usar a conversa
 * até o fim dele, ela se encerra, e o processo do provider não fica vivo sem ninguém que o veja. A
 * interface que recarrega reconecta como outro cliente e, ao usar a conversa (`enviar`,
 * `responderAprovacao`, `interromper`), a adota: o prazo se cancela.
 *
 * O T3 não amarra a sessão do provider à conexão: as conversas dele são persistidas, e o
 * `ProviderSessionManager` libera a sessão depois de 30 minutos ociosa, sem turno em andamento, para
 * retomá-la quando o usuário voltar. Aqui ainda não há persistência nem retomada (M1.2): a conversa
 * que perdeu o cliente não volta a ser vista, e só a tolerância curta cobre o recarregamento da
 * interface. Com a retomada, a regra passa a ser a do T3 (ociosidade, não conexão).
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
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
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

/**
 * Quanto uma conversa espera, depois que a conexão do dono cai, antes de se encerrar. Cobre a
 * interface que recarrega (segundos) com folga.
 */
export const TOLERANCIA_ORFA = Duration.minutes(2);

/** O cliente RPC que chama: o `id` do `RpcServer` (um por conexão WebSocket). */
export type Cliente = number;

export class Conversas extends Context.Service<
  Conversas,
  {
    readonly iniciar: (
      cliente: Cliente,
      entrada: EntradaIniciar,
    ) => Effect.Effect<string, Motor.FalhaProvider | PastaTrabalhoInvalida>;
    readonly enviar: (
      cliente: Cliente,
      sessao: string,
      texto: string,
    ) => ReturnType<Motor.Motor["Service"]["enviarMensagem"]>;
    readonly responderAprovacao: (
      cliente: Cliente,
      sessao: string,
      aprovacao: string,
      decisao: Motor.Decisao,
    ) => ReturnType<Motor.Motor["Service"]["responderAprovacao"]>;
    readonly interromper: (cliente: Cliente, sessao: string) => ReturnType<Motor.Motor["Service"]["interromper"]>;
    readonly encerrar: (sessao: string) => ReturnType<Motor.Motor["Service"]["encerrar"]>;
    /** A conexão do cliente caiu: as conversas dele ficam órfãs e se encerram no fim da tolerância. */
    readonly clienteSaiu: (cliente: Cliente) => Effect.Effect<void>;
  }
>()("@simplifica-if/server/Conversas") {}

/** Uma conversa aberta: o escopo da sessão MCP, o dono e, se órfã, o prazo que a encerra. */
interface Aberta {
  readonly escopo: Scope.Closeable;
  dono: Cliente;
  prazo: Fiber.Fiber<void> | undefined;
}

const make = Effect.fnUntraced(function* (tolerancia: Duration.Duration) {
  const motor = yield* Motor.Motor;
  const mcp = yield* McpHttp.ServidorMcpHttp;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const escopoDaLayer = yield* Effect.scope;
  /** As conversas abertas, pelo id da sessão do motor. */
  const abertas = new Map<string, Aberta>();
  let sequencia = 0;

  const fechar = (id: string, aberta: Aberta) =>
    motor
      .encerrar(id)
      .pipe(
        Effect.catchTags({ SessaoDesconhecida: () => Effect.void }),
        Effect.ensuring(Scope.close(aberta.escopo, Exit.void)),
      );

  yield* Effect.addFinalizer(() =>
    Effect.forEach([...abertas], ([id, aberta]) => fechar(id, aberta), { discard: true, concurrency: "unbounded" }),
  );

  /** O caminho real da pasta: absoluto, existente e pasta; senão, `PastaTrabalhoInvalida`. */
  const conferirPasta = Effect.fn("Conversas.conferirPasta")(function* (pasta: string) {
    const invalida = new PastaTrabalhoInvalida({ pasta });
    if (!path.isAbsolute(pasta)) return yield* invalida;
    const info = yield* fs.stat(pasta).pipe(Effect.mapError(() => invalida));
    if (info.type !== "Directory") return yield* invalida;
    return yield* fs.realPath(pasta).pipe(Effect.mapError(() => invalida));
  });

  /** O cliente que usa a conversa passa a ser o dono dela; se ela estava órfã, o prazo se cancela. */
  const adotar = Effect.fn("Conversas.adotar")(function* (cliente: Cliente, id: string) {
    const aberta = abertas.get(id);
    if (aberta === undefined || aberta.dono === cliente) return;
    const prazo = aberta.prazo;
    aberta.dono = cliente;
    aberta.prazo = undefined;
    if (prazo !== undefined) {
      yield* Fiber.interrupt(prazo);
      yield* Effect.logInfo(`conversa ${id} adotada por outro cliente antes do fim da tolerância`);
    }
  });

  const iniciar = Effect.fn("Conversas.iniciar")(function* (cliente: Cliente, entrada: EntradaIniciar) {
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
    abertas.set(id, { escopo, dono: cliente, prazo: undefined });
    yield* Effect.logInfo(`conversa ${id} (${rotulo}) aberta em ${pasta}`);
    return id;
  });

  const encerrar = Effect.fn("Conversas.encerrar")(function* (id: string) {
    const aberta = abertas.get(id);
    abertas.delete(id);
    if (aberta?.prazo !== undefined) yield* Fiber.interrupt(aberta.prazo);
    yield* motor
      .encerrar(id)
      .pipe(Effect.ensuring(aberta === undefined ? Effect.void : Scope.close(aberta.escopo, Exit.void)));
  });

  /** No fim do prazo, encerra a conversa se ela continua do cliente que saiu. */
  const encerrarOrfa = Effect.fn("Conversas.encerrarOrfa")(function* (cliente: Cliente, id: string) {
    yield* Effect.sleep(tolerancia);
    const aberta = abertas.get(id);
    if (aberta === undefined || aberta.dono !== cliente) return;
    aberta.prazo = undefined;
    abertas.delete(id);
    yield* Effect.logInfo(`conversa ${id} encerrada: sem cliente há ${Duration.format(tolerancia)}`);
    yield* fechar(id, aberta);
  });

  const clienteSaiu = Effect.fn("Conversas.clienteSaiu")(function* (cliente: Cliente) {
    for (const [id, aberta] of abertas) {
      if (aberta.dono !== cliente || aberta.prazo !== undefined) continue;
      // O prazo vive no escopo da layer: sobrevive à conexão que caiu e morre com o servidor.
      aberta.prazo = yield* encerrarOrfa(cliente, id).pipe(Effect.forkIn(escopoDaLayer));
    }
  });

  const responderAprovacao = Effect.fn("Conversas.responderAprovacao")(function* (
    cliente: Cliente,
    sessao: string,
    aprovacao: string,
    decisao: Motor.Decisao,
  ) {
    yield* adotar(cliente, sessao);
    return yield* motor.responderAprovacao(sessao, aprovacao, decisao);
  });

  const interromper = Effect.fn("Conversas.interromper")(function* (cliente: Cliente, sessao: string) {
    yield* adotar(cliente, sessao);
    return yield* motor.interromper(sessao);
  });

  return Conversas.of({
    iniciar,
    enviar: (cliente, sessao, texto) =>
      Stream.unwrap(Effect.as(adotar(cliente, sessao), motor.enviarMensagem(sessao, texto))),
    responderAprovacao,
    interromper,
    encerrar,
    clienteSaiu,
  });
});

/**
 * Pede o `Motor`, o `ServidorMcpHttp`, o `FileSystem` e o `Path`. `tolerancia`: o prazo da conversa
 * órfã (padrão: `TOLERANCIA_ORFA`).
 */
export const layer = (opcoes: { readonly tolerancia?: Duration.Duration } = {}) =>
  Layer.effect(Conversas, make(opcoes.tolerancia ?? TOLERANCIA_ORFA));
