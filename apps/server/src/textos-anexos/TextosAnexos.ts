// @effect-diagnostics nodeBuiltinImport:off -- o resumo do nome longo é síncrono, numa função pura (`caminhoDoTexto`)
/**
 * `TextosAnexos`: a versão em texto dos anexos que a IA não lê sozinha (proposta "Anexos em texto
 * para a IA", `docs/plans/propostas/anexos-em-texto.md`).
 *
 * Hoje só o `.docx`: o Claude não o lê, e o Codex e o Gemini só com um conversor instalado e um
 * comando, que pede aprovação. Ao anexar, `PastasTrabalho.anexar` chama `converter`, que roda
 * `docxParaMarkdown` num Worker com teto de memória e de tempo (`WorkerLimitado.ts`) e devolve o
 * Markdown com o cabeçalho; o `PastasTrabalho` o grava em `<pasta>/.simplifica/textos/<nome>.md`
 * (`PASTA_TEXTOS`). A pasta é oculta: fica fora da lista do painel e do Desfazer (o texto é derivado),
 * e a IA o acha pelo caminho que a nota do pedido dá.
 *
 * `converter` nunca falha: o anexo vale mesmo sem texto, e o motivo vai para a nota (`semTexto`).
 *
 * No app empacotado, o Worker é o `trabalhador-textos.mjs` do bundle, ao lado do `bin.mjs`
 * (`apps/desktop/scripts/construir.ts`); no desenvolvimento, o `trabalhador.ts`.
 */
import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";
import { mensagemErroDocx } from "@simplifica-if/docx/erro";
import { type FalhaWorker, type LimitesWorker, rodarNoWorker } from "../WorkerLimitado.ts";
import type { PedidoTexto, RespostaTexto } from "./trabalhador.ts";

/** Onde fica o texto, relativo à pasta da tarefa (com `/`). */
export const PASTA_TEXTOS = ".simplifica/textos";

/** As extensões que ganham versão em texto. */
export const EXTENSOES_CONVERTIDAS: ReadonlyArray<string> = [".docx"];

export interface Limites extends LimitesWorker {
  /** Tamanho máximo do arquivo, conferido antes de ler (o de `LIMITES_PADRAO.bytesDoArquivo`). */
  readonly bytesDoArquivo: number;
}

export const LIMITES: Limites = { bytesDoArquivo: 20 * 1024 * 1024, memoriaMb: 512, tempoMs: 30_000 };

/** O Markdown (com o cabeçalho), por que não há, ou o formato que não se converte (a IA já o lê). */
export type ResultadoTexto =
  | { readonly tipo: "texto"; readonly markdown: string }
  | { readonly tipo: "sem-texto"; readonly motivo: string }
  | { readonly tipo: "nao-converte" };

/** O tamanho máximo do nome do `.md`, em bytes: o sistema de arquivos aceita 255. */
const BYTES_DO_NOME = 200;

/**
 * O caminho do texto de `nome`, relativo à pasta da tarefa: `.simplifica/textos/<nome>.md`. O nome
 * perde o que a gravação recusa (`\` e caracteres de controle, que o macOS aceita num nome) e, longo
 * demais, é cortado e ganha um resumo do nome inteiro, para não colidir com outro de mesmo começo.
 */
export function caminhoDoTexto(nome: string): string {
  // oxlint-disable-next-line no-control-regex -- os caracteres de controle são justamente o que sai
  let seguro = nome.replace(/[\\\u0000-\u001f\u007f]/g, "_");
  const codificador = new TextEncoder();
  if (codificador.encode(seguro).length > BYTES_DO_NOME) {
    const resumo = NodeCrypto.createHash("sha256").update(nome).digest("hex").slice(0, 8);
    let corte = [...seguro];
    while (codificador.encode(corte.join("")).length > BYTES_DO_NOME - 9) corte = corte.slice(0, -1);
    seguro = `${corte.join("")}-${resumo}`;
  }
  return `${PASTA_TEXTOS}/${seguro}.md`;
}

export class TextosAnexos extends Context.Service<
  TextosAnexos,
  {
    /**
     * A versão em texto de `arquivo` (caminho absoluto), com `nome` no cabeçalho. A extensão de `nome`
     * decide se há conversão. Nunca falha.
     */
    readonly converter: (arquivo: string, nome: string) => Effect.Effect<ResultadoTexto>;
  }
>()("@simplifica-if/server/textos-anexos/TextosAnexos") {}

/** O script do Worker: o `.ts` ao lado deste no desenvolvimento, o `trabalhador-textos.mjs` no bundle. */
export const URL_TRABALHADOR = import.meta.url.endsWith(".ts")
  ? new URL("./trabalhador.ts", import.meta.url)
  : new URL("./trabalhador-textos.mjs", import.meta.url);

const ERRO_INTERNO = "Um erro interno do Simplifica IF impediu a conversão.";

const semTexto = (motivo: string): ResultadoTexto => ({ tipo: "sem-texto", motivo });

const DATA = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

/** A linha do começo do texto: de onde veio e o que pode faltar, para a IA saber o limite do que leu. */
export function cabecalhoTexto(nome: string, data: string): string {
  // Um nome com quebra de linha (o macOS aceita) não abre linhas próprias no cabeçalho.
  const umaLinha = nome.replace(/[\r\n]+/g, " ");
  return (
    `> Texto extraído automaticamente de "${umaLinha}" pelo Simplifica IF em ${data}, para leitura pela IA. ` +
    "Títulos, listas, tabelas e notas de rodapé entram; imagens, comentários do Word e o texto excluído " +
    "com alterações controladas, não. Na dúvida sobre um trecho, peça à pessoa que confira no original.\n\n"
  );
}

export interface OpcoesTextos {
  readonly limites?: Partial<Limites>;
  readonly trabalhador?: URL;
}

export const make = Effect.fn("TextosAnexos.make")(function* (opcoes: OpcoesTextos = {}) {
  const limites = { ...LIMITES, ...opcoes.limites };
  const url = opcoes.trabalhador ?? URL_TRABALHADOR;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // Uma conversão por vez: cada Worker pode usar até `memoriaMb` de heap.
  const vez = yield* Semaphore.make(1);

  /** O Markdown do arquivo, sem o cabeçalho, ou por que não há. */
  const markdownDe = Effect.fn("TextosAnexos.markdownDe")(function* (arquivo: string) {
    const info = yield* fs.stat(arquivo);
    if (Number(info.size) > limites.bytesDoArquivo)
      return semTexto(`O arquivo passa de ${Math.round(limites.bytesDoArquivo / 1024 / 1024)} MB.`);
    const bytes = yield* fs.readFile(arquivo);
    // Cópia própria: o buffer é transferido ao Worker, e o lido pode ser fatia de um pool.
    const pedido: PedidoTexto = { bytes: new Uint8Array(bytes) };
    const resposta = yield* vez.withPermits(1)(
      rodarNoWorker<RespostaTexto>(url, pedido, [pedido.bytes.buffer as ArrayBuffer], limites),
    );
    if (resposta.ok) return { tipo: "texto", markdown: resposta.markdown } satisfies ResultadoTexto;
    if ("arquivoInvalido" in resposta) return semTexto(mensagemErroDocx(resposta.arquivoInvalido));
    yield* Effect.logError("texto do anexo: defeito no Worker", resposta.defeito);
    return semTexto(ERRO_INTERNO);
  });

  /** O motivo da falha do Worker, para a pessoa; o que não é limite vai para o log. */
  const motivoDoWorker = (erro: FalhaWorker): Effect.Effect<ResultadoTexto> => {
    switch (erro.motivo) {
      case "memoria":
        return Effect.succeed(semTexto("O arquivo exigiu memória demais para virar texto."));
      case "tempo":
        return Effect.succeed(semTexto("A conversão passou do tempo máximo."));
      case "parou":
      case "erro":
        return Effect.logError("texto do anexo: o Worker falhou", erro).pipe(Effect.as(semTexto(ERRO_INTERNO)));
    }
  };

  const converter = Effect.fn("TextosAnexos.converter")(function* (arquivo: string, nome: string) {
    if (!EXTENSOES_CONVERTIDAS.includes(path.extname(nome).toLowerCase()))
      return { tipo: "nao-converte" } satisfies ResultadoTexto;
    const saida: ResultadoTexto = yield* markdownDe(arquivo).pipe(
      Effect.catchTags({ FalhaWorker: motivoDoWorker }),
      // Arquivo que sumiu ou não abre: o anexo vale sem o texto.
      Effect.catch((erro) =>
        Effect.logError("texto do anexo: não foi possível ler o arquivo", erro).pipe(
          Effect.as(semTexto("O arquivo não pôde ser lido.")),
        ),
      ),
    );
    if (saida.tipo !== "texto") return saida;
    const data = DATA.format(DateTime.toDateUtc(yield* DateTime.now));
    return { tipo: "texto", markdown: cabecalhoTexto(nome, data) + saida.markdown } satisfies ResultadoTexto;
  });

  return TextosAnexos.of({ converter });
});

/** Pede o `FileSystem` e o `Path`. */
export const layer = (opcoes: OpcoesTextos = {}) => Layer.effect(TextosAnexos, make(opcoes));
