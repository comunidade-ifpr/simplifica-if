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
import * as Stream from "effect/Stream";
import * as Argument from "effect/cli/Argument";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { RAIZ_PROJETO } from "./config.ts";
import { executarPrincipal, sairCom } from "./principal.ts";

export class ManifestoInvalido extends Schema.TaggedError<ManifestoInvalido>()("ManifestoInvalido", {
  motivo: Schema.String,
}) {
  override get message(): string {
    return `docs/upstream-t3.md: ${this.motivo}`;
  }
}

export class GitFalhou extends Schema.TaggedError<GitFalhou>()("GitFalhou", {
  subcomando: Schema.String,
  codigo: Schema.Int,
  stderr: Schema.String,
}) {
  override get message(): string {
    return `git ${this.subcomando} falhou no upstream (código ${this.codigo}): ${this.stderr}`;
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

const git = Effect.fn("upstream_t3.git")(function* (checkout: string, args: ReadonlyArray<string>) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const processo = yield* spawner.spawn(ChildProcess.make("git", ["-C", checkout, ...args], { stdin: "ignore" }));
      const [saida, erro, codigo] = yield* Effect.all(
        [
          Stream.mkString(Stream.decodeText(processo.stdout)),
          Stream.mkString(Stream.decodeText(processo.stderr)),
          processo.exitCode,
        ],
        { concurrency: "unbounded" },
      );
      if (codigo !== 0) {
        return yield* new GitFalhou({ subcomando: args[0] ?? "", codigo, stderr: erro.trim().slice(0, 500) });
      }
      return saida;
    }),
  );
});

const carregarManifesto = Effect.fn("upstream_t3.carregarManifesto")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* lerManifesto(yield* fs.readFileString(path.join(RAIZ_PROJETO, "docs", "upstream-t3.md")));
});

const UPSTREAM_PADRAO = "$T3CODE_DIR";

/** `--upstream`, ou `T3CODE_DIR`, ou o checkout padrão do curador. */
const resolverUpstream = Effect.fn("upstream_t3.resolverUpstream")(function* (flag: Option.Option<string>) {
  if (Option.isSome(flag)) return flag.value;
  return yield* Config.String("T3CODE_DIR").pipe(Config.withDefault(UPSTREAM_PADRAO));
});

const flags = {
  upstream: Flag.String("upstream").pipe(
    Flag.withDescription(`checkout do T3 Code (padrão: T3CODE_DIR ou ${UPSTREAM_PADRAO})`),
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
    const alvo = (yield* git(upstream, ["rev-parse", "--short=10", ref])).trim();
    yield* Console.log(`upstream ${upstream} em ${ref} (${alvo})\n`);
    let comMudanca = 0;
    for (const parte of partes) {
      const intervalo = `${parte.commit}..${ref}`;
      const commits = Number((yield* git(upstream, ["rev-list", "--count", intervalo, "--", ...parte.origem])).trim());
      const arquivos = (yield* git(upstream, ["diff", "--name-only", parte.commit, ref, "--", ...parte.origem]))
        .split("\n")
        .filter((linha) => linha !== "");
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
        const saida = yield* git(upstream, [
          "diff",
          ...(stat ? ["--stat"] : []),
          parte.commit,
          ref,
          "--",
          ...parte.origem,
        ]);
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
      Effect.catchTags({ ParteDesconhecida: (erro) => Console.error(erro.message).pipe(Effect.andThen(sairCom(2))) }),
    ),
  );
}
