// @effect-diagnostics nodeBuiltinImport:off -- O_NOFOLLOW, rmdir e o SHA-256 incremental, que o FileSystem e o Digest do Effect não expõem
/**
 * As três operações de arquivo das `PastasTrabalho` que a plataforma do Effect não oferece, com o
 * Node direto. O resto das pastas usa o `FileSystem`.
 *
 * - **Temporário sem seguir link.** O Desfazer grava num temporário novo (`O_CREAT | O_EXCL |
 *   O_NOFOLLOW`) e o troca pelo alvo com `rename`: um link plantado no lugar do temporário não leva a
 *   escrita para fora da pasta. O `FileSystem` do Effect só aceita o `OpenFlag` em texto (`"wx"`), sem
 *   `O_NOFOLLOW`. `O_NOFOLLOW` não existe no Windows.
 * - **Pasta vazia.** O `remove` do `FileSystem` é o `rm` do Node, que numa pasta exige `recursive` e
 *   então apaga o que tiver entrado nela depois da conferência; o `rmdir` recusa a pasta que não está
 *   vazia.
 * - **SHA-256 por partes.** O `Digest` do Effect só recebe os bytes inteiros; o retrato da pasta lê
 *   cada arquivo por `FileSystem.stream` e atualiza o hash a cada pedaço.
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/** A operação do Node falhou. */
export class EscritaNaoFeita extends Schema.TaggedError<EscritaNaoFeita>()("EscritaNaoFeita", {
  operacao: Schema.Literals(["temporario", "pasta-vazia"]),
  caminho: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return this.operacao === "temporario"
      ? `não foi possível gravar o temporário em ${this.caminho}`
      : `não foi possível remover a pasta vazia ${this.caminho}`;
  }
}

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
