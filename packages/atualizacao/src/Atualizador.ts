// @effect-diagnostics nodeBuiltinImport:off -- confere a existência da base anterior na pasta do app
/**
 * O serviço de atualização da base e das skills no servidor (M1.10).
 *
 * - **Quando confere:** na abertura (logo depois de o servidor subir) e a cada 24 horas, no canal
 *   gravado (`atualizacao.json`) ou no padrão da política; "Procurar agora" confere na hora.
 * - **O que faz:** baixa e confere em segundo plano (`remoto.ts`) e deixa a base e as skills
 *   pendentes. A troca é na próxima abertura (`local.ts`); "Aplicar agora" e "Voltar" pedem ao
 *   desktop para reiniciar o servidor, e se recusam (adiam) enquanto uma análise ou revisão roda.
 * - **Desligado** quando a política não tem feed ou chave pública (a hospedagem e a chave de produção
 *   ainda não estão no app) ou quando a base vem de fora (`SIMPLIFICA_KB`): o estado diz o motivo.
 */
import * as NodeFS from "node:fs";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import type {
  CanalAtualizacao,
  EstadoAtualizacao,
  ResultadoTroca,
  SituacaoAtualizacao,
} from "@simplifica-if/contratos-app";
import type { Abertura } from "./local.ts";
import { caminhos, gravarEstado, lerEstado, lerInfoBanco } from "./local.ts";
import type { ChavePublica } from "./minisign.ts";
import { type Baixar, baixarAtualizacao, baixarComFetch, conferirManifesto, urlManifesto } from "./remoto.ts";

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
  /** Uma análise ou revisão está rodando? (a troca espera) */
  readonly ocupado: Effect.Effect<boolean>;
  readonly baixar?: Baixar;
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
>()("@simplifica-if/atualizacao/Atualizador") {}

interface Memoria {
  readonly situacao: SituacaoAtualizacao;
  readonly erro: string | null;
  readonly aviso: string | null;
}

const mensagem = (erro: unknown) => (erro instanceof Error ? erro.message : String(erro));

export const make = Effect.fn("Atualizador.make")(function* (opcoes: Opcoes) {
  const memoria = yield* Ref.make<Memoria>({ situacao: "parada", erro: null, aviso: null });
  const uma = yield* Semaphore.make(1);
  const baixar = opcoes.baixar ?? baixarComFetch();
  const c = caminhos(opcoes.pasta);

  const canalAtual = () => lerEstado(opcoes.pasta).canal ?? opcoes.canalPadrao;

  const estado = Effect.gen(function* () {
    const m = yield* Ref.get(memoria);
    const gravado = lerEstado(opcoes.pasta);
    const info = opcoes.abertura.info;
    const anteriorBaixada = NodeFS.existsSync(c.anterior) ? lerInfoBanco(c.anterior)?.versao : undefined;
    const anteriorEmpacotada =
      opcoes.abertura.origem === "baixada" ? lerInfoBanco(opcoes.bancoEmpacotado)?.versao : undefined;
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
      anterior: anteriorBaixada ?? anteriorEmpacotada ?? null,
      pendente: gravado.pendente?.versao ?? null,
      skills: gravado.skills ?? "empacotadas",
      skillsPendentes: gravado.skillsPendentes ?? null,
      ultimaConferencia: gravado.ultimaConferencia ?? null,
      novidades:
        gravado.novidades !== undefined && !gravado.novidades.vista
          ? { versao: gravado.novidades.versao, itens: gravado.novidades.itens }
          : null,
    } satisfies EstadoAtualizacao;
  });

  const conferir = Effect.gen(function* () {
    if (opcoes.desligada !== null || opcoes.feed === null || opcoes.chave === null) return;
    const canal = canalAtual();
    const url = urlManifesto(opcoes.feed, canal);
    const chave = opcoes.chave;
    yield* Ref.set(memoria, { situacao: "conferindo", erro: null, aviso: null });
    const agora = DateTime.formatIso(yield* DateTime.now);
    const resultado = yield* Effect.tryPromise({
      try: async () => {
        const manifesto = await conferirManifesto({ urlManifesto: url, canal, chave, baixar });
        gravarEstado(opcoes.pasta, { ...lerEstado(opcoes.pasta), ultimaConferencia: agora });
        return baixarAtualizacao(manifesto, url, {
          pasta: opcoes.pasta,
          versaoApp: opcoes.versaoApp,
          baseEmUso: { caminho: opcoes.abertura.banco, info: opcoes.abertura.info },
          versoesSkills: opcoes.versoesSkills,
          baixar,
        });
      },
      catch: mensagem,
    }).pipe(Effect.result);
    if (resultado._tag === "Failure") {
      yield* Effect.logWarning(`atualização: ${resultado.failure}`);
      yield* Ref.set(memoria, { situacao: "erro", erro: resultado.failure, aviso: null });
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
    if (pedido === "voltar") gravarEstado(opcoes.pasta, { ...gravado, voltar: true });
    if (yield* opcoes.ocupado) {
      return {
        resultado: "adiada",
        mensagem: "Uma análise está em andamento. A troca da base fica para quando o app abrir de novo.",
      } satisfies ResultadoTroca;
    }
    return {
      resultado: "reiniciar",
      mensagem: "Reiniciando o servidor local para trocar a base.",
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
