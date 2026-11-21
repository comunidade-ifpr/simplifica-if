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
 * - Na próxima mensagem, a sessão se reabre pela retomada do provider
 *   (`ConfigSessao.retomar` com o id nativo). Se o provider não retomar (sem `session/load` no `agy`,
 *   transcrição apagada), abre-se uma sessão nova, e a próxima mensagem leva o histórico gravado como
 *   contexto.
 * - **Queda do processo do provider:** o motor avisa (`infoSessao().queda`). No meio de um turno, o
 *   turno termina com `Erro` e `FimTurno` (motivo `falha`); fora dele, grava-se o `Erro`. A conversa
 *   fica `caiu`, e a próxima mensagem a reabre pela retomada.
 * - **Turno e interromper:** o turno abre antes do preparo (a cópia da pasta e os textos), na fase
 *   `preparando`, como o `starting` do T3 Code. Nessa fase, interromper para o preparo e fecha o turno com
 *   `MOTIVO_PARADO_ANTES_DO_ENVIO`, sem a mensagem ter ido à IA; depois (`respondendo`), pede ao provider
 *   que pare, e se o turno não terminar em `PRAZO_INTERRUPCAO`, a sessão se libera e o turno termina como
 *   interrompido. Em todo caso a conversa aceita novo turno.
 * - Ao fim da layer (o app fechou), as sessões se liberam, e um turno em andamento termina como
 *   interrompido. Na abertura, as conversas que o banco dá como abertas (o servidor morreu sem
 *   fechar) passam a `liberada`, com o turno pela metade fechado do mesmo jeito.
 *
 * O `TextoParcial` não se grava: ao fechar o turno, o texto parcial que não ganhou `TextoFinal` vira
 * um `TextoFinal` no banco, e quem acompanha um turno em andamento recebe o texto parcial acumulado
 * num `TextoParcial` só.
 *
 * A política de aprovação (M1.7) fica no motor: aqui só chegam os pedidos que ela manda perguntar.
 *
 * **Aviso de uso (M1.8):** nada vai à IA antes do aviso aceito. `iniciar` e `enviar`, que
 * abrem a sessão do provider ou mandam a mensagem, recusam com `AvisoNaoAceito` antes de tudo.
 *
 * **Skills do app (M1.11):** toda sessão aberta (nova, retomada ou recomeçada com o histórico) leva as
 * skills do `CatalogoSkills` em `ConfigSessao.skills`. O motor grava os arquivos em
 * `<pasta>/.simplifica/skills/` e lista as skills nas instruções da sessão; regravar a cada abertura
 * faz a conversa retomada usar a versão das skills do app que está aberto.
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
  type AvisoNaoAceito,
  type ConversaGravada,
  type EntradaIniciar,
  type EstadoConversa,
  type EventoConversa,
  type FalhaPasta,
  type ItemConversa,
  MOTIVO_PARADO_ANTES_DO_ENVIO,
  type NotaResposta,
  type PastaConversa,
  PastaTrabalhoInvalida,
  type ResumoConversa,
  TarefaDesconhecida,
} from "@simplifica-if/contratos-app";
import * as McpHttp from "@simplifica-if/mcp/http";
import * as Motor from "@simplifica-if/motor";
import * as CatalogoSkills from "./CatalogoSkills.ts";
import { avisoDasMudancas } from "./textos-anexos/aviso.ts";
import * as PastasTrabalho from "./PastasTrabalho.ts";
import * as Historico from "./persistencia/Historico.ts";
import * as Preferencias from "./persistencia/Preferencias.ts";

/** O nome do servidor MCP na sessão do provider: as ferramentas chegam como `ifpr.<ferramenta>`. */
export const NOME_MCP = "ifpr";

/** A tarefa da caixa livre do Início ("O que você precisa hoje?"): conversa sem skill indicada. */
export const TAREFA_CONVERSA = "conversa";

/** Depois de quanto tempo sem turno a sessão do provider se libera (o T3 usa 30 minutos). */
export const OCIOSIDADE = Duration.minutes(30);

/** Quanto se espera pelo fim do turno depois de pedir a interrupção, antes de liberar a sessão. */
export const PRAZO_INTERRUPCAO = Duration.seconds(15);

/** O tamanho máximo do histórico levado como contexto quando a retomada não é possível. */
const LIMITE_CONTEXTO = 24_000;

export class Conversas extends Context.Service<
  Conversas,
  {
    readonly iniciar: (
      entrada: EntradaIniciar,
    ) => Effect.Effect<string, Motor.FalhaProvider | PastaTrabalhoInvalida | TarefaDesconhecida | AvisoNaoAceito>;
    readonly enviar: (
      sessao: string,
      texto: string,
    ) => Stream.Stream<
      EventoConversa,
      Motor.FalhaProvider | Motor.TurnoEmAndamento | Motor.SessaoDesconhecida | AvisoNaoAceito
    >;
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
    /** 👍/👎 na resposta do turno; `null` retira. */
    readonly avaliar: (
      sessao: string,
      turno: number,
      nota: NotaResposta | null,
    ) => Effect.Effect<void, Motor.SessaoDesconhecida>;
    /** A pasta de trabalho da conversa: os arquivos e a previsão do Desfazer. */
    readonly pasta: (sessao: string) => Effect.Effect<PastaConversa, Motor.SessaoDesconhecida | FalhaPasta>;
    /** Restaura a cópia da pasta de antes do último turno que a mudou; recusa com turno em andamento. */
    readonly desfazer: (
      sessao: string,
      incluirForaDaConversa: boolean,
    ) => Effect.Effect<PastaConversa, Motor.SessaoDesconhecida | Motor.TurnoEmAndamento | FalhaPasta>;
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
  /**
   * `preparando`: a cópia da pasta e os textos, antes de a mensagem ir à IA; `respondendo`: a IA já a
   * recebeu. O `interromper` e a fibra do turno conferem e trocam a fase num passo só, sem `yield` no
   * meio: um "Parar" no preparo nunca deixa a mensagem chegar à IA.
   */
  fase: "preparando" | "respondendo";
  /** O "Parar" chegou no preparo (o `interromper` o marca junto com a fase). */
  parado: boolean;
  /** O sinal do "Parar" no preparo: interrompe a cópia e as conversões em andamento. */
  readonly parar: Deferred.Deferred<void>;
  fibra: Fiber.Fiber<void> | undefined;
  /** O texto parcial desde o último `TextoFinal`. */
  acumulado: string;
  /** O `FimTurno` já foi gravado. */
  terminou: boolean;
  /** O turno terminou com falha do provider (já gravou o `Erro`). */
  falhou: boolean;
  /** O retrato da pasta no fim do turno (`PastasTrabalho.fecharTurno`) já foi feito. */
  retratado: boolean;
  /** O turno saiu da conversa (`concluirTurno`): o estado em repouso e o `FimTurno` estão gravados. */
  fechado: boolean;
  readonly fim: Deferred.Deferred<void>;
}

/** Uma conversa em memória: o registro do banco e o que vive enquanto o servidor vive. */
interface Viva {
  readonly id: string;
  registro: Historico.RegistroConversa;
  sessao: SessaoAberta | undefined;
  turno: TurnoAberto | undefined;
  ociosidade: Fiber.Fiber<void> | undefined;
  /** O histórico a levar na próxima mensagem, quando a retomada não foi possível. */
  contexto: string | undefined;
  /** Algum turno já levou a mensagem à IA (`undefined`: ainda não lido do histórico). */
  chegouAIA: boolean | undefined;
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

const make = Effect.fn("Conversas.make")(function* (opcoes: {
  readonly ociosidade: Duration.Duration;
  readonly prazoInterrupcao: Duration.Duration;
}) {
  const motor = yield* Motor.Motor;
  const mcp = yield* McpHttp.ServidorMcpHttp;
  const historico = yield* Historico.Historico;
  const catalogo = yield* CatalogoSkills.CatalogoSkills;
  const pastas = yield* PastasTrabalho.PastasTrabalho;
  const { exigirAviso } = yield* Preferencias.Preferencias;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const aleatorio = yield* SecureRandom.SecureRandom;
  const escopoDaLayer = yield* Effect.scope;
  const vivas = new Map<string, Viva>();
  let sequencia = 0;

  /* ------------------------------------------------------------ registro */

  const resumo = (registro: Historico.RegistroConversa): ResumoConversa => ({
    id: registro.id,
    provider: registro.provider,
    pastaTrabalho: registro.pastaTrabalho,
    ...(registro.modelo === undefined ? {} : { modelo: registro.modelo }),
    titulo: registro.titulo,
    estado: registro.estado,
    turnos: registro.turnos,
    criadaEm: registro.criadaEm,
    atualizadaEm: registro.atualizadaEm,
    ...(registro.tarefa === undefined ? {} : { tarefa: registro.tarefa }),
  });

  // `fnUntraced`: ajudante por mudança de estado da conversa, coberto pelo span da operação que a provoca.
  const alterar = Effect.fnUntraced(function* (viva: Viva, alteracao: Historico.Alteracao) {
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

  /**
   * Um evento do `turno` (o aberto, ou nenhum): o parcial se acumula e se publica; o resto se grava e
   * se publica. Chame com a `travaItens`.
   */
  const gravarEvento = Effect.fnUntraced(function* (
    viva: Viva,
    turno: TurnoAberto | undefined,
    evento: EventoConversa,
  ) {
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
  });

  /** Um evento do turno aberto (ou de fora de turno), com a `travaItens`. */
  const registrarEvento = (viva: Viva, evento: EventoConversa) =>
    viva.travaItens
      .withPermits(1)(Effect.suspend(() => gravarEvento(viva, viva.turno, evento)))
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
        if (!viva.ultimoTurnoFalhou)
          yield* registrarEvento(viva, { _tag: "Erro", tipo: falha.tipo, mensagem: Motor.diagnosticoDaFalha(falha) });
        yield* alterar(viva, { estado: "caiu" });
      }),
    );

  /** Abre a sessão do provider, pela retomada se a conversa já tem id nativo. Chame com a `trava`. */
  const abrirSessao = Effect.fn("Conversas.abrirSessao")(function* (viva: Viva) {
    if (viva.sessao !== undefined) return viva.sessao;
    const registro = viva.registro;
    const pasta = yield* conferirPasta(registro.pastaTrabalho).pipe(
      // A pasta de trabalho não existe mais.
      Effect.mapError(
        (cause) =>
          new Motor.FalhaProvider({ provider: registro.provider, operacao: "retomar", tipo: "desconhecido", cause }),
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
      ...(registro.esforco === undefined ? {} : { esforco: registro.esforco }),
      ...(catalogo.skills.length === 0 ? {} : { skills: catalogo.skills }),
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

  /**
   * Fecha o turno com o `FimTurno` dado, nesta ordem: o turno sai da conversa e o estado em repouso é
   * gravado, e só então o `FimTurno` é publicado e o `fim` concluído. Quem recebe o `FimTurno` (a
   * interface) já encontra a conversa aceitando outra mensagem, mesmo que o stream do provider ainda
   * não tenha acabado. A `travaItens` segura a mensagem nova até o `FimTurno` ficar gravado.
   */
  const concluirTurno = Effect.fn("Conversas.concluirTurno")(function* (
    viva: Viva,
    turno: TurnoAberto,
    fimTurno: Motor.Evento,
  ) {
    if (turno.fechado) return;
    yield* viva.travaItens.withPermits(1)(
      Effect.gen(function* () {
        turno.fechado = true;
        viva.ultimoTurnoFalhou = turno.falhou;
        if (viva.turno === turno) viva.turno = undefined;
        yield* alterar(viva, { estado: estadoEmRepouso(viva) });
        yield* gravarEvento(viva, turno, fimTurno);
      }),
    );
    yield* Deferred.succeed(turno.fim, undefined);
    yield* agendarOciosidade(viva);
  }, Effect.uninterruptible);

  /**
   * O retrato da pasta no fim do turno (o Desfazer separa o que a IA fez do que mudou depois), uma vez
   * por turno. Vem antes do `FimTurno`: a interface dá o turno por acabado quando o recebe, e o retrato
   * (que lê cada arquivo da pasta) não pode deixar a conversa `respondendo` depois disso.
   */
  // Sem span próprio: o `PastasTrabalho.fecharTurno` já tem o dele.
  const retratarPasta = Effect.fnUntraced(function* (viva: Viva, turno: TurnoAberto) {
    if (turno.retratado) return;
    yield* pastas.fecharTurno(viva.id, turno.numero, viva.registro.pastaTrabalho);
    turno.retratado = true;
  });

  /** Os eventos do turno, do motor para o banco e para quem acompanha. Roda no escopo da layer. */
  const bombear = (viva: Viva, turno: TurnoAberto, sessao: SessaoAberta, texto: string) =>
    motor.enviarMensagem(sessao.id, texto).pipe(
      Stream.runForEach((evento) =>
        Effect.suspend(() => {
          // Depois do `FimTurno`, o turno já está fechado e a conversa pode ter outro: nada mais é dele.
          if (turno.fechado) return Effect.void;
          if (evento._tag !== "FimTurno") return registrarEvento(viva, evento);
          return retratarPasta(viva, turno).pipe(Effect.ensuring(concluirTurno(viva, turno, evento)));
        }),
      ),
      Effect.catch((erro) =>
        Effect.gen(function* () {
          if (turno.fechado) {
            yield* Effect.logWarning(`conversa ${viva.id}: o provider falhou depois do fim do turno`, erro);
            return;
          }
          // A falha do provider (inclusive a queda do processo) vira `Erro` e `FimTurno`: a conversa
          // continua, e a próxima mensagem reabre a sessão se for preciso.
          yield* Effect.logWarning(`conversa ${viva.id}: o turno falhou`, erro);
          turno.falhou = true;
          // Se foi queda do processo (o driver a avisa antes de falhar o turno), a sessão sai já, e o
          // turno fecha com a conversa `caiu`.
          const caiu = yield* sessao.queda.pipe(Effect.timeoutOption(Duration.seconds(1)));
          if (Option.isSome(caiu)) yield* derrubar(viva, sessao);
          yield* registrarEvento(viva, {
            _tag: "Erro",
            tipo: erro._tag === "FalhaProvider" ? erro.tipo : "desconhecido",
            mensagem: Motor.diagnosticoDaFalha(erro),
          });
          yield* retratarPasta(viva, turno).pipe(
            Effect.ensuring(concluirTurno(viva, turno, { _tag: "FimTurno", motivo: "falha" })),
          );
        }),
      ),
    );

  /**
   * O turno inteiro, na fibra dele: o preparo (a cópia da pasta para o Desfazer, os textos e o que a
   * pessoa mexeu na pasta), a troca para `respondendo` e o envio à IA (`bombear`). O preparo corre contra
   * o sinal `parar`: o "Parar" o interrompe (o Worker de uma conversão em andamento se encerra), e o
   * turno fecha sem a mensagem ter ido à IA.
   */
  /**
   * Algum turno já levou a mensagem à IA? O primeiro que leva é o que indica a skill da tarefa; um turno
   * parado no preparo não conta. Lido do histórico uma vez por conversa viva.
   */
  const jaChegouAIA = Effect.fnUntraced(function* (viva: Viva) {
    if (viva.chegouAIA === undefined) {
      const itens = yield* historico.itens(viva.id);
      viva.chegouAIA = itens.some(
        (item) =>
          item._tag === "EventoTurno" &&
          item.evento._tag === "FimTurno" &&
          item.evento.motivo !== MOTIVO_PARADO_ANTES_DO_ENVIO,
      );
    }
    return viva.chegouAIA;
  });

  /**
   * O turno que acaba sem `FimTurno` (o "Parar" no preparo, a sessão liberada ou encerrada, o app que
   * fecha): no preparo, a mensagem não foi à IA, a cópia dele sai (o próximo compara a pasta com o último
   * turno que chegou à IA) e ele fecha como parado; depois, o retrato que faltar e o turno interrompido.
   * Dois finalizadores em cada caso: o turno fecha mesmo que o descarte ou o retrato morra.
   */
  const fecharSemFim = (viva: Viva, turno: TurnoAberto) =>
    Effect.suspend(() => {
      if (turno.fechado) return Effect.void;
      if (turno.fase === "preparando") {
        turno.retratado = true;
        return pastas
          .descartarCopia(viva.id, turno.numero)
          .pipe(
            Effect.ensuring(concluirTurno(viva, turno, { _tag: "FimTurno", motivo: MOTIVO_PARADO_ANTES_DO_ENVIO })),
          );
      }
      return retratarPasta(viva, turno).pipe(
        Effect.ensuring(concluirTurno(viva, turno, { _tag: "FimTurno", motivo: "interrompido" })),
      );
    });

  /**
   * O turno inteiro, na fibra dele: o preparo (a cópia da pasta para o Desfazer, os textos e o que a
   * pessoa mexeu na pasta), a troca para `respondendo` e o envio à IA (`bombear`). O preparo corre contra
   * o sinal `parar`: o "Parar" o interrompe (o Worker de uma conversão em andamento se encerra), e o
   * turno fecha sem a mensagem ter ido à IA (`fecharSemFim`).
   */
  const executarTurno = Effect.fn("Conversas.executarTurno")(
    function* (viva: Viva, turno: TurnoAberto, sessao: SessaoAberta, texto: string) {
      const mudancas = yield* pastas
        .guardarCopia(viva.id, turno.numero, viva.registro.pastaTrabalho)
        .pipe(Effect.raceFirst(Deferred.await(turno.parar).pipe(Effect.as(undefined))));
      // A troca de fase num passo só, sem `yield`: o `interromper` confere e marca do mesmo jeito.
      const segue = yield* Effect.sync(() => {
        if (turno.parado) return false;
        turno.fase = "respondendo";
        return true;
      });
      if (!segue) return;
      // A sessão caiu durante o preparo (o vigia a derrubou): a mensagem não vai a uma sessão encerrada, e o
      // turno fecha com o erro da queda, como no meio da resposta.
      if (viva.sessao !== sessao) {
        const queda = yield* sessao.queda.pipe(Effect.timeoutOption(Duration.seconds(1)));
        yield* registrarEvento(
          viva,
          Option.isSome(queda)
            ? { _tag: "Erro", tipo: queda.value.tipo, mensagem: Motor.diagnosticoDaFalha(queda.value) }
            : { _tag: "Erro", tipo: "queda", mensagem: "a sessão da IA terminou antes de a mensagem sair" },
        );
        turno.falhou = true;
        yield* retratarPasta(viva, turno).pipe(
          Effect.ensuring(concluirTurno(viva, turno, { _tag: "FimTurno", motivo: "falha" })),
        );
        return;
      }
      // A mensagem vai à IA: o aviso das mudanças fica dado (os textos do índice deixam de estar pendentes).
      if (mudancas !== undefined) yield* registrarEvento(viva, mudancas);
      yield* pastas.confirmarAviso(viva.registro.pastaTrabalho);
      const primeiro = !(yield* jaChegouAIA(viva));
      viva.chegouAIA = true;
      const contexto = viva.contexto;
      viva.contexto = undefined;
      // A tarefa de uma skill (M1.9): o primeiro turno que chega à IA diz qual skill seguir. Só vai ao
      // provider; o histórico guarda a mensagem como a pessoa a escreveu.
      const tarefa = viva.registro.tarefa;
      const comMudancas = mudancas === undefined ? texto : `${texto}\n\n${avisoDasMudancas(mudancas)}`;
      const pedido =
        primeiro && tarefa !== undefined && tarefa !== TAREFA_CONVERSA
          ? `Siga a skill \`${tarefa}\` (SKILL.md em .simplifica/skills/${tarefa}/) para este pedido.\n\n${comMudancas}`
          : comMudancas;
      yield* bombear(viva, turno, sessao, contexto === undefined ? pedido : `${contexto}\n\n${pedido}`);
    },
    (efeito, viva, turno) => efeito.pipe(Effect.ensuring(fecharSemFim(viva, turno))),
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
        // O turno abre antes do preparo (a cópia da pasta e os textos, em `executarTurno`), para o "Parar"
        // ter o que interromper desde a mensagem.
        const turno: TurnoAberto = {
          numero,
          fase: "preparando",
          parado: false,
          parar: yield* Deferred.make<void>(),
          fibra: undefined,
          acumulado: "",
          terminou: false,
          retratado: false,
          fechado: false,
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
        turno.fibra = yield* executarTurno(viva, turno, sessao, texto).pipe(Effect.forkIn(escopoDaLayer));
        return { inscricao, turno };
      }),
    );

  /** Um stream vazio que acaba quando o turno se fecha. */
  const esperarFim = (turno: TurnoAberto) => Stream.fromEffect(Deferred.await(turno.fim)).pipe(Stream.drain);

  /* ------------------------------------------------------------ conversas */

  const novaViva = Effect.fn("Conversas.novaViva")(function* (registro: Historico.RegistroConversa) {
    const viva: Viva = {
      id: registro.id,
      registro,
      sessao: undefined,
      turno: undefined,
      ociosidade: undefined,
      contexto: undefined,
      chegouAIA: undefined,
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
    yield* exigirAviso;
    // O nome da tarefa entra numa instrução do app à IA: só uma skill do catálogo ou `conversa`.
    const tarefa = entrada.tarefa;
    if (tarefa !== undefined && tarefa !== TAREFA_CONVERSA && !catalogo.skills.some((skill) => skill.nome === tarefa))
      return yield* new TarefaDesconhecida({ tarefa });
    const pasta = yield* conferirPasta(entrada.pastaTrabalho);
    const id = yield* aleatorio.uuidV4();
    yield* historico.criar({
      id,
      provider: entrada.provider,
      pastaTrabalho: pasta,
      ...(entrada.modelo === undefined ? {} : { modelo: entrada.modelo }),
      ...(entrada.esforco === undefined ? {} : { esforco: entrada.esforco }),
      ...(entrada.tarefa === undefined ? {} : { tarefa: entrada.tarefa }),
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
        yield* exigirAviso;
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
    if (turno === undefined) return;
    // No preparo, a mensagem ainda não foi à IA: o turno para sem ela (a fibra confere `parado` antes de
    // enviar, no mesmo passo em que troca a fase). Vale também com a sessão já caída.
    const noPreparo = yield* Effect.sync(() => {
      if (turno.fase !== "preparando") return false;
      turno.parado = true;
      return true;
    });
    if (noPreparo) return yield* Deferred.succeed(turno.parar, undefined);
    const sessao = viva.sessao;
    if (sessao === undefined) return;
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
    return {
      conversa: resumo(viva.registro),
      itens: yield* historico.itens(id),
      avaliacoes: yield* historico.avaliacoes(id),
    } satisfies ConversaGravada;
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

  const avaliar = Effect.fn("Conversas.avaliar")(function* (id: string, turno: number, nota: NotaResposta | null) {
    yield* obter(id);
    yield* historico.avaliar(id, turno, nota);
  });

  const pasta = Effect.fn("Conversas.pasta")(function* (id: string) {
    const viva = yield* obter(id);
    return yield* pastas.ver(id, viva.registro.pastaTrabalho);
  });

  const desfazer = Effect.fn("Conversas.desfazer")(function* (id: string, incluirForaDaConversa: boolean) {
    const viva = yield* obter(id);
    return yield* viva.trava.withPermits(1)(
      Effect.gen(function* () {
        if (viva.turno !== undefined) return yield* new Motor.TurnoEmAndamento();
        return yield* pastas.desfazer(id, viva.registro.pastaTrabalho, incluirForaDaConversa);
      }),
    );
  });

  return Conversas.of({
    avaliar,
    pasta,
    desfazer,
    iniciar,
    enviar,
    responderAprovacao,
    interromper,
    encerrar,
    listar: Effect.map(historico.listar, (registros) => registros.map(resumo)),
    carregar,
    acompanhar,
  });
});

/**
 * Pede o `Motor`, o `ServidorMcpHttp`, o `Historico`, as `Preferencias`, o `CatalogoSkills`, o
 * `FileSystem`, o `Path` e o `SecureRandom`.
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
