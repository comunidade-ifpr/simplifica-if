#!/usr/bin/env node
/**
 * O que mudou no T3 Code desde a cópia de cada parte registrada em `docs/upstream-t3.md`.
 *
 *   node scripts/upstream_t3.ts status [--upstream <checkout>] [--ref <ref>]
 *   node scripts/upstream_t3.ts diff [<parte>…] [--upstream <checkout>] [--ref <ref>] [--stat]
 *
 * Só lê o git do checkout do upstream (`rev-parse`, `rev-list`, `diff`). Compara o commit registrado
 * de cada parte com `--ref` (padrão `HEAD`); para comparar com o `main` remoto, rode `git fetch` no
 * checkout e passe `--ref origin/main`.
 */
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Argument from "effect/cli/Argument";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import { RAIZ_PROJETO } from "./config.ts";
import * as Git from "./git.ts";
import { sairCom } from "@simplifica-if/kb/principal";
import { executarPrincipal } from "./principal.ts";

export class ManifestoInvalido extends Schema.TaggedError<ManifestoInvalido>()("ManifestoInvalido", {
  motivo: Schema.String,
}) {
  override get message(): string {
    return `docs/upstream-t3.md: ${this.motivo}`;
  }
}

export class ParteDesconhecida extends Schema.TaggedError<ParteDesconhecida>()("ParteDesconhecida", {
  nome: Schema.String,
}) {
  override get message(): string {
    return `parte não registrada em docs/upstream-t3.md: ${this.nome}`;
  }
}

/** Uma linha da tabela "Partes copiadas". */
export interface Parte {
  readonly nome: string;
  readonly origem: ReadonlyArray<string>;
  readonly aqui: ReadonlyArray<string>;
  readonly commit: string;
  readonly data: string;
  readonly adaptacoes: string;
}

const COMMIT = /^[0-9a-f]{7,40}$/;

const trechosEntreCrases = (celula: string): ReadonlyArray<string> =>
  [...celula.matchAll(/`([^`]+)`/g)].map((trecho) => trecho[1] ?? "").filter((trecho) => trecho !== "");

/**
 * Lê a tabela da seção "## Partes copiadas" do manifesto. Função pura: o teste a roda sobre o
 * próprio `docs/upstream-t3.md`.
 */
export function lerManifesto(texto: string): Effect.Effect<ReadonlyArray<Parte>, ManifestoInvalido> {
  const secao = texto.split(/^## /m).find((bloco) => bloco.startsWith("Partes copiadas"));
  if (secao === undefined) return Effect.fail(new ManifestoInvalido({ motivo: "sem a seção Partes copiadas" }));
  const linhas = secao.split("\n").filter((linha) => linha.startsWith("|"));
  const partes: Array<Parte> = [];
  // As duas primeiras linhas são o cabeçalho e o separador.
  for (const linha of linhas.slice(2)) {
    const celulas = linha
      .slice(1, -1)
      .split("|")
      .map((celula) => celula.trim());
    const [nome, origem, aqui, commit, data, adaptacoes] = celulas;
    if (celulas.length !== 6 || !nome || !origem || !aqui || !commit || !data || adaptacoes === undefined) {
      return Effect.fail(new ManifestoInvalido({ motivo: `linha com ${celulas.length} colunas, esperadas 6` }));
    }
    if (!COMMIT.test(commit)) return Effect.fail(new ManifestoInvalido({ motivo: `commit inválido em ${nome}` }));
    const caminhosOrigem = trechosEntreCrases(origem);
    if (caminhosOrigem.length === 0) {
      return Effect.fail(new ManifestoInvalido({ motivo: `sem caminho de origem em ${nome}` }));
    }
    partes.push({ nome, origem: caminhosOrigem, aqui: trechosEntreCrases(aqui), commit, data, adaptacoes });
  }
  if (partes.length === 0) return Effect.fail(new ManifestoInvalido({ motivo: "tabela vazia" }));
  return Effect.succeed(partes);
}

const carregarManifesto = Effect.fn("upstream_t3.carregarManifesto")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* lerManifesto(yield* fs.readFileString(path.join(RAIZ_PROJETO, "docs", "upstream-t3.md")));
});

export class UpstreamAusente extends Schema.TaggedError<UpstreamAusente>()("UpstreamAusente", {}) {
  override get message(): string {
    return (
      "informe o checkout local do T3 Code (https://github.com/pingdotgg/t3code): " +
      "--upstream <pasta> ou a variável de ambiente T3CODE_DIR"
    );
  }
}

/** `--upstream` ou `T3CODE_DIR`; sem nenhum dos dois, `UpstreamAusente`. */
const resolverUpstream = Effect.fn("upstream_t3.resolverUpstream")(function* (flag: Option.Option<string>) {
  if (Option.isSome(flag)) return flag.value;
  const ambiente = yield* Config.option(Config.String("T3CODE_DIR"));
  if (Option.isSome(ambiente) && ambiente.value.trim() !== "") return ambiente.value;
  return yield* new UpstreamAusente();
});

export class UpstreamInexistente extends Schema.TaggedError<UpstreamInexistente>()("UpstreamInexistente", {
  caminho: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `o git não rodou em ${this.caminho}: a pasta do checkout do upstream existe?`;
  }
}

export class RefNaoEncontrada extends Schema.TaggedError<RefNaoEncontrada>()("RefNaoEncontrada", {
  upstream: Schema.String,
  ref: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `ref ${this.ref} não encontrada no checkout do upstream ${this.upstream}`;
  }
}

export class ParteSemHistorico extends Schema.TaggedError<ParteSemHistorico>()("ParteSemHistorico", {
  parte: Schema.String,
  commit: Schema.String,
  ref: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return (
      `parte ${this.parte}: o git não comparou ${this.commit.slice(0, 10)} com ${this.ref} ` +
      "(commit ausente no checkout?); rode git fetch no checkout do upstream"
    );
  }
}

/** Sem `codigo`, o git nem rodou na pasta: `UpstreamInexistente`; com ele, o erro do caso. */
const traduzirGit =
  <E>(caminho: string, comCodigo: (erro: Git.GitFalhou) => E) =>
  <A, R>(efeito: Effect.Effect<A, Git.GitFalhou, R>): Effect.Effect<A, E | UpstreamInexistente, R> =>
    efeito.pipe(
      Effect.catchTags({
        GitFalhou: (erro) =>
          Effect.fail(erro.codigo === undefined ? new UpstreamInexistente({ caminho, cause: erro }) : comCodigo(erro)),
      }),
    );

/** O commit (abreviado) a que `ref` aponta no upstream. */
export const resolverRef = Effect.fn("upstream_t3.resolverRef")(function* (upstream: string, ref: string) {
  const saida = yield* Git.executar(["rev-parse", "--short=10", ref], { cwd: upstream }).pipe(
    traduzirGit(upstream, (cause) => new RefNaoEncontrada({ upstream, ref, cause })),
  );
  return saida.trim();
});

const semHistorico = (upstream: string, parte: Parte, ref: string) =>
  traduzirGit(upstream, (cause) => new ParteSemHistorico({ parte: parte.nome, commit: parte.commit, ref, cause }));

/** Quantos commits e quais arquivos da origem da parte mudaram entre o commit registrado e `ref`. */
export const mudancasDaParte = Effect.fn("upstream_t3.mudancasDaParte")(function* (
  upstream: string,
  parte: Parte,
  ref: string,
) {
  const commits = Number(
    (yield* Git.executar(["rev-list", "--count", `${parte.commit}..${ref}`, "--", ...parte.origem], {
      cwd: upstream,
    }).pipe(semHistorico(upstream, parte, ref))).trim(),
  );
  const arquivos = (yield* Git.executar(["diff", "--name-only", parte.commit, ref, "--", ...parte.origem], {
    cwd: upstream,
  }).pipe(semHistorico(upstream, parte, ref)))
    .split("\n")
    .filter((linha) => linha !== "");
  return { commits, arquivos };
});

/** O diff (ou o `--stat`) da origem da parte, do commit registrado até `ref`. */
export const diffDaParte = Effect.fn("upstream_t3.diffDaParte")(function* (
  upstream: string,
  parte: Parte,
  ref: string,
  stat: boolean,
) {
  return yield* Git.executar(["diff", ...(stat ? ["--stat"] : []), parte.commit, ref, "--", ...parte.origem], {
    cwd: upstream,
  }).pipe(semHistorico(upstream, parte, ref));
});

const flags = {
  upstream: Flag.String("upstream").pipe(
    Flag.withDescription("checkout do T3 Code (padrão: a variável de ambiente T3CODE_DIR)"),
    Flag.optional,
  ),
  ref: Flag.String("ref").pipe(
    Flag.withDescription("ref do upstream comparada ao commit registrado (padrão: HEAD)"),
    Flag.withDefault("HEAD"),
  ),
};

const status = Command.make("status", flags, ({ upstream: flagUpstream, ref }) =>
  Effect.gen(function* () {
    const upstream = yield* resolverUpstream(flagUpstream);
    const partes = yield* carregarManifesto();
    const alvo = yield* resolverRef(upstream, ref);
    yield* Console.log(`upstream ${upstream} em ${ref} (${alvo})\n`);
    let comMudanca = 0;
    for (const parte of partes) {
      const { commits, arquivos } = yield* mudancasDaParte(upstream, parte, ref);
      const marca = arquivos.length === 0 ? "igual" : `${arquivos.length} arquivo(s), ${commits} commit(s)`;
      yield* Console.log(`${parte.nome.padEnd(26)} ${parte.commit.slice(0, 10)} ${parte.data}  ${marca}`);
      if (arquivos.length > 0) comMudanca++;
      for (const arquivo of arquivos.slice(0, 20)) yield* Console.log(`    ${arquivo}`);
      if (arquivos.length > 20) yield* Console.log(`    … mais ${arquivos.length - 20}`);
    }
    yield* Console.log(`\n${comMudanca} de ${partes.length} parte(s) com mudança no upstream`);
  }),
).pipe(Command.withDescription("lista as partes copiadas e o que mudou no upstream desde o commit registrado"));

const diff = Command.make(
  "diff",
  {
    ...flags,
    partes: Argument.String("parte").pipe(
      Argument.withDescription("nome da parte (coluna Parte); sem nome, todas"),
      Argument.variadic(),
    ),
    stat: Flag.Boolean("stat").pipe(Flag.withDescription("só o resumo por arquivo"), Flag.withDefault(false)),
  },
  ({ upstream: flagUpstream, ref, partes: nomes, stat }) =>
    Effect.gen(function* () {
      const upstream = yield* resolverUpstream(flagUpstream);
      const partes = yield* carregarManifesto();
      const escolhidas = [];
      for (const nome of nomes) {
        const parte = partes.find((candidata) => candidata.nome === nome);
        if (parte === undefined) return yield* new ParteDesconhecida({ nome });
        escolhidas.push(parte);
      }
      for (const parte of escolhidas.length === 0 ? partes : escolhidas) {
        const saida = yield* diffDaParte(upstream, parte, ref, stat);
        if (saida.trim() === "") continue;
        yield* Console.log(`### ${parte.nome} (${parte.commit.slice(0, 10)}..${ref}) → ${parte.aqui.join(" ")}\n`);
        yield* Console.log(saida);
      }
    }),
).pipe(Command.withDescription("diff do upstream de cada parte, do commit registrado até --ref"));

export const comandoUpstream = Command.make("upstream_t3").pipe(
  Command.withDescription("Acompanha o código copiado do T3 Code (docs/upstream-t3.md)."),
  Command.withSubcommands([status, diff]),
);

if (import.meta.main) {
  executarPrincipal(
    "upstream_t3",
    Command.run(comandoUpstream, { version: "1.0.0" }).pipe(
      Effect.catchTags({
        ParteDesconhecida: (erro) => Console.error(erro.message).pipe(Effect.andThen(sairCom(2))),
        UpstreamAusente: (erro) => Console.error(erro.message).pipe(Effect.andThen(sairCom(2))),
      }),
    ),
  );
}
