/**
 * As conversas do app: gravadas no banco (`persistencia/`), com a sessão do provider aberta pelo
 * `Motor` quando é preciso e liberada quando não é, como o `ProviderSessionManager` do T3.
 *
 * **A conversa não depende da conexão.** Ela tem um id próprio (UUID), dura no banco e não se encerra
 * quando a interface cai ou recarrega. `enviar` só abre o turno; os eventos dele passam por um fiber do
 * servidor (`bombear`), que os grava e os publica para quem acompanha (`acompanhar`: os itens gravados
 * depois de uma `ordem`, o texto parcial acumulado, o estado da conversa e, daí em diante, cada item e
 * cada mudança de estado). A interface segue a conversa só por `acompanhar`, e volta a ela, depois de
 * recarregar ou de a conexão cair, pela última `ordem` que viu; a conexão que cai não interrompe o turno.
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
 *   `parado_antes_do_envio`, sem a mensagem ter ido à IA; depois (`respondendo`), pede ao provider
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
 * **Skills do app (M1.11):** toda sessão aberta (nova, retomada ou recomeçada com o histórico) leva
 * skills do `CatalogoSkills` em `ConfigSessao.skills`: a conversa livre, todas; a de tarefa, só a da
 * tarefa. O motor grava os arquivos em `<pasta>/.simplifica/skills/` e lista as skills nas instruções da
 * sessão; regravar a cada abertura faz a conversa retomada usar a versão das skills do app que está aberto.
 *
 * **Tarefa da conversa:** a conversa aberta por um cartão guarda o `id` da tarefa (`conversas.tarefa`);
 * a conversa livre não guarda nada. `iniciar` só aceita o `id` de uma tarefa de conversa que o
 * `CatalogoTarefas` tem no canal em uso (a `experimental`, só no beta). A tarefa restringe a sessão
 * (`CatalogoTarefas.regraDaSessao`), na conversa nova e em toda reabertura: a sessão leva só a skill que a
 * tarefa cita (nenhuma, se não cita) e fica sem busca nem leitura na web se o manifesto a desliga
 * (`ConfigSessao.semWeb`). O primeiro turno que chega à IA indica a skill. As ferramentas `ifpr` vão
 * inteiras a toda sessão.
 *
 * **Fichas de contexto e origem** (`docs/plans/multitarefa.md`, "Conversa ao lado"): a mensagem leva as
 * fichas que a pessoa deixou junto, gravadas com ela e mandadas à IA num bloco depois do texto
 * (`textoDasFichas`); o arquivo de uma ficha já está na pasta. A conversa que um módulo abre (a conversa
 * ao lado de uma revisão de PPC) guarda a origem, que a lista de conversas mostra, e o módulo a troca
 * quando ela deixa de existir (`mudarOrigem`).
 *
 * **Atividades** (`docs/plans/multitarefa.md`, "Em andamento"): cada conversa publica no serviço
 * `Atividades` o que a bandeja mostra dela: respondendo, o pedido de aprovação pendente (guardado só em
 * memória), a resposta que terminou depois da última vez em que a interface a mostrou (`marcarVista`) e o
 * turno que parou na cota da assinatura. Na partida, as que terminaram sem ser vistas vêm do banco.
 *
 * **Continuar com outra IA** ("Limite da assinatura"): `iniciar` com `continuaDe` abre a conversa nova na
 * pasta e na tarefa da antiga e devolve o que vai à caixa dela, à vista: a ficha com o histórico
 * (`continuacaoDe`), as fichas da última mensagem e a última pergunta, que não é enviada.
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
  type AprovacaoPendente,
  type Atividade,
  type AvisoNaoAceito,
  type Continuacao,
  type ConversaGravada,
  type EntradaIniciar,
  type EstadoConversa,
  type EventoConversa,
  type FalhaPasta,
  type FichaContexto,
  type ItemAoVivo,
  type ItemConversa,
  type NotaResposta,
  type OrigemConversa,
  type PastaConversa,
  PastaTrabalhoInvalida,
  type PreviaApagarConversa,
  type ResultadoApagarConversa,
  type ResumoConversa,
  TarefaDesconhecida,
  type TurnoAberto as TurnoAbertoContrato,
} from "@simplifica-if/contratos-app";
import * as DateTime from "effect/DateTime";
import type { CanalDistribuicao } from "@simplifica-if/kb/canal";
import * as McpHttp from "@simplifica-if/mcp/http";
import * as Motor from "@simplifica-if/motor";
import * as Atividades from "./Atividades.ts";
import * as CatalogoSkills from "./CatalogoSkills.ts";
import * as CatalogoTarefas from "./CatalogoTarefas.ts";
import { avisoDasMudancas } from "./textos-anexos/aviso.ts";
import * as PastasTrabalho from "./PastasTrabalho.ts";
import { resumoDaFalha } from "./observabilidade/resumoDaFalha.ts";
import * as Historico from "./persistencia/Historico.ts";
import * as Preferencias from "./persistencia/Preferencias.ts";

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
    /**
     * `canal`: o canal de atualização em uso, que decide se uma tarefa `experimental` abre conversa.
     * `origem`: a de uma conversa que um módulo abre.
     */
    readonly iniciar: (
      entrada: EntradaIniciar,
      canal: CanalDistribuicao,
      origem?: OrigemConversa,
    ) => Effect.Effect<
      { readonly sessao: string; readonly continuacao?: Continuacao },
      | Motor.FalhaProvider
      | PastaTrabalhoInvalida
      | TarefaDesconhecida
      | AvisoNaoAceito
      | Motor.SessaoDesconhecida
      | Motor.TurnoEmAndamento
    >;
    /**
     * Abre o turno com a mensagem (e as fichas de contexto) e devolve o número dele e a `ordem` da mensagem;
     * o turno segue no servidor.
     */
    readonly enviar: (
      sessao: string,
      texto: string,
      fichas?: ReadonlyArray<FichaContexto>,
    ) => Effect.Effect<
      TurnoAbertoContrato,
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
    /** A interface mostrou a conversa: a resposta que terminou até agora deixa de ser "resposta pronta". */
    readonly marcarVista: (sessao: string) => Effect.Effect<void, Motor.SessaoDesconhecida>;
    /** Troca a origem (a revisão de onde a conversa nasceu foi apagada). */
    readonly mudarOrigem: (sessao: string, origem: OrigemConversa) => Effect.Effect<void, Motor.SessaoDesconhecida>;
    readonly listar: Effect.Effect<ReadonlyArray<ResumoConversa>>;
    readonly carregar: (sessao: string) => Effect.Effect<ConversaGravada, Motor.SessaoDesconhecida>;
    /**
     * A conversa ao vivo, a partir de `depois`: os itens gravados, o parcial acumulado, o estado e o que vier;
     * só termina quando a conversa é apagada.
     */
    readonly acompanhar: (sessao: string, depois: number) => Stream.Stream<ItemAoVivo, Motor.SessaoDesconhecida>;
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
    /** O que apagar a conversa tira do app e o que fica no computador. */
    readonly previaApagar: (sessao: string) => Effect.Effect<PreviaApagarConversa, Motor.SessaoDesconhecida>;
    /**
     * Apaga a conversa: o turno em andamento para e fecha, a sessão do provider se libera, e saem o
     * histórico (com as avaliações e os relatos registrados), as cópias do Desfazer e o registro que o
     * provider guarda neste computador. A pasta da tarefa fica.
     */
    readonly apagar: (sessao: string) => Effect.Effect<ResultadoApagarConversa, Motor.SessaoDesconhecida>;
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
  /** Quando o turno abriu (ISO 8601), para a bandeja dizer há quanto tempo responde. */
  readonly inicio: string;
  /** Os pedidos de aprovação sem resposta, na ordem em que chegaram, com a hora de cada um. */
  readonly aprovacoes: Array<{ readonly pedido: AprovacaoPendente; readonly em: string }>;
  /** O provider avisou a cota da assinatura neste turno (um `Erro` de tipo `cota`). */
  cota: boolean;
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
  /**
   * O último turno terminou (com resposta, ou na cota) depois da última vez em que a interface mostrou a
   * conversa; sai com `marcarVista` e com o turno seguinte.
   */
  fimNaoVisto: { readonly em: string; readonly limite: boolean } | undefined;
  readonly aoVivo: PubSub.PubSub<ItemAoVivo>;
  /** Abrir e fechar a sessão e começar o turno, um de cada vez. */
  readonly trava: Semaphore.Semaphore;
  /**
   * A conversa foi apagada (marcado com a `trava`): quem esperava a trava (um turno novo, o Desfazer, a
   * liberação por ociosidade) não grava nada nela.
   */
  apagada: boolean;
  /** Concluído ao apagar: os `acompanhar` em curso terminam. */
  readonly encerrada: Deferred.Deferred<void>;
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
    if (item._tag === "Mensagem") {
      const fichas = textoDasFichas(item.fichas ?? []);
      turnos.set(item.turno, {
        pessoa: fichas === undefined ? item.texto : `${item.texto}\n\n${fichas}`,
        respostas: [],
      });
    } else if (item._tag === "EventoTurno" && item.evento._tag === "TextoFinal") {
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

/**
 * As fichas de contexto como vão à IA, depois do texto da pessoa: o link da base (lido pelas ferramentas
 * `ifpr`), o arquivo da pasta e o texto, cada um com o rótulo que a pessoa viu.
 */
export function textoDasFichas(fichas: ReadonlyArray<FichaContexto>): string | undefined {
  if (fichas.length === 0) return undefined;
  const linhas = fichas.map((ficha) => {
    switch (ficha._tag) {
      case "link":
        return `- Documento da base, “${ficha.rotulo}”: ${ficha.link} (leia pelas ferramentas \`${NOME_MCP}\`).${ficha.texto === undefined ? "" : ` ${ficha.texto}`}`;
      case "arquivo":
        return `- Arquivo da pasta da conversa, “${ficha.rotulo}”: \`${ficha.arquivo}\`.${ficha.texto === undefined ? "" : ` ${ficha.texto}`}`;
      case "texto":
        return `- ${ficha.rotulo}:\n\n${ficha.texto
          .split("\n")
          .map((linha) => `  > ${linha}`)
          .join("\n")}`;
    }
  });
  return ["O que a pessoa deixou junto desta mensagem (fichas de contexto):", ...linhas].join("\n");
}

/** O nome curto da IA nos textos que a conversa grava ("Histórico da conversa com o Claude"). */
const NOME_IA: Readonly<Record<Motor.Provider, string>> = {
  claude: "Claude",
  codex: "ChatGPT",
  antigravity: "Gemini",
};

/** O título da conversa na bandeja: o da primeira mensagem, entre aspas. */
const tituloDaAtividade = (titulo: string): string => (titulo === "" ? "Conversa sem título" : `Conversa “${titulo}”`);

/**
 * O que vai à caixa da conversa que continua `itens` com outra IA: a última pergunta (a que parou no
 * limite) e as fichas dela, e, antes, a ficha com o histórico dos turnos anteriores, das mensagens mais
 * recentes até `LIMITE_CONTEXTO`, que diz quantas mensagens leva e se as mais antigas ficaram de fora.
 */
export function continuacaoDe(itens: ReadonlyArray<ItemConversa>, provider: Motor.Provider): Continuacao {
  const turnos = new Map<number, { pessoa: string; respostas: Array<string> }>();
  let ultima: Extract<ItemConversa, { _tag: "Mensagem" }> | undefined;
  const naCota = new Set<number>();
  for (const item of itens) {
    if (item._tag === "Mensagem") {
      ultima = item;
      const fichas = textoDasFichas(item.fichas ?? []);
      turnos.set(item.turno, {
        pessoa: fichas === undefined ? item.texto : `${item.texto}\n\n${fichas}`,
        respostas: [],
      });
    } else if (item._tag === "EventoTurno" && item.evento._tag === "TextoFinal") {
      turnos.get(item.turno)?.respostas.push(item.evento.texto);
    } else if (item._tag === "EventoTurno" && item.evento._tag === "Erro" && item.evento.tipo === "cota") {
      naCota.add(item.turno);
    }
  }
  // Só a pergunta que parou no limite volta à caixa; a que foi respondida depois dele fica no histórico.
  if (ultima !== undefined && !naCota.has(ultima.turno)) ultima = undefined;
  if (ultima !== undefined) turnos.delete(ultima.turno);
  const blocos: Array<string> = [];
  let tamanho = 0;
  let mensagens = 0;
  const anteriores = [...turnos.values()].reverse();
  for (const turno of anteriores) {
    const resposta = turno.respostas.join("\n\n");
    const bloco = `Pessoa: ${turno.pessoa}\n\nIA: ${resposta || "(sem resposta)"}`;
    if (tamanho + bloco.length > LIMITE_CONTEXTO && blocos.length > 0) break;
    blocos.unshift(bloco);
    tamanho += bloco.length;
    mensagens += resposta === "" ? 1 : 2;
  }
  const nome = NOME_IA[provider];
  const deFora = blocos.length < anteriores.length ? "; as mais antigas ficam de fora" : "";
  const historico: ReadonlyArray<FichaContexto> =
    blocos.length === 0
      ? []
      : [
          {
            _tag: "texto",
            rotulo: `Histórico da conversa com o ${nome} (${mensagens === 1 ? "1 mensagem" : `${mensagens} mensagens`}${deFora})`,
            texto: [
              `Esta conversa continua outra, com o ${nome}, que parou no limite da assinatura. O que se disse nela:`,
              blocos.join("\n\n---\n\n"),
            ].join("\n\n"),
          },
        ];
  return { fichas: [...historico, ...(ultima?.fichas ?? [])], pergunta: ultima?.texto ?? "" };
}

const make = Effect.fn("Conversas.make")(function* (opcoes: {
  readonly ociosidade: Duration.Duration;
  readonly prazoInterrupcao: Duration.Duration;
}) {
  const motor = yield* Motor.Motor;
  const mcp = yield* McpHttp.ServidorMcpHttp;
  const historico = yield* Historico.Historico;
  const catalogo = yield* CatalogoSkills.CatalogoSkills;
  const tarefas = yield* CatalogoTarefas.CatalogoTarefas;
  const pastas = yield* PastasTrabalho.PastasTrabalho;
  const atividades = yield* Atividades.Atividades;
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
    ...(registro.origem === undefined ? {} : { origem: registro.origem }),
    ...(registro.continuadaCom === undefined ? {} : { continuadaCom: registro.continuadaCom }),
  });

  const agora = Effect.map(DateTime.now, DateTime.formatIso);

  /** A atividade de uma conversa (`Atividades`): o id e o que a leva até ela. */
  const atividadeDe = (
    id: string,
    titulo: string,
    provider: Motor.Provider,
  ): Pick<Atividade, "id" | "titulo" | "rota" | "provider"> => ({
    id: `conversa:${id}`,
    titulo: tituloDaAtividade(titulo),
    rota: `/conversa?id=${id}`,
    provider,
  });

  /**
   * Publica o que a bandeja mostra da conversa agora: o pedido de aprovação pendente, o turno em andamento
   * ou o fim que ninguém viu; sem nada disso, a conversa sai das atividades.
   */
  // `fnUntraced`: ajudante por mudança do turno, coberto pelo span da operação que a provoca.
  // O estado é lido na vez das `Atividades`: a publicação atrasada não recoloca a conversa apagada.
  const atualizarAtividade = (viva: Viva) =>
    atividades.atualizar(
      `conversa:${viva.id}`,
      Effect.sync((): Atividade | undefined => {
        if (viva.apagada) return undefined;
        const base = atividadeDe(viva.id, viva.registro.titulo, viva.registro.provider);
        const turno = viva.turno;
        if (turno !== undefined && !turno.fechado) {
          const pendente = turno.aprovacoes[0];
          return pendente === undefined
            ? { ...base, situacao: "andamento", desde: turno.inicio }
            : { ...base, situacao: "permissao", desde: pendente.em, aprovacao: pendente.pedido };
        }
        const fim = viva.fimNaoVisto;
        return fim === undefined ? undefined : { ...base, situacao: fim.limite ? "limite" : "pronta", desde: fim.em };
      }),
    );

  // `fnUntraced`: ajudante por mudança de estado da conversa, coberto pelo span da operação que a provoca.
  const alterar = Effect.fnUntraced(function* (viva: Viva, alteracao: Historico.Alteracao) {
    const antes = viva.registro.estado;
    yield* historico.alterar(viva.id, alteracao);
    const atual = yield* historico.buscar(viva.id);
    if (Option.isSome(atual)) viva.registro = atual.value;
    // Quem acompanha recebe o estado novo: a interface não o deduz dos eventos.
    if (viva.registro.estado !== antes)
      yield* PubSub.publish(viva.aoVivo, { _tag: "Estado", estado: viva.registro.estado });
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
      if (evento._tag === "Erro" && evento.tipo === "cota") turno.cota = true;
      if (evento._tag === "PedidoAprovacao")
        turno.aprovacoes.push({
          pedido: {
            conversa: viva.id,
            id: evento.id,
            ferramenta: evento.ferramenta,
            tipo: evento.tipo,
            descricao: evento.descricao,
          },
          em: yield* agora,
        });
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
    if (turno !== undefined && evento._tag === "PedidoAprovacao") yield* atualizarAtividade(viva);
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
    // A liberação abre o próprio trace: o fiber nasce no span do pedido que agendou, já terminado.
    viva.ociosidade = yield* Effect.sleep(opcoes.ociosidade).pipe(
      Effect.andThen(
        Effect.suspend(() => {
          viva.ociosidade = undefined;
          if (viva.turno !== undefined) return Effect.void;
          return Effect.logInfo(
            `conversa ${viva.id}: sessão liberada depois de ${Duration.format(opcoes.ociosidade)} ociosa`,
          ).pipe(Effect.andThen(liberar(viva)));
        }).pipe(Effect.withSpan("Conversas.liberarOciosa", { root: true })),
      ),
      Effect.forkIn(escopoDaLayer),
    );
  });

  /**
   * Libera a sessão do provider: um turno em andamento termina como interrompido, o processo morre e
   * o token do MCP é revogado. A conversa fica `liberada` (ou `caiu`, se foi queda).
   */
  const liberar = (viva: Viva) => viva.trava.withPermits(1)(Effect.suspend(() => soltar(viva)));

  /** O corpo do `liberar`, para quem já segura a `trava` (o `apagar`). */
  const soltar = Effect.fnUntraced(function* (viva: Viva) {
    if (viva.apagada) return;
    // Sem a sessão antes de fechar o turno: o turno interrompido não agenda a ociosidade.
    const sessao = viva.sessao;
    viva.sessao = undefined;
    yield* cancelarOciosidade(viva);
    const turno = viva.turno;
    // Espera a fibra do turno terminar, com os finalizadores (o retrato da pasta e o `FimTurno` gravados).
    if (turno?.fibra !== undefined) yield* Fiber.interrupt(turno.fibra);
    if (sessao !== undefined) {
      // O provider pode ter trocado o id nativo no meio da sessão (o Claude o manda em cada mensagem): a
      // retomada e o apagar no provider usam o atual.
      const info = yield* motor.infoSessao(sessao.id).pipe(Effect.option);
      const idNativo = Option.isSome(info) ? info.value.idNativo : undefined;
      if (idNativo !== undefined && idNativo !== viva.registro.idNativo) yield* alterar(viva, { idNativo });
      yield* fecharSessao(sessao);
    }
    if (viva.registro.estado !== estadoEmRepouso(viva)) yield* alterar(viva, { estado: estadoEmRepouso(viva) });
  });

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
        yield* Effect.logWarning(`conversa ${viva.id}: o processo do provider caiu: ${resumoDaFalha(falha)}`);
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
    const servidor: Motor.ServidorMcp = {
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
    // A conversa de tarefa leva só a skill da tarefa e a web que o manifesto deixa; a livre, tudo. A regra
    // é a da tarefa com que a conversa nasceu, lida a cada abertura da sessão (nova ou retomada).
    const regra = registro.tarefa === undefined ? undefined : tarefas.regraDaSessao(registro.tarefa);
    const skills =
      regra === undefined ? catalogo.skills : catalogo.skills.filter((skill) => skill.nome === regra.skill);
    const config: Motor.ConfigSessao = {
      provider: registro.provider,
      pastaTrabalho: pasta,
      servidoresMcp: [servidor],
      ...(registro.modelo === undefined ? {} : { modelo: registro.modelo }),
      ...(registro.esforco === undefined ? {} : { esforco: registro.esforco }),
      ...(skills.length === 0 ? {} : { skills }),
      // A skill retirada sai também de `.simplifica/skills/`, onde uma sessão de antes a gravou.
      ...(catalogo.retiradas.size === 0 ? {} : { skillsRetiradas: [...catalogo.retiradas].sort() }),
      // A coluna guarda o "sem web" com que a conversa nasceu: o manifesto que sumiu ou chegou inválido não a religa.
      ...(registro.semWeb || regra?.web === false ? { semWeb: true } : {}),
    };
    const abrir =
      registro.idNativo === undefined
        ? motor.iniciarSessao(config)
        : motor.iniciarSessao({ ...config, retomar: registro.idNativo }).pipe(
            Effect.tap(() => Effect.logInfo(`conversa ${viva.id}: sessão retomada no provider`)),
            Effect.catch((falha) =>
              Effect.gen(function* () {
                // O provider não retomou: sessão nova, com o histórico gravado como contexto.
                yield* Effect.logWarning(
                  `conversa ${viva.id}: a retomada falhou; recomeça com o histórico: ${resumoDaFalha(falha)}`,
                );
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
    // A queda abre o próprio trace: o vigia nasce no span do pedido que abriu a sessão, já terminado.
    sessao.vigia = yield* info.queda.pipe(
      Effect.flatMap((falha) => aoCair(viva, sessao, falha).pipe(Effect.withSpan("Conversas.aoCair", { root: true }))),
      Effect.forkIn(escopoDaLayer),
    );
    // O id, não a pasta: o nome dela vem do pedido da pessoa.
    yield* Effect.logInfo(`conversa ${viva.id} (${rotulo}): sessão aberta`);
    return sessao;
  });

  /* ------------------------------------------------------------ turno */

  /**
   * Fecha o turno com o `FimTurno` dado, uma vez por turno. Primeiro a pasta (`PastasTrabalho.fecharTurno`:
   * o retrato do fim e o aviso confirmado, ou a cópia descartada se a mensagem não chegou à IA), fora da
   * região ininterrupta, porque o retrato lê cada arquivo e cede a quem libera a sessão. Ela vem antes do
   * `FimTurno`: a interface dá o turno por acabado quando o recebe, e o retrato não pode deixar a conversa
   * `respondendo` depois disso. Depois, sem interrupção, o turno sai da conversa e o estado em repouso é
   * gravado, e só então o `FimTurno` é publicado e o `fim` concluído: quem o recebe já encontra a
   * conversa aceitando outra mensagem. A `travaItens` segura a mensagem nova até o `FimTurno` ficar gravado.
   */
  const concluirTurno = (viva: Viva, turno: TurnoAberto, fimTurno: Motor.Evento) =>
    Effect.suspend(() => {
      if (turno.fechado) return Effect.void;
      return pastas
        .fecharTurno(viva.id, turno.numero, viva.registro.pastaTrabalho, { chegouAIA: turno.fase === "respondendo" })
        .pipe(Effect.ensuring(fecharNaConversa(viva, turno, fimTurno)));
    }).pipe(Effect.withSpan("Conversas.concluirTurno"));

  const fecharNaConversa = Effect.fnUntraced(function* (viva: Viva, turno: TurnoAberto, fimTurno: Motor.Evento) {
    if (turno.fechado) return;
    yield* viva.travaItens.withPermits(1)(
      Effect.gen(function* () {
        turno.fechado = true;
        viva.ultimoTurnoFalhou = turno.falhou;
        if (viva.turno === turno) viva.turno = undefined;
        // A resposta que ninguém viu terminar, ou o turno que parou na cota, fica na bandeja até ser vista.
        // Antes do `FimTurno`: a tela que o recebe marca a conversa como vista, e isso vem depois.
        const motivo = fimTurno._tag === "FimTurno" ? fimTurno.motivo : undefined;
        const limite = motivo === "falha" && turno.cota;
        if (motivo === "concluido" || limite) viva.fimNaoVisto = { em: yield* agora, limite };
        yield* alterar(viva, { estado: estadoEmRepouso(viva) });
        yield* gravarEvento(viva, turno, fimTurno);
        yield* atualizarAtividade(viva);
      }),
    );
    yield* Deferred.succeed(turno.fim, undefined);
    yield* agendarOciosidade(viva);
  }, Effect.uninterruptible);

  /** Os eventos do turno, do motor para o banco e para quem acompanha. Roda no escopo da layer. */
  const bombear = (viva: Viva, turno: TurnoAberto, sessao: SessaoAberta, texto: string) =>
    motor.enviarMensagem(sessao.id, texto).pipe(
      Stream.runForEach((evento) =>
        Effect.suspend(() => {
          // Depois do `FimTurno`, o turno já está fechado e a conversa pode ter outro: nada mais é dele.
          if (turno.fechado) return Effect.void;
          if (evento._tag !== "FimTurno") return registrarEvento(viva, evento);
          return concluirTurno(viva, turno, evento);
        }),
      ),
      Effect.catch((erro) =>
        Effect.gen(function* () {
          if (turno.fechado) {
            yield* Effect.logWarning(
              `conversa ${viva.id}: o provider falhou depois do fim do turno: ${resumoDaFalha(erro)}`,
            );
            return;
          }
          // A falha do provider (inclusive a queda do processo) vira `Erro` e `FimTurno`: a conversa
          // continua, e a próxima mensagem reabre a sessão se for preciso.
          yield* Effect.logWarning(`conversa ${viva.id}: o turno falhou: ${resumoDaFalha(erro)}`);
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
          yield* concluirTurno(viva, turno, { _tag: "FimTurno", motivo: "falha" });
        }),
      ),
    );

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
          item.evento.motivo !== "parado_antes_do_envio",
      );
    }
    return viva.chegouAIA;
  });

  /**
   * O turno inteiro, na fibra dele: o preparo (a cópia da pasta para o Desfazer, os textos e o que a
   * pessoa mexeu na pasta), a troca para `respondendo` e o envio à IA (`bombear`). O preparo corre contra
   * o sinal `parar`: o "Parar" o interrompe (o Worker de uma conversão em andamento se encerra), e o
   * turno fecha sem a mensagem ter ido à IA. O turno que acaba sem `FimTurno` (o "Parar" no preparo, a
   * sessão liberada ou encerrada, o app que fecha) fecha como parado, se a mensagem não foi à IA, ou como
   * interrompido.
   */
  const executarTurno = Effect.fn("Conversas.executarTurno")(
    function* (
      viva: Viva,
      turno: TurnoAberto,
      sessao: SessaoAberta,
      texto: string,
      fichas: ReadonlyArray<FichaContexto>,
    ) {
      const mudancas = yield* pastas
        .abrirTurno(viva.id, turno.numero, viva.registro.pastaTrabalho)
        .pipe(Effect.raceFirst(Deferred.await(turno.parar).pipe(Effect.as(undefined))));
      // A troca de fase num passo só, sem `yield`: o `interromper` confere e marca do mesmo jeito. A sessão
      // que caiu no preparo (o vigia a derrubou) também deixa o turno no preparo: a mensagem não vai a uma
      // sessão encerrada.
      const passo = yield* Effect.sync(() => {
        if (turno.parado) return "parado" as const;
        if (viva.sessao !== sessao) return "caiu" as const;
        turno.fase = "respondendo";
        return "segue" as const;
      });
      if (passo === "parado") return;
      // O turno fecha com o erro da queda, como no meio da resposta.
      if (passo === "caiu") {
        const queda = yield* sessao.queda.pipe(Effect.timeoutOption(Duration.seconds(1)));
        yield* registrarEvento(
          viva,
          Option.isSome(queda)
            ? { _tag: "Erro", tipo: queda.value.tipo, mensagem: Motor.diagnosticoDaFalha(queda.value) }
            : { _tag: "Erro", tipo: "queda", mensagem: "a sessão da IA terminou antes de a mensagem sair" },
        );
        turno.falhou = true;
        yield* concluirTurno(viva, turno, { _tag: "FimTurno", motivo: "falha" });
        return;
      }
      // A mensagem vai à IA com o aviso das mudanças (que o fechamento do turno dá por confirmado).
      if (mudancas !== undefined) yield* registrarEvento(viva, mudancas);
      const primeiro = !(yield* jaChegouAIA(viva));
      viva.chegouAIA = true;
      const contexto = viva.contexto;
      viva.contexto = undefined;
      // A tarefa com skill (M1.9): o primeiro turno que chega à IA diz qual skill seguir, a mesma que a
      // sessão leva. Só vai ao provider; o histórico guarda a mensagem como a pessoa a escreveu.
      const tarefa = viva.registro.tarefa;
      const skill = tarefa === undefined ? undefined : tarefas.regraDaSessao(tarefa).skill;
      const contextoFichas = textoDasFichas(fichas);
      const comFichas = contextoFichas === undefined ? texto : `${texto}\n\n${contextoFichas}`;
      const comMudancas = mudancas === undefined ? comFichas : `${comFichas}\n\n${avisoDasMudancas(mudancas)}`;
      const pedido =
        primeiro && skill !== undefined
          ? `Siga a skill \`${skill}\` (SKILL.md em .simplifica/skills/${skill}/) para este pedido.\n\n${comMudancas}`
          : comMudancas;
      yield* bombear(viva, turno, sessao, contexto === undefined ? pedido : `${contexto}\n\n${pedido}`);
    },
    (efeito, viva, turno) =>
      efeito.pipe(
        Effect.ensuring(
          Effect.suspend(() =>
            concluirTurno(viva, turno, {
              _tag: "FimTurno",
              motivo: turno.fase === "preparando" ? "parado_antes_do_envio" : "interrompido",
            }),
          ),
        ),
      ),
  );

  /** Começa o turno e devolve o número dele e a `ordem` da mensagem gravada. */
  const comecarTurno = (viva: Viva, texto: string, fichas: ReadonlyArray<FichaContexto>) =>
    viva.trava.withPermits(1)(
      Effect.gen(function* () {
        if (viva.apagada) return yield* new Motor.SessaoDesconhecida({ id: viva.id });
        if (viva.turno !== undefined) return yield* new Motor.TurnoEmAndamento();
        const sessao = yield* abrirSessao(viva);
        yield* cancelarOciosidade(viva);
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
          fechado: false,
          falhou: false,
          inicio: yield* agora,
          aprovacoes: [],
          cota: false,
          fim: yield* Deferred.make<void>(),
        };
        viva.turno = turno;
        viva.fimNaoVisto = undefined;
        yield* viva.travaItens.withPermits(1)(
          registrar(
            viva,
            (ordem) => ({
              _tag: "Mensagem",
              turno: numero,
              ordem,
              texto,
              ...(fichas.length === 0 ? {} : { fichas: [...fichas] }),
            }),
            { publicar: true },
          ),
        );
        yield* alterar(viva, {
          estado: "respondendo",
          ...(viva.registro.titulo === "" ? { titulo: derivarTitulo(texto) } : {}),
        });
        const ordem = viva.registro.ultimaOrdem;
        yield* atualizarAtividade(viva);
        // O turno abre o próprio trace: o pedido de `enviar` termina assim que ele abre, e a caixa-preta
        // ignora o que chega depois para um trace já descartado.
        turno.fibra = yield* executarTurno(viva, turno, sessao, texto, fichas).pipe(
          Effect.withSpan("Conversas.turno", { root: true }),
          Effect.forkIn(escopoDaLayer),
        );
        return { turno: numero, ordem } satisfies TurnoAbertoContrato;
      }),
    );

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
      fimNaoVisto: undefined,
      aoVivo: yield* PubSub.unbounded<ItemAoVivo>(),
      trava: yield* Semaphore.make(1),
      travaItens: yield* Semaphore.make(1),
      apagada: false,
      encerrada: yield* Deferred.make<void>(),
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

  // As respostas que terminaram sem ser vistas numa execução anterior voltam à bandeja.
  for (const naoVista of yield* historico.naoVistas) {
    yield* atividades.publicar({
      ...atividadeDe(naoVista.id, naoVista.titulo, naoVista.provider),
      situacao: naoVista.limite ? "limite" : "pronta",
      desde: naoVista.terminouEm,
    });
  }

  // Ao fim da layer, as sessões se liberam (os turnos em andamento terminam como interrompidos).
  yield* Effect.addFinalizer(() =>
    Effect.forEach([...vivas.values()], liberar, { discard: true, concurrency: "unbounded" }),
  );

  const iniciar = Effect.fn("Conversas.iniciar")(function* (
    entrada: EntradaIniciar,
    canal: CanalDistribuicao,
    origem?: OrigemConversa,
  ) {
    yield* exigirAviso;
    // A continuação fica na pasta e na tarefa da antiga (a tarefa que saiu do catálogo não a impede: a nova
    // fica livre).
    const antiga = entrada.continuaDe === undefined ? undefined : yield* obter(entrada.continuaDe);
    if (antiga?.apagada === true) return yield* new Motor.SessaoDesconhecida({ id: antiga.id });
    // A que ainda responde não parou no limite: continua depois que o turno dela termina.
    if (antiga?.turno !== undefined) return yield* new Motor.TurnoEmAndamento();
    const daAntiga = antiga?.registro.tarefa;
    // Só uma tarefa de conversa do catálogo do canal: a skill dela entra numa instrução do app à IA, e a
    // experimental fora do beta não abre conversa (a regra de `tarefas.listar`).
    const tarefa =
      antiga === undefined
        ? entrada.tarefa
        : daAntiga !== undefined && tarefas.recusaDeConversa(daAntiga, canal) === undefined
          ? daAntiga
          : undefined;
    const recusa = tarefa === undefined ? undefined : tarefas.recusaDeConversa(tarefa, canal);
    if (tarefa !== undefined && recusa !== undefined) return yield* new TarefaDesconhecida({ tarefa, motivo: recusa });
    const pasta = yield* conferirPasta(antiga?.registro.pastaTrabalho ?? entrada.pastaTrabalho);
    const origemEfetiva = origem ?? antiga?.registro.origem;
    const id = yield* aleatorio.uuidV4();
    yield* historico.criar({
      id,
      provider: entrada.provider,
      pastaTrabalho: pasta,
      ...(entrada.modelo === undefined ? {} : { modelo: entrada.modelo }),
      ...(entrada.esforco === undefined ? {} : { esforco: entrada.esforco }),
      ...(tarefa === undefined ? {} : { tarefa }),
      // O "sem web" da antiga vale na continuação, mesmo que a tarefa dela tenha saído do catálogo.
      ...(antiga?.registro.semWeb === true || (tarefa !== undefined && !tarefas.regraDaSessao(tarefa).web)
        ? { semWeb: true }
        : {}),
      // A continuação fica com a origem da antiga (a conversa ao lado da revisão continua ao lado dela).
      ...(origemEfetiva === undefined ? {} : { origem: origemEfetiva }),
      ...(antiga === undefined ? {} : { continuaDe: antiga.id }),
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
        // Nada ficou fora do banco: a sessão não abriu, e nenhum turno guardou cópia.
        Effect.onError(() =>
          Effect.suspend(() => {
            vivas.delete(id);
            return historico.apagar(id).pipe(Effect.andThen(historico.concluirApagamento(id)));
          }),
        ),
      );
    if (antiga === undefined) return { sessao: id };
    antiga.registro = { ...antiga.registro, continuadaCom: { id, provider: entrada.provider } };
    return { sessao: id, continuacao: continuacaoDe(yield* historico.itens(antiga.id), antiga.registro.provider) };
  });

  const enviar = Effect.fn("Conversas.enviar")(function* (
    id: string,
    texto: string,
    fichas: ReadonlyArray<FichaContexto> = [],
  ) {
    yield* exigirAviso;
    return yield* comecarTurno(yield* obter(id), texto, fichas);
  });

  // Na `travaItens`: nem cai entre o fim do turno e o `FimTurno` gravado, nem depois de a conversa sair do banco.
  const marcarVista = Effect.fn("Conversas.marcarVista")(function* (id: string) {
    const viva = yield* obter(id);
    yield* viva.travaItens.withPermits(1)(
      Effect.gen(function* () {
        if (viva.apagada) return yield* new Motor.SessaoDesconhecida({ id });
        yield* historico.marcarVista(id);
        viva.fimNaoVisto = undefined;
        yield* atualizarAtividade(viva);
      }),
    );
  });

  const mudarOrigem = Effect.fn("Conversas.mudarOrigem")(function* (id: string, origem: OrigemConversa) {
    const viva = yield* obter(id);
    if (viva.apagada) return yield* new Motor.SessaoDesconhecida({ id });
    yield* historico.mudarOrigem(id, origem);
    viva.registro = { ...viva.registro, origem };
  });

  const responderAprovacao = Effect.fn("Conversas.responderAprovacao")(function* (
    id: string,
    aprovacao: string,
    decisao: Motor.Decisao,
  ) {
    const viva = yield* obter(id);
    if (viva.apagada) return yield* new Motor.SessaoDesconhecida({ id });
    const sessao = viva.sessao;
    const turno = viva.turno;
    if (sessao === undefined || turno === undefined) return yield* new Motor.AprovacaoDesconhecida({ id: aprovacao });
    yield* motor
      .responderAprovacao(sessao.id, aprovacao, decisao)
      .pipe(
        Effect.catchTags({ SessaoDesconhecida: () => Effect.fail(new Motor.AprovacaoDesconhecida({ id: aprovacao })) }),
      );
    // A conversa pode ter sido apagada enquanto o motor respondia: a decisão não vai a um registro que saiu.
    yield* viva.travaItens.withPermits(1)(
      Effect.gen(function* () {
        if (viva.apagada) return yield* new Motor.SessaoDesconhecida({ id });
        yield* registrar(
          viva,
          (ordem) => ({ _tag: "DecisaoAprovacao", turno: turno.numero, ordem, aprovacao, decisao }),
          { publicar: true },
        );
        const indice = turno.aprovacoes.findIndex((pendente) => pendente.pedido.id === aprovacao);
        if (indice >= 0) turno.aprovacoes.splice(indice, 1);
        yield* atualizarAtividade(viva);
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
    // O prazo corre depois do fim do pedido: abre o próprio trace.
    yield* Deferred.await(turno.fim).pipe(
      Effect.timeoutOption(opcoes.prazoInterrupcao),
      Effect.flatMap((terminou) =>
        Option.isSome(terminou) || viva.turno !== turno
          ? Effect.void
          : Effect.logWarning(
              `conversa ${id}: o provider não terminou o turno depois de interromper; sessão liberada`,
            ).pipe(Effect.andThen(liberar(viva))),
      ),
      Effect.withSpan("Conversas.prazoInterrupcao", { root: true }),
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
        // O retrato e a inscrição juntos: nenhum item cai entre os gravados e os que chegam. A inscrição
        // vem antes do estado: uma mudança no meio chega pela inscrição (repetida, sem efeito).
        const { inscricao, retrato } = yield* viva.travaItens.withPermits(1)(
          Effect.gen(function* () {
            const inscricao = yield* PubSub.subscribe(viva.aoVivo);
            const gravados = yield* historico.itens(id, depois);
            const turno = viva.turno !== undefined && !viva.turno.terminou ? viva.turno : undefined;
            const parcial: ReadonlyArray<ItemAoVivo> =
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
            const estado: ItemAoVivo = { _tag: "Estado", estado: viva.registro.estado };
            return { inscricao, retrato: [...gravados, ...parcial, estado] };
          }),
        );
        return Stream.concat(Stream.fromIterable(retrato), Stream.fromSubscription(inscricao)).pipe(
          Stream.interruptWhen(Deferred.await(viva.encerrada)),
        );
      }),
    );

  const avaliar = Effect.fn("Conversas.avaliar")(function* (id: string, turno: number, nota: NotaResposta | null) {
    if ((yield* obter(id)).apagada) return yield* new Motor.SessaoDesconhecida({ id });
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
        if (viva.apagada) return yield* new Motor.SessaoDesconhecida({ id });
        if (viva.turno !== undefined) return yield* new Motor.TurnoEmAndamento();
        return yield* pastas.desfazer(id, viva.registro.pastaTrabalho, incluirForaDaConversa);
      }),
    );
  });

  const previaApagar = Effect.fn("Conversas.previaApagar")(function* (id: string) {
    const viva = yield* obter(id);
    const pastaTrabalho = viva.registro.pastaTrabalho;
    const [doHistorico, relatos, pasta] = yield* Effect.all([
      historico.previa(id),
      historico.relatos(id),
      pastas.ver(id, pastaTrabalho).pipe(Effect.option),
    ]);
    return {
      respondendo: viva.turno !== undefined,
      mensagens: doHistorico.mensagens,
      anexos: doHistorico.anexos,
      pasta: {
        caminho: pastaTrabalho,
        gerida: pasta._tag === "Some" && pasta.value.gerida,
        compartilhada: doHistorico.pastaCompartilhada,
        arquivos: pasta._tag === "Some" ? pasta.value.arquivos.length : 0,
      },
      relatos: relatos.flatMap((relato) => (relato.arquivo === null ? [] : [relato.arquivo])),
    } satisfies PreviaApagarConversa;
  });

  /**
   * O que ficou fora do banco de uma conversa apagada: as cópias do Desfazer e o registro do provider. A
   * pendência sai quando os dois saem; senão, conta a tentativa e espera a próxima partida do servidor.
   */
  const limparFora = Effect.fn("Conversas.limparFora")(function* (pendente: Historico.ApagamentoPendente) {
    const copias = yield* pastas.esquecer(pendente.conversa);
    const transcricao: ResultadoApagarConversa["transcricao"] =
      pendente.idNativo === null
        ? "nenhuma"
        : (yield* motor.esquecer(pendente.provider, pendente.idNativo, pendente.pastaTrabalho))
          ? "apagada"
          : "ficou";
    if (copias && transcricao !== "ficou") yield* historico.concluirApagamento(pendente.conversa);
    else {
      yield* historico.registrarTentativaApagamento(pendente.conversa);
      yield* Effect.logWarning(
        `conversa ${pendente.conversa}: ficou o que apagar fora do banco (tentativa ${pendente.tentativas + 1}); tenta de novo na próxima partida`,
      );
    }
    return transcricao;
  });

  /**
   * Na `trava`: o turno para (a fibra termina com o retrato e o `FimTurno`) e a sessão fecha; a conversa
   * sai da memória e do banco, que guarda na mesma transação o que falta apagar fora dele; então as cópias
   * do Desfazer e, com o processo do provider já morto, o registro dele (`limparFora`). Um pedido que
   * esperava a trava encontra a conversa `apagada`.
   */
  const apagar = Effect.fn("Conversas.apagar")(function* (id: string) {
    const viva = yield* obter(id);
    const pendente = yield* viva.trava.withPermits(1)(
      Effect.gen(function* () {
        if (viva.apagada) return yield* new Motor.SessaoDesconhecida({ id });
        yield* soltar(viva);
        // Na `travaItens`: o que grava na conversa fora da `trava` (a decisão de aprovação, a vista) a
        // encontra inteira ou já apagada.
        const pendente = yield* viva.travaItens.withPermits(1)(
          Effect.gen(function* () {
            viva.apagada = true;
            yield* Deferred.succeed(viva.encerrada, undefined);
            const pendente = yield* historico.apagar(id);
            vivas.delete(id);
            yield* atualizarAtividade(viva);
            return pendente;
          }),
        );
        // A conversa que esta continuava deixa de apontar para ela.
        for (const outra of vivas.values())
          if (outra.registro.continuadaCom?.id === id) {
            const atual = yield* historico.buscar(outra.id);
            if (Option.isSome(atual)) outra.registro = atual.value;
          }
        return pendente;
      }),
    );
    yield* Effect.logInfo(`conversa ${id}: apagada`);
    if (pendente === null) return { transcricao: "nenhuma" } satisfies ResultadoApagarConversa;
    return { transcricao: yield* limparFora(pendente) } satisfies ResultadoApagarConversa;
  });

  // O que ficou por apagar fora do banco de uma execução anterior (o provider recusou, o app fechou no
  // meio): tenta de novo, em segundo plano, porque abrir o provider para apagar pode levar segundos.
  yield* Effect.gen(function* () {
    for (const pendente of yield* historico.apagamentosPendentes) yield* limparFora(pendente);
  }).pipe(Effect.withSpan("Conversas.retomarApagamentos", { root: true }), Effect.forkIn(escopoDaLayer));

  return Conversas.of({
    avaliar,
    pasta,
    desfazer,
    previaApagar,
    apagar,
    iniciar,
    enviar,
    responderAprovacao,
    interromper,
    encerrar,
    mudarOrigem,
    marcarVista,
    listar: Effect.map(historico.listar, (registros) => registros.map(resumo)),
    carregar,
    acompanhar,
  });
});

/**
 * Pede o `Motor`, o `ServidorMcpHttp`, o `Historico`, as `Preferencias`, as `Atividades`, o
 * `CatalogoSkills`, o `CatalogoTarefas`, o `FileSystem`, o `Path` e o `SecureRandom`.
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
