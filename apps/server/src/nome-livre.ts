/**
 * Gravar sem sobrescrever: o primeiro nome livre de uma sequência (`nome`, `nome (2)`, `nome (3)`…). A
 * pasta da tarefa, o anexo e o relato são criados assim: quem cria usa uma operação exclusiva
 * (`makeDirectory` sem `recursive`, `writeFile` com `flag: "wx"`), e o nome ocupado (`AlreadyExists`)
 * passa ao seguinte. Conferir antes e criar depois deixaria duas criações simultâneas com o mesmo nome.
 *
 * A cópia comentada da revisão prévia usa a mesma sequência com outro critério (`pular: travado`): ela
 * regrava o nome fixo e só passa ao seguinte quando o arquivo está aberto e travado por outro programa.
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

/** A extensão de um nome sem `/`, como o `extname` do Node (`.bashrc` e `..` não têm extensão). */
const extensao = (nome: string): string => {
  const ponto = nome.lastIndexOf(".");
  return ponto <= 0 || nome === ".." ? "" : nome.slice(ponto);
};

/** `nome (n).ext`, para o n-ésimo nome repetido (n ≥ 2). */
export function comNumero(nome: string, n: number): string {
  if (n < 2) return nome;
  const ext = extensao(nome);
  const base = ext === "" ? nome : nome.slice(0, -ext.length);
  return `${base} (${n})${ext}`;
}

/** Todos os nomes da sequência estavam ocupados. */
export class NomesEsgotados extends Schema.TaggedError<NomesEsgotados>()("NomesEsgotados", {
  pasta: Schema.String,
  primeiro: Schema.String,
}) {
  override get message(): string {
    return `não há nome livre para ${this.primeiro} em ${this.pasta}`;
  }
}

/** O nome já existe: a criação exclusiva recusou. */
const ocupado = (erro: unknown): boolean => PlatformError.isPlatformError(erro) && erro.reason._tag === "AlreadyExists";

/**
 * O arquivo existe e outro programa o segura: o Word no Windows trava o documento aberto (`EBUSY`,
 * ou `EPERM`/`EACCES` na escrita).
 */
export const travado = (erro: unknown): boolean =>
  PlatformError.isPlatformError(erro) && (erro.reason._tag === "Busy" || erro.reason._tag === "PermissionDenied");

/**
 * Chama `criar` com `nomes(de)`, `nomes(de + 1)`… até `ate`, enquanto o nome estiver ocupado (ou a
 * falha for das que `pular` aceita), e devolve o resultado da primeira criação. Qualquer outra falha
 * para a sequência.
 */
export const criarSemColisao = Effect.fn("nomeLivre.criarSemColisao")(function* <A, E, R>(
  opcoes: {
    /** Onde se cria (para a mensagem de `NomesEsgotados`). */
    readonly pasta: string;
    readonly nomes: (n: number) => string;
    readonly de?: number;
    readonly ate: number;
    /** As falhas que passam ao nome seguinte (padrão: o nome já existe). */
    readonly pular?: (erro: unknown) => boolean;
  },
  criar: (nome: string) => Effect.Effect<A, E, R>,
) {
  const de = opcoes.de ?? 1;
  for (let n = de; n <= opcoes.ate; n++) {
    const criado = yield* criar(opcoes.nomes(n)).pipe(
      Effect.asSome,
      Effect.catchIf(opcoes.pular ?? ocupado, () => Effect.succeedNone),
    );
    if (Option.isSome(criado)) return criado.value;
  }
  return yield* new NomesEsgotados({ pasta: opcoes.pasta, primeiro: opcoes.nomes(de) });
});
