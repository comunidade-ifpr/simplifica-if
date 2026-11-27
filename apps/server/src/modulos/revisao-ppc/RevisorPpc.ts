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
 * 4. Grava a cópia comentada ao lado do original, num arquivo temporário da mesma pasta renomeado por
 *    cima, e a libera (`ArquivosLiberados`): "Acompanhar no Word" a abre e a conferência ao salvar a lê
 *    sem o diálogo de escolha. Cada revisão tem a sua: a nova, `<nome> - revisão prévia (Simplifica IF) <data e hora>.docx`,
 *    só num nome livre; a da própria revisão é regravada no lugar se ainda é a que o app gravou (o sha256
 *    registrado em `CopiasComentadas`). A cópia editada pela pessoa, só de leitura, travada (o Word no
 *    Windows) ou que não é arquivo comum (um link) fica, e a cópia vai para o próximo nome livre da
 *    sequência ` (2)`, ` (3)`…, nunca por cima da cópia de outra revisão. O original nunca é aberto para escrita.
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
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import {
  type EtapaLeituraPpc,
  FalhaRevisaoPpc,
  type PendenciaRevisao,
  type ResultadoRevisaoPpc,
} from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import { SUFIXO_REVISAO_PREVIA } from "@simplifica-if/contratos-app/ponte";
import type * as Cursos from "@simplifica-if/kb/Cursos";
import * as FontesNormativas from "@simplifica-if/kb/FontesNormativas";
import type * as Normas from "@simplifica-if/kb/Normas";
import type * as PacoteRevisaoPpc from "@simplifica-if/kb/PacoteRevisaoPpc";
import * as NodeCrypto from "node:crypto";
import { mensagemErroDocx } from "@simplifica-if/docx/erro";
import { montarBaseRevisao } from "@simplifica-if/ppc/base-revisao";
import {
  type EntradaIa,
  type MarcaPendencia,
  type RevisaoPrevia,
  revisarMarkdown,
  verificacaoDaBase,
} from "@simplifica-if/ppc/revisao-previa";
import * as ArquivosLiberados from "../../ArquivosLiberados.ts";
import * as CopiasComentadas from "./persistencia/CopiasComentadas.ts";
import { comNumero, NomesEsgotados } from "../../nome-livre.ts";
import * as WorkerLimitado from "../../WorkerLimitado.ts";
import type { AndamentoTrabalhador, PedidoTrabalhador, RespostaTrabalhador } from "./trabalho.ts";
import { resumoDaFalha } from "../../observabilidade/resumoDaFalha.ts";

/** Os limites da revisão (os do Worker e o do arquivo); os testes os apertam para provocar o estouro. */
export interface Limites extends WorkerLimitado.LimitesWorker {
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
  /** Grava a cópia comentada ao lado do original (quando falso, pula os comentários no Worker). */
  readonly gravar: boolean;
  /**
   * A cópia comentada desta revisão, para regravar nela; sem ela, uma cópia nova, com a data e a hora no
   * nome (cada revisão tem a sua).
   */
  readonly copia?: string;
  /** O que fazer se outra revisão já estiver rodando: `"esperar"` (padrão) ou `"recusar"`. */
  readonly seOcupada?: "esperar" | "recusar";
  /** Recusa o arquivo se o conteúdo mudou desde a preparação. */
  readonly sha256?: string;
  readonly aoEtapa?: AoEtapa;
}

/** O que a montagem leve recebe: o texto já convertido da lista e o curso escolhido, sem o `.docx`. */
export interface EntradaMontagem {
  readonly arquivo: string;
  readonly markdown: string;
  /** O curso que a pessoa escolheu ("Qual é o curso?"); sem ele, o identificado no texto. */
  readonly cnct?: string;
  readonly forma?: string;
  /** A cópia comentada atual (fica a mesma: a montagem não grava cópia). */
  readonly arquivoComentado: string;
  readonly ia: EntradaIa;
}

export class RevisorPpc extends Context.Service<
  RevisorPpc,
  {
    /**
     * Converte, pré-confere e (com `ia`) junta os resultados da IA; com `gravar: true`, comenta e grava a
     * cópia ao lado do original. Confere arquivo liberado, extensão, tamanho e limites do Worker.
     */
    readonly revisarArquivo: (entrada: EntradaRevisarArquivo) => Effect.Effect<RevisaoDoArquivo, FalhaRevisaoPpc>;
    /**
     * O resultado e as pendências refeitos com os resultados da IA, sem Worker, sem reler o `.docx` e sem
     * cópia comentada (a mesclagem de cada bloco pronto da leitura com IA): `revisarMarkdown` do `ppc`
     * sobre o texto da lista (dezenas de milissegundos), com a base já montada. As pendências saem com o
     * `noDocumento` provisório de lá, que a próxima cópia comentada corrige.
     */
    readonly montar: (
      entrada: EntradaMontagem,
    ) => Effect.Effect<
      { readonly resultado: ResultadoRevisaoPpc; readonly pendencias: ReadonlyArray<PendenciaRevisao> },
      FalhaRevisaoPpc
    >;
    /** Uma revisão está rodando agora? (a troca da base espera, M1.10) */
    readonly ocupada: Effect.Effect<boolean>;
    /**
     * Falha (com `escolherDeNovo`) se o desktop não liberou o arquivo nesta execução: a ação que vai
     * precisar dele recusa antes de começar, e não no fim.
     */
    readonly exigirLiberado: (arquivo: string) => Effect.Effect<void, FalhaRevisaoPpc>;
    /** O sha256 de um `.docx` liberado, com as recusas da revisão (extensão, liberação, tamanho), sem revisá-lo. */
    readonly sha256: (arquivo: string) => Effect.Effect<string, FalhaRevisaoPpc>;
    /**
     * Libera a cópia comentada que uma execução anterior do app gravou (a liberação vive só em memória),
     * pelo original liberado: a cópia fica na pasta dele. Sem o original liberado, pede o original de novo
     * (`escolherDeNovo`), e não a cópia.
     */
    readonly liberarCopia: (original: string, copia: string) => Effect.Effect<void, FalhaRevisaoPpc>;
  }
>()("@simplifica-if/server/modulos/revisao-ppc/RevisorPpc") {}

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
  executar: typeof WorkerLimitado.rodarNoWorker,
  pedido: PedidoTrabalhador,
  limites: Limites,
  falha: (motivo: string) => FalhaRevisaoPpc,
  aoEtapa?: AoEtapa,
): Effect.Effect<Revisao, FalhaRevisaoPpc> {
  return executar<RespostaTrabalhador, AndamentoTrabalhador>(
    URL_TRABALHADOR,
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
            return Effect.logError(`revisão prévia: o Worker falhou: ${resumoDaFalha(erro)}`).pipe(
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
        : Effect.logError(`revisão prévia: defeito no Worker: ${resumoDaFalha(resposta.defeito)}`).pipe(
            Effect.andThen(Effect.fail(falha(ERRO_INTERNO))),
          );
    }),
  );
}

/* ============================================================ arquivo */

/**
 * A cópia comentada não pôde ser gravada (a pasta não aceita gravação, disco cheio). Em `cause`, só o
 * resumo da falha (`resumoDaFalha`), e a mensagem sem o destino: o span grava a mensagem e a cadeia de
 * `cause` no trace, e o destino fica ao lado do `.docx` da pessoa, fora das pastas do app.
 */
class CopiaNaoGravada extends Schema.TaggedError<CopiaNaoGravada>()("CopiaNaoGravada", {
  destino: Schema.String,
  cause: Schema.String,
}) {
  override get message(): string {
    return "a cópia comentada não foi gravada";
  }
}

/** Até quantos nomes de cópia tentar antes de desistir (o nome com a data e a hora e ` (2)` a ` (20)`). */
const COPIAS = 20;

const sha256De = (bytes: Uint8Array) => NodeCrypto.createHash("sha256").update(bytes).digest("hex");

const codigo = (erro: unknown) => (erro as NodeJS.ErrnoException | undefined)?.code;
/** O Word no Windows segura o documento aberto: renomear por cima falha com um destes. */
const TRAVADO = new Set(["EBUSY", "EPERM", "EACCES"]);

/**
 * O que há no lugar da cópia: nada, a cópia que o app gravou por último (pode ser regravada) ou outra
 * coisa, que fica: o arquivo editado pela pessoa, um que o app não conhece, um só de leitura (aberto e
 * travado) ou o que não é arquivo comum (um link, que seria seguido, ou uma pasta).
 */
async function ocupacao(destino: string, conhecida: string | null): Promise<"livre" | "do-app" | "outro"> {
  const info = await NodeFSP.lstat(destino).catch((erro: unknown) => {
    if (codigo(erro) === "ENOENT") return null;
    throw erro;
  });
  if (info === null) return "livre";
  if (!info.isFile() || conhecida === null) return "outro";
  const gravavel = await NodeFSP.access(destino, NodeFSP.constants.W_OK).then(
    () => true,
    () => false,
  );
  if (!gravavel) return "outro";
  return sha256De(await NodeFSP.readFile(destino)) === conhecida ? "do-app" : "outro";
}

/**
 * Grava num temporário da mesma pasta (criação exclusiva) e renomeia por cima do destino: quem abre a
 * cópia nunca a vê pela metade, e um link no lugar dela é trocado, não seguido. `false` se o destino
 * está travado.
 */
async function gravarPorCima(pasta: string, destino: string, bytes: Uint8Array): Promise<boolean> {
  const temporario = NodePath.join(pasta, `.${NodePath.basename(destino)}.${NodeCrypto.randomUUID()}.tmp`);
  await NodeFSP.writeFile(temporario, bytes, { flag: "wx" });
  try {
    await NodeFSP.rename(temporario, destino);
    return true;
  } catch (erro) {
    await NodeFSP.rm(temporario, { force: true });
    if (TRAVADO.has(codigo(erro) ?? "")) return false;
    throw erro;
  }
}

/** A data e a hora de um instante no fuso dele, para o nome da cópia: "2026-11-26 12h55". */
export function carimboDaCopia(quando: DateTime.DateTime): string {
  const p = DateTime.toParts(quando);
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${dois(p.month)}-${dois(p.day)} ${dois(p.hour)}h${dois(p.minute)}`;
}

/** O nome de uma cópia sem o ` (n)` do fim, para a sequência de nomes partir dele. */
export const semNumero = (nome: string) => nome.replace(/ \((?:[2-9]|[1-9]\d)\)(\.docx)$/i, "$1");

/**
 * Grava a cópia comentada ao lado do original. Cada revisão tem a sua:
 * - **cópia nova** (sem `propria`): `<nome> - revisão prévia (Simplifica IF) <data e hora>.docx`, só num
 *   nome livre (` (2)`, ` (3)`… se ocupado), para nunca gravar por cima da cópia de outra revisão;
 * - **a cópia da revisão** (`propria`, ao regravar): por cima dela, se ainda é a que o app gravou; se a
 *   pessoa a editou ou ela está travada, fica, e a cópia passa ao próximo nome livre da sequência
 *   (` (2)`, ` (3)`…), nunca por cima de outra cópia, que pode ser de outra revisão.
 */
export const gravarCopia = Effect.fn("RevisorPpc.gravarCopia")(function* (
  original: string,
  bytes: Uint8Array,
  propria: string | undefined,
  carimbo: string,
) {
  const copias = yield* CopiasComentadas.CopiasComentadas;
  const pasta = NodePath.dirname(original);
  const copia =
    propria === undefined
      ? `${NodePath.basename(original, NodePath.extname(original))}${SUFIXO_REVISAO_PREVIA} ${carimbo}.docx`
      : semNumero(NodePath.basename(propria));
  const sha256 = sha256De(bytes);
  const propriaNome = propria === undefined ? undefined : NodePath.basename(propria);
  const candidatos = [
    ...(propria === undefined ? [] : [NodePath.basename(propria)]),
    ...Array.from({ length: COPIAS }, (_, i) => comNumero(copia, i + 1)),
  ].filter((nome, i, todos) => todos.indexOf(nome) === i);
  for (const nome of candidatos) {
    const destino = NodePath.join(pasta, nome);
    const conhecida = yield* copias.conhecida(destino);
    const gravada = yield* Effect.tryPromise({
      try: async () => {
        const situacao = await ocupacao(destino, conhecida);
        // Por cima, só da própria cópia da revisão (se ainda é a que o app gravou). Os outros nomes, só
        // livres e sem registro: um nome registrado é (ou foi) a cópia de outra revisão, que ainda pode
        // apontar para ele mesmo depois de a pessoa apagar o arquivo.
        const pode = nome === propriaNome ? situacao !== "outro" : situacao === "livre" && conhecida === null;
        return pode ? gravarPorCima(pasta, destino, bytes) : false;
      },
      catch: (falha) => new CopiaNaoGravada({ destino, cause: resumoDaFalha(falha) }),
    });
    if (gravada) {
      yield* copias.registrar(destino, sha256);
      return destino;
    }
  }
  return yield* new NomesEsgotados({ pasta, primeiro: copia });
});

/* ============================================================ serviço */

/** O resultado para a interface (sem as pendências, que vão à lista, o Markdown, o aviso e as linhas da triagem). */
export const resultadoParaInterface = (arquivo: string, r: RevisaoDoArquivo): ResultadoRevisaoPpc => {
  const { aviso: _, markdown: __, linhasTextoParaIa: ___, pendencias: ____, ...resto } = r.revisao;
  return { arquivoOriginal: arquivo, arquivoComentado: r.arquivoComentado ?? "", ...resto };
};

export interface OpcoesRevisao {
  readonly limites?: Partial<Limites>;
}

export const make = Effect.fn("RevisorPpc.make")(function* (opcoes: OpcoesRevisao = {}) {
  const limites = { ...LIMITES, ...opcoes.limites };
  const executar = yield* WorkerLimitado.Executor;
  const contexto = yield* Effect.context<
    FontesNormativas.FontesNormativas | Cursos.Cursos | Normas.Normas | PacoteRevisaoPpc.PacoteRevisaoPpc
  >();
  const copias = yield* CopiasComentadas.CopiasComentadas;
  const { diaDaVigencia } = Context.get(contexto, FontesNormativas.FontesNormativas);
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

  const exigirLiberado = Effect.fn("RevisorPpc.exigirLiberado")(function* (arquivo: string) {
    if (yield* liberacao.liberado(arquivo)) return;
    return yield* new FalhaRevisaoPpc({
      arquivo,
      motivo: `Escolha de novo o arquivo “${NodePath.basename(arquivo)}”, pelo botão “Escolher o PPC” ou soltando-o na janela do app: depois que o app é fechado, ele pede o arquivo outra vez.`,
      escolherDeNovo: true,
    });
  });

  const lerArquivo = Effect.fn("RevisorPpc.lerArquivo")(function* (arquivo: string, aoEtapa?: AoEtapa) {
    const falha = (motivo: string) => new FalhaRevisaoPpc({ arquivo, motivo });
    if (!NodePath.isAbsolute(arquivo) || NodePath.extname(arquivo).toLowerCase() !== ".docx")
      return yield* falha("Escolha um arquivo do Word (.docx).");
    yield* exigirLiberado(arquivo);
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
    aoEtapa?.("lendo");
    const bytes = yield* Effect.tryPromise({
      try: () => NodeFSP.readFile(arquivo),
      catch: () => falha("O arquivo não pode ser lido."),
    });
    const sha256 = NodeCrypto.createHash("sha256").update(bytes).digest("hex");
    return { bytes, sha256 };
  });

  const revisarUm = Effect.fn("RevisorPpc.revisarArquivo")(function* (entrada: EntradaRevisarArquivo) {
    const arquivo = entrada.arquivo;
    const falha = (motivo: string) => new FalhaRevisaoPpc({ arquivo, motivo });
    const { bytes, sha256 } = yield* lerArquivo(arquivo, entrada.aoEtapa);
    if (entrada.sha256 !== undefined && entrada.sha256 !== sha256)
      return yield* falha(
        "O arquivo mudou depois que a revisão começou. Revise o arquivo de novo para começar outra revisão.",
      );
    const dados = yield* base.pipe(
      Effect.mapError(() => falha("A base de normas do Simplifica IF não pôde ser lida. Reinicie o app.")),
    );
    const revisao = yield* rodarNoTrabalhador(
      executar,
      {
        // Cópia própria: o buffer é transferido ao Worker, e um `Buffer` do Node pode ser fatia de um pool.
        bytes: new Uint8Array(bytes),
        nome: NodePath.basename(arquivo),
        // A base fica em cache; a vigência, não: cada revisão a calcula no próprio dia.
        base: { ...dados, dataBase: yield* diaDaVigencia },
        agora: DateTime.formatIso(yield* DateTime.now),
        comentar: entrada.gravar,
        cnct: entrada.cnct,
        forma: entrada.forma,
        ia: entrada.ia,
        situacoes: entrada.situacoes,
      },
      limites,
      falha,
      entrada.aoEtapa,
    );
    const arquivoComentado =
      entrada.gravar && revisao.docx !== null
        ? yield* gravarCopia(
            arquivo,
            revisao.docx,
            entrada.copia === undefined || entrada.copia === "" ? undefined : entrada.copia,
            carimboDaCopia(DateTime.setZone(yield* DateTime.now, DateTime.zoneMakeLocal())),
          ).pipe(
            Effect.provideService(CopiasComentadas.CopiasComentadas, copias),
            Effect.tapError((erro) =>
              Effect.logError(`revisão prévia: a cópia comentada não foi gravada: ${resumoDaFalha(erro)}`),
            ),
            Effect.mapError(() =>
              falha(
                "Não foi possível gravar a cópia comentada na pasta do arquivo. Confira se a pasta aceita gravação.",
              ),
            ),
          )
        : null;
    if (arquivoComentado !== null) yield* liberacao.liberar(arquivoComentado);
    const { docx: _, ...semDocx } = revisao;
    return { revisao: semDocx, sha256, arquivoComentado } satisfies RevisaoDoArquivo;
  });

  const revisarArquivo = (entrada: EntradaRevisarArquivo) =>
    entrada.seOcupada === "recusar"
      ? revisarUm(entrada).pipe(
          vez.withPermitsIfAvailable(1),
          Effect.flatMap(
            Option.match({
              onSome: (resultado) => Effect.succeed(resultado),
              onNone: () =>
                Effect.fail(
                  new FalhaRevisaoPpc({
                    arquivo: entrada.arquivo,
                    motivo:
                      "Já há uma revisão em andamento (pode ser a conferência do arquivo que você salvou no Word). Espere ela terminar e tente de novo.",
                  }),
                ),
            }),
          ),
        )
      : revisarUm(entrada).pipe(vez.withPermits(1));

  // A parte da base dos verificadores que não depende do PPC, montada uma vez (o registro e a vigência).
  const verificacao = yield* Effect.cached(base.pipe(Effect.map((dados) => ({ dados, ...verificacaoDaBase(dados) }))));

  const montar = Effect.fn("RevisorPpc.montar")(function* (entrada: EntradaMontagem) {
    const { dados, ...comum } = yield* verificacao.pipe(
      Effect.mapError(
        () =>
          new FalhaRevisaoPpc({
            arquivo: entrada.arquivo,
            motivo: "A base de normas do Simplifica IF não pôde ser lida. Reinicie o app.",
          }),
      ),
    );
    const texto = revisarMarkdown(entrada.markdown, dados, {
      ia: entrada.ia,
      cnct: entrada.cnct,
      forma: entrada.forma,
      verificacao: comum,
    });
    const { pendencias, itens: _, temasForaDaRevisao: __, linhasTextoParaIa: ___, ...resto } = texto;
    return {
      resultado: { arquivoOriginal: entrada.arquivo, arquivoComentado: entrada.arquivoComentado, ...resto },
      pendencias,
    };
  });

  const ocupada = vez.withPermitsIfAvailable(1)(Effect.void).pipe(Effect.map(Option.isNone));
  const sha256 = Effect.fn("RevisorPpc.sha256")(function* (arquivo: string) {
    return (yield* lerArquivo(arquivo)).sha256;
  });
  const liberarCopia = Effect.fn("RevisorPpc.liberarCopia")(function* (original: string, copia: string) {
    yield* exigirLiberado(original);
    if (NodePath.dirname(copia) !== NodePath.dirname(original) || NodePath.extname(copia).toLowerCase() !== ".docx")
      return yield* new FalhaRevisaoPpc({ arquivo: copia, motivo: "A cópia comentada não está na pasta do PPC." });
    yield* liberacao.liberar(copia);
  });
  return RevisorPpc.of({ revisarArquivo, montar, ocupada, exigirLiberado, sha256, liberarCopia });
});

/**
 * O serviço sobre os serviços do kb (`FontesNormativas`, `Cursos`, `Normas` e `PacoteRevisaoPpc` do
 * `kb.sqlite`, os do `Leitura` do servidor), os `ArquivosLiberados` e as `CopiasComentadas`.
 */
export const layer = (opcoes: OpcoesRevisao = {}) => Layer.effect(RevisorPpc, make(opcoes));
