/**
 * `PastaTrabalho`: o único ponto em que o simplifica-mcp lê um arquivo fora do `kb.sqlite`. Serve ao
 * `pacote_contexto` com `arquivo`: o `.md` de um PPC fora da base, que tem de estar dentro da pasta
 * de trabalho informada na inicialização (`--pasta-trabalho`, padrão: o diretório atual).
 *
 * A conferência tem duas etapas. Antes de tocar no disco, o caminho pedido (relativo ou absoluto) é
 * resolvido contra a pasta e recusado se sair dela, o que pega o `..` e o caminho absoluto de fora,
 * sem revelar se o arquivo de fora existe (a exceção é o nome curto 8.3 do Windows, que só o disco
 * traduz para o longo; a recusa continua igual). Depois de conferir que o arquivo existe, o caminho real
 * (`realPath`, que segue os links simbólicos) é conferido de novo: um symlink dentro da pasta que
 * aponta para fora é recusado.
 *
 * O `FileSystem` entra só aqui. A layer do kb (`layerSomenteLeitura`) continua sem ele, e o `Leitura`
 * pede este serviço como opcional: sem ele (o RPC do app, por exemplo), `arquivo` é recusado. No
 * servidor HTTP, cada sessão tem a sua (`make`), fornecida por requisição.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { EntradaInvalida } from "../contratos.ts";

/** Maior `.md` aceito: o maior PPC da base tem cerca de 1 MB. */
export const TAMANHO_MAXIMO = 8 * 1024 * 1024;

/** A pasta de trabalho não existe ou não é uma pasta. */
export class PastaTrabalhoInvalida extends Schema.TaggedError<PastaTrabalhoInvalida>()("PastaTrabalhoInvalida", {
  pasta: Schema.String,
}) {
  override get message(): string {
    return `pasta de trabalho não encontrada: ${this.pasta}`;
  }
}

export const ehPastaTrabalhoInvalida = Schema.is(PastaTrabalhoInvalida);

/** Um `.md` lido da pasta de trabalho. */
export interface ArquivoLido {
  /** Caminho relativo à pasta, com `/` (o que entra no pacote como `path`). */
  readonly caminho: string;
  readonly markdown: string;
}

export class PastaTrabalho extends Context.Service<
  PastaTrabalho,
  {
    /** O caminho real da pasta. */
    readonly pasta: string;
    /** Lê o `.md` em `arquivo` (relativo à pasta, ou absoluto dentro dela). */
    readonly lerMarkdown: (arquivo: string) => Effect.Effect<ArquivoLido, EntradaInvalida>;
  }
>()("@simplifica-if/mcp/leitura/PastaTrabalho") {}

/** `relativo` (de `path.relative`) fica dentro da pasta. */
function dentro(path: Path.Path, relativo: string): boolean {
  return relativo !== "" && !path.isAbsolute(relativo) && relativo.split(path.sep)[0] !== "..";
}

/** A pasta de trabalho em `pasta`, conferida; o servidor HTTP monta uma por sessão. */
export const make = Effect.fn("PastaTrabalho.make")(function* (opcoes: { readonly pasta: string }) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const invalida = () => new PastaTrabalhoInvalida({ pasta: opcoes.pasta });
  const info = yield* fs.stat(opcoes.pasta).pipe(Effect.mapError(invalida));
  if (info.type !== "Directory") return yield* invalida();
  const pasta = yield* fs.realPath(opcoes.pasta).pipe(Effect.mapError(invalida));
  const informada = path.resolve(opcoes.pasta);

  const recusar = (mensagem: string) => new EntradaInvalida({ mensagem: `arquivo: ${mensagem}` });
  const naoLido = (arquivo: string) => () => recusar(`não foi possível ler "${arquivo}"`);

  const lerMarkdown = Effect.fn("PastaTrabalho.lerMarkdown")(function* (arquivo: string) {
    if (!arquivo.toLowerCase().endsWith(".md")) {
      return yield* recusar(`esperava um arquivo .md (o PPC convertido para Markdown), veio "${arquivo}"`);
    }
    // 1. o caminho pedido, sem tocar no disco: `..` e caminho absoluto de fora param aqui. O absoluto
    // vale tanto com o caminho real da pasta quanto com o informado (no macOS, /var é link para /private/var)
    const pedido = path.resolve(pasta, arquivo);
    let relativo = [pasta, informada].map((base) => path.relative(base, pedido)).find((r) => dentro(path, r));
    // No Windows, o mesmo caminho tem dois nomes: o curto 8.3 (`C:\Users\RUNNER~1\…`, o que o TEMP costuma
    // trazer) e o longo (`C:\Users\runneradmin\…`, o do diretório atual e do caminho real). O texto não
    // basta para comparar os dois; só então se resolve o caminho real, e a recusa continua a mesma
    // mensagem, exista ou não o arquivo
    if (relativo === undefined && path.sep === "\\" && pedido.includes("~")) {
      const real = yield* fs.realPath(pedido).pipe(Effect.option);
      if (real._tag === "Some") {
        const r = path.relative(pasta, real.value);
        if (dentro(path, r)) relativo = r;
      }
    }
    if (relativo === undefined) {
      return yield* recusar(
        `"${arquivo}" fica fora da pasta de trabalho (${pasta}). O servidor só lê arquivos dentro dela; copie o arquivo para lá ou inicie o servidor com --pasta-trabalho`,
      );
    }
    // 2. existe?
    if (!(yield* fs.exists(pedido).pipe(Effect.mapError(naoLido(arquivo))))) {
      return yield* recusar(`"${arquivo}" não existe na pasta de trabalho (${pasta})`);
    }
    // 3. o caminho real, com os links simbólicos seguidos, continua dentro da pasta?
    const real = yield* fs.realPath(pedido).pipe(Effect.mapError(naoLido(arquivo)));
    if (!dentro(path, path.relative(pasta, real))) {
      return yield* recusar(
        `"${arquivo}" é um link simbólico para fora da pasta de trabalho (${pasta}); o servidor só lê arquivos dentro dela`,
      );
    }
    const info = yield* fs.stat(real).pipe(Effect.mapError(naoLido(arquivo)));
    if (info.type !== "File") return yield* recusar(`"${arquivo}" não é um arquivo`);
    if (Number(info.size) > TAMANHO_MAXIMO) {
      return yield* recusar(`"${arquivo}" passa de ${TAMANHO_MAXIMO / 1024 / 1024} MB; não parece um PPC em Markdown`);
    }
    const markdown = yield* fs.readFileString(real).pipe(Effect.mapError(naoLido(arquivo)));
    const lido: ArquivoLido = { caminho: relativo.split(path.sep).join("/"), markdown };
    return lido;
  });

  return PastaTrabalho.of({ pasta, lerMarkdown });
});

/** A pasta de trabalho em `pasta` (relativa ao diretório atual ou absoluta). */
export const layer = (opcoes: { readonly pasta: string }) => Layer.effect(PastaTrabalho, make(opcoes));
