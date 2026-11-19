// @effect-diagnostics nodeBuiltinImport:off -- O_NOFOLLOW no Windows, a leitura pelo descritor conferido, unlink, rmdir e o SHA-256 incremental, que o FileSystem e o Digest do Effect não oferecem como as pastas precisam
/**
 * As operações de arquivo das `PastasTrabalho` que a plataforma do Effect não oferece como as pastas
 * precisam, com o Node direto. O resto das pastas usa o `FileSystem`.
 *
 * - **Temporário sem seguir link.** O Desfazer grava num temporário novo (`O_CREAT | O_EXCL |
 *   O_NOFOLLOW`) e o troca pelo alvo com `rename`: um link plantado no lugar do temporário não leva a
 *   escrita para fora da pasta. O `open` do `FileSystem` aceita `noFollow`, mas no Windows (sem
 *   `O_NOFOLLOW`) falha com `BadArgument`; aqui o `O_NOFOLLOW` entra só onde existe, e no Windows a
 *   proteção fica com o `O_EXCL` e o `rename`.
 * - **Arquivo ou link, sem seguir link.** O `remove` do `FileSystem` é o `rm` do Node, que numa pasta
 *   com `recursive` apaga o que tiver dentro; o `unlink` só remove o arquivo ou o próprio link e recusa
 *   a pasta que tiver entrado no lugar depois da conferência.
 * - **Pasta vazia.** Pelo mesmo motivo, o `rmdir` recusa a pasta que não está vazia.
 * - **Leitura sem seguir link.** O documento que vira texto (`lerSemSeguirLinks`) é aberto sem seguir
 *   link (`O_NOFOLLOW`; no macOS, `O_NOFOLLOW_ANY`, em todo o caminho) e lido pelo descritor, depois de
 *   conferir que ele está na pasta (no Linux, pelo `/proc/self/fd`; em todos, pelo caminho real e o
 *   `dev`/`ino`): a IA escreve na pasta e poderia trocar o arquivo, ou uma subpasta do caminho, por um
 *   link para fora. O `FileSystem` não dá essas conferências sobre o mesmo descritor.
 * - **SHA-256 por partes.** O `Digest` do Effect só recebe os bytes inteiros; o retrato da pasta lê
 *   cada arquivo por `FileSystem.stream` e atualiza o hash a cada pedaço.
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HostProcess from "@simplifica-if/motor/t3/HostProcess";

/** A operação do Node falhou. */
export class EscritaNaoFeita extends Schema.TaggedError<EscritaNaoFeita>()("EscritaNaoFeita", {
  operacao: Schema.Literals(["temporario", "arquivo", "pasta-vazia"]),
  caminho: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    switch (this.operacao) {
      case "temporario":
        return `não foi possível gravar o temporário em ${this.caminho}`;
      case "arquivo":
        return `não foi possível remover o arquivo ${this.caminho}`;
      case "pasta-vazia":
        return `não foi possível remover a pasta vazia ${this.caminho}`;
    }
  }
}

/**
 * A leitura de `caminho` (relativo à pasta) foi recusada: o que está lá não é um arquivo comum da pasta,
 * ou mudou entre a abertura e a conferência (o `motivo` é só diagnóstico; quem chama trata todos igual).
 */
export class LeituraRecusada extends Schema.TaggedError<LeituraRecusada>()("LeituraRecusada", {
  motivo: Schema.Literals(["link", "nao-e-arquivo", "fora-da-pasta", "trocado"]),
  caminho: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.motivo) {
      case "link":
        return `${this.caminho} passa por um link simbólico e não foi lido`;
      case "nao-e-arquivo":
        return `${this.caminho} não é um arquivo comum e não foi lido`;
      case "fora-da-pasta":
        return `${this.caminho} leva para fora da pasta e não foi lido`;
      case "trocado":
        return `${this.caminho} foi trocado ou removido durante a leitura`;
    }
  }
}

/** O arquivo passa do tamanho máximo e não foi lido. */
export class ArquivoGrandeDemais extends Schema.TaggedError<ArquivoGrandeDemais>()("ArquivoGrandeDemais", {
  caminho: Schema.String,
  maximoBytes: Schema.Number,
}) {
  override get message(): string {
    return `${this.caminho} passa de ${this.maximoBytes} bytes e não foi lido`;
  }
}

/** A leitura de `caminho` falhou por erro de E/S (disco, permissão). */
export class LeituraNaoFeita extends Schema.TaggedError<LeituraNaoFeita>()("LeituraNaoFeita", {
  caminho: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `não foi possível ler ${this.caminho}`;
  }
}

const codigoDe = (cause: unknown): unknown =>
  typeof cause === "object" && cause !== null && "code" in cause ? cause.code : undefined;

// `O_NONBLOCK`: um FIFO no lugar do arquivo não trava a abertura (o `fstat` o recusa em seguida).
const LEITURA = NodeFS.constants.O_RDONLY | (NodeFS.constants.O_NONBLOCK ?? 0);

/**
 * O `O_NOFOLLOW_ANY` do macOS (`sys/fcntl.h`): a abertura recusa link em qualquer parte do caminho, não
 * só na última. O Node não exporta a constante, mas passa o valor ao `open`; ele não vai junto com o
 * `O_NOFOLLOW` (`EINVAL`) e recusa também o link acima da pasta (`/tmp` → `/private/tmp`): por isso o
 * caminho se monta sobre a pasta já resolvida.
 */
const O_NOFOLLOW_ANY = 0x2000_0000;

const abrirLeitura = (plataforma: string) =>
  LEITURA | (plataforma === "darwin" ? O_NOFOLLOW_ANY : (NodeFS.constants.O_NOFOLLOW ?? 0));

/** O que a falha na abertura quer dizer. */
const naAbertura = (caminho: string, cause: unknown): LeituraRecusada | LeituraNaoFeita => {
  switch (codigoDe(cause)) {
    // O link recusado pelo `O_NOFOLLOW` (`EMLINK` no FreeBSD).
    case "ELOOP":
    case "EMLINK":
      return new LeituraRecusada({ motivo: "link", caminho, cause });
    // A pasta no lugar do arquivo (no Windows, a abertura falha).
    case "EISDIR":
      return new LeituraRecusada({ motivo: "nao-e-arquivo", caminho, cause });
    // O arquivo saiu, ou uma parte do caminho deixou de ser pasta, depois do retrato: troca, não erro.
    case "ENOENT":
    case "ENOTDIR":
      return new LeituraRecusada({ motivo: "trocado", caminho, cause });
    default:
      return new LeituraNaoFeita({ caminho, cause });
  }
};

const PEDACO = 1024 * 1024;

/** Os bytes do descritor, do começo; `undefined` se passam de `maximo` (o arquivo cresceu depois do `fstat`). */
const lerAte = async (arquivo: NodeFSP.FileHandle, maximo: number): Promise<Uint8Array | undefined> => {
  const pedacos: Array<Uint8Array> = [];
  let total = 0;
  while (total <= maximo) {
    const pedaco = new Uint8Array(Math.min(PEDACO, maximo + 1 - total));
    const { bytesRead } = await arquivo.read(pedaco, 0, pedaco.length, total);
    if (bytesRead === 0) break;
    pedacos.push(pedaco.subarray(0, bytesRead));
    total += bytesRead;
  }
  if (total > maximo) return undefined;
  const bytes = new Uint8Array(total);
  let posicao = 0;
  for (const pedaco of pedacos) {
    bytes.set(pedaco, posicao);
    posicao += pedaco.length;
  }
  return bytes;
};

/** `caminho` está dentro de `base` (os dois pelo `realpath` nativo)? */
const dentroDe = (base: string, caminho: string) => caminho.startsWith(base + NodePath.sep);

/**
 * Os bytes de `real/relativo` (`real`: a pasta da tarefa), sem seguir link, lidos pelo descritor depois
 * de conferido: arquivo comum, até `maximoBytes`, e dentro da pasta. A IA escreve na pasta e poderia
 * trocar o arquivo, ou uma subpasta do caminho, por um link para fora entre a conferência e a leitura.
 *
 * - **macOS:** a abertura com `O_NOFOLLOW_ANY` recusa link em qualquer parte do caminho.
 * - **Linux:** o caminho do próprio descritor (`/proc/self/fd`), que o kernel dá, precisa estar na pasta.
 * - **Os dois, e o resto:** o caminho real do arquivo precisa estar na pasta e levar ao mesmo arquivo
 *   aberto (`dev`/`ino`). No Windows (sem `O_NOFOLLOW` nem `/proc`), só esta conferência vale: uma
 *   junction posta e tirada entre a abertura e a conferência ainda passaria (risco residual). Um hard
 *   link para um arquivo de fora também passa, mas exige o mesmo volume e a leitura do alvo, com que se
 *   poderia simplesmente copiá-lo para a pasta.
 *
 * A pasta passa pelo mesmo `realpath` nativo do arquivo: o do `FileSystem` do Effect (em JS fora do
 * Windows) guarda a caixa e a forma Unicode que recebeu, e a comparação recusaria à toa no APFS.
 */
export const lerSemSeguirLinks = Effect.fn("pastasNode.lerSemSeguirLinks")(function* (
  real: string,
  relativo: string,
  maximoBytes: number,
) {
  const plataforma = yield* HostProcess.Platform;
  const recusa = (motivo: LeituraRecusada["motivo"], cause?: unknown) =>
    new LeituraRecusada({ motivo, caminho: relativo, ...(cause === undefined ? {} : { cause }) });
  const falhaDeLeitura = (cause: unknown) => new LeituraNaoFeita({ caminho: relativo, cause });
  const base = yield* Effect.tryPromise({ try: () => NodeFSP.realpath(real), catch: falhaDeLeitura });
  const caminho = NodePath.join(base, relativo);
  return yield* Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => NodeFSP.open(caminho, abrirLeitura(plataforma)),
      catch: (cause) => naAbertura(relativo, cause),
    }),
    (arquivo) =>
      Effect.gen(function* () {
        // `bigint`: no Windows, o `ino` é o índice de 64 bits do arquivo, que um `number` arredonda.
        const aberto = yield* Effect.tryPromise({ try: () => arquivo.stat({ bigint: true }), catch: falhaDeLeitura });
        if (!aberto.isFile()) return yield* recusa("nao-e-arquivo");
        if (aberto.size > BigInt(maximoBytes))
          return yield* new ArquivoGrandeDemais({ caminho: relativo, maximoBytes });
        // O caminho do descritor, onde o sistema o dá: sem `/proc` (macOS, Windows), `undefined`.
        const doDescritor = yield* Effect.promise(() =>
          NodeFSP.readlink(`/proc/self/fd/${arquivo.fd}`).catch(() => undefined),
        );
        if (doDescritor !== undefined && !dentroDe(base, doDescritor)) return yield* recusa("fora-da-pasta");
        // O caminho que já não leva a um arquivo (removido ou trocado depois da abertura) é troca.
        const caminhoReal = yield* Effect.tryPromise({
          try: () => NodeFSP.realpath(caminho),
          catch: (cause) => recusa("trocado", cause),
        });
        if (!dentroDe(base, caminhoReal)) return yield* recusa("fora-da-pasta");
        const doCaminho = yield* Effect.tryPromise({
          try: () => NodeFSP.stat(caminhoReal, { bigint: true }),
          catch: (cause) => recusa("trocado", cause),
        });
        if (doCaminho.dev !== aberto.dev || doCaminho.ino !== aberto.ino) return yield* recusa("trocado");
        const bytes = yield* Effect.tryPromise({ try: () => lerAte(arquivo, maximoBytes), catch: falhaDeLeitura });
        return bytes ?? (yield* new ArquivoGrandeDemais({ caminho: relativo, maximoBytes }));
      }),
    (arquivo) => Effect.promise(() => arquivo.close().catch(() => undefined)),
  );
});

const ABRIR_TEMPORARIO =
  NodeFS.constants.O_WRONLY | NodeFS.constants.O_CREAT | NodeFS.constants.O_EXCL | (NodeFS.constants.O_NOFOLLOW ?? 0);

/** Grava `conteudo` num arquivo novo `<pasta>/<prefixo><uuid>`, sem seguir link, e devolve o caminho. */
export const gravarTemporario = Effect.fn("pastasNode.gravarTemporario")(function* (
  pasta: string,
  prefixo: string,
  conteudo: Uint8Array,
) {
  const temporario = NodePath.join(pasta, `${prefixo}${NodeCrypto.randomUUID()}`);
  yield* Effect.tryPromise({
    try: async () => {
      const arquivo = await NodeFSP.open(temporario, ABRIR_TEMPORARIO, 0o644);
      try {
        await arquivo.writeFile(conteudo);
      } finally {
        await arquivo.close();
      }
    },
    catch: (cause) => new EscritaNaoFeita({ operacao: "temporario", caminho: pasta, cause }),
  });
  return temporario;
});

/** Remove o arquivo ou o próprio link (nunca o alvo); uma pasta no lugar faz falhar. */
export const removerArquivo = Effect.fn("pastasNode.removerArquivo")(function* (caminho: string) {
  yield* Effect.tryPromise({
    try: () => NodeFSP.unlink(caminho),
    catch: (cause) => new EscritaNaoFeita({ operacao: "arquivo", caminho, cause }),
  });
});

/** Remove a pasta se ela estiver vazia; com algo dentro, falha. */
export const removerPastaVazia = Effect.fn("pastasNode.removerPastaVazia")(function* (pasta: string) {
  yield* Effect.tryPromise({
    try: () => NodeFSP.rmdir(pasta),
    catch: (cause) => new EscritaNaoFeita({ operacao: "pasta-vazia", caminho: pasta, cause }),
  });
});

/** Um SHA-256 alimentado por partes (`atualizar`) e lido no fim (`hex`). */
export const novoSha256 = () => {
  const hash = NodeCrypto.createHash("sha256");
  return {
    atualizar: (pedaco: Uint8Array) => void hash.update(pedaco),
    hex: () => hash.digest("hex"),
  };
};
