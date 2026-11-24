// @effect-diagnostics nodeBuiltinImport:off -- gravação atômica síncrona de arquivos da base (node:fs, node:crypto), como o resto do pipeline; os chamadores a levam para o canal de erro
/** Gravação de vários arquivos da base de uma vez (tudo ou nada) e edição de registro que preserva a ordem das chaves. */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Schema from "effect/Schema";

/**
 * `objeto` com `chave` = `valor`: no mesmo lugar, se a chave já existe; senão, antes da primeira chave
 * existente que vem depois dela em `ordem` (a ordem dos campos do schema). As outras chaves não mudam
 * de posição, para o registro já completo sair igual byte a byte.
 */
export function comChave<T extends object>(objeto: T, chave: string, valor: unknown, ordem: readonly string[]): T {
  if (chave in objeto) return { ...objeto, [chave]: valor };
  const depois = new Set(ordem.slice(ordem.indexOf(chave) + 1));
  const entradas: Array<[string, unknown]> = Object.entries(objeto);
  const posicao = entradas.findIndex(([nome]) => depois.has(nome));
  entradas.splice(posicao === -1 ? entradas.length : posicao, 0, [chave, valor]);
  return Object.fromEntries(entradas) as T;
}

export type Gravacao = { destino: string; texto: string };

/** Falha de `gravarJuntos`, com o destino em que ela ocorreu; a falha do sistema fica em `cause`. */
export class FalhaAoGravar extends Schema.TaggedError<FalhaAoGravar>()("FalhaAoGravar", {
  destino: Schema.String,
  /** `code` do erro do sistema (`ENOSPC`, `EACCES`), quando há. */
  codigo: Schema.optional(Schema.String),
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Falha ao gravar ${this.destino}${this.codigo ? ` (${this.codigo})` : ""}`;
  }
}

export const ehFalhaAoGravar = Schema.is(FalhaAoGravar);

function codigoDoSistema(erro: unknown): string | undefined {
  const code: unknown = (erro as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Grava os arquivos juntos: cada texto vai primeiro para um temporário na pasta do destino e só
 * depois, com todos escritos, é renomeado sobre o destino. Se uma troca falha, as já feitas são
 * desfeitas (o arquivo anterior volta, o novo sai) e sobe `FalhaAoGravar` com o destino que falhou.
 * `renomear` é o `renameSync`; os testes o trocam para simular a falha.
 */
export function gravarJuntos(
  gravacoes: Gravacao[],
  renomear: (de: string, para: string) => void = NodeFS.renameSync,
): void {
  const sufixo = `${NodeCrypto.randomBytes(4).toString("hex")}.tmp`;
  const itens = gravacoes.map((gravacao) => ({
    ...gravacao,
    temporario: NodePath.join(NodePath.dirname(gravacao.destino), `.${NodePath.basename(gravacao.destino)}.${sufixo}`),
    anterior: NodeFS.existsSync(gravacao.destino) ? NodeFS.readFileSync(gravacao.destino) : null,
    pastaCriada: undefined as string | undefined,
  }));
  const trocados: typeof itens = [];
  let atual: (typeof itens)[number] | undefined;
  try {
    for (const item of itens) {
      atual = item;
      item.pastaCriada = NodeFS.mkdirSync(NodePath.dirname(item.destino), { recursive: true });
      NodeFS.writeFileSync(item.temporario, item.texto, "utf-8");
    }
    for (const item of itens) {
      atual = item;
      renomear(item.temporario, item.destino);
      trocados.push(item);
    }
  } catch (erro) {
    for (const item of trocados.reverse()) {
      if (item.anterior) NodeFS.writeFileSync(item.destino, item.anterior);
      else NodeFS.rmSync(item.destino, { force: true });
    }
    for (const item of itens) {
      NodeFS.rmSync(item.temporario, { force: true });
      if (item.pastaCriada) NodeFS.rmSync(item.pastaCriada, { recursive: true, force: true });
    }
    const codigo = codigoDoSistema(erro);
    throw new FalhaAoGravar({
      destino: atual?.destino ?? "",
      ...(codigo === undefined ? {} : { codigo }),
      cause: erro,
    });
  }
}
