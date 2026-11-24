#!/usr/bin/env node
/**
 * A fábrica da atualização (M1.10). Roda no computador de quem publica, nunca no app.
 *
 *   pnpm fabrica gerar-chave --saida ~/.simplifica-fabrica          # uma vez: o par minisign (fora do repositório)
 *   pnpm fabrica canal [--versao 2026.11.20] [--repositorio dono/repo] [--anterior <kb.sqlite>]… [--mesmas-fontes]
 *   pnpm fabrica promover --de beta --para estavel --versao 2026.11.20     # só o manifesto, os mesmos pacotes
 *   pnpm fabrica publicar --canal beta --versao 2026.11.20 --repositorio dono/repo [--executar]
 *   pnpm fabrica publicar-app --canal beta --versao 0.2.0 --repositorio dono/repo [--executar]
 *   pnpm fabrica propor-novidades --de <kb anterior> --para <kb nova> [--versao 2026.11.20]
 *
 * `canal` (só o beta) escolhe a versão, se não vier `--versao` (a data de hoje, com `.N` se o dia já tem
 * versão guardada), recusa a versão sem mudança nas fontes (`fontes_sha256` igual ao da última
 * guardada; `--mesmas-fontes` publica assim mesmo, para levar só skills), compila o `kb.sqlite` publicável do commit (`git archive HEAD` numa pasta à parte,
 * nunca o disco: arquivo não rastreado, ignorado ou modificado fica de fora) com `--versao` e `--commit`,
 * sem canal (o canal é do manifesto, não do banco; promover não muda a base) (o build é
 * determinístico: o mesmo commit refaz o mesmo banco), recusa fonte não classificada, empacota a base
 * (zstd 19), os patches das versões anteriores guardadas em `tmp/fabrica/bases/` (ou das dadas em
 * `--anterior`), as skills do app e as novidades da versão, e assina o manifesto. Saída em
 * `tmp/fabrica/<canal>-<versao>/`.
 *
 * A chave secreta vem do arquivo em `SIMPLIFICA_MINISIGN_CHAVE` (fora do repositório) e a senha, se
 * houver, de `SIMPLIFICA_MINISIGN_SENHA`, pelo `Config` (ambiente ou `.env.local` da raiz); a senha
 * fica `Redacted` até a leitura da chave. O script se recusa a ler ou gravar chave dentro do checkout.
 *
 * `publicar` mostra (ou, com `--executar`, roda) os comandos `gh release` da hospedagem decidida
 * (GitHub Releases do próprio repositório; ver `packages/atualizacao/src/hospedagem.ts`). O `gh` é ferramenta de quem
 * publica; o app só baixa pelos links diretos. Os comandos saem de funções puras
 * (`comandosPublicacao`, `comandosPublicacaoApp`).
 *
 * As funções de `@simplifica-if/atualizacao` são síncronas e lançam `Error` com o motivo; aqui elas
 * viram `EtapaFalhou`, cuja mensagem diz a etapa e cujo `cause` guarda o motivo, que o ponto de
 * entrada mostra a quem publica.
 */
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { CANAIS_DISTRIBUICAO } from "@simplifica-if/kb/canal";
import { arquivosFonte } from "@simplifica-if/kb/db/fontes";
import { lerPastaSkills } from "@simplifica-if/mcp/skills";
import {
  APP_MINIMO_PADRAO,
  gerarCanal,
  promoverManifesto,
  type SkillDaFabrica,
} from "@simplifica-if/atualizacao/fabrica";
import {
  reescreverLatestYml,
  TAG_APP,
  TAG_BASE,
  TAG_CANAL,
  urlPacoteBase,
  validarRepositorio,
} from "@simplifica-if/atualizacao/hospedagem";
import { fontesNaoClassificadas } from "@simplifica-if/atualizacao/fontes";
import { lerInfoBanco } from "@simplifica-if/atualizacao/local";
import { arquivoManifesto, type Canal, compararVersoes, SUFIXO_ASSINATURA } from "@simplifica-if/atualizacao/manifesto";
import {
  escreverChavePublica,
  escreverChaveSecreta,
  gerarChaves,
  lerChaveSecreta,
} from "@simplifica-if/atualizacao/minisign";
import {
  lerNovidades,
  novidadesDaVersao,
  proporNovidades,
  proposta,
  soAcrescimos,
} from "@simplifica-if/atualizacao/novidades";
import { RAIZ_PROJETO } from "./config.ts";
import * as Git from "./git.ts";
import { sairCom } from "@simplifica-if/kb/principal";
import { executarPrincipal } from "./principal.ts";

/** As pastas de onde a fábrica lê, extraídas do commit (`git archive`), nunca do disco. */
const PASTAS_DO_COMMIT = ["base-conhecimento", "packages/kb", ".agents/skills"] as const;

/* ------------------------------------------------------------------ erros */

/** A chave secreta não está onde deveria; nunca leva o conteúdo nem a senha. */
export class ChaveIndisponivel extends Schema.TaggedError<ChaveIndisponivel>()("ChaveIndisponivel", {
  motivo: Schema.Literals(["sem-variavel", "dentro-do-repositorio", "ja-existe"]),
  caminho: Schema.optionalKey(Schema.String),
}) {
  override get message(): string {
    switch (this.motivo) {
      case "sem-variavel":
        return "defina SIMPLIFICA_MINISIGN_CHAVE com o caminho da chave secreta (fora do repositório)";
      case "dentro-do-repositorio":
        return "a chave secreta não pode ficar dentro do repositório (use, por exemplo, ~/.simplifica-fabrica)";
      case "ja-existe":
        return `já existe uma chave em ${this.caminho ?? ""}; não sobrescrevo`;
    }
  }
}

/** Falta o que um passo anterior gera (a saída do canal, o manifesto, os `latest*.yml` do app). */
export class PreRequisitoAusente extends Schema.TaggedError<PreRequisitoAusente>()("PreRequisitoAusente", {
  falta: Schema.String,
  caminho: Schema.String,
  /** O comando ou o passo que gera o que falta. */
  comoGerar: Schema.String,
}) {
  override get message(): string {
    return `sem ${this.falta} em ${this.caminho}; ${this.comoGerar}`;
  }
}

/** Uma conferência recusou o pacote; `itens` diz o quê (nomes de arquivo, de skill ou de entrada). */
export class ConferenciaRecusada extends Schema.TaggedError<ConferenciaRecusada>()("ConferenciaRecusada", {
  conferencia: Schema.Literals(["fontes", "skills", "novidades"]),
  itens: Schema.Array(Schema.String),
}) {
  override get message(): string {
    switch (this.conferencia) {
      case "fontes":
        return `fontes não classificadas como publicáveis entrariam no pacote:\n  ${this.itens.join("\n  ")}`;
      case "skills":
        return `skills do app inválidas:\n  ${this.itens.join("\n  ")}`;
      case "novidades":
        return `novidades.yaml não é só de acréscimos: ${this.itens.join("; ")}`;
    }
  }
}

/** A base nova tem as mesmas fontes da última versão guardada: não há o que publicar. */
export class BaseSemMudanca extends Schema.TaggedError<BaseSemMudanca>()("BaseSemMudanca", {
  versao: Schema.String,
  anterior: Schema.String,
}) {
  override get message(): string {
    return `a base ${this.versao} tem as mesmas fontes da ${this.anterior}: nada a publicar (para levar só as skills, --mesmas-fontes)`;
  }
}

/**
 * A versão nova de um dia (`hoje` em AAAA-MM-DD): `AAAA.MM.DD`, ou `AAAA.MM.DD.N` com o `N` seguinte
 * quando o dia já tem versão entre as `existentes`.
 */
export function proximaVersao(hoje: string, existentes: ReadonlyArray<string>): string {
  const doDia = hoje.replaceAll("-", ".");
  const numeros = existentes.flatMap((versao) => {
    if (versao === doDia) return [1];
    const resto = versao.startsWith(`${doDia}.`) ? versao.slice(doDia.length + 1) : "";
    return /^\d+$/.test(resto) ? [Number(resto)] : [];
  });
  return numeros.length === 0 ? doDia : `${doDia}.${Math.max(...numeros) + 1}`;
}

/**
 * Uma etapa falhou: um processo (git, tar, kb, gh) que não rodou ou saiu com erro, ou uma função de
 * `@simplifica-if/atualizacao` que lançou. A saída do processo já foi ao terminal ou fica em `cause`.
 */
export class EtapaFalhou extends Schema.TaggedError<EtapaFalhou>()("EtapaFalhou", {
  etapa: Schema.String,
  /** Código de saída do processo, quando ele rodou. */
  codigo: Schema.optionalKey(Schema.Int),
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    return this.codigo === undefined ? `${this.etapa} falhou` : `${this.etapa} falhou (código ${this.codigo})`;
  }
}

/* ------------------------------------------------------------------ comandos gh (puros) */

/** Um comando de publicação; `podeJaExistir` é o release fixo do canal, criado só na primeira vez. */
export interface ComandoGh {
  readonly args: ReadonlyArray<string>;
  readonly podeJaExistir?: boolean;
}

/** O comando como se digita: partes com espaço entre aspas. */
export const textoComando = (args: ReadonlyArray<string>): string =>
  `$ ${args.map((parte) => (/\s/.test(parte) ? JSON.stringify(parte) : parte)).join(" ")}`;

/**
 * Publicação da base: o release imutável da versão (nunca "latest"; uma promoção, sem pacotes, não o
 * cria de novo), o release fixo do canal e a troca do manifesto nele.
 */
export function comandosPublicacao(opcoes: {
  readonly canal: Canal;
  readonly versao: string;
  readonly repositorio: string;
  /** Caminhos dos pacotes da versão. */
  readonly pacotes: ReadonlyArray<string>;
  /** Caminhos do manifesto e da assinatura dele. */
  readonly manifesto: readonly [string, string];
}): ReadonlyArray<ComandoGh> {
  const repo = ["--repo", opcoes.repositorio];
  const releaseVersao: ReadonlyArray<ComandoGh> =
    opcoes.pacotes.length === 0
      ? []
      : [
          {
            args: [
              "gh",
              "release",
              "create",
              TAG_BASE(opcoes.versao),
              ...opcoes.pacotes,
              ...repo,
              "--title",
              `Base ${opcoes.versao}`,
              "--notes",
              `Base de conhecimento ${opcoes.versao}.`,
              "--latest=false",
            ],
          },
        ];
  return [
    ...releaseVersao,
    {
      args: [
        "gh",
        "release",
        "create",
        TAG_CANAL(opcoes.canal),
        ...repo,
        "--prerelease",
        "--latest=false",
        "--title",
        `Canal ${opcoes.canal}`,
        "--notes",
        "Manifesto do canal. Não apague: o app procura aqui.",
      ],
      podeJaExistir: true,
    },
    { args: ["gh", "release", "upload", TAG_CANAL(opcoes.canal), ...opcoes.manifesto, "--clobber", ...repo] },
  ];
}

/**
 * Publicação do app: os instaladores no release imutável `app-v<versao>` e os `latest*.yml`, já
 * reescritos para apontar para ele, no release fixo do canal, onde o `electron-updater` procura.
 */
export function comandosPublicacaoApp(opcoes: {
  readonly canal: Canal;
  readonly versao: string;
  readonly repositorio: string;
  readonly instaladores: ReadonlyArray<string>;
  readonly ymls: ReadonlyArray<string>;
}): ReadonlyArray<ComandoGh> {
  const repo = ["--repo", opcoes.repositorio];
  return [
    {
      args: [
        "gh",
        "release",
        "create",
        TAG_APP(opcoes.versao),
        ...opcoes.instaladores,
        ...repo,
        "--title",
        `Simplifica IF ${opcoes.versao}`,
        "--notes",
        "Instaladores do app.",
        "--latest=false",
      ],
    },
    { args: ["gh", "release", "upload", TAG_CANAL(opcoes.canal), ...opcoes.ymls, "--clobber", ...repo] },
  ];
}

/* ------------------------------------------------------------------ processos e caminhos */

/** Onde a fábrica roda: a raiz do checkout e o executável do Node que compila a base. */
export interface ContextoFabrica {
  readonly raiz: string;
  readonly node: string;
}

const pastaFabrica = (path: Path.Path, raiz: string) => path.join(raiz, "tmp", "fabrica");
const pastaBases = (path: Path.Path, raiz: string) => path.join(raiz, "tmp", "fabrica", "bases");

/** Roda um processo com a saída no terminal; devolve o código de saída. */
const rodarProcesso = Effect.fn("fabrica_atualizacao.rodarProcesso")(function* (
  etapa: string,
  args: ReadonlyArray<string>,
  opcoes: {
    readonly cwd?: string;
    readonly env?: Record<string, string>;
    readonly stdin?: Stream.Stream<Uint8Array>;
  } = {},
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const [comando = "", ...resto] = args;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const processo = yield* spawner.spawn(
        ChildProcess.make(comando, resto, {
          ...(opcoes.cwd === undefined ? {} : { cwd: opcoes.cwd }),
          ...(opcoes.env === undefined ? {} : { env: opcoes.env, extendEnv: true }),
          stdin: opcoes.stdin ?? "inherit",
          stdout: "inherit",
          stderr: "inherit",
        }),
      );
      return Number(yield* processo.exitCode);
    }),
  ).pipe(Effect.catchTags({ PlatformError: (cause) => Effect.fail(new EtapaFalhou({ etapa, cause })) }));
});

/** Como `rodarProcesso`, mas código diferente de zero é `EtapaFalhou`. */
const exigirProcesso = Effect.fn("fabrica_atualizacao.exigirProcesso")(function* (
  etapa: string,
  args: ReadonlyArray<string>,
  opcoes?: Parameters<typeof rodarProcesso>[2],
) {
  const codigo = yield* rodarProcesso(etapa, args, opcoes);
  if (codigo !== 0) return yield* new EtapaFalhou({ etapa, codigo });
});

/** `git <args>` na raiz; o stderr do git fica só no `cause`. */
const git = Effect.fn("fabrica_atualizacao.git")(function* (args: ReadonlyArray<string>, raiz: string) {
  return yield* Git.executar(args, { cwd: raiz }).pipe(
    Effect.catchTags({
      GitFalhou: (cause) => Effect.fail(new EtapaFalhou({ etapa: `git ${cause.subcomando}`, cause })),
    }),
  );
});

/** Uma função síncrona de `@simplifica-if/atualizacao` (ou do kb) que lança com o motivo. */
const etapa = <A>(nome: string, calcular: () => A): Effect.Effect<A, EtapaFalhou> =>
  Effect.try({ try: calcular, catch: (cause) => new EtapaFalhou({ etapa: nome, cause }) });

/** `~/` no começo vira a pasta do usuário (`HOME`); o resto fica como veio. */
const expandir = Effect.fn("fabrica_atualizacao.expandir")(function* (caminho: string) {
  const path = yield* Path.Path;
  if (!caminho.startsWith("~/")) return path.resolve(caminho);
  return path.join(yield* Config.String("HOME"), caminho.slice(2));
});

const dentroDoRepositorio = (path: Path.Path, raiz: string, caminho: string) => {
  const relativo = path.relative(raiz, path.resolve(caminho));
  return !relativo.startsWith("..") && !path.isAbsolute(relativo);
};

const senhaChave = Config.option(Config.Redacted("SIMPLIFICA_MINISIGN_SENHA"));

/* ------------------------------------------------------------------ etapas */

/**
 * Extrai as fontes do commit numa pasta à parte e liga o `node_modules` do checkout (o `kb` roda dela):
 * a base sai do que está no commit, como o build reproduzível promete.
 */
export const arvoreDoCommit = Effect.fn("fabrica_atualizacao.arvoreDoCommit")(function* (
  commit: string,
  destino: string,
  raiz: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.remove(destino, { recursive: true, force: true });
  yield* fs.makeDirectory(destino, { recursive: true });
  const arquivo = yield* Git.executarBytes(["archive", "--format=tar", commit, "--", ...PASTAS_DO_COMMIT], {
    cwd: raiz,
  }).pipe(Effect.catchTags({ GitFalhou: (cause) => Effect.fail(new EtapaFalhou({ etapa: "git archive", cause })) }));
  yield* exigirProcesso("tar", ["tar", "-x", "-C", destino], { stdin: Stream.make(arquivo) });
  for (const pasta of ["node_modules", "packages/kb/node_modules"]) {
    const origem = path.join(raiz, ...pasta.split("/"));
    const alvo = path.join(destino, ...pasta.split("/"));
    if ((yield* fs.exists(origem)) && (yield* fs.exists(path.dirname(alvo)))) yield* fs.symlink(origem, alvo);
  }
  return destino;
});

/** Lê a chave secreta de `SIMPLIFICA_MINISIGN_CHAVE`, com a senha de `SIMPLIFICA_MINISIGN_SENHA`. */
const lerChave = Effect.fn("fabrica_atualizacao.lerChave")(function* (raiz: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const variavel = yield* Config.option(Config.String("SIMPLIFICA_MINISIGN_CHAVE"));
  if (Option.isNone(variavel)) return yield* new ChaveIndisponivel({ motivo: "sem-variavel" });
  const caminho = yield* expandir(variavel.value);
  if (dentroDoRepositorio(path, raiz, caminho))
    return yield* new ChaveIndisponivel({ motivo: "dentro-do-repositorio" });
  const texto = yield* fs.readFileString(caminho);
  const senha = yield* senhaChave;
  return yield* etapa("ler a chave secreta", () =>
    lerChaveSecreta(texto, Option.getOrUndefined(Option.map(senha, Redacted.value))),
  );
});

/** Gera o par minisign em `saida` (fora do repositório), sem sobrescrever uma chave existente. */
export const gerarChave = Effect.fn("fabrica_atualizacao.gerarChave")(function* (saida: string, raiz: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const pasta = yield* expandir(saida);
  if (dentroDoRepositorio(path, raiz, pasta)) return yield* new ChaveIndisponivel({ motivo: "dentro-do-repositorio" });
  yield* fs.makeDirectory(pasta, { recursive: true, mode: 0o700 });
  const secreta = path.join(pasta, "simplifica-fabrica.key");
  if (yield* fs.exists(secreta)) return yield* new ChaveIndisponivel({ motivo: "ja-existe", caminho: secreta });
  const chave = gerarChaves();
  const senha = yield* senhaChave;
  const texto = escreverChaveSecreta(
    chave,
    Option.match(senha, { onNone: () => ({}), onSome: (valor) => ({ senha: Redacted.value(valor) }) }),
  );
  yield* fs.writeFileString(secreta, texto, { mode: 0o600 });
  const publica = escreverChavePublica(chave);
  yield* fs.writeFileString(path.join(pasta, "simplifica-fabrica.pub"), publica);
  yield* Console.log(`chave secreta: ${secreta}${Option.isNone(senha) ? " (sem senha)" : " (cifrada com a senha)"}`);
  yield* Console.log(
    "chave pública (vai para POLITICA_FABRICA.atualizacao.chavePublica, em packages/motor/src/politica.ts):",
  );
  yield* Console.log(publica.split("\n")[1]);
});

const skillsDoApp = Effect.fn("fabrica_atualizacao.skillsDoApp")(function* (arvore: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const pasta = yield* lerPastaSkills(path.join(arvore, ".agents", "skills"));
  if (pasta.invalidas.length > 0) {
    return yield* new ConferenciaRecusada({ conferencia: "skills", itens: pasta.invalidas.map((e) => e.message) });
  }
  return yield* Effect.forEach(
    pasta.skills,
    Effect.fnUntraced(function* (skill) {
      // por skill: o span é o de `skillsDoApp`
      const arquivos = yield* Effect.forEach(["SKILL.md", ...skill.manifesto.arquivos], (caminho) =>
        Effect.map(fs.readFile(path.join(skill.pasta, ...caminho.split("/"))), (conteudo) => ({ caminho, conteudo })),
      );
      return {
        nome: skill.nome,
        versao: skill.manifesto.versao ?? "0.1.0",
        appMinimo: skill.manifesto.app_minimo ?? "0.1.0",
        baseMinima: skill.manifesto.base_minima ?? "2000.01.01",
        arquivos,
      } satisfies SkillDaFabrica;
    }),
  );
});

const VersaoGuardada = Schema.fromJsonString(Schema.Struct({ commit: Schema.String }));
const decodificarVersaoGuardada = Schema.decodeUnknownEffect(VersaoGuardada);

/** As novidades conferidas: o arquivo só ganhou entradas desde a última versão publicada. */
const novidades = Effect.fn("fabrica_atualizacao.novidades")(function* (arvore: string, raiz: string, versao: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const texto = yield* fs.readFileString(path.join(arvore, "base-conhecimento", "novidades.yaml"));
  const atual = yield* etapa("ler novidades.yaml", () => lerNovidades(texto));
  const bases = pastaBases(path, raiz);
  const guardadas = (yield* fs.exists(bases))
    ? (yield* fs.readDirectory(bases)).filter((nome) => nome.endsWith(".json")).sort()
    : [];
  const ultima = guardadas.at(-1);
  if (ultima !== undefined) {
    const { commit } = yield* fs
      .readFileString(path.join(bases, ultima))
      .pipe(
        Effect.flatMap(decodificarVersaoGuardada),
        Effect.catchTags({ SchemaError: (cause) => Effect.fail(new EtapaFalhou({ etapa: `ler ${ultima}`, cause })) }),
      );
    // O commit da última versão pode não ter o arquivo: aí não há o que conferir.
    const antes = Option.flatMap(
      yield* Git.tentar(["show", `${commit}:base-conhecimento/novidades.yaml`], { cwd: raiz }),
      Option.liftThrowable(lerNovidades),
    );
    if (Option.isSome(antes)) {
      const problemas = soAcrescimos(antes.value, atual);
      if (problemas.length > 0) return yield* new ConferenciaRecusada({ conferencia: "novidades", itens: problemas });
    }
  }
  const itens = novidadesDaVersao(atual, versao);
  if (itens.length === 0) yield* Console.warn(`aviso: novidades.yaml não tem entradas da versão ${versao}`);
  return itens;
});

const canal = Effect.fn("fabrica_atualizacao.canal")(function* (
  contexto: ContextoFabrica,
  opcoes: {
    /** Sem ela, a de hoje (`proximaVersao`). */
    readonly versao: Option.Option<string>;
    /** Publica mesmo com as fontes iguais às da última versão guardada (só skills novas). */
    readonly mesmasFontes: boolean;
    readonly repositorio: Option.Option<string>;
    readonly anteriores: ReadonlyArray<string>;
    readonly appMinimo: string;
  },
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { raiz } = contexto;
  const canalNovo: Canal = "beta";
  const commit = (yield* git(["rev-parse", "--short", "HEAD"], raiz)).trim();
  if ((yield* git(["status", "--porcelain", "--", ...PASTAS_DO_COMMIT], raiz)).trim() !== "") {
    yield* Console.warn(`aviso: há mudanças fora do commit nas fontes; a base sai do commit ${commit}, sem elas`);
  }
  const arvore = yield* arvoreDoCommit(commit, path.join(pastaFabrica(path, raiz), "arvore"), raiz);
  const naoClassificadas = fontesNaoClassificadas(yield* etapa("listar as fontes", () => arquivosFonte(arvore)));
  if (naoClassificadas.length > 0) {
    return yield* new ConferenciaRecusada({ conferencia: "fontes", itens: naoClassificadas });
  }
  const chave = yield* lerChave(raiz);
  const bases = pastaBases(path, raiz);
  yield* fs.makeDirectory(bases, { recursive: true });
  const existentes = (yield* fs.readDirectory(bases))
    .filter((nome) => nome.endsWith(".sqlite"))
    .map((nome) => nome.slice(0, -".sqlite".length));
  const versao = Option.isSome(opcoes.versao)
    ? opcoes.versao.value
    : proximaVersao(
        DateTime.formatIsoDate(DateTime.setZone(yield* DateTime.now, DateTime.zoneMakeLocal())),
        existentes,
      );
  const saida = path.join(pastaFabrica(path, raiz), `${canalNovo}-${versao}`);
  yield* fs.remove(saida, { recursive: true, force: true });
  const banco = path.join(bases, `${versao}.sqlite`);
  yield* Console.log(`compilando a base ${versao} do commit ${commit}…`);
  // O kb da árvore do commit, com a raiz nela; sem `--canal`: o canal é do manifesto, não do banco.
  yield* exigirProcesso(
    "kb compilar",
    [
      contexto.node,
      path.join(arvore, "packages", "kb", "src", "cli.ts"),
      "compilar",
      "--destino",
      banco,
      "--versao",
      versao,
      "--commit",
      commit,
    ],
    { cwd: arvore, env: { KB_SQLITE: banco } },
  );
  // As três versões anteriores guardadas, além das dadas.
  const guardadas = (yield* fs.readDirectory(bases))
    .filter((nome) => nome.endsWith(".sqlite") && nome !== `${versao}.sqlite`)
    .map((nome) => path.join(bases, nome))
    .filter((caminho) => {
      const info = lerInfoBanco(caminho);
      return info !== null && compararVersoes(info.versao, versao) < 0;
    })
    .sort((a, b) => compararVersoes(lerInfoBanco(a)!.versao, lerInfoBanco(b)!.versao))
    .slice(-3);
  const ultima = guardadas.length === 0 ? null : lerInfoBanco(guardadas.at(-1)!);
  if (!opcoes.mesmasFontes && ultima !== null && ultima.fontesSha256 === lerInfoBanco(banco)?.fontesSha256) {
    yield* fs.remove(banco, { force: true });
    yield* fs.remove(arvore, { recursive: true, force: true });
    return yield* new BaseSemMudanca({ versao, anterior: ultima.versao });
  }
  const dadas = yield* Effect.forEach(opcoes.anteriores, expandir);
  const anteriores = [...new Set([...dadas, ...guardadas])];
  yield* Console.log(`empacotando (zstd 19; patches de ${anteriores.length} versões anteriores)…`);
  const skills = yield* skillsDoApp(arvore);
  const itens = yield* novidades(arvore, raiz, versao);
  const gerado = yield* etapa("gerar o canal", () =>
    gerarCanal({
      saida,
      canal: canalNovo,
      commit,
      banco,
      anteriores,
      skills,
      appMinimo: opcoes.appMinimo,
      novidades: itens,
      chave,
      ...(Option.isNone(opcoes.repositorio) ? {} : { urlPacotes: urlPacoteBase(versao) }),
    }),
  );
  yield* fs.writeFileString(
    path.join(bases, `${versao}.json`),
    // @effect-diagnostics-next-line globalJsonInEffect:off -- objeto de três cadeias montado aqui; não há como falhar
    `${JSON.stringify({ versao: versao, commit, canal: canalNovo }, null, 2)}\n`,
  );
  for (const arquivo of gerado.arquivos) {
    const bytes = Number((yield* fs.stat(path.join(saida, arquivo))).size);
    yield* Console.log(`  ${arquivo}  ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  }
  yield* Console.log(`saída: ${saida}`);
  yield* fs.remove(arvore, { recursive: true, force: true });
});

/**
 * Promove uma versão do beta ao estável: os mesmos pacotes já publicados (o release `base-<versao>`),
 * só o manifesto do estável, conferido e assinado de novo. Nada se recompila.
 */
const promover = Effect.fn("fabrica_atualizacao.promover")(function* (
  contexto: ContextoFabrica,
  opcoes: { readonly de: Canal; readonly para: Canal; readonly versao: string },
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const origem = path.join(pastaFabrica(path, contexto.raiz), `${opcoes.de}-${opcoes.versao}`);
  const nome = arquivoManifesto(opcoes.de);
  if (!(yield* fs.exists(path.join(origem, nome)))) {
    return yield* new PreRequisitoAusente({
      falta: `o manifesto ${nome}`,
      caminho: origem,
      comoGerar: `gere antes: pnpm fabrica canal --versao ${opcoes.versao}`,
    });
  }
  const texto = yield* fs.readFileString(path.join(origem, nome));
  const assinatura = yield* fs.readFileString(path.join(origem, `${nome}${SUFIXO_ASSINATURA}`));
  const chave = yield* lerChave(contexto.raiz);
  const agora = DateTime.toDateUtc(yield* DateTime.now);
  const { manifesto, arquivos } = yield* etapa("promover o manifesto", () =>
    promoverManifesto({ texto, assinatura, de: opcoes.de, para: opcoes.para, chave, agora }),
  );
  const saida = path.join(pastaFabrica(path, contexto.raiz), `${opcoes.para}-${opcoes.versao}`);
  yield* fs.remove(saida, { recursive: true, force: true });
  yield* fs.makeDirectory(saida, { recursive: true });
  for (const [arquivo, conteudo] of arquivos) yield* fs.writeFileString(path.join(saida, arquivo), conteudo);
  yield* Console.log(`manifesto ${arquivoManifesto(manifesto.canal)} da versão ${manifesto.versao} em ${saida}`);
  yield* Console.log(
    `publique com: pnpm fabrica publicar --canal ${opcoes.para} --versao ${opcoes.versao} --repositorio dono/repo`,
  );
});

/** Mostra cada comando e, com `executar`, roda; o release do canal que já existe não é falha. */
const executarComandos = Effect.fn("fabrica_atualizacao.executarComandos")(function* (
  comandos: ReadonlyArray<ComandoGh>,
  executar: boolean,
) {
  for (const comando of comandos) {
    yield* Console.log(textoComando(comando.args));
    if (!executar) continue;
    const nome = comando.args.slice(0, 3).join(" ");
    const codigo = yield* rodarProcesso(nome, comando.args);
    if (codigo === 0) continue;
    if (!comando.podeJaExistir) return yield* new EtapaFalhou({ etapa: nome, codigo });
    yield* Console.log("  (o release do canal já existe)");
  }
  if (!executar) yield* Console.log("\n(só mostrei os comandos; rode de novo com --executar para publicar)");
});

const publicar = Effect.fn("fabrica_atualizacao.publicar")(function* (
  contexto: ContextoFabrica,
  opcoes: { readonly canal: Canal; readonly versao: string; readonly repositorio: string; readonly executar: boolean },
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const saida = path.join(pastaFabrica(path, contexto.raiz), `${opcoes.canal}-${opcoes.versao}`);
  if (!(yield* fs.exists(saida))) {
    return yield* new PreRequisitoAusente({
      falta: "a saída do canal",
      caminho: saida,
      comoGerar: `rode antes: pnpm fabrica canal --versao ${opcoes.versao}`,
    });
  }
  const manifesto = arquivoManifesto(opcoes.canal);
  const assinatura = `${manifesto}${SUFIXO_ASSINATURA}`;
  const pacotes = (yield* fs.readDirectory(saida))
    .filter((nome) => nome !== manifesto && nome !== assinatura)
    .sort()
    .map((nome) => path.join(saida, nome));
  const comandos = comandosPublicacao({
    canal: opcoes.canal,
    versao: opcoes.versao,
    repositorio: opcoes.repositorio,
    pacotes,
    manifesto: [path.join(saida, manifesto), path.join(saida, assinatura)],
  });
  yield* executarComandos(comandos, opcoes.executar);
});

/**
 * O app: os instaladores de `apps/desktop/dist/pacotes` (de `pnpm --filter @simplifica-if/desktop dist`,
 * em cada sistema) vão para o release imutável `app-v<versao>`, e os `latest*.yml`, reescritos para
 * apontar para ele, para o release fixo do canal, onde o `electron-updater` (feed `generic`) procura.
 */
const publicarApp = Effect.fn("fabrica_atualizacao.publicarApp")(function* (
  contexto: ContextoFabrica,
  opcoes: { readonly canal: Canal; readonly versao: string; readonly repositorio: string; readonly executar: boolean },
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const pacotes = path.join(contexto.raiz, "apps", "desktop", "dist", "pacotes");
  const ymls = yield* Effect.filter(["latest-mac.yml", "latest.yml"], (nome) => fs.exists(path.join(pacotes, nome)));
  if (ymls.length === 0) {
    return yield* new PreRequisitoAusente({
      falta: "latest*.yml",
      caminho: pacotes,
      comoGerar: "rode o dist (sem --dir) antes",
    });
  }
  const saida = path.join(pastaFabrica(path, contexto.raiz), `app-${opcoes.canal}-${opcoes.versao}`);
  yield* fs.remove(saida, { recursive: true, force: true });
  yield* fs.makeDirectory(saida, { recursive: true });
  for (const nome of ymls) {
    const original = yield* fs.readFileString(path.join(pacotes, nome));
    const reescrito = yield* etapa(`reescrever ${nome}`, () => reescreverLatestYml(original, opcoes.versao));
    yield* fs.writeFileString(path.join(saida, nome), reescrito);
  }
  const instaladores = (yield* fs.readDirectory(pacotes))
    .filter((nome) => nome.includes(`-${opcoes.versao}-`) && /\.(dmg|zip|exe|blockmap)$/.test(nome))
    .sort()
    .map((nome) => path.join(pacotes, nome));
  const comandos = comandosPublicacaoApp({
    canal: opcoes.canal,
    versao: opcoes.versao,
    repositorio: opcoes.repositorio,
    instaladores,
    ymls: ymls.map((nome) => path.join(saida, nome)),
  });
  yield* executarComandos(comandos, opcoes.executar);
});

const proporNovidadesDe = Effect.fn("fabrica_atualizacao.proporNovidades")(function* (opcoes: {
  readonly de: string;
  readonly para: string;
  readonly versao: Option.Option<string>;
}) {
  const versao = Option.getOrElse(opcoes.versao, () => lerInfoBanco(opcoes.para)?.versao ?? "AAAA.MM.DD");
  const itens = yield* etapa("comparar as bases", () => proporNovidades(opcoes.de, opcoes.para));
  const hoje = DateTime.formatIsoDateUtc(yield* DateTime.now);
  yield* Console.log(
    `# ${itens.length} entradas propostas de ${opcoes.de} para ${opcoes.para}; revise o texto antes de colar.`,
  );
  yield* Console.log(proposta(versao, hoje, itens));
});

/* ------------------------------------------------------------------ linha de comando */

const flagCanal = (nome: string, padrao: Canal) =>
  Flag.ChoiceWithValue(
    nome,
    CANAIS_DISTRIBUICAO.map((canal) => [canal, canal] as const),
  ).pipe(Flag.withDefault(padrao));

const flagVersao = Flag.String("versao");

const repositorioValido = (repositorio: string): boolean => {
  try {
    validarRepositorio(repositorio);
    return true;
  } catch {
    return false;
  }
};

const flagRepositorio = Flag.String("repositorio").pipe(
  Flag.withDescription("repositório do GitHub dos releases (dono/repo)"),
  Flag.filter(repositorioValido, (repositorio) => `--repositorio no formato dono/repo: ${repositorio}`),
);

const flagExecutar = Flag.Boolean("executar").pipe(
  Flag.withDescription("roda os comandos gh (sem ele, só os mostra)"),
  Flag.withDefault(false),
);

export const comandoFabrica = (contexto: ContextoFabrica) =>
  Command.make("fabrica").pipe(
    Command.withDescription("A fábrica da atualização: chave, canal, promoção e publicação da base e do app."),
    Command.withSubcommands([
      Command.make(
        "gerar-chave",
        { saida: Flag.String("saida").pipe(Flag.withDescription("pasta fora do repositório")) },
        ({ saida }) => gerarChave(saida, contexto.raiz),
      ).pipe(Command.withDescription("gera o par minisign (uma vez)")),
      Command.make(
        "canal",
        {
          canal: flagCanal("canal", "beta").pipe(
            Flag.filter(
              (canalDado) => canalDado === "beta",
              () =>
                "uma versão nova entra pelo beta; para o estável, use: pnpm fabrica promover --de beta --para estavel",
            ),
          ),
          versao: flagVersao.pipe(
            Flag.withDescription("AAAA.MM.DD (padrão: a de hoje, com .N se o dia já tem versão)"),
            Flag.filter(
              (versao) => /^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(versao),
              () => "--versao no formato AAAA.MM.DD",
            ),
            Flag.optional,
          ),
          mesmasFontes: Flag.Boolean("mesmas-fontes").pipe(
            Flag.withDescription("publica mesmo sem mudança nas fontes da base (só skills novas)"),
            Flag.withDefault(false),
          ),
          repositorio: flagRepositorio.pipe(Flag.optional),
          anterior: Flag.String("anterior").pipe(
            Flag.withDescription("kb.sqlite de uma versão anterior (um patch de cada)"),
            Flag.atLeast(0),
          ),
          appMinimo: Flag.String("app-minimo").pipe(Flag.withDefault(APP_MINIMO_PADRAO)),
        },
        ({ versao, mesmasFontes, repositorio, anterior, appMinimo }) =>
          canal(contexto, { versao, mesmasFontes, repositorio, anteriores: anterior, appMinimo }),
      ).pipe(Command.withDescription("compila, empacota e assina uma versão nova da base no beta")),
      Command.make(
        "promover",
        { de: flagCanal("de", "beta"), para: flagCanal("para", "estavel"), versao: flagVersao },
        (opcoes) => promover(contexto, opcoes),
      ).pipe(Command.withDescription("promove uma versão a outro canal (só o manifesto)")),
      Command.make(
        "publicar",
        { canal: flagCanal("canal", "beta"), versao: flagVersao, repositorio: flagRepositorio, executar: flagExecutar },
        (opcoes) => publicar(contexto, opcoes),
      ).pipe(Command.withDescription("mostra ou roda os comandos gh que publicam a base")),
      Command.make(
        "publicar-app",
        {
          canal: flagCanal("canal", "beta"),
          versao: flagVersao.pipe(Flag.withDescription("X.Y.Z (a do apps/desktop/package.json)")),
          repositorio: flagRepositorio,
          executar: flagExecutar,
        },
        (opcoes) => publicarApp(contexto, opcoes),
      ).pipe(Command.withDescription("mostra ou roda os comandos gh que publicam o app")),
      Command.make(
        "propor-novidades",
        {
          de: Flag.String("de").pipe(Flag.withDescription("kb.sqlite anterior")),
          para: Flag.String("para").pipe(Flag.withDescription("kb.sqlite novo")),
          versao: flagVersao.pipe(Flag.optional),
        },
        proporNovidadesDe,
      ).pipe(Command.withDescription("propõe entradas de novidades.yaml pela diferença entre duas bases")),
    ]),
  );

/**
 * Para `EtapaFalhou`, mostra também o motivo de quem lançou: as funções de `@simplifica-if/atualizacao`
 * dizem o que está errado no manifesto, no yml ou na chave, sem conteúdo de segredo; o `GitFalhou` e o
 * erro da plataforma dizem só o comando e o código. A saída dos processos já foi ao terminal.
 */
const relatarEtapa = Effect.fn("fabrica_atualizacao.relatarEtapa")(function* (erro: EtapaFalhou) {
  const motivo = erro.cause instanceof Error ? `: ${erro.cause.message}` : "";
  yield* Console.error(`fabrica_atualizacao: ${erro.message}${motivo}`);
  return yield* sairCom(1);
});

if (import.meta.main) {
  executarPrincipal(
    "fabrica_atualizacao",
    Command.run(comandoFabrica({ raiz: RAIZ_PROJETO, node: process.execPath }), { version: "1.0.0" }).pipe(
      Effect.catchTags({ EtapaFalhou: relatarEtapa }),
    ),
  );
}
