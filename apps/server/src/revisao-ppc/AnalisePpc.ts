// @effect-diagnostics nodeBuiltinImport:off -- borda com o sistema de arquivos e o `worker_threads`
/**
 * `AnalisePpc`: a revisão prévia sem IA de um PPC em DOCX (M1.11, etapa 3), atrás do RPC
 * `revisaoPpc.analisar`.
 *
 * 1. Confere o pedido: caminho absoluto de um `.docx` que existe, até 20 MB (recusado antes de ler).
 * 2. Monta a base uma vez, do `kb.sqlite` que o servidor já serve (`FontesNormativas` e as tabelas
 *    `cnct`, `normas`, `fichas` e `meta`): nada vem de arquivos do repositório, e o app empacotado,
 *    sem o checkout, faz a mesma análise.
 * 3. Roda `revisarDocx` num `Worker` (`trabalhador.ts`), com `resourceLimits` (512 MB de heap) e
 *    tempo máximo (30 s, depois `terminate()`): a conversão é síncrona e mantém o XML na memória, e o
 *    laço de eventos do servidor não pode parar. Estouro de memória, de tempo, `ErroDocx` e defeito
 *    viram uma `FalhaRevisaoPpc` com a frase em português; o servidor continua de pé.
 * 4. Grava a cópia comentada ao lado do original, `<nome> - revisão prévia (Simplifica IF).docx`,
 *    sem sobrescrever (` (2)`, ` (3)`… se já existir). O original nunca é aberto para escrita.
 *
 * No app empacotado, o Worker é o `trabalhador-ppc.mjs` do bundle, ao lado do `bin.mjs`
 * (`apps/desktop/scripts/construir.ts`); no desenvolvimento, o `trabalhador.ts`.
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeWorkerThreads from "node:worker_threads";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/sql/SqlClient";
import { FalhaRevisaoPpc, type ResultadoRevisaoPpc, SUFIXO_REVISAO_PREVIA } from "@simplifica-if/contratos-app";
import { FontesNormativas } from "@simplifica-if/kb/FontesNormativas";
import * as Sql from "@simplifica-if/kb/db/sql";
import type { BaseRevisaoPrevia } from "@simplifica-if/ppc/revisao-previa";
import type { CursoCnct } from "@simplifica-if/ppc/verificadores/comum";
import type { PedidoTrabalhador, RespostaTrabalhador } from "./trabalhador.ts";

/** Os limites da análise; os testes os apertam para provocar o estouro. */
export interface Limites {
  /** Tamanho máximo do arquivo, conferido antes de ler (o mesmo de `LIMITES_PADRAO.bytesDoArquivo`). */
  readonly bytesDoArquivo: number;
  /**
   * `resourceLimits.maxOldGenerationSizeMb` do Worker, com piso de `MEMORIA_MINIMA_MB`: com heap
   * pequeno demais (2 MB, medido no Node 26), o V8 aborta o processo inteiro em vez de encerrar o Worker.
   */
  readonly memoriaMb: number;
  /** Tempo máximo do Worker, em milissegundos. */
  readonly tempoMs: number;
}

export const MEMORIA_MINIMA_MB = 64;

export const LIMITES: Limites = { bytesDoArquivo: 20 * 1024 * 1024, memoriaMb: 512, tempoMs: 30_000 };

export interface EntradaAnalise {
  readonly arquivo: string;
  readonly cnct?: string;
  readonly forma?: string;
}

export class AnalisePpc extends Context.Service<
  AnalisePpc,
  { readonly analisar: (entrada: EntradaAnalise) => Effect.Effect<ResultadoRevisaoPpc, FalhaRevisaoPpc> }
>()("@simplifica-if/server/revisao-ppc/AnalisePpc") {}

/** O script do Worker: o `.ts` ao lado deste no desenvolvimento, o `trabalhador-ppc.mjs` no bundle. */
export const URL_TRABALHADOR = import.meta.url.endsWith(".ts")
  ? new URL("./trabalhador.ts", import.meta.url)
  : new URL("./trabalhador-ppc.mjs", import.meta.url);

/* ============================================================ base */

const linhasCnct = Sql.todas(Schema.Struct({ slug: Schema.String, dados_json: Schema.String }));
const linhasFontes = Sql.todas(Schema.Struct({ id: Schema.String, fonte: Schema.String }));
const linhasFichas = Sql.todas(Schema.Struct({ id: Schema.String, titulo: Schema.String }));

/** A base da revisão prévia, do `kb.sqlite` (só dados planos: vai ao Worker pelo `postMessage`). */
export const montarBase = Effect.gen(function* () {
  const fontes = yield* FontesNormativas;
  const cncts = (yield* linhasCnct("SELECT slug, dados_json FROM cnct ORDER BY slug")).map(
    (linha): CursoCnct => ({ ...(JSON.parse(linha.dados_json) as object), slug: linha.slug }) as CursoCnct,
  );
  const urls: Record<string, string> = {};
  for (const linha of yield* linhasFontes("SELECT id, fonte FROM normas WHERE fonte LIKE 'http%'"))
    urls[linha.id] = linha.fonte;
  const fichas: Record<string, string> = {};
  for (const linha of yield* linhasFichas("SELECT id, titulo FROM fichas ORDER BY id")) fichas[linha.id] = linha.titulo;
  return {
    // Cópias planas: o `postMessage` não clona protótipos nem readonly profundos.
    normas: fontes.registro.entradas.map((entrada) => ({ ...entrada, aliases: [...entrada.aliases] })),
    relacoes: fontes.relacoes.map((relacao) => structuredClone(relacao)),
    cncts,
    urls,
    fichas,
    topicos: fontes.topicosFichas.map((topico) => ({ id: topico.id, fichas: [...(topico.fichas ?? [])] })),
    dataBase: fontes.dataReferencia,
  } satisfies BaseRevisaoPrevia;
});

/* ============================================================ Worker */

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;

type Revisao = Extract<RespostaTrabalhador, { ok: true }>["revisao"];

const ERRO_INTERNO = "Não foi possível analisar este arquivo por um erro interno do Simplifica IF.";

/**
 * Roda o pedido no Worker. O tempo máximo e a interrupção (a conexão caiu) encerram o Worker pelo
 * finalizador do `callback` (`terminate()`).
 */
function rodarNoTrabalhador(
  pedido: PedidoTrabalhador,
  limites: Limites,
  url: URL,
  falha: (motivo: string) => FalhaRevisaoPpc,
): Effect.Effect<Revisao, FalhaRevisaoPpc> {
  const rodar = Effect.callback<Revisao, FalhaRevisaoPpc>((resume) => {
    const trabalhador = new NodeWorkerThreads.Worker(url, {
      resourceLimits: { maxOldGenerationSizeMb: Math.max(MEMORIA_MINIMA_MB, limites.memoriaMb) },
      stdout: true,
      stderr: false,
    });
    let terminou = false;
    const terminar = (efeito: Effect.Effect<Revisao, FalhaRevisaoPpc>) => {
      if (terminou) return;
      terminou = true;
      void trabalhador.terminate();
      resume(efeito);
    };
    trabalhador.once("message", (resposta: RespostaTrabalhador) => {
      if (resposta.ok) return terminar(Effect.succeed(resposta.revisao));
      const motivo = resposta.arquivoInvalido ? resposta.mensagem : ERRO_INTERNO;
      terminar(
        resposta.arquivoInvalido
          ? Effect.fail(falha(motivo))
          : Effect.logError("revisão prévia: defeito no Worker", resposta.mensagem).pipe(
              Effect.andThen(Effect.fail(falha(motivo))),
            ),
      );
    });
    trabalhador.once("error", (erro: Error & { code?: string }) =>
      terminar(
        Effect.logError("revisão prévia: o Worker falhou", erro).pipe(
          Effect.andThen(
            Effect.fail(
              falha(
                erro.code === "ERR_WORKER_OUT_OF_MEMORY"
                  ? "O arquivo exigiu memória demais para ser analisado. Compacte as imagens no Word (Arquivo > Compactar imagens) ou retire anexos grandes, e tente de novo."
                  : ERRO_INTERNO,
              ),
            ),
          ),
        ),
      ),
    );
    trabalhador.once("exit", () => terminar(Effect.fail(falha("A análise parou antes de terminar. Tente de novo."))));
    trabalhador.postMessage(pedido, [pedido.bytes.buffer as ArrayBuffer]);
    return Effect.sync(() => {
      terminou = true;
      void trabalhador.terminate();
    });
  });
  return rodar.pipe(
    Effect.timeoutOrElse({
      duration: Duration.millis(limites.tempoMs),
      orElse: () =>
        Effect.fail(
          falha(
            `A análise passou do tempo máximo (${Math.round(limites.tempoMs / 1000)} s) e foi interrompida. O arquivo pode ter estrutura incomum; salve-o de novo no Word como .docx e tente outra vez.`,
          ),
        ),
    }),
  );
}

/* ============================================================ arquivo */

/** Grava ao lado do original sem sobrescrever: `<nome> - revisão prévia (Simplifica IF).docx`, depois ` (2)`… */
async function gravarCopia(original: string, bytes: Uint8Array): Promise<string> {
  const pasta = NodePath.dirname(original);
  const nome = NodePath.basename(original, NodePath.extname(original));
  for (let n = 1; n <= 99; n += 1) {
    const destino = NodePath.join(pasta, `${nome}${SUFIXO_REVISAO_PREVIA}${n === 1 ? "" : ` (${n})`}.docx`);
    try {
      await NodeFSP.writeFile(destino, bytes, { flag: "wx" });
      return destino;
    } catch (erro) {
      if ((erro as { code?: string }).code !== "EEXIST") throw erro;
    }
  }
  throw new Error("cópias demais com o mesmo nome");
}

/* ============================================================ serviço */

export interface OpcoesAnalise {
  readonly limites?: Partial<Limites>;
  readonly trabalhador?: URL;
}

export const make = Effect.fn("AnalisePpc.make")(function* (opcoes: OpcoesAnalise = {}) {
  const limites = { ...LIMITES, ...opcoes.limites };
  const url = opcoes.trabalhador ?? URL_TRABALHADOR;
  const contexto = yield* Effect.context<FontesNormativas | SqlClient.SqlClient>();
  // A base é montada na primeira análise e reaproveitada (o banco é só de leitura).
  const base = yield* Effect.cached(
    montarBase.pipe(
      Effect.provideContext(contexto),
      Effect.tapError((erro) => Effect.logError("revisão prévia: base indisponível", erro)),
    ),
  );

  const analisar = Effect.fn("AnalisePpc.analisar")(function* (entrada: EntradaAnalise) {
    const arquivo = entrada.arquivo;
    const falha = (motivo: string) => new FalhaRevisaoPpc({ arquivo, motivo });
    if (!NodePath.isAbsolute(arquivo) || NodePath.extname(arquivo).toLowerCase() !== ".docx")
      return yield* falha("Escolha um arquivo do Word (.docx).");
    const info = yield* Effect.tryPromise({
      try: () => NodeFSP.stat(arquivo),
      catch: () => falha("O arquivo não foi encontrado ou não pode ser lido."),
    });
    if (!info.isFile()) return yield* falha("Escolha um arquivo do Word (.docx).");
    if (info.size > limites.bytesDoArquivo)
      return yield* falha(
        `O arquivo tem ${megabytes(info.size)}, acima do limite de ${megabytes(limites.bytesDoArquivo)}. Compacte as imagens no Word (Arquivo > Compactar imagens) e tente de novo.`,
      );
    const bytes = yield* Effect.tryPromise({
      try: () => NodeFSP.readFile(arquivo),
      catch: () => falha("O arquivo não pode ser lido."),
    });
    const dados = yield* base.pipe(
      Effect.mapError(() => falha("A base de normas do Simplifica IF não pôde ser lida. Reinicie o app.")),
    );
    const revisao = yield* rodarNoTrabalhador(
      {
        // Cópia própria: o buffer é transferido ao Worker, e um `Buffer` do Node pode ser fatia de um pool.
        bytes: new Uint8Array(bytes),
        nome: NodePath.basename(arquivo),
        base: dados,
        agora: DateTime.formatIso(yield* DateTime.now),
        cnct: entrada.cnct,
        forma: entrada.forma,
      },
      limites,
      url,
      falha,
    );
    const arquivoComentado = yield* Effect.tryPromise({
      try: () => gravarCopia(arquivo, revisao.docx),
      catch: () =>
        falha("Não foi possível gravar a cópia comentada na pasta do arquivo. Confira se a pasta aceita gravação."),
    });
    const { docx: _, aviso: __, ...resto } = revisao;
    return { arquivoOriginal: arquivo, arquivoComentado, ...resto } satisfies ResultadoRevisaoPpc;
  });

  return AnalisePpc.of({ analisar });
});

/** O serviço sobre o `FontesNormativas` e o `SqlClient` do `kb.sqlite` (os do `Leitura` do servidor). */
export const layer = (opcoes: OpcoesAnalise = {}) => Layer.effect(AnalisePpc, make(opcoes));
