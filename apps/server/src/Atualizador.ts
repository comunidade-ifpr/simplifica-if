/**
 * O serviço de atualização da base, das skills e do catálogo de tarefas no servidor (M1.10).
 *
 * - **Quando confere:** na abertura (logo depois de o servidor subir) e a cada 24 horas, no canal
 *   gravado (`atualizacao.json`) ou no padrão da política; "Procurar agora" confere na hora.
 * - **O que faz:** baixa e confere em segundo plano (`@simplifica-if/atualizacao/remoto`) e deixa a base, as skills
 *   e o catálogo de tarefas pendentes. A troca é na próxima abertura (`local.ts`); "Aplicar agora" e "Voltar" pedem ao
 *   desktop para reiniciar o servidor, e se recusam (adiam) enquanto há trabalho em andamento no servidor
 *   (`Opcoes.ocupado`: uma revisão de PPC, uma conversa respondendo, uma operação na pasta da tarefa).
 * - **Desligado** quando a política não tem feed ou chave pública (a hospedagem e a chave de produção
 *   ainda não estão no app) ou quando a base vem de fora (`SIMPLIFICA_KB`): o estado diz o motivo.
 */
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as HttpClient from "effect/http/HttpClient";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import type {
  CanalAtualizacao,
  EstadoAtualizacao,
  ResultadoTroca,
  SituacaoAtualizacao,
} from "@simplifica-if/contratos-app";
import type { Abertura } from "@simplifica-if/atualizacao/local";
import {
  caminhos,
  type EstadoGravado,
  gravarEstado,
  lerEstado,
  lerInfoBanco,
  versaoDaPastaSkills,
} from "@simplifica-if/atualizacao/local";
import type { ChavePublica } from "@simplifica-if/atualizacao/minisign";
import { atualizarUmaVez, type Resultado } from "@simplifica-if/atualizacao/remoto";

export interface Opcoes {
  /** `null`: atualização desligada, com o motivo. */
  readonly desligada: string | null;
  /** O feed da política (URL com `{canal}` ou pasta). */
  readonly feed: string | null;
  readonly chave: ChavePublica | null;
  readonly canalPadrao: CanalAtualizacao;
  /** A pasta do app (`atualizacao.json`, `base/`, `skills/`). */
  readonly pasta: string;
  readonly bancoEmpacotado: string;
  readonly versaoApp: string;
  /** O que `prepararAbertura` decidiu nesta abertura. */
  readonly abertura: Abertura;
  /** Versões das skills disponíveis (empacotadas e baixadas), por nome. */
  readonly versoesSkills: ReadonlyMap<string, string>;
  /** As skills retiradas que o app conhece (as do instalador e as baixadas): nenhuma se baixa. */
  readonly skillsRetiradas?: ReadonlySet<string>;
  /** Há trabalho em andamento no servidor (revisão de PPC, conversa respondendo, operação na pasta)? A troca espera. */
  readonly ocupado: Effect.Effect<boolean>;
  /** Prazo de cada download (padrão: o de `@simplifica-if/atualizacao/remoto`). */
  readonly prazo?: Duration.Input;
  /** Conferir na abertura e depois no intervalo (padrão: sim). */
  readonly automatico?: boolean;
}

export class Atualizador extends Context.Service<
  Atualizador,
  {
    readonly estado: Effect.Effect<EstadoAtualizacao>;
    /**
     * O canal em uso (o gravado ou o padrão da política), da memória: sem ler a pasta de atualização nem
     * abrir banco, para quem só precisa dele a cada chamada (`tarefas.listar`). Muda com `trocarCanal`.
     */
    readonly canal: Effect.Effect<CanalAtualizacao>;
    readonly procurar: Effect.Effect<EstadoAtualizacao>;
    readonly trocarCanal: (canal: CanalAtualizacao) => Effect.Effect<EstadoAtualizacao>;
    readonly aplicar: Effect.Effect<ResultadoTroca>;
    readonly voltar: Effect.Effect<ResultadoTroca>;
    readonly novidadesVistas: Effect.Effect<EstadoAtualizacao>;
  }
>()("@simplifica-if/server/Atualizador") {}

/**
 * Há algo esperando a próxima abertura: a base, as skills ou o catálogo de tarefas baixados, ou uma
 * retirada de skill em uso nesta execução (`retiradas`), que só sai do catálogo quando o servidor reiniciar.
 */
const haPendente = (gravado: EstadoGravado, retiradas: RetiradasPendentes | null): boolean =>
  gravado.pendente !== undefined ||
  gravado.skillsPendentes !== undefined ||
  gravado.catalogoPendente !== undefined ||
  retiradas !== null;

/** As skills em uso que a última conferência achou retiradas, com a versão do manifesto. */
type RetiradasPendentes = NonNullable<Resultado["retiradasPendentes"]>;

interface Memoria {
  readonly situacao: SituacaoAtualizacao;
  readonly erro: string | null;
  readonly aviso: string | null;
}

export const make = Effect.fn("Atualizador.make")(function* (opcoes: Opcoes) {
  const memoria = yield* Ref.make<Memoria>({ situacao: "parada", erro: null, aviso: null });
  // Fica entre as conferências: só a abertura seguinte tira a skill retirada do catálogo em memória.
  const retiradas = yield* Ref.make<RetiradasPendentes | null>(null);
  // Serializa as conferências (os downloads, de até minutos).
  const uma = yield* Semaphore.make(1);
  // A trava curta do `atualizacao.json`: cada leitura-modificação-gravação dele, as da tela e as da
  // conferência (`Contexto.travaEstado`), sem nunca esperar um download.
  const travaEstado = yield* Semaphore.make(1);
  // O download e a pasta: os métodos do serviço não pedem nada a quem os chama.
  const servicos = yield* Effect.context<HttpClient.HttpClient | FileSystem.FileSystem | Path.Path>();
  const c = caminhos(opcoes.pasta);

  // Sem pasta de atualização, nada vai ao disco: o estado gravado é vazio, e o canal fica só na memória
  // (um caminho vazio seria o `atualizacao.json` do diretório corrente).
  const semPasta = opcoes.pasta === "";
  const lerGravado = semPasta
    ? Effect.succeed<EstadoGravado>({})
    : lerEstado(opcoes.pasta).pipe(Effect.provideContext(servicos));
  // Uma falha ao gravar o `atualizacao.json` é defeito: a pasta do app é do próprio app.
  const gravar = (novo: EstadoGravado) =>
    semPasta ? Effect.void : gravarEstado(opcoes.pasta, novo).pipe(Effect.provideContext(servicos), Effect.orDie);
  /** Lê, altera e grava o `atualizacao.json` na trava curta. */
  const alterarGravado = (alterar: (gravado: EstadoGravado) => EstadoGravado | undefined) =>
    travaEstado.withPermits(1)(
      Effect.gen(function* () {
        const novo = alterar(yield* lerGravado);
        if (novo !== undefined) yield* gravar(novo);
      }),
    );
  // O canal fica na memória: o `atualizacao.json` só o muda por `trocarCanal`, neste processo.
  const canalEmUso = yield* Ref.make<CanalAtualizacao>((yield* lerGravado).canal ?? opcoes.canalPadrao);
  const canalAtual = Ref.get(canalEmUso);

  /**
   * A versão para onde "Voltar" leva: a anterior baixada ou, sem ela, a empacotada. Nenhuma quando é a
   * versão de que se acabou de voltar (a recusada): voltar de novo seria ir para a frente.
   */
  const versaoParaVoltar = Effect.gen(function* () {
    if (opcoes.abertura.origem !== "baixada") return null;
    const anterior = lerInfoBanco(c.anterior)?.versao ?? lerInfoBanco(opcoes.bancoEmpacotado)?.versao ?? null;
    return anterior !== null && anterior === (yield* lerGravado).recusada ? null : anterior;
  });

  const estado = Effect.gen(function* () {
    const m = yield* Ref.get(memoria);
    const gravado = yield* lerGravado;
    const retiradasPendentes = yield* Ref.get(retiradas);
    const info = opcoes.abertura.info;
    const situacao: SituacaoAtualizacao =
      m.situacao === "parada" && haPendente(gravado, retiradasPendentes) ? "pronta" : m.situacao;
    return {
      desligada: opcoes.desligada,
      canal: yield* canalAtual,
      situacao,
      erro: m.erro,
      aviso: m.aviso,
      versaoApp: opcoes.versaoApp,
      base: {
        versao: info?.versao ?? "desconhecida",
        dataReferencia: info?.dataReferencia ?? null,
        commit: info?.commit ?? null,
        origem:
          opcoes.desligada !== null && opcoes.abertura.origem === "empacotada" ? "externa" : opcoes.abertura.origem,
      },
      anterior: gravado.voltar === true ? null : yield* versaoParaVoltar,
      pendente: gravado.pendente?.versao ?? null,
      skills: gravado.skills === undefined ? "empacotadas" : versaoDaPastaSkills(gravado.skills),
      // Para a pessoa, skills novas, catálogo novo e skill retirada são a mesma coisa: "tarefas novas".
      skillsPendentes:
        (gravado.skillsPendentes === undefined ? undefined : versaoDaPastaSkills(gravado.skillsPendentes)) ??
        gravado.catalogoPendente ??
        retiradasPendentes?.versao ??
        null,
      ultimaConferencia: gravado.ultimaConferencia ?? null,
      manifestoGeradoEm: gravado.manifestoGeradoEm ?? null,
      novidades:
        gravado.novidades !== undefined && !gravado.novidades.vista
          ? { versao: gravado.novidades.versao, itens: gravado.novidades.itens }
          : null,
    } satisfies EstadoAtualizacao;
  });

  const conferir = Effect.gen(function* () {
    if (opcoes.desligada !== null || opcoes.feed === null || opcoes.chave === null) return;
    const canal = yield* canalAtual;
    const feed = opcoes.feed;
    const chave = opcoes.chave;
    yield* Ref.set(memoria, { situacao: "conferindo", erro: null, aviso: null });
    const resultado = yield* atualizarUmaVez({
      feed,
      canal,
      chave,
      pasta: opcoes.pasta,
      versaoApp: opcoes.versaoApp,
      abertura: opcoes.abertura,
      versoesSkills: opcoes.versoesSkills,
      ...(opcoes.skillsRetiradas === undefined ? {} : { skillsRetiradas: opcoes.skillsRetiradas }),
      ...(opcoes.prazo === undefined ? {} : { prazo: opcoes.prazo }),
      travaEstado,
      // O canal trocado no meio: o que esta conferência baixou não se põe no lugar.
      vale: Effect.map(canalAtual, (emUso) => emUso === canal),
    }).pipe(Effect.provideContext(servicos), Effect.result);
    if (resultado._tag === "Failure") {
      // A mensagem vem dos atributos do erro (o host, nunca a URL do feed): vai ao log e à interface.
      const erro = resultado.failure;
      yield* Effect.logWarning(`atualização: ${erro.message}`).pipe(Effect.annotateLogs({ erro: erro._tag }));
      yield* Ref.set(memoria, { situacao: "erro", erro: erro.message, aviso: null });
      return;
    }
    const r = resultado.success;
    yield* Ref.set(retiradas, r.retiradasPendentes ?? null);
    if (r.tipo === "descartada" || (yield* canalAtual) !== canal) {
      // A tela já mostra o canal novo: o aviso de app velho e o "baixada" do canal antigo não valem.
      yield* Effect.logInfo(`atualização: o canal mudou para ${yield* canalAtual} durante a conferência do ${canal}`);
      yield* Ref.set(memoria, { situacao: "parada", erro: null, aviso: null });
      return;
    }
    if (r.retiradasPendentes !== undefined) {
      yield* Effect.logInfo(
        `atualização: skills retiradas em uso, saem quando o app reiniciar: ${r.retiradasPendentes.skills.join(", ")}`,
      );
    }
    for (const aviso of r.avisos ?? []) yield* Effect.logWarning(`atualização: ${aviso}`);
    const avisoDaPasta =
      r.avisos === undefined ? null : `A conferência terminou com um problema na pasta do app: ${r.avisos.join("; ")}.`;
    if (r.tipo === "app-desatualizado") {
      yield* Ref.set(memoria, {
        situacao: "parada",
        erro: null,
        aviso: [
          `A base ${r.versao} pede o app ${r.appMinimo} ou mais novo. Atualize o app para receber a base nova.`,
          avisoDaPasta,
        ]
          .filter((parte) => parte !== null)
          .join(" "),
      });
      return;
    }
    if (r.tipo === "baixada") {
      yield* Effect.logInfo(
        `atualização: ${r.versao} baixada (base: ${r.via}; skills: ${r.skills}; catálogo de tarefas: ${r.catalogo ? "novo" : "o mesmo"})`,
      );
    }
    yield* Ref.set(memoria, { situacao: "parada", erro: null, aviso: avisoDaPasta });
  });

  const procurar = uma.withPermits(1)(conferir).pipe(Effect.andThen(estado));

  const trocar = Effect.fn("Atualizador.trocar")(function* (pedido: "aplicar" | "voltar") {
    const gravado = yield* lerGravado;
    if (pedido === "aplicar" && !haPendente(gravado, yield* Ref.get(retiradas))) {
      return { resultado: "nada", mensagem: "Não há atualização baixada esperando." } satisfies ResultadoTroca;
    }
    if (pedido === "voltar" && opcoes.abertura.origem !== "baixada") {
      return { resultado: "nada", mensagem: "A base em uso já é a que veio com o app." } satisfies ResultadoTroca;
    }
    if (pedido === "voltar" && (yield* versaoParaVoltar) === null) {
      return {
        resultado: "nada",
        mensagem: "A versão anterior é a de que você acabou de voltar. Espere uma versão mais nova da base.",
      } satisfies ResultadoTroca;
    }
    if (pedido === "voltar") yield* alterarGravado((atual) => ({ ...atual, voltar: true }));
    if (yield* opcoes.ocupado) {
      return {
        resultado: "adiada",
        mensagem: "Há um trabalho em andamento no app. A troca da base fica para quando o app abrir de novo.",
      } satisfies ResultadoTroca;
    }
    return {
      resultado: "reiniciar",
      mensagem: "O Simplifica IF está reiniciando para trocar a base.",
    } satisfies ResultadoTroca;
  });

  if (opcoes.automatico ?? true) {
    // Cada conferência periódica abre o próprio trace: o fiber nasce no span de quem montou a layer, que já
    // terminou, e herdaria o `traceId` dele.
    yield* uma
      .withPermits(1)(conferir)
      .pipe(
        Effect.withSpan("Atualizador.conferir", { root: true }),
        Effect.repeat(Schedule.spaced(Duration.hours(24))),
        Effect.forkScoped,
      );
  }

  return Atualizador.of({
    estado,
    canal: canalAtual,
    procurar,
    // Na trava curta do `atualizacao.json`, não na das conferências: o canal troca na hora, sem esperar um
    // download. A conferência em curso do canal antigo termina, e o que ela ainda não pôs no lugar é
    // descartado (`vale`); o que já estava pendente fica, como se ela tivesse terminado antes da troca.
    trocarCanal: Effect.fn("Atualizador.trocarCanal")(function* (canal: CanalAtualizacao) {
      yield* travaEstado.withPermits(1)(
        Effect.gen(function* () {
          yield* gravar({ ...(yield* lerGravado), canal });
          yield* Ref.set(canalEmUso, canal);
        }),
      );
      yield* Ref.set(memoria, { situacao: "parada", erro: null, aviso: null });
      return yield* estado;
    }),
    aplicar: trocar("aplicar"),
    voltar: trocar("voltar"),
    novidadesVistas: Effect.gen(function* () {
      yield* alterarGravado((gravado) =>
        gravado.novidades === undefined ? undefined : { ...gravado, novidades: { ...gravado.novidades, vista: true } },
      );
      return yield* estado;
    }),
  });
});
