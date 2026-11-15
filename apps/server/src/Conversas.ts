/**
 * As conversas do app: gravadas no banco (`persistencia/`), com a sessão do provider aberta pelo
 * `Motor` quando é preciso e liberada quando não é, como o `ProviderSessionManager` do T3.
 *
 * **A conversa não depende da conexão.** Ela tem um id próprio (UUID), dura no banco e não se encerra
 * quando a interface cai ou recarrega. A interface volta a ela por `carregar` e, se há turno em
 * andamento, por `acompanhar`. Os eventos de cada turno passam por um fiber do servidor (`bombear`),
 * que os grava e os publica para quem acompanha; a conexão que cai não interrompe o turno.
 *
 * **Ciclo de vida da sessão do provider.**
 * - `iniciar` abre a sessão (já com o MCP `ifpr`: uma sessão no servidor MCP HTTP com token próprio,
 *   revogado ao fechar) e grava a conversa com o id nativo do provider.
 * - Ociosa por `OCIOSIDADE` (30 minutos, como no T3), sem turno em andamento, a sessão se libera: o
 *   processo do provider morre, e a conversa fica `liberada`.
 * - Na próxima mensagem (ou em `retomar`), a sessão se reabre pela retomada do provider
 *   (`ConfigSessao.retomar` com o id nativo). Se o provider não retomar (sem `session/load` no `agy`,
 *   transcrição apagada), abre-se uma sessão nova, e a próxima mensagem leva o histórico gravado como
 *   contexto.
 * - **Queda do processo do provider:** o motor avisa (`infoSessao().queda`). No meio de um turno, o
 *   turno termina com `Erro` e `FimTurno` (motivo `falha`); fora dele, grava-se o `Erro`. A conversa
 *   fica `caiu`, e a próxima mensagem a reabre pela retomada.
 * - **Interromper:** pede ao provider que pare; se o turno não terminar em `PRAZO_INTERRUPCAO`, a
 *   sessão se libera e o turno termina como interrompido. Em todo caso a conversa aceita novo turno.
 * - Ao fim da layer (o app fechou), as sessões se liberam, e um turno em andamento termina como
 *   interrompido. Na abertura, as conversas que o banco dá como abertas (o servidor morreu sem
 *   fechar) passam a `liberada`, com o turno pela metade fechado do mesmo jeito.
 *
 * O `TextoParcial` não se grava: ao fechar o turno, o texto parcial que não ganhou `TextoFinal` vira
 * um `TextoFinal` no banco, e quem acompanha um turno em andamento recebe o texto parcial acumulado
 * num `TextoParcial` só.
 *
 * A política de aprovação (M1.7) fica no motor: aqui só chegam os pedidos que ela manda perguntar.
 * Ponto de extensão: as skills do app (M1.11) entram como `ConfigSessao.skills` em `abrirSessao`.
 */
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SecureRandom from "effect/crypto/SecureRandom";
import {
  type ConversaGravada,
  type EntradaIniciar,
  type EstadoConversa,
  type ItemConversa,
  PastaTrabalhoInvalida,
  type ResumoConversa,
} from "@simplifica-if/contratos-app";
import * as McpHttp from "@simplifica-if/mcp/http";
import * as Motor from "@simplifica-if/motor";
import { type Alteracao, Historico, type RegistroConversa } from "./persistencia/Historico.ts";

/** O nome do servidor MCP na sessão do provider: as ferramentas chegam como `ifpr.<ferramenta>`. */
export const NOME_MCP = "ifpr";

/** Depois de quanto tempo sem turno a sessão do provider se libera (o T3 usa 30 minutos). */
export const OCIOSIDADE = Duration.minutes(30);

/** Quanto se espera pelo fim do turno depois de pedir a interrupção, antes de liberar a sessão. */
export const PRAZO_INTERRUPCAO = Duration.seconds(15);

/** O tamanho máximo do histórico levado como contexto quando a retomada não é possível. */
const LIMITE_CONTEXTO = 24_000;

export class Conversas extends Context.Service<
  Conversas,
  {
    readonly iniciar: (entrada: EntradaIniciar) => Effect.Effect<string, Motor.FalhaProvider | PastaTrabalhoInvalida>;
    readonly enviar: (
      sessao: string,
      texto: string,
    ) => Stream.Stream<Motor.Evento, Motor.FalhaProvider | Motor.TurnoEmAndamento | Motor.SessaoDesconhecida>;
    readonly responderAprovacao: (
      sessao: string,
      aprovacao: string,
      decisao: Motor.Decisao,
    ) => Effect.Effect<void, Motor.SessaoDesconhecida | Motor.AprovacaoDesconhecida>;
    readonly interromper: (sessao: string) => Effect.Effect<void, Motor.SessaoDesconhecida | Motor.FalhaProvider>;
    /** Libera a sessão do provider; a conversa continua gravada. */
    readonly encerrar: (sessao: string) => Effect.Effect<void, Motor.SessaoDesconhecida>;
    readonly listar: Effect.Effect<ReadonlyArray<ResumoConversa>>;
    readonly carregar: (sessao: string) => Effect.Effect<ConversaGravada, Motor.SessaoDesconhecida>;
    readonly acompanhar: (sessao: string, depois: number) => Stream.Stream<ItemConversa, Motor.SessaoDesconhecida>;
    readonly retomar: (sessao: string) => Effect.Effect<ResumoConversa, Motor.FalhaProvider | Motor.SessaoDesconhecida>;
  }
>()("@simplifica-if/server/Conversas") {}

/** A sessão do provider aberta para uma conversa. */
interface SessaoAberta {
  /** O id da sessão no `Motor`. */
  readonly id: string;
  /** O escopo da sessão MCP (o token). */
  readonly escopo: Scope.Closeable;
  /** Termina com a queda do processo do provider. */
  readonly queda: Effect.Effect<Motor.FalhaProvider>;
  /** O fiber que espera a queda do processo do provider. */
  vigia: Fiber.Fiber<void> | undefined;
}

interface TurnoAberto {
  readonly numero: number;
  fibra: Fiber.Fiber<void> | undefined;
  /** O texto parcial desde o último `TextoFinal`. */
  acumulado: string;
  /** O `FimTurno` já foi gravado. */
  terminou: boolean;
  /** O turno terminou com falha do provider (já gravou o `Erro`). */
  falhou: boolean;
  readonly fim: Deferred.Deferred<void>;
}

/** Uma conversa em memória: o registro do banco e o que vive enquanto o servidor vive. */
interface Viva {
  readonly id: string;
  registro: RegistroConversa;
  sessao: SessaoAberta | undefined;
  turno: TurnoAberto | undefined;
  ociosidade: Fiber.Fiber<void> | undefined;
  /** O histórico a levar na próxima mensagem, quando a retomada não foi possível. */
  contexto: string | undefined;
  /** O processo do provider caiu e a sessão ainda não se reabriu. */
  caiu: boolean;
  /** O último turno terminou com falha do provider (o `Erro` dele já está gravado). */
  ultimoTurnoFalhou: boolean;
  readonly aoVivo: PubSub.PubSub<ItemConversa>;
  /** Abrir e fechar a sessão e começar o turno, um de cada vez. */
  readonly trava: Semaphore.Semaphore;
  /** Gravar e publicar um item, e o retrato de `acompanhar`, um de cada vez. */
  readonly travaItens: Semaphore.Semaphore;
}

/** O título da conversa: a primeira linha da primeira mensagem, até 80 caracteres. */
export function derivarTitulo(texto: string): string {
  const linha = texto.trim().split(/\r?\n/, 1)[0]?.replace(/\s+/g, " ").trim() ?? "";
  return linha.length <= 80 ? linha : `${linha.slice(0, 79)}…`;
}

/**
 * O histórico gravado como contexto de uma sessão nova, quando o provider não retoma a anterior: as
 * mensagens da pessoa e as respostas finais, das mais recentes até `LIMITE_CONTEXTO`.
 */
export function contextoDoHistorico(itens: ReadonlyArray<ItemConversa>): string | undefined {
  const turnos = new Map<number, { pessoa: string; respostas: Array<string> }>();
  for (const item of itens) {
    if (item._tag === "Mensagem") turnos.set(item.turno, { pessoa: item.texto, respostas: [] });
    else if (item._tag === "EventoTurno" && item.evento._tag === "TextoFinal") {
      turnos.get(item.turno)?.respostas.push(item.evento.texto);
    }
  }
  const blocos: Array<string> = [];
  let tamanho = 0;
  for (const turno of [...turnos.values()].reverse()) {
    const bloco = `Pessoa: ${turno.pessoa}\n\nIA: ${turno.respostas.join("\n\n") || "(sem resposta)"}`;
    if (tamanho + bloco.length > LIMITE_CONTEXTO && blocos.length > 0) break;
    blocos.unshift(bloco);
    tamanho += bloco.length;
  }
  if (blocos.length === 0) return undefined;
  return [
    "Esta conversa continua uma anterior, que não pôde ser retomada no provider. O histórico dela, para contexto:",
    blocos.join("\n\n---\n\n"),
    "---",
    "Nova mensagem:",
  ].join("\n\n");
}

const make = Effect.fnUntraced(function* (opcoes: {
  readonly ociosidade: Duration.Duration;
  readonly prazoInterrupcao: Duration.Duration;
}) {
  const motor = yield* Motor.Motor;
  const mcp = yield* McpHttp.ServidorMcpHttp;
  const historico = yield* Historico;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const aleatorio = yield* SecureRandom.SecureRandom;
  const escopoDaLayer = yield* Effect.scope;
  const vivas = new Map<string, Viva>();
  let sequencia = 0;

  /* ------------------------------------------------------------ registro */

  const resumo = (registro: RegistroConversa): ResumoConversa => ({
    id: registro.id,
    provider: registro.provider,
    pastaTrabalho: registro.pastaTrabalho,
    ...(registro.modelo === undefined ? {} : { modelo: registro.modelo }),
    titulo: registro.titulo,
    estado: registro.estado,
    turnos: registro.turnos,
    criadaEm: registro.criadaEm,
    atualizadaEm: registro.atualizadaEm,
  });

  const alterar = Effect.fnUntraced(function* (viva: Viva, alteracao: Alteracao) {
    yield* historico.alterar(viva.id, alteracao);
    const atual = yield* historico.buscar(viva.id);
    if (Option.isSome(atual)) viva.registro = atual.value;
  });

  const estadoEmRepouso = (viva: Viva): EstadoConversa =>
    viva.sessao !== undefined ? "pronta" : viva.caiu ? "caiu" : "liberada";

  /** Grava (exceto o `TextoParcial`) e publica um item, com a próxima `ordem`. */
  const registrar = Effect.fn("Conversas.registrar")(function* (
    viva: Viva,
    item: (ordem: number) => ItemConversa,
    opcoes: { readonly publicar: boolean },
  ) {
    const ordem = viva.registro.ultimaOrdem + 1;
    const pronto = item(ordem);
    yield* historico.gravar(viva.id, pronto);
    viva.registro = { ...viva.registro, ultimaOrdem: ordem, turnos: Math.max(viva.registro.turnos, pronto.turno) };
    if (opcoes.publicar) yield* PubSub.publish(viva.aoVivo, pronto);
  });

  /** Um evento do turno: o parcial se acumula e se publica; o resto se grava e se publica. */
  const registrarEvento = (viva: Viva, evento: Motor.Evento) =>
    viva.travaItens
      .withPermits(1)(
        Effect.gen(function* () {
          const turno = viva.turno;
          const numero = turno?.numero ?? viva.registro.turnos;
          if (evento._tag === "TextoParcial") {
            if (turno !== undefined) turno.acumulado += evento.texto;
            yield* PubSub.publish(viva.aoVivo, {
              _tag: "EventoTurno",
              turno: numero,
              ordem: viva.registro.ultimaOrdem,
              evento,
            });
            return;
          }
          if (turno !== undefined) {
            if (evento._tag === "TextoFinal") turno.acumulado = "";
            // O texto parcial que não ganhou `TextoFinal` (Claude interrompido, por exemplo) fica no banco.
            if (evento._tag === "FimTurno" && turno.acumulado.trim() !== "") {
              const texto = turno.acumulado;
              turno.acumulado = "";
              yield* registrar(
                viva,
                (ordem) => ({ _tag: "EventoTurno", turno: numero, ordem, evento: { _tag: "TextoFinal", texto } }),
                { publicar: false },
              );
            }
            if (evento._tag === "FimTurno") turno.terminou = true;
          }
          yield* registrar(viva, (ordem) => ({ _tag: "EventoTurno", turno: numero, ordem, evento }), {
            publicar: true,
          });
        }),
      )
      .pipe(Effect.uninterruptible);

  /* ------------------------------------------------------------ sessão */

  const conferirPasta = Effect.fn("Conversas.conferirPasta")(function* (pasta: string) {
    const invalida = new PastaTrabalhoInvalida({ pasta });
    if (!path.isAbsolute(pasta)) return yield* invalida;
    const info = yield* fs.stat(pasta).pipe(Effect.mapError(() => invalida));
    if (info.type !== "Directory") return yield* invalida;
    return yield* fs.realPath(pasta).pipe(Effect.mapError(() => invalida));
  });

  /** Fecha a sessão do motor e o escopo do MCP; nunca falha. */
  const fecharSessao = Effect.fn("Conversas.fecharSessao")(function* (sessao: SessaoAberta) {
    if (sessao.vigia !== undefined) yield* Fiber.interrupt(sessao.vigia);
    yield* motor.encerrar(sessao.id).pipe(Effect.ignore);
    yield* Scope.close(sessao.escopo, Exit.void);
  });

  const cancelarOciosidade = (viva: Viva) =>
    Effect.suspend(() => {
      const fibra = viva.ociosidade;
      viva.ociosidade = undefined;
      return fibra === undefined ? Effect.void : Fiber.interrupt(fibra);
    });

  /** Libera a sessão ociosa no fim do prazo, se não houver turno. */
  const agendarOciosidade = Effect.fn("Conversas.agendarOciosidade")(function* (viva: Viva) {
    yield* cancelarOciosidade(viva);
    if (viva.sessao === undefined || viva.turno !== undefined) return;
    viva.ociosidade = yield* Effect.sleep(opcoes.ociosidade).pipe(
      Effect.andThen(
        Effect.suspend(() => {
          viva.ociosidade = undefined;
          if (viva.turno !== undefined) return Effect.void;
          return Effect.logInfo(
            `conversa ${viva.id}: sessão liberada depois de ${Duration.format(opcoes.ociosidade)} ociosa`,
          ).pipe(Effect.andThen(liberar(viva)));
        }),
      ),
      Effect.forkIn(escopoDaLayer),
    );
  });

  /**
   * Libera a sessão do provider: um turno em andamento termina como interrompido, o processo morre e
   * o token do MCP é revogado. A conversa fica `liberada` (ou `caiu`, se foi queda).
   */
  const liberar = (viva: Viva) =>
    viva.trava.withPermits(1)(
      Effect.gen(function* () {
        // Sem a sessão antes de fechar o turno: o turno interrompido não agenda a ociosidade.
        const sessao = viva.sessao;
        viva.sessao = undefined;
        yield* cancelarOciosidade(viva);
        const turno = viva.turno;
        if (turno?.fibra !== undefined) yield* Fiber.interrupt(turno.fibra);
        if (sessao !== undefined) yield* fecharSessao(sessao);
        if (viva.registro.estado !== estadoEmRepouso(viva)) yield* alterar(viva, { estado: estadoEmRepouso(viva) });
      }),
    );

  /**
   * O processo do provider caiu: a sessão sai da conversa e se fecha, e a conversa fica `caiu`. Sem
   * a `trava`: o turno que falhou chama daqui também (`bombear`), e quem chegar primeiro fecha.
   */
  const derrubar = Effect.fn("Conversas.derrubar")(function* (viva: Viva, sessao: SessaoAberta) {
    if (viva.sessao !== sessao) return false;
    viva.sessao = undefined;
    viva.caiu = true;
    yield* cancelarOciosidade(viva);
    yield* fecharSessao(sessao);
    return true;
  });

  /** O vigia da sessão viu a queda fora do turno: o `Erro` fica no histórico. */
  const aoCair = (viva: Viva, sessao: SessaoAberta, falha: Motor.FalhaProvider) =>
    viva.trava.withPermits(1)(
      Effect.gen(function* () {
        sessao.vigia = undefined;
        if (!(yield* derrubar(viva, sessao))) return;
        yield* Effect.logWarning(`conversa ${viva.id}: o processo do provider caiu`, falha);
        // No meio de um turno, o próprio turno termina com o erro (`bombear`); fora dele, ninguém viu a
        // queda, e o `Erro` fica no histórico.
        if (viva.turno !== undefined) return;
        if (!viva.ultimoTurnoFalhou) yield* registrarEvento(viva, { _tag: "Erro", mensagem: falha.message });
        yield* alterar(viva, { estado: "caiu" });
      }),
    );

  /** Abre a sessão do provider, pela retomada se a conversa já tem id nativo. Chame com a `trava`. */
  const abrirSessao = Effect.fn("Conversas.abrirSessao")(function* (viva: Viva) {
    if (viva.sessao !== undefined) return viva.sessao;
    const registro = viva.registro;
    const pasta = yield* conferirPasta(registro.pastaTrabalho).pipe(
      Effect.mapError(
        () =>
          new Motor.FalhaProvider({
            provider: registro.provider,
            operacao: "retomar",
            detalhe: `a pasta de trabalho não existe mais: ${registro.pastaTrabalho}`,
          }),
      ),
    );
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
    const config: Motor.ConfigSessao = {
      provider: registro.provider,
      pastaTrabalho: pasta,
      servidoresMcp: [servidor],
      ...(registro.modelo === undefined ? {} : { modelo: registro.modelo }),
      ...(registro.buscaWeb === undefined ? {} : { buscaWeb: registro.buscaWeb }),
    };
    const abrir =
      registro.idNativo === undefined
        ? motor.iniciarSessao(config)
        : motor.iniciarSessao({ ...config, retomar: registro.idNativo }).pipe(
            Effect.tap(() => Effect.logInfo(`conversa ${viva.id}: sessão retomada no provider`)),
            Effect.catch((falha) =>
              Effect.gen(function* () {
                // O provider não retomou: sessão nova, com o histórico gravado como contexto.
                yield* Effect.logWarning(`conversa ${viva.id}: a retomada falhou; recomeça com o histórico`, falha);
                const id = yield* motor.iniciarSessao(config);
                viva.contexto = contextoDoHistorico(yield* historico.itens(viva.id));
                return id;
              }),
            ),
          );
    const id = yield* abrir.pipe(Effect.onError(() => Scope.close(escopo, Exit.void)));
    const info = yield* motor.infoSessao(id).pipe(Effect.orDie);
    const sessao: SessaoAberta = { id, escopo, queda: info.queda, vigia: undefined };
    viva.sessao = sessao;
    viva.caiu = false;
    if (info.idNativo !== undefined && info.idNativo !== registro.idNativo) {
      yield* alterar(viva, { idNativo: info.idNativo });
    }
    sessao.vigia = yield* info.queda.pipe(
      Effect.flatMap((falha) => aoCair(viva, sessao, falha)),
      Effect.forkIn(escopoDaLayer),
    );
    yield* Effect.logInfo(`conversa ${viva.id} (${rotulo}): sessão aberta em ${pasta}`);
    return sessao;
  });

  /* ------------------------------------------------------------ turno */

  /** Fecha o turno: o `FimTurno` que faltar, o estado e o prazo de ociosidade. */
  const fecharTurno = Effect.fn("Conversas.fecharTurno")(function* (viva: Viva, turno: TurnoAberto) {
    if (!turno.terminou) yield* registrarEvento(viva, { _tag: "FimTurno", motivo: "interrompido" });
    viva.ultimoTurnoFalhou = turno.falhou;
    viva.turno = undefined;
    yield* alterar(viva, { estado: estadoEmRepouso(viva) });
    yield* Deferred.succeed(turno.fim, undefined);
    yield* agendarOciosidade(viva);
  }, Effect.uninterruptible);

  /** Os eventos do turno, do motor para o banco e para quem acompanha. Roda no escopo da layer. */
  const bombear = (viva: Viva, turno: TurnoAberto, sessao: SessaoAberta, texto: string) =>
    motor.enviarMensagem(sessao.id, texto).pipe(
      Stream.runForEach((evento) => registrarEvento(viva, evento)),
      Effect.catch((erro) =>
        Effect.gen(function* () {
          // A falha do provider (inclusive a queda do processo) vira `Erro` e `FimTurno`: a conversa
          // continua, e a próxima mensagem reabre a sessão se for preciso.
          yield* Effect.logWarning(`conversa ${viva.id}: o turno falhou`, erro);
          turno.falhou = true;
          // Se foi queda do processo (o driver a avisa antes de falhar o turno), a sessão sai já, e o
          // turno fecha com a conversa `caiu`.
          const caiu = yield* sessao.queda.pipe(Effect.timeoutOption(Duration.seconds(1)));
          if (Option.isSome(caiu)) yield* derrubar(viva, sessao);
          yield* registrarEvento(viva, { _tag: "Erro", mensagem: erro.message });
          yield* registrarEvento(viva, { _tag: "FimTurno", motivo: "falha" });
        }),
      ),
      Effect.ensuring(Effect.suspend(() => fecharTurno(viva, turno))),
    );

  /** Começa o turno e devolve a inscrição nos itens dele (no escopo de quem chama). */
  const comecarTurno = (viva: Viva, texto: string) =>
    viva.trava.withPermits(1)(
      Effect.gen(function* () {
        if (viva.turno !== undefined) return yield* new Motor.TurnoEmAndamento();
        const sessao = yield* abrirSessao(viva);
        yield* cancelarOciosidade(viva);
        const inscricao = yield* PubSub.subscribe(viva.aoVivo);
        const numero = viva.registro.turnos + 1;
        const turno: TurnoAberto = {
          numero,
          fibra: undefined,
          acumulado: "",
          terminou: false,
          falhou: false,
          fim: yield* Deferred.make<void>(),
        };
        viva.turno = turno;
        yield* viva.travaItens.withPermits(1)(
          registrar(viva, (ordem) => ({ _tag: "Mensagem", turno: numero, ordem, texto }), { publicar: true }),
        );
        yield* alterar(viva, {
          estado: "respondendo",
          ...(viva.registro.titulo === "" ? { titulo: derivarTitulo(texto) } : {}),
        });
        const contexto = viva.contexto;
        viva.contexto = undefined;
        turno.fibra = yield* bombear(
          viva,
          turno,
          sessao,
          contexto === undefined ? texto : `${contexto}\n\n${texto}`,
        ).pipe(Effect.forkIn(escopoDaLayer));
        return { inscricao, turno };
      }),
    );

  /** Um stream vazio que acaba quando o turno se fecha. */
  const esperarFim = (turno: TurnoAberto) => Stream.fromEffect(Deferred.await(turno.fim)).pipe(Stream.drain);

  /* ------------------------------------------------------------ conversas */

  const novaViva = Effect.fn("Conversas.novaViva")(function* (registro: RegistroConversa) {
    const viva: Viva = {
      id: registro.id,
      registro,
      sessao: undefined,
      turno: undefined,
      ociosidade: undefined,
      contexto: undefined,
      caiu: registro.estado === "caiu",
      ultimoTurnoFalhou: false,
      aoVivo: yield* PubSub.unbounded<ItemConversa>(),
      trava: yield* Semaphore.make(1),
      travaItens: yield* Semaphore.make(1),
    };
    return viva;
  });

  /** A conversa viva, carregada do banco na primeira vez; `SessaoDesconhecida` se não existe. */
  const obter = Effect.fn("Conversas.obter")(function* (id: string) {
    const viva = vivas.get(id);
    if (viva !== undefined) return viva;
    const registro = yield* historico.buscar(id);
    if (Option.isNone(registro)) return yield* new Motor.SessaoDesconhecida({ id });
    const carregada = vivas.get(id) ?? (yield* novaViva(registro.value));
    vivas.set(id, carregada);
    return carregada;
  });

  // As conversas que uma execução anterior deixou abertas: o turno pela metade se fecha e a sessão,
  // que morreu com o processo, fica liberada.
  for (const registro of yield* historico.abertas) {
    const viva = yield* novaViva(registro);
    const ultimo = (yield* historico.itens(registro.id, registro.ultimaOrdem - 1)).at(-1);
    const aberto = ultimo !== undefined && !(ultimo._tag === "EventoTurno" && ultimo.evento._tag === "FimTurno");
    if (aberto) yield* registrarEvento(viva, { _tag: "FimTurno", motivo: "interrompido" });
    yield* historico.alterar(registro.id, { estado: "liberada" });
    yield* Effect.logInfo(`conversa ${registro.id}: aberta na execução anterior; fica liberada`);
  }

  // Ao fim da layer, as sessões se liberam (os turnos em andamento terminam como interrompidos).
  yield* Effect.addFinalizer(() =>
    Effect.forEach([...vivas.values()], liberar, { discard: true, concurrency: "unbounded" }),
  );

  const iniciar = Effect.fn("Conversas.iniciar")(function* (entrada: EntradaIniciar) {
    const pasta = yield* conferirPasta(entrada.pastaTrabalho);
    const id = yield* aleatorio.uuidV4();
    yield* historico.criar({
      id,
      provider: entrada.provider,
      pastaTrabalho: pasta,
      ...(entrada.modelo === undefined ? {} : { modelo: entrada.modelo }),
      ...(entrada.buscaWeb === undefined ? {} : { buscaWeb: entrada.buscaWeb }),
      estado: "liberada",
    });
    const registro = yield* historico.buscar(id).pipe(Effect.flatMap(Effect.fromOption), Effect.orDie);
    const viva = yield* novaViva(registro);
    vivas.set(id, viva);
    yield* viva.trava
      .withPermits(1)(
        Effect.gen(function* () {
          yield* abrirSessao(viva);
          yield* alterar(viva, { estado: "pronta" });
          yield* agendarOciosidade(viva);
        }),
      )
      .pipe(
        // Sem sessão, a conversa não existe: não fica na lista.
        Effect.onError(() =>
          Effect.suspend(() => {
            vivas.delete(id);
            return historico.apagar(id);
          }),
        ),
      );
    return id;
  });

  const enviar = (id: string, texto: string) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const viva = yield* obter(id);
        const { inscricao, turno } = yield* comecarTurno(viva, texto);
        return Stream.fromSubscription(inscricao).pipe(
          Stream.filter((item) => item._tag === "EventoTurno"),
          Stream.map((item) => item.evento),
          Stream.takeUntil((evento) => evento._tag === "FimTurno"),
          // O stream acaba com o turno fechado (estado gravado): a próxima mensagem já é aceita.
          Stream.concat(esperarFim(turno)),
        );
      }),
    );

  const responderAprovacao = Effect.fn("Conversas.responderAprovacao")(function* (
    id: string,
    aprovacao: string,
    decisao: Motor.Decisao,
  ) {
    const viva = yield* obter(id);
    const sessao = viva.sessao;
    const turno = viva.turno;
    if (sessao === undefined || turno === undefined) return yield* new Motor.AprovacaoDesconhecida({ id: aprovacao });
    yield* motor
      .responderAprovacao(sessao.id, aprovacao, decisao)
      .pipe(
        Effect.catchTags({ SessaoDesconhecida: () => Effect.fail(new Motor.AprovacaoDesconhecida({ id: aprovacao })) }),
      );
    yield* viva.travaItens.withPermits(1)(
      registrar(viva, (ordem) => ({ _tag: "DecisaoAprovacao", turno: turno.numero, ordem, aprovacao, decisao }), {
        publicar: true,
      }),
    );
  });

  const interromper = Effect.fn("Conversas.interromper")(function* (id: string) {
    const viva = yield* obter(id);
    const turno = viva.turno;
    const sessao = viva.sessao;
    if (turno === undefined || sessao === undefined) return;
    yield* motor.interromper(sessao.id).pipe(Effect.catchTags({ SessaoDesconhecida: () => Effect.void }));
    // Se o provider não fechar o turno no prazo, a sessão se libera e o turno termina como interrompido.
    yield* Deferred.await(turno.fim).pipe(
      Effect.timeoutOption(opcoes.prazoInterrupcao),
      Effect.flatMap((terminou) =>
        Option.isSome(terminou) || viva.turno !== turno
          ? Effect.void
          : Effect.logWarning(
              `conversa ${id}: o provider não terminou o turno depois de interromper; sessão liberada`,
            ).pipe(Effect.andThen(liberar(viva))),
      ),
      Effect.forkIn(escopoDaLayer),
    );
  });

  const encerrar = Effect.fn("Conversas.encerrar")(function* (id: string) {
    yield* liberar(yield* obter(id));
  });

  const carregar = Effect.fn("Conversas.carregar")(function* (id: string) {
    const viva = yield* obter(id);
    return { conversa: resumo(viva.registro), itens: yield* historico.itens(id) } satisfies ConversaGravada;
  });

  const acompanhar = (id: string, depois: number) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const viva = yield* obter(id);
        // O retrato e a inscrição juntos: nenhum item cai entre os gravados e os que chegam.
        const { inscricao, gravados, turno } = yield* viva.travaItens.withPermits(1)(
          Effect.gen(function* () {
            const inscricao = yield* PubSub.subscribe(viva.aoVivo);
            const gravados = yield* historico.itens(id, depois);
            const turno = viva.turno !== undefined && !viva.turno.terminou ? viva.turno : undefined;
            const parcial: ReadonlyArray<ItemConversa> =
              turno === undefined || turno.acumulado === ""
                ? []
                : [
                    {
                      _tag: "EventoTurno",
                      turno: turno.numero,
                      ordem: viva.registro.ultimaOrdem,
                      evento: { _tag: "TextoParcial", texto: turno.acumulado },
                    },
                  ];
            return { inscricao, gravados: [...gravados, ...parcial], turno };
          }),
        );
        const anteriores = Stream.fromIterable(gravados);
        if (turno === undefined) return anteriores;
        return Stream.concat(
          anteriores,
          Stream.fromSubscription(inscricao).pipe(
            Stream.takeUntil((item) => item._tag === "EventoTurno" && item.evento._tag === "FimTurno"),
            Stream.concat(esperarFim(turno)),
          ),
        );
      }),
    );

  const retomar = Effect.fn("Conversas.retomar")(function* (id: string) {
    const viva = yield* obter(id);
    yield* viva.trava.withPermits(1)(
      Effect.gen(function* () {
        const aberta = viva.sessao !== undefined;
        yield* abrirSessao(viva);
        if (!aberta && viva.turno === undefined) {
          yield* alterar(viva, { estado: "pronta" });
          yield* agendarOciosidade(viva);
        }
      }),
    );
    return resumo(viva.registro);
  });

  return Conversas.of({
    iniciar,
    enviar,
    responderAprovacao,
    interromper,
    encerrar,
    listar: Effect.map(historico.listar, (registros) => registros.map(resumo)),
    carregar,
    acompanhar,
    retomar,
  });
});

/**
 * Pede o `Motor`, o `ServidorMcpHttp`, o `Historico`, o `FileSystem`, o `Path` e o `SecureRandom`.
 * `ociosidade`: depois de quanto tempo sem turno a sessão se libera (`OCIOSIDADE`);
 * `prazoInterrupcao`: quanto se espera pelo fim do turno interrompido (`PRAZO_INTERRUPCAO`).
 */
export const layer = (
  opcoes: { readonly ociosidade?: Duration.Duration; readonly prazoInterrupcao?: Duration.Duration } = {},
) =>
  Layer.effect(
    Conversas,
    make({
      ociosidade: opcoes.ociosidade ?? OCIOSIDADE,
      prazoInterrupcao: opcoes.prazoInterrupcao ?? PRAZO_INTERRUPCAO,
    }),
  );
