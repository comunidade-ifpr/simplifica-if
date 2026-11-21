// @effect-diagnostics nodeBuiltinImport:off -- borda com o sistema de arquivos e o `worker_threads`
/**
 * `RevisorPpc`: a revisão prévia sem IA de um PPC em DOCX (M1.11, etapa 3), atrás do RPC
 * `revisaoPpc.revisar`.
 *
 * 1. Confere o pedido: caminho absoluto de um `.docx` que existe, até 20 MB (recusado antes de ler).
 * 2. Monta a base uma vez, do `kb.sqlite` que o servidor já serve, pela montagem única do `ppc`
 *    (`montarBaseRevisao`, sobre os serviços do kb): nada vem de arquivos do repositório, e o app
 *    empacotado, sem o checkout, faz a mesma revisão que os scripts e os testes do `ppc`.
 * 3. Roda `revisarDocx` num `Worker` (`trabalhador.ts`), com `resourceLimits` (512 MB de heap) e
 *    tempo máximo (30 s, depois `terminate()`): a conversão é síncrona e mantém o XML na memória, e o
 *    laço de eventos do servidor não pode parar. Estouro de memória, de tempo, `ErroDocx` e defeito
 *    viram uma `FalhaRevisaoPpc` com a frase em português; o servidor continua de pé.
 * 4. Grava a cópia comentada ao lado do original, `<nome> - revisão prévia (Simplifica IF).docx`,
 *    sempre com o mesmo nome (regravada a cada revisão); ` (2)`, ` (3)`… só quando a cópia está aberta e
 *    travada (o Word no Windows). O original nunca é aberto para escrita.
 *
 * As etapas (`EtapaLeituraPpc`) vão para `aoEtapa` quando cada uma começa: `lendo` aqui, antes de ler os bytes, as
 * outras do Worker, como avisos de andamento (`WorkerLimitado.AvisoAndamento`).
 *
 * No app empacotado, o Worker é o `trabalhador-ppc.mjs` do bundle, ao lado do `bin.mjs`
 * (`apps/desktop/scripts/construir.ts`); no desenvolvimento, o `trabalhador.ts`.
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import {
  type EtapaLeituraPpc,
  FalhaRevisaoPpc,
  type ResultadoRevisaoPpc,
  SUFIXO_REVISAO_PREVIA,
} from "@simplifica-if/contratos-app";
import type * as Cursos from "@simplifica-if/kb/Cursos";
import type * as FontesNormativas from "@simplifica-if/kb/FontesNormativas";
import type * as Normas from "@simplifica-if/kb/Normas";
import type * as PacoteContexto from "@simplifica-if/kb/PacoteContexto";
import * as NodeCrypto from "node:crypto";
import { mensagemErroDocx } from "@simplifica-if/docx/erro";
import { montarBaseRevisao } from "@simplifica-if/ppc/base-revisao";
import type { EntradaIa, MarcaPendencia, RevisaoPrevia } from "@simplifica-if/ppc/revisao-previa";
import * as ArquivosLiberados from "../ArquivosLiberados.ts";
import { comNumero, criarSemColisao, travado } from "../nome-livre.ts";
import { type LimitesWorker, rodarNoWorker } from "../WorkerLimitado.ts";
import type { AndamentoTrabalhador, PedidoTrabalhador, RespostaTrabalhador } from "./trabalhador.ts";

/** Os limites da revisão (os do Worker e o do arquivo); os testes os apertam para provocar o estouro. */
export interface Limites extends LimitesWorker {
  /** Tamanho máximo do arquivo, conferido antes de ler (o mesmo de `LIMITES_PADRAO.bytesDoArquivo`). */
  readonly bytesDoArquivo: number;
}

export const LIMITES: Limites = { bytesDoArquivo: 20 * 1024 * 1024, memoriaMb: 512, tempoMs: 30_000 };

export interface EntradaRevisao {
  readonly arquivo: string;
  readonly cnct?: string;
  readonly forma?: string;
}

/** Avisado quando cada etapa da leitura começa (síncrono: o Worker avisa por um evento do Node). */
export type AoEtapa = (etapa: EtapaLeituraPpc) => void;

/** A revisão de um arquivo, para a revisão com IA (`RevisaoIa.ts`): sem os bytes do DOCX. */
export interface RevisaoDoArquivo {
  readonly revisao: Omit<RevisaoPrevia, "docx">;
  /** sha256 do `.docx` lido. */
  readonly sha256: string;
  /** A cópia comentada gravada, quando pedida. */
  readonly arquivoComentado: string | null;
}

export interface EntradaRevisarArquivo extends EntradaRevisao {
  readonly ia?: EntradaIa;
  /** A situação de cada pendência na lista viva (etapa 5b): a cópia comentada reflete o estado. */
  readonly situacoes?: Record<string, MarcaPendencia>;
  /** Grava a cópia comentada ao lado do original. */
  readonly gravar: boolean;
  /** Recusa o arquivo se o conteúdo mudou desde a preparação. */
  readonly sha256?: string;
  readonly aoEtapa?: AoEtapa;
}

export class RevisorPpc extends Context.Service<
  RevisorPpc,
  {
    readonly revisar: (entrada: EntradaRevisao) => Effect.Effect<ResultadoRevisaoPpc, FalhaRevisaoPpc>;
    /** O mesmo `revisar`, com o Markdown e as linhas da triagem (a lista viva guarda o texto do PPC). */
    readonly revisarCompleto: (
      entrada: EntradaRevisao,
      aoEtapa?: AoEtapa,
    ) => Effect.Effect<RevisaoDoArquivo, FalhaRevisaoPpc>;
    /**
     * Converte, pré-confere e (com `ia`) junta os resultados da IA; espera a vez em vez de recusar.
     * As mesmas conferências do `revisar` (arquivo liberado, tamanho, Worker com limites).
     */
    readonly revisarArquivo: (entrada: EntradaRevisarArquivo) => Effect.Effect<RevisaoDoArquivo, FalhaRevisaoPpc>;
    /** Uma revisão está rodando agora? (a troca da base espera, M1.10) */
    readonly ocupada: Effect.Effect<boolean>;
  }
>()("@simplifica-if/server/revisao-ppc/RevisorPpc") {}

/** O script do Worker: o `.ts` ao lado deste no desenvolvimento, o `trabalhador-ppc.mjs` no bundle. */
export const URL_TRABALHADOR = import.meta.url.endsWith(".ts")
  ? new URL("./trabalhador.ts", import.meta.url)
  : new URL("./trabalhador-ppc.mjs", import.meta.url);

/* ============================================================ Worker */

/** O tamanho na mensagem para a pessoa, pelo `Intl` em pt-BR (M1.14): "12,3 MB". */
const FORMATO_MB = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const megabytes = (bytes: number) => `${FORMATO_MB.format(bytes / 1024 / 1024)} MB`;

type Revisao = Extract<RespostaTrabalhador, { ok: true }>["revisao"];

const ERRO_INTERNO = "Não foi possível revisar este arquivo por um erro interno do Simplifica IF.";

/** Roda o pedido no Worker (`WorkerLimitado`) e traduz o que não for revisão para a frase da pessoa. */
function rodarNoTrabalhador(
  pedido: PedidoTrabalhador,
  limites: Limites,
  url: URL,
  falha: (motivo: string) => FalhaRevisaoPpc,
  aoEtapa?: AoEtapa,
): Effect.Effect<Revisao, FalhaRevisaoPpc> {
  return rodarNoWorker<RespostaTrabalhador, AndamentoTrabalhador>(
    url,
    pedido,
    [pedido.bytes.buffer as ArrayBuffer],
    limites,
    aoEtapa,
  ).pipe(
    Effect.catchTags({
      FalhaWorker: (erro) => {
        switch (erro.motivo) {
          case "tempo":
            return Effect.fail(
              falha(
                `A revisão passou do tempo máximo (${Math.round(limites.tempoMs / 1000)} s) e foi interrompida. O arquivo pode ter estrutura incomum; salve-o de novo no Word como .docx e tente outra vez.`,
              ),
            );
          case "parou":
            return Effect.fail(falha("A revisão parou antes de terminar. Tente de novo."));
          case "memoria":
          case "erro":
            return Effect.logError("revisão prévia: o Worker falhou", erro.cause).pipe(
              Effect.andThen(
                Effect.fail(
                  falha(
                    erro.motivo === "memoria"
                      ? "O arquivo exigiu memória demais para ser revisado. Compacte as imagens no Word (Arquivo > Compactar imagens) ou retire anexos grandes, e tente de novo."
                      : ERRO_INTERNO,
                  ),
                ),
              ),
            );
        }
      },
    }),
    Effect.flatMap((resposta) => {
      if (resposta.ok) return Effect.succeed(resposta.revisao);
      return "arquivoInvalido" in resposta
        ? Effect.fail(falha(mensagemErroDocx(resposta.arquivoInvalido)))
        : Effect.logError("revisão prévia: defeito no Worker", resposta.defeito).pipe(
            Effect.andThen(Effect.fail(falha(ERRO_INTERNO))),
          );
    }),
  );
}

/* ============================================================ arquivo */

/** Até quantas cópias travadas pular antes de desistir (` (2)` a ` (20)`). */
const COPIAS_TRAVADAS = 20;

/**
 * Grava ao lado do original, `<nome> - revisão prévia (Simplifica IF).docx`, por cima da cópia da
 * revisão anterior: a pasta fica com uma cópia só. Se ela está aberta e travada (o Word no Windows),
 * passa a ` (2)`, ` (3)`…, que também são regravadas.
 */
const gravarCopia = Effect.fn("RevisorPpc.gravarCopia")(function* (original: string, bytes: Uint8Array) {
  const fs = yield* FileSystem.FileSystem;
  const pasta = NodePath.dirname(original);
  const copia = `${NodePath.basename(original, NodePath.extname(original))}${SUFIXO_REVISAO_PREVIA}.docx`;
  return yield* criarSemColisao(
    { pasta, nomes: (n) => comNumero(copia, n), ate: COPIAS_TRAVADAS, pular: travado },
    (nome) => {
      const destino = NodePath.join(pasta, nome);
      return fs.writeFile(destino, bytes).pipe(Effect.as(destino));
    },
  );
});

/* ============================================================ serviço */

/** O resultado para a interface (sem o Markdown, o aviso e as linhas da triagem). */
export const resultadoParaInterface = (arquivo: string, r: RevisaoDoArquivo): ResultadoRevisaoPpc => {
  const { aviso: _, markdown: __, linhasTextoParaIa: ___, ...resto } = r.revisao;
  return { arquivoOriginal: arquivo, arquivoComentado: r.arquivoComentado ?? "", ...resto };
};

export interface OpcoesRevisao {
  readonly limites?: Partial<Limites>;
  readonly trabalhador?: URL;
}

export const make = Effect.fn("RevisorPpc.make")(function* (opcoes: OpcoesRevisao = {}) {
  const limites = { ...LIMITES, ...opcoes.limites };
  const url = opcoes.trabalhador ?? URL_TRABALHADOR;
  const contexto = yield* Effect.context<
    FontesNormativas.FontesNormativas | Cursos.Cursos | Normas.Normas | PacoteContexto.PacoteContexto
  >();
  const fs = yield* FileSystem.FileSystem;
  // A base é montada na primeira revisão e reaproveitada (o banco é só de leitura).
  const base = yield* Effect.cached(
    montarBaseRevisao.pipe(
      Effect.provideContext(contexto),
      Effect.tapError((erro) => Effect.logError("revisão prévia: base indisponível", erro)),
    ),
  );

  // Só revisa arquivos liberados pelo desktop: um cliente do RPC não manda o servidor ler um `.docx`
  // qualquer nem gravar ao lado dele.
  const liberacao = yield* ArquivosLiberados.ArquivosLiberados;
  // Uma revisão por vez: cada Worker pode usar até `memoriaMb` de heap.
  const vez = yield* Semaphore.make(1);

  const revisarUm = Effect.fn("RevisorPpc.revisarArquivo")(function* (entrada: EntradaRevisarArquivo) {
    const arquivo = entrada.arquivo;
    const falha = (motivo: string) => new FalhaRevisaoPpc({ arquivo, motivo });
    if (!NodePath.isAbsolute(arquivo) || NodePath.extname(arquivo).toLowerCase() !== ".docx")
      return yield* falha("Escolha um arquivo do Word (.docx).");
    if (!(yield* liberacao.liberado(arquivo)))
      return yield* falha('Escolha o arquivo pelo botão "Escolher o PPC (.docx)…" do app.');
    const info = yield* Effect.tryPromise({
      try: () => NodeFSP.stat(arquivo),
      catch: () => falha("O arquivo não foi encontrado ou não pode ser lido."),
    });
    if (!info.isFile()) return yield* falha("Escolha um arquivo do Word (.docx).");
    if (info.size > limites.bytesDoArquivo)
      return yield* falha(
        `O arquivo tem ${megabytes(info.size)}, acima do limite de ${megabytes(limites.bytesDoArquivo)}. Compacte as imagens no Word (Arquivo > Compactar imagens) e tente de novo.`,
      );
    // A leitura começa depois das recusas (extensão, liberação, tamanho): uma recusa não mostra etapa.
    entrada.aoEtapa?.("lendo");
    const bytes = yield* Effect.tryPromise({
      try: () => NodeFSP.readFile(arquivo),
      catch: () => falha("O arquivo não pode ser lido."),
    });
    const sha256 = NodeCrypto.createHash("sha256").update(bytes).digest("hex");
    if (entrada.sha256 !== undefined && entrada.sha256 !== sha256)
      return yield* falha(
        "O arquivo mudou depois que a revisão começou. Revise o arquivo de novo para começar outra revisão.",
      );
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
        ia: entrada.ia,
        situacoes: entrada.situacoes,
      },
      limites,
      url,
      falha,
      entrada.aoEtapa,
    );
    const arquivoComentado = entrada.gravar
      ? yield* gravarCopia(arquivo, revisao.docx).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.mapError(() =>
            falha("Não foi possível gravar a cópia comentada na pasta do arquivo. Confira se a pasta aceita gravação."),
          ),
        )
      : null;
    const { docx: _, ...semDocx } = revisao;
    return { revisao: semDocx, sha256, arquivoComentado } satisfies RevisaoDoArquivo;
  });

  const revisarCompleto = (entrada: EntradaRevisao, aoEtapa?: AoEtapa) =>
    revisarUm({ ...entrada, gravar: true, ...(aoEtapa ? { aoEtapa } : {}) }).pipe(
      vez.withPermitsIfAvailable(1),
      Effect.flatMap(
        Option.match({
          onSome: (resultado) => Effect.succeed(resultado),
          onNone: () =>
            Effect.fail(
              new FalhaRevisaoPpc({
                arquivo: entrada.arquivo,
                motivo: "Já há uma revisão em andamento. Espere ela terminar e tente de novo.",
              }),
            ),
        }),
      ),
    );
  const revisar = (entrada: EntradaRevisao) =>
    revisarCompleto(entrada).pipe(Effect.map((r) => resultadoParaInterface(entrada.arquivo, r)));
  const revisarArquivo = (entrada: EntradaRevisarArquivo) => revisarUm(entrada).pipe(vez.withPermits(1));

  const ocupada = vez.withPermitsIfAvailable(1)(Effect.void).pipe(Effect.map(Option.isNone));
  return RevisorPpc.of({ revisar, revisarCompleto, revisarArquivo, ocupada });
});

/**
 * O serviço sobre os serviços do kb (`FontesNormativas`, `Cursos`, `Normas` e `PacoteContexto` do
 * `kb.sqlite`, os do `Leitura` do servidor), os `ArquivosLiberados` e o `FileSystem`.
 */
export const layer = (opcoes: OpcoesRevisao = {}) => Layer.effect(RevisorPpc, make(opcoes));
