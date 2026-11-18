// @effect-diagnostics nodeBuiltinImport:off -- confere a existência da base anterior na pasta do app
/**
 * O serviço de atualização da base e das skills no servidor (M1.10).
 *
 * - **Quando confere:** na abertura (logo depois de o servidor subir) e a cada 24 horas, no canal
 *   gravado (`atualizacao.json`) ou no padrão da política; "Procurar agora" confere na hora.
 * - **O que faz:** baixa e confere em segundo plano (`@simplifica-if/atualizacao/remoto`) e deixa a base e as skills
 *   pendentes. A troca é na próxima abertura (`local.ts`); "Aplicar agora" e "Voltar" pedem ao
 *   desktop para reiniciar o servidor, e se recusam (adiam) enquanto uma revisão de PPC (prévia ou com IA) roda.
 * - **Desligado** quando a política não tem feed ou chave pública (a hospedagem e a chave de produção
 *   ainda não estão no app) ou quando a base vem de fora (`SIMPLIFICA_KB`): o estado diz o motivo.
 */
import * as NodeFS from "node:fs";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";
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
import { caminhos, gravarEstado, lerEstado, lerInfoBanco } from "@simplifica-if/atualizacao/local";
import type { ChavePublica } from "@simplifica-if/atualizacao/minisign";
import { atualizarUmaVez } from "@simplifica-if/atualizacao/remoto";

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
  readonly versoesSkills: Readonly<Record<string, string>>;
  /** Uma revisão de PPC (prévia ou com IA) está rodando? (a troca espera) */
  readonly ocupado: Effect.Effect<boolean>;
  /** Prazo de cada download (padrão: o de `@simplifica-if/atualizacao/remoto`). */
  readonly prazo?: Duration.Input;
  /** Intervalo entre conferências (padrão: 24 h). */
  readonly intervalo?: Duration.Input;
  /** Conferir na abertura e depois no intervalo (padrão: sim). */
  readonly automatico?: boolean;
}

export class Atualizador extends Context.Service<
  Atualizador,
  {
    readonly estado: Effect.Effect<EstadoAtualizacao>;
    readonly procurar: Effect.Effect<EstadoAtualizacao>;
    readonly trocarCanal: (canal: CanalAtualizacao) => Effect.Effect<EstadoAtualizacao>;
    readonly aplicar: Effect.Effect<ResultadoTroca>;
    readonly voltar: Effect.Effect<ResultadoTroca>;
    readonly novidadesVistas: Effect.Effect<EstadoAtualizacao>;
  }
>()("@simplifica-if/server/Atualizador") {}

interface Memoria {
  readonly situacao: SituacaoAtualizacao;
  readonly erro: string | null;
  readonly aviso: string | null;
}

export const make = Effect.fn("Atualizador.make")(function* (opcoes: Opcoes) {
  const memoria = yield* Ref.make<Memoria>({ situacao: "parada", erro: null, aviso: null });
  const uma = yield* Semaphore.make(1);
  // O download e a pasta: os métodos do serviço não pedem nada a quem os chama.
  const servicos = yield* Effect.context<HttpClient.HttpClient | FileSystem.FileSystem | Path.Path>();
  const c = caminhos(opcoes.pasta);

  const canalAtual = () => lerEstado(opcoes.pasta).canal ?? opcoes.canalPadrao;

  /**
   * A versão para onde "Voltar" leva: a anterior baixada ou, sem ela, a empacotada. Nenhuma quando é a
   * versão de que se acabou de voltar (a recusada): voltar de novo seria ir para a frente.
   */
  const versaoParaVoltar = (): string | null => {
    if (opcoes.abertura.origem !== "baixada") return null;
    const anterior =
      (NodeFS.existsSync(c.anterior) ? lerInfoBanco(c.anterior)?.versao : undefined) ??
      lerInfoBanco(opcoes.bancoEmpacotado)?.versao ??
      null;
    return anterior !== null && anterior === lerEstado(opcoes.pasta).recusada ? null : anterior;
  };

  const estado = Effect.gen(function* () {
    const m = yield* Ref.get(memoria);
    const gravado = lerEstado(opcoes.pasta);
    const info = opcoes.abertura.info;
    const situacao: SituacaoAtualizacao =
      m.situacao === "parada" && (gravado.pendente !== undefined || gravado.skillsPendentes !== undefined)
        ? "pronta"
        : m.situacao;
    return {
      desligada: opcoes.desligada,
      canal: canalAtual(),
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
      anterior: gravado.voltar === true ? null : versaoParaVoltar(),
      pendente: gravado.pendente?.versao ?? null,
      skills: gravado.skills ?? "empacotadas",
      skillsPendentes: gravado.skillsPendentes ?? null,
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
    const canal = canalAtual();
    const feed = opcoes.feed;
    const chave = opcoes.chave;
    yield* Ref.set(memoria, { situacao: "conferindo", erro: null, aviso: null });
    const agora = DateTime.formatIso(yield* DateTime.now);
    const resultado = yield* atualizarUmaVez({
      feed,
      canal,
      chave,
      agora,
      contexto: {
        pasta: opcoes.pasta,
        versaoApp: opcoes.versaoApp,
        baseEmUso: { caminho: opcoes.abertura.banco, info: opcoes.abertura.info },
        versoesSkills: opcoes.versoesSkills,
        ...(opcoes.prazo === undefined ? {} : { prazo: opcoes.prazo }),
      },
    }).pipe(Effect.provideContext(servicos), Effect.result);
    if (resultado._tag === "Failure") {
      // A mensagem vem dos atributos do erro (o host, nunca a URL do feed): vai ao log e à interface.
      const erro = resultado.failure;
      yield* Effect.logWarning(`atualização: ${erro.message}`).pipe(Effect.annotateLogs({ erro: erro._tag }));
      yield* Ref.set(memoria, { situacao: "erro", erro: erro.message, aviso: null });
      return;
    }
    const r = resultado.success;
    if (r.tipo === "app-desatualizado") {
      yield* Ref.set(memoria, {
        situacao: "parada",
        erro: null,
        aviso: `A base ${r.versao} pede o app ${r.appMinimo} ou mais novo. Atualize o app para receber a base nova.`,
      });
      return;
    }
    if (r.tipo === "baixada") {
      yield* Effect.logInfo(`atualização: ${r.versao} baixada (base: ${r.via}; skills: ${r.skills})`);
    }
    yield* Ref.set(memoria, { situacao: "parada", erro: null, aviso: null });
  });

  const procurar = uma.withPermits(1)(conferir).pipe(Effect.andThen(estado));

  const trocar = Effect.fn("Atualizador.trocar")(function* (pedido: "aplicar" | "voltar") {
    const gravado = lerEstado(opcoes.pasta);
    if (pedido === "aplicar" && gravado.pendente === undefined && gravado.skillsPendentes === undefined) {
      return { resultado: "nada", mensagem: "Não há atualização baixada esperando." } satisfies ResultadoTroca;
    }
    if (pedido === "voltar" && opcoes.abertura.origem !== "baixada") {
      return { resultado: "nada", mensagem: "A base em uso já é a que veio com o app." } satisfies ResultadoTroca;
    }
    if (pedido === "voltar" && versaoParaVoltar() === null) {
      return {
        resultado: "nada",
        mensagem: "A versão anterior é a de que você acabou de voltar. Espere uma versão mais nova da base.",
      } satisfies ResultadoTroca;
    }
    if (pedido === "voltar") gravarEstado(opcoes.pasta, { ...gravado, voltar: true });
    if (yield* opcoes.ocupado) {
      return {
        resultado: "adiada",
        mensagem: "Uma revisão está em andamento. A troca da base fica para quando o app abrir de novo.",
      } satisfies ResultadoTroca;
    }
    return {
      resultado: "reiniciar",
      mensagem: "O Simplifica IF está reiniciando para trocar a base.",
    } satisfies ResultadoTroca;
  });

  if (opcoes.automatico ?? true) {
    yield* uma
      .withPermits(1)(conferir)
      .pipe(Effect.repeat(Schedule.spaced(opcoes.intervalo ?? Duration.hours(24))), Effect.forkScoped);
  }

  return Atualizador.of({
    estado,
    procurar,
    trocarCanal: Effect.fn("Atualizador.trocarCanal")(function* (canal: CanalAtualizacao) {
      gravarEstado(opcoes.pasta, { ...lerEstado(opcoes.pasta), canal });
      yield* Ref.set(memoria, { situacao: "parada", erro: null, aviso: null });
      return yield* estado;
    }),
    aplicar: trocar("aplicar"),
    voltar: trocar("voltar"),
    novidadesVistas: Effect.sync(() => {
      const gravado = lerEstado(opcoes.pasta);
      if (gravado.novidades !== undefined) {
        gravarEstado(opcoes.pasta, { ...gravado, novidades: { ...gravado.novidades, vista: true } });
      }
    }).pipe(Effect.andThen(estado)),
  });
});

export const layer = (opcoes: Opcoes) => Layer.effect(Atualizador, make(opcoes));
