#!/usr/bin/env node
/**
 * A fábrica da atualização (M1.10). Roda no computador de quem publica, nunca no app.
 *
 *   pnpm fabrica gerar-chave --saida ~/.simplifica-fabrica          # uma vez: o par minisign (fora do repositório)
 *   pnpm fabrica canal [--versao 2026.11.20] [--repositorio dono/repo | --manifesto-publicado <beta.json> | --primeira-publicacao]
 *        [--anterior <kb.sqlite>]… [--mesmas-fontes]
 *   pnpm fabrica promover --de beta --para estavel --versao 2026.11.20 [--repositorio dono/repo | --manifesto-publicado <estavel.json> | --primeira-publicacao]
 *        # só o manifesto, os mesmos pacotes; conferido contra o publicado no canal de destino
 *   pnpm fabrica publicar --canal beta --versao 2026.11.20 --repositorio dono/repo [--executar]
 *   pnpm fabrica publicar-app --canal beta --versao 0.2.0 --repositorio dono/repo [--executar]
 *   pnpm fabrica propor-novidades --de <kb anterior> --para <kb nova> [--versao 2026.11.20]
 *
 * `canal` (só o beta) escolhe a versão, se não vier `--versao` (a data de hoje, com `.N` se o dia já tem
 * versão guardada), recusa a versão sem mudança nas fontes (`fontes_sha256` igual ao da última
 * guardada; `--mesmas-fontes` publica assim mesmo, para levar só as skills ou o catálogo de tarefas), compila o `kb.sqlite` publicável do commit (`git archive HEAD` numa pasta à parte,
 * nunca o disco: arquivo não rastreado, ignorado ou modificado fica de fora) com `--versao` e `--commit`,
 * sem canal (o canal é do manifesto, não do banco; promover não muda a base) (o build é
 * determinístico: o mesmo commit refaz o mesmo banco), recusa fonte não classificada, empacota a base
 * (zstd 19), os patches das versões anteriores guardadas em `tmp/fabrica/bases/` (ou das dadas em
 * `--anterior`), as skills do app (`catalogo/skills/`, um pacote por skill) e as novidades da versão, põe
 * no manifesto o catálogo de tarefas inteiro (`catalogo/tarefas/*.yaml`) e os nomes das skills retiradas
 * (`catalogo/skills/retiradas.yaml`, só de acréscimos), e assina o manifesto. As guardas comparam com o
 * manifesto publicado do canal (assinado; baixado de `--repositorio` ou lido de `--manifesto-publicado`;
 * sem ele, só com `--primeira-publicacao`, que exige o canal vazio: com `--repositorio`, o 404 do
 * manifesto; sem, `tmp/fabrica/bases/` sem versão) e
 * com os registros de `tmp/fabrica/bases/<versao>.json`: a versão nova é maior que a publicada, o commit
 * descende do publicado e não tem data anterior à dele (nem no futuro), as retiradas não encolhem, a versão
 * de uma skill não desce, e a mesma versão tem o mesmo conteúdo. O banco
 * compila num temporário e só vai para `tmp/fabrica/bases/` com o registro, no fim. Saída em
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
import { conferirAbertura, conferirAppMinimo, lerPastaTarefas, tarefasParaOCanal } from "@simplifica-if/mcp/tarefas";
import {
  APP_MINIMO_PADRAO,
  conferirContraPublicado,
  gerarCanal,
  lerManifestoPublicado,
  promoverManifesto,
  type PublicacaoAnterior,
  type SkillDaFabrica,
} from "@simplifica-if/atualizacao/fabrica";
import {
  feedGitHub,
  reescreverLatestYml,
  TAG_APP,
  TAG_BASE,
  TAG_CANAL,
  urlPacoteBase,
  validarRepositorio,
} from "@simplifica-if/atualizacao/hospedagem";
import { fontesNaoClassificadas } from "@simplifica-if/atualizacao/fontes";
import { lerInfoBanco } from "@simplifica-if/atualizacao/local";
import {
  arquivoManifesto,
  type Canal,
  codificarManifesto,
  compararVersoes,
  LIMITE_MANIFESTO,
  type Manifesto,
  problemaDataCommit,
  Semver,
  SUFIXO_ASSINATURA,
  VersaoBase,
} from "@simplifica-if/atualizacao/manifesto";
import type { ChavePublica } from "@simplifica-if/atualizacao/minisign";
import { baixar, conferirManifesto, layerHttp, urlManifesto } from "@simplifica-if/atualizacao/remoto";
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
import {
  ARQUIVO_RETIRADAS,
  lerRetiradas,
  nomesRetirados,
  soAcrescimos as soAcrescimosRetiradas,
} from "@simplifica-if/atualizacao/retiradas";
import { RAIZ_PROJETO } from "./config.ts";
import * as Git from "./git.ts";
import { sairCom } from "@simplifica-if/kb/principal";
import { executarPrincipal } from "./principal.ts";

/** As pastas de onde a fábrica lê, extraídas do commit (`git archive`), nunca do disco. */
const PASTAS_DO_COMMIT = ["base-conhecimento", "packages/kb", "catalogo"] as const;

/** Onde ficam, na árvore do commit, as skills do app, a lista de retiradas e os manifestos de tarefa. */
const PASTA_SKILLS = "catalogo/skills";
const PASTA_TAREFAS = "catalogo/tarefas";
const CAMINHO_RETIRADAS = `${PASTA_SKILLS}/${ARQUIVO_RETIRADAS}`;

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
  conferencia: Schema.Literals(["fontes", "skills", "tarefas", "retiradas", "novidades", "publicado", "data"]),
  itens: Schema.Array(Schema.String),
}) {
  override get message(): string {
    switch (this.conferencia) {
      case "publicado":
        return `a versão nova não segue o manifesto publicado do canal:\n  ${this.itens.join("\n  ")}`;
      case "data":
        return this.itens.join("; ");
      case "fontes":
        return `fontes não classificadas como publicáveis entrariam no pacote:\n  ${this.itens.join("\n  ")}`;
      case "skills":
        return `skills do app inválidas:\n  ${this.itens.join("\n  ")}`;
      case "tarefas":
        return `tarefas do catálogo inválidas:\n  ${this.itens.join("\n  ")}`;
      case "retiradas":
        return `${CAMINHO_RETIRADAS} recusado: ${this.itens.join("; ")}`;
      case "novidades":
        return `novidades.yaml não é só de acréscimos: ${this.itens.join("; ")}`;
    }
  }
}

/**
 * A fábrica não tem o manifesto publicado do canal, com que confere as guardas: nenhuma fonte dada
 * (`sem-fonte`), ou o canal ainda não tem manifesto (`canal-vazio`).
 */
export class SemManifestoPublicado extends Schema.TaggedError<SemManifestoPublicado>()("SemManifestoPublicado", {
  motivo: Schema.Literals(["sem-fonte", "canal-vazio"]),
  canal: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    return this.motivo === "sem-fonte"
      ? `a fábrica confere a versão nova contra o manifesto publicado do canal ${this.canal}: dê --repositorio dono/repo ` +
          `(baixa o manifesto do release canal-${this.canal}) ou --manifesto-publicado <${this.canal}.json> (com o .minisig ao lado); ` +
          "só na primeira publicação, --primeira-publicacao"
      : `o canal ${this.canal} não tem manifesto publicado; se esta é a primeira publicação, --primeira-publicacao`;
  }
}

/**
 * `--primeira-publicacao` pula as guardas contra o canal e só vale quando não há com o que conferir: o
 * canal responde 404 (`canal-publicado`, quando ele tem manifesto), não veio `--manifesto-publicado`
 * (`com-manifesto-publicado`) e, sem `--repositorio` (sem o 404 como prova), `tmp/fabrica/bases/` não tem
 * versão (`bases-com-versoes`).
 */
export class PrimeiraPublicacaoRecusada extends Schema.TaggedError<PrimeiraPublicacaoRecusada>()(
  "PrimeiraPublicacaoRecusada",
  {
    motivo: Schema.Literals(["canal-publicado", "com-manifesto-publicado", "bases-com-versoes"]),
    canal: Schema.String,
    /** A versão publicada no canal, ou as versões guardadas em `tmp/fabrica/bases/`. */
    detalhe: Schema.optionalKey(Schema.String),
  },
) {
  override get message(): string {
    switch (this.motivo) {
      case "canal-publicado":
        return `--primeira-publicacao recusada: o canal ${this.canal} já tem manifesto publicado (versão ${this.detalhe ?? "?"}); tire a opção, e a fábrica confere contra ele`;
      case "com-manifesto-publicado":
        return "--primeira-publicacao não vai junto com --manifesto-publicado: com o manifesto publicado, não é a primeira publicação";
      case "bases-com-versoes":
        return (
          `--primeira-publicacao sem --repositorio recusada: tmp/fabrica/bases/ já tem versões geradas (${this.detalhe ?? ""}), ` +
          "e sem o canal não há como saber se alguma foi publicada. Dê --repositorio dono/repo (a fábrica confirma que o canal está vazio) " +
          "ou, se nenhuma delas foi publicada, mova ou apague tmp/fabrica/bases/"
        );
    }
  }
}

/**
 * O manifesto dado em `--manifesto-publicado` não é o que o canal publica em `--repositorio`: o canal não
 * tem manifesto (`canal-vazio`) ou tem outro (`outro`, com as duas versões).
 */
export class ManifestoPublicadoDiferente extends Schema.TaggedError<ManifestoPublicadoDiferente>()(
  "ManifestoPublicadoDiferente",
  {
    motivo: Schema.Literals(["canal-vazio", "outro"]),
    canal: Schema.String,
    versaoDada: Schema.String,
    versaoPublicada: Schema.optionalKey(Schema.String),
  },
) {
  override get message(): string {
    return this.motivo === "canal-vazio"
      ? `--manifesto-publicado (versão ${this.versaoDada}) não está publicado: o canal ${this.canal} não tem manifesto`
      : `--manifesto-publicado (versão ${this.versaoDada}) não é o publicado no canal ${this.canal} (versão ${this.versaoPublicada ?? "?"}); dê só --repositorio`;
  }
}

/**
 * O commit do manifesto publicado não está neste clone: sem ele, não se confere que o commit novo descende
 * do publicado nem que os registros só de acréscimos não perderam entradas.
 */
export class CommitPublicadoAusente extends Schema.TaggedError<CommitPublicadoAusente>()("CommitPublicadoAusente", {
  commit: Schema.String,
  canal: Schema.String,
}) {
  override get message(): string {
    return `o commit ${this.commit}, do manifesto publicado do canal ${this.canal}, não está neste clone: rode git fetch (num clone raso, git fetch --unshallow) e tente de novo`;
  }
}

/**
 * O `kb compilar` da árvore do commit não deu o banco: o ponto de entrada não está no commit
 * (`sem-entrada`), ou ele saiu com 0 sem gravar um banco com `meta` legível (`sem-banco`).
 */
export class CompilacaoSemBanco extends Schema.TaggedError<CompilacaoSemBanco>()("CompilacaoSemBanco", {
  motivo: Schema.Literals(["sem-entrada", "sem-banco"]),
  /** O ponto de entrada, relativo à árvore do commit. */
  entrada: Schema.String,
  destino: Schema.String,
}) {
  override get message(): string {
    return this.motivo === "sem-entrada"
      ? `o commit não tem ${this.entrada}, o ponto de entrada do kb compilar que a fábrica roda; publique um commit que o tenha`
      : `o kb compilar (${this.entrada}) saiu sem erro, mas não gravou um banco com meta em ${this.destino}`;
  }
}

/** A base nova tem as mesmas fontes da última versão guardada: não há o que publicar. */
export class BaseSemMudanca extends Schema.TaggedError<BaseSemMudanca>()("BaseSemMudanca", {
  versao: Schema.String,
  anterior: Schema.String,
}) {
  override get message(): string {
    return `a base ${this.versao} tem as mesmas fontes da ${this.anterior}: nada a publicar (para levar só as skills ou o catálogo de tarefas, --mesmas-fontes)`;
  }
}

/**
 * A versão nova de um dia (`hoje` em AAAA-MM-DD): `AAAA.MM.DD`, ou `AAAA.MM.DD.N` com o `N` seguinte
 * quando o dia já tem versão entre as `existentes`. Uma existente de dia posterior a `hoje` (a publicada
 * por quem está noutro fuso, ou com o relógio adiantado) dá o dia: a versão nova passa dela.
 */
export function proximaVersao(hoje: string, existentes: ReadonlyArray<string>): string {
  const diaDe = (versao: string) => (/^\d{4}\.\d{2}\.\d{2}(?:\.\d+)?$/.test(versao) ? versao.slice(0, 10) : "");
  const doDia = existentes.map(diaDe).reduce((maior, dia) => (dia > maior ? dia : maior), hoje.replaceAll("-", "."));
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

/** O ponto de entrada do `kb compilar` só com o `packages/kb`, relativo à árvore do commit. */
export const ENTRADA_COMPILAR = "packages/kb/src/cli/compilar-principal.ts";

/**
 * Compila o `kb.sqlite` com o `kb` da árvore do commit e a raiz nela, sem `--canal` (o canal é do
 * manifesto, não do banco). Confere que o banco saiu, com o `meta`: um compilador que sai com 0 sem
 * gravar nada é recusado aqui, e não adiante, ao empacotar.
 */
export const compilarBase = Effect.fn("fabrica_atualizacao.compilarBase")(function* (opcoes: {
  readonly node: string;
  readonly arvore: string;
  readonly destino: string;
  readonly versao: string;
  readonly commit: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entrada = path.join(opcoes.arvore, ...ENTRADA_COMPILAR.split("/"));
  if (!(yield* fs.exists(entrada))) {
    return yield* new CompilacaoSemBanco({ motivo: "sem-entrada", entrada: ENTRADA_COMPILAR, destino: opcoes.destino });
  }
  yield* exigirProcesso(
    "kb compilar",
    [opcoes.node, entrada, "--destino", opcoes.destino, "--versao", opcoes.versao, "--commit", opcoes.commit],
    { cwd: opcoes.arvore, env: { KB_SQLITE: opcoes.destino } },
  );
  const info = (yield* fs.exists(opcoes.destino)) ? lerInfoBanco(opcoes.destino) : null;
  if (info === null) {
    return yield* new CompilacaoSemBanco({ motivo: "sem-banco", entrada: ENTRADA_COMPILAR, destino: opcoes.destino });
  }
  return info;
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

/** As skills do app do commit (`catalogo/skills`), cada uma com os arquivos que vão no pacote. */
export const skillsDoApp = Effect.fn("fabrica_atualizacao.skillsDoApp")(function* (arvore: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const origem = path.join(arvore, ...PASTA_SKILLS.split("/"));
  if (!(yield* fs.exists(origem))) return [];
  const pasta = yield* lerPastaSkills(origem, { estrito: true });
  const recusadas = [
    ...pasta.invalidas.map((erro) => erro.message),
    ...pasta.foraDoApp.map((nome) => `skill ${nome}: sem o bloco simplifica: no SKILL.md`),
  ];
  if (recusadas.length > 0) return yield* new ConferenciaRecusada({ conferencia: "skills", itens: recusadas });
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

/**
 * O catálogo de tarefas do commit, pronto para o manifesto: todos os `catalogo/tarefas/*.yaml`, lidos em
 * modo estrito. A fábrica recusa o manifesto inválido, a tarefa que cita skill fora das publicadas ou
 * módulo que o app não tem e a de `app_minimo` menor que o da skill que cita: o que o `validar_base.ts`
 * recusa não se publica.
 */
export const tarefasDoCatalogo = Effect.fn("fabrica_atualizacao.tarefasDoCatalogo")(function* (
  arvore: string,
  skills: ReadonlyArray<Pick<SkillDaFabrica, "nome" | "appMinimo">>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const origem = path.join(arvore, ...PASTA_TAREFAS.split("/"));
  if (!(yield* fs.exists(origem))) return [];
  const pasta = yield* lerPastaTarefas(origem, { estrito: true });
  const appMinimos = new Map(skills.map((skill) => [skill.nome, skill.appMinimo] as const));
  const recusadas = [
    ...pasta.invalidas.map((erro) => erro.message),
    ...pasta.tarefas.flatMap((tarefa) => {
      const { ausente } = conferirAbertura(tarefa, appMinimos);
      if (ausente !== undefined) return [`tarefa ${tarefa.id}: cita ${ausente.tipo} que não existe: ${ausente.nome}`];
      const appMinimo = conferirAppMinimo(tarefa, (nome) => appMinimos.get(nome));
      return appMinimo === undefined ? [] : [appMinimo];
    }),
  ];
  if (recusadas.length > 0) return yield* new ConferenciaRecusada({ conferencia: "tarefas", itens: recusadas });
  return tarefasParaOCanal(pasta.tarefas);
});

/**
 * O registro de uma versão gerada (`tmp/fabrica/bases/<versao>.json`): o commit e as skills que ela levou,
 * com as versões no padrão do manifesto (`VersaoBase`, `Semver`): uma versão malformada faria a guarda de
 * versão comparar com `NaN` e passar.
 */
const VersaoGuardada = Schema.fromJsonString(
  Schema.Struct({
    versao: VersaoBase,
    commit: Schema.String,
    /** Ausente nos registros de antes da guarda de versão. */
    skills: Schema.optionalKey(
      Schema.Array(
        Schema.Struct({
          nome: Schema.String,
          versao: Semver,
          sha256: Schema.String.check(
            Schema.isPattern(/^[0-9a-f]{64}$/, { message: "esperava sha256 em hexadecimal" }),
          ),
        }),
      ),
    ),
  }),
);
const decodificarVersaoGuardada = Schema.decodeUnknownEffect(VersaoGuardada);

/** Um registro de versão gerada, já lido. */
export type RegistroVersao = typeof VersaoGuardada.Type;

/**
 * Os registros das versões estritamente anteriores a `versao`, da menor à maior pela ordem de versões
 * (`compararVersoes`, não a do nome do arquivo: `2026.11.20.2` vem depois de `2026.11.20`). O último é a
 * versão gerada imediatamente antes.
 */
export const registrosAnteriores = (
  registros: ReadonlyArray<RegistroVersao>,
  versao: string,
): ReadonlyArray<RegistroVersao> =>
  registros
    .filter((registro) => compararVersoes(registro.versao, versao) < 0)
    .sort((a, b) => compararVersoes(a.versao, b.versao));

/** Os registros das versões já geradas (`tmp/fabrica/bases/*.json`), sem ordem. */
const versoesGuardadas = Effect.fn("fabrica_atualizacao.versoesGuardadas")(function* (raiz: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const bases = pastaBases(path, raiz);
  const nomes = (yield* fs.exists(bases))
    ? (yield* fs.readDirectory(bases)).filter((nome) => nome.endsWith(".json"))
    : [];
  return yield* Effect.forEach(nomes, (nome) =>
    fs.readFileString(path.join(bases, nome)).pipe(
      Effect.flatMap(decodificarVersaoGuardada),
      Effect.catchTags({
        SchemaError: (cause) =>
          Effect.fail(
            new EtapaFalhou({
              etapa: `ler o registro tmp/fabrica/bases/${nome} (malformado: corrija ou apague o registro e o .sqlite da versão)`,
              cause,
            }),
          ),
      }),
    ),
  );
});

/**
 * Os nomes das skills retiradas do commit (`catalogo/skills/retiradas.yaml`; sem o arquivo, nenhuma). O
 * arquivo só ganhou entradas desde cada commit anterior dado (o do manifesto publicado e o da última versão
 * gerada); um commit que o git não tem, ou sem o arquivo, não tem o que conferir. A skill retirada que
 * continua no catálogo é recusada em `gerarCanal`.
 */
export const skillsRetiradas = Effect.fn("fabrica_atualizacao.skillsRetiradas")(function* (
  arvore: string,
  raiz: string,
  commitsAnteriores: ReadonlyArray<string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const arquivo = path.join(arvore, ...CAMINHO_RETIRADAS.split("/"));
  if (!(yield* fs.exists(arquivo))) return [];
  const texto = yield* fs.readFileString(arquivo);
  const atual = yield* etapa(`ler ${CAMINHO_RETIRADAS}`, () => lerRetiradas(texto));
  const problemas: string[] = [];
  for (const commit of commitsAnteriores) {
    const antes = Option.flatMap(
      yield* Git.tentar(["show", `${commit}:${CAMINHO_RETIRADAS}`], { cwd: raiz }),
      Option.liftThrowable(lerRetiradas),
    );
    if (Option.isSome(antes)) problemas.push(...soAcrescimosRetiradas(antes.value, atual));
  }
  if (problemas.length > 0) {
    return yield* new ConferenciaRecusada({ conferencia: "retiradas", itens: [...new Set(problemas)] });
  }
  return nomesRetirados(atual);
});

/** As novidades conferidas: o arquivo só ganhou entradas desde cada commit anterior dado. */
const novidades = Effect.fn("fabrica_atualizacao.novidades")(function* (
  arvore: string,
  raiz: string,
  versao: string,
  commitsAnteriores: ReadonlyArray<string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const texto = yield* fs.readFileString(path.join(arvore, "base-conhecimento", "novidades.yaml"));
  const atual = yield* etapa("ler novidades.yaml", () => lerNovidades(texto));
  for (const commit of commitsAnteriores) {
    // O commit anterior pode não ter o arquivo (ou o git não o ter): aí não há o que conferir.
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

/**
 * Baixa o manifesto publicado de `url` com a assinatura conferida; `None` só se o manifesto responde 404
 * (o canal vazio). O manifesto no ar com a assinatura que falta (404 do `.minisig`) é erro, não canal vazio.
 */
const baixarPublicado = Effect.fn("fabrica_atualizacao.baixarPublicado")(function* (
  url: string,
  chave: ChavePublica,
  canal: Canal,
) {
  const noAr = yield* baixar(url, LIMITE_MANIFESTO).pipe(
    Effect.as(true),
    Effect.provide(layerHttp()),
    Effect.catchTags({
      FalhaDownload: (cause) =>
        cause.categoria === "status" && cause.status === 404
          ? Effect.succeed(false)
          : Effect.fail(new EtapaFalhou({ etapa: "baixar o manifesto publicado", cause })),
    }),
  );
  if (!noAr) return Option.none<Manifesto>();
  return yield* conferirManifesto({ urlManifesto: url, canal, chave }).pipe(
    Effect.asSome,
    Effect.provide(layerHttp()),
    Effect.catchTags({
      FalhaDownload: (cause) =>
        Effect.fail(new EtapaFalhou({ etapa: "baixar o manifesto publicado e a assinatura dele", cause })),
      ManifestoRecusado: (cause) => Effect.fail(new EtapaFalhou({ etapa: "conferir o manifesto publicado", cause })),
    }),
  );
});

/**
 * O manifesto publicado do canal, a referência das guardas da fábrica, com a assinatura conferida pela
 * chave da fábrica:
 *
 * - com `url` (o release fixo do canal, de `--repositorio`), sempre baixado: `--primeira-publicacao` só
 *   passa se o canal responde 404, e um `arquivo` dado tem de ser o mesmo que o canal publica;
 * - com `arquivo` (`--manifesto-publicado`, com o `.minisig` ao lado), lido dele; não vai junto com
 *   `--primeira-publicacao`;
 * - sem nenhum dos dois, só a primeira publicação (`Option.none()`), e quem chama confere que
 *   `tmp/fabrica/bases/` está vazia (`conferirPrimeiraPublicacao`).
 */
export const manifestoPublicado = Effect.fn("fabrica_atualizacao.manifestoPublicado")(function* (opcoes: {
  readonly arquivo: Option.Option<string>;
  readonly url: Option.Option<string>;
  readonly primeiraPublicacao: boolean;
  readonly chave: ChavePublica;
  readonly canal: Canal;
}) {
  const fs = yield* FileSystem.FileSystem;
  if (opcoes.primeiraPublicacao && Option.isSome(opcoes.arquivo)) {
    return yield* new PrimeiraPublicacaoRecusada({ motivo: "com-manifesto-publicado", canal: opcoes.canal });
  }
  const baixado = Option.isSome(opcoes.url)
    ? Option.some(yield* baixarPublicado(opcoes.url.value, opcoes.chave, opcoes.canal))
    : Option.none<Option.Option<Manifesto>>();
  if (Option.isSome(opcoes.arquivo)) {
    const arquivo = yield* expandir(opcoes.arquivo.value);
    const texto = yield* fs.readFileString(arquivo);
    const assinatura = yield* fs.readFileString(`${arquivo}${SUFIXO_ASSINATURA}`);
    const manifesto = yield* etapa("ler o manifesto publicado", () =>
      lerManifestoPublicado({ texto, assinatura, chave: opcoes.chave, canal: opcoes.canal }),
    );
    if (Option.isSome(baixado)) {
      const publicado = baixado.value;
      if (Option.isNone(publicado)) {
        return yield* new ManifestoPublicadoDiferente({
          motivo: "canal-vazio",
          canal: opcoes.canal,
          versaoDada: manifesto.versao,
        });
      }
      if (codificarManifesto(publicado.value) !== codificarManifesto(manifesto)) {
        return yield* new ManifestoPublicadoDiferente({
          motivo: "outro",
          canal: opcoes.canal,
          versaoDada: manifesto.versao,
          versaoPublicada: publicado.value.versao,
        });
      }
    }
    return Option.some(manifesto);
  }
  if (Option.isSome(baixado)) {
    const publicado = baixado.value;
    if (Option.isSome(publicado) && opcoes.primeiraPublicacao) {
      return yield* new PrimeiraPublicacaoRecusada({
        motivo: "canal-publicado",
        canal: opcoes.canal,
        detalhe: publicado.value.versao,
      });
    }
    if (Option.isNone(publicado) && !opcoes.primeiraPublicacao) {
      return yield* new SemManifestoPublicado({ motivo: "canal-vazio", canal: opcoes.canal });
    }
    return publicado;
  }
  if (opcoes.primeiraPublicacao) return Option.none<Manifesto>();
  return yield* new SemManifestoPublicado({ motivo: "sem-fonte", canal: opcoes.canal });
});

/** As versões já geradas neste computador (`tmp/fabrica/bases/`, pelos `.sqlite` e pelos registros). */
const versoesNasBases = Effect.fn("fabrica_atualizacao.versoesNasBases")(function* (raiz: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const bases = pastaBases(path, raiz);
  if (!(yield* fs.exists(bases))) return [];
  return [
    ...new Set(
      (yield* fs.readDirectory(bases))
        .filter((nome) => nome.endsWith(".sqlite") || nome.endsWith(".json"))
        .map((nome) => nome.replace(/\.(sqlite|json)$/, "")),
    ),
  ].sort();
});

/**
 * `--primeira-publicacao` sem `--repositorio` não tem como perguntar ao canal: só passa com
 * `tmp/fabrica/bases/` vazia (nada foi gerado neste computador). Com `--repositorio`
 * (`confirmadaNoCanal`), o 404 do manifesto (`manifestoPublicado`) é a prova que vale, e as bases
 * guardadas não importam.
 */
export const conferirPrimeiraPublicacao = Effect.fn("fabrica_atualizacao.conferirPrimeiraPublicacao")(function* (
  raiz: string,
  canal: Canal,
  confirmadaNoCanal: boolean,
) {
  if (confirmadaNoCanal) return;
  const versoes = yield* versoesNasBases(raiz);
  if (versoes.length > 0) {
    return yield* new PrimeiraPublicacaoRecusada({ motivo: "bases-com-versoes", canal, detalhe: versoes.join(", ") });
  }
});

/**
 * O commit novo descende do commit do manifesto publicado (`git merge-base --is-ancestor`): a versão nova
 * não saiu de um ramo que perdeu o que já foi publicado. Recusa com `CommitPublicadoAusente` se o commit
 * publicado não está neste clone, em vez de pular a conferência.
 */
export const conferirDescendencia = Effect.fn("fabrica_atualizacao.conferirDescendencia")(function* (
  publicado: Manifesto,
  commit: string,
  raiz: string,
) {
  const existe = yield* Git.tentar(["cat-file", "-e", `${publicado.commit}^{commit}`], { cwd: raiz });
  if (Option.isNone(existe)) {
    return yield* new CommitPublicadoAusente({ commit: publicado.commit, canal: publicado.canal });
  }
  const descende = yield* Git.executar(["merge-base", "--is-ancestor", publicado.commit, commit], { cwd: raiz }).pipe(
    Effect.as(true),
    Effect.catchTags({
      GitFalhou: (cause) =>
        cause.codigo === 1
          ? Effect.succeed(false)
          : Effect.fail(new EtapaFalhou({ etapa: "git merge-base --is-ancestor", cause })),
    }),
  );
  if (!descende) {
    return yield* new ConferenciaRecusada({
      conferencia: "publicado",
      itens: [
        `o commit ${commit} não descende do ${publicado.commit}, o do manifesto publicado (versão ${publicado.versao}): publique de um commit que contém o publicado`,
      ],
    });
  }
});

const canal = Effect.fn("fabrica_atualizacao.canal")(function* (
  contexto: ContextoFabrica,
  opcoes: {
    /** Sem ela, a de hoje (`proximaVersao`). */
    readonly versao: Option.Option<string>;
    /** Publica mesmo com as fontes iguais às da última versão guardada (só skills ou tarefas novas). */
    readonly mesmasFontes: boolean;
    readonly repositorio: Option.Option<string>;
    /** O manifesto publicado do canal num arquivo (no lugar de baixá-lo de `repositorio`). */
    readonly manifestoPublicado: Option.Option<string>;
    /** Sem manifesto publicado com que conferir: só na primeira publicação do canal. */
    readonly primeiraPublicacao: boolean;
    readonly anteriores: ReadonlyArray<string>;
    readonly appMinimo: string;
  },
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { raiz } = contexto;
  const canalNovo: Canal = "beta";
  const commit = (yield* git(["rev-parse", "--short", "HEAD"], raiz)).trim();
  const dataCommit = (yield* git(["show", "-s", "--format=%cI", "HEAD"], raiz)).trim();
  const problemaData = problemaDataCommit(dataCommit, DateTime.toEpochMillis(yield* DateTime.now));
  if (problemaData !== undefined) return yield* new ConferenciaRecusada({ conferencia: "data", itens: [problemaData] });
  if ((yield* git(["status", "--porcelain", "--", ...PASTAS_DO_COMMIT], raiz)).trim() !== "") {
    yield* Console.warn(`aviso: há mudanças fora do commit nas fontes; a base sai do commit ${commit}, sem elas`);
  }
  const arvore = yield* arvoreDoCommit(commit, path.join(pastaFabrica(path, raiz), "arvore"), raiz);
  const naoClassificadas = fontesNaoClassificadas(yield* etapa("listar as fontes", () => arquivosFonte(arvore)));
  if (naoClassificadas.length > 0) {
    return yield* new ConferenciaRecusada({ conferencia: "fontes", itens: naoClassificadas });
  }
  const chave = yield* lerChave(raiz);
  const publicado = yield* manifestoPublicado({
    arquivo: opcoes.manifestoPublicado,
    url: Option.map(opcoes.repositorio, (repositorio) => urlManifesto(feedGitHub(repositorio), canalNovo)),
    primeiraPublicacao: opcoes.primeiraPublicacao,
    chave,
    canal: canalNovo,
  });
  if (opcoes.primeiraPublicacao) {
    yield* conferirPrimeiraPublicacao(raiz, canalNovo, Option.isSome(opcoes.repositorio));
  }
  if (Option.isSome(publicado)) yield* conferirDescendencia(publicado.value, commit, raiz);
  const bases = pastaBases(path, raiz);
  yield* fs.makeDirectory(bases, { recursive: true });
  const existentes = (yield* fs.readDirectory(bases))
    .filter((nome) => nome.endsWith(".sqlite"))
    .map((nome) => nome.slice(0, -".sqlite".length));
  // A versão nova passa também da publicada: a geração de outro computador não se repete aqui, e uma
  // publicada de data posterior ao dia local (outro fuso, relógio atrasado) dá o `.N` seguinte dela.
  const versao = Option.isSome(opcoes.versao)
    ? opcoes.versao.value
    : proximaVersao(DateTime.formatIsoDate(DateTime.setZone(yield* DateTime.now, DateTime.zoneMakeLocal())), [
        ...existentes,
        ...Option.toArray(Option.map(publicado, (manifesto) => manifesto.versao)),
      ]);
  if (Option.isSome(publicado)) {
    // A versão e a data antes de compilar; `gerarCanal` confere de novo, com as retiradas do commit.
    const contra = conferirContraPublicado(
      { versao, dataCommit, skillsRetiradas: publicado.value.skills_retiradas },
      publicado.value,
    );
    if (contra.length > 0) return yield* new ConferenciaRecusada({ conferencia: "publicado", itens: contra });
  }
  const saida = path.join(pastaFabrica(path, raiz), `${canalNovo}-${versao}`);
  yield* fs.remove(saida, { recursive: true, force: true });
  // O banco compila num temporário e só vai para `bases/`, com o registro, quando tudo passou: uma recusa
  // não deixa em `bases/` uma versão que nunca saiu (a geração seguinte pularia a versão e faria patch dela).
  const compilando = path.join(pastaFabrica(path, raiz), "compilando");
  yield* fs.remove(compilando, { recursive: true, force: true });
  yield* fs.makeDirectory(compilando, { recursive: true });
  const banco = path.join(compilando, `${versao}.sqlite`);
  const gerar = Effect.gen(function* () {
    yield* Console.log(`compilando a base ${versao} do commit ${commit}…`);
    const compilado = yield* compilarBase({ node: contexto.node, arvore, destino: banco, versao, commit });
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
    if (!opcoes.mesmasFontes && ultima !== null && ultima.fontesSha256 === compilado.fontesSha256) {
      return yield* new BaseSemMudanca({ versao, anterior: ultima.versao });
    }
    const dadas = yield* Effect.forEach(opcoes.anteriores, expandir);
    const anteriores = [...new Set([...dadas, ...guardadas])];
    yield* Console.log(`empacotando (zstd 19; patches de ${anteriores.length} versões anteriores)…`);
    // As versões geradas antes desta (neste computador) e o manifesto publicado do canal: os commits dos
    // dois conferem os registros só de acréscimos, e as skills, a guarda de versão.
    const registros = registrosAnteriores(yield* versoesGuardadas(raiz), versao);
    const commitsAnteriores = [
      ...new Set([
        ...Option.toArray(Option.map(publicado, (manifesto) => manifesto.commit)),
        ...registros.slice(-1).map((registro) => registro.commit),
      ]),
    ];
    const publicacoes: ReadonlyArray<PublicacaoAnterior> = registros.map((registro) => ({
      versao: registro.versao,
      origem: "registro-local",
      skills: registro.skills ?? [],
    }));
    const skills = yield* skillsDoApp(arvore);
    const tarefas = yield* tarefasDoCatalogo(arvore, skills);
    const retiradas = yield* skillsRetiradas(arvore, raiz, commitsAnteriores);
    const itens = yield* novidades(arvore, raiz, versao, commitsAnteriores);
    const gerado = yield* etapa("gerar o canal", () =>
      gerarCanal({
        saida,
        canal: canalNovo,
        commit,
        dataCommit,
        banco,
        anteriores,
        skills,
        publicacoes,
        ...(Option.isSome(publicado) ? { publicado: publicado.value } : {}),
        skillsRetiradas: retiradas,
        tarefas,
        appMinimo: opcoes.appMinimo,
        novidades: itens,
        chave,
        ...(Option.isNone(opcoes.repositorio) ? {} : { urlPacotes: urlPacoteBase(versao) }),
      }),
    );
    yield* fs.rename(banco, path.join(bases, `${versao}.sqlite`));
    yield* fs.writeFileString(
      path.join(bases, `${versao}.json`),
      // @effect-diagnostics-next-line globalJsonInEffect:off -- objeto de cadeias montado aqui; não há como falhar
      `${JSON.stringify({ versao: versao, commit, canal: canalNovo, skills: gerado.skillsPublicadas }, null, 2)}\n`,
    );
    yield* Console.log(
      `catálogo: ${tarefas.length} tarefas, ${skills.length} skills, ${retiradas.length} skills retiradas`,
    );
    for (const arquivo of gerado.arquivos) {
      const bytes = Number((yield* fs.stat(path.join(saida, arquivo))).size);
      yield* Console.log(`  ${arquivo}  ${(bytes / 1024 / 1024).toFixed(2)} MB`);
    }
    yield* Console.log(`saída: ${saida}`);
  });
  yield* gerar.pipe(
    Effect.onError(() =>
      Effect.all([
        fs.remove(compilando, { recursive: true, force: true }),
        fs.remove(saida, { recursive: true, force: true }),
      ]).pipe(Effect.ignore),
    ),
    Effect.ensuring(fs.remove(arvore, { recursive: true, force: true }).pipe(Effect.ignore)),
  );
  yield* fs.remove(compilando, { recursive: true, force: true });
});

/**
 * Promove uma versão do beta ao estável: os mesmos pacotes já publicados (o release `base-<versao>`), o
 * mesmo catálogo de tarefas e as mesmas skills retiradas, que vão dentro do manifesto; só o manifesto do
 * estável, conferido e assinado de novo. Nada se recompila.
 */
const promover = Effect.fn("fabrica_atualizacao.promover")(function* (
  contexto: ContextoFabrica,
  opcoes: {
    readonly de: Canal;
    readonly para: Canal;
    readonly versao: string;
    readonly repositorio: Option.Option<string>;
    /** O manifesto publicado do canal de destino num arquivo (no lugar de baixá-lo de `repositorio`). */
    readonly manifestoPublicado: Option.Option<string>;
    /** O canal de destino ainda não tem manifesto publicado. */
    readonly primeiraPublicacao: boolean;
  },
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const origem = path.join(pastaFabrica(path, contexto.raiz), `${opcoes.de}-${opcoes.versao}`);
  const nome = arquivoManifesto(opcoes.de);
  if (!(yield* fs.exists(path.join(origem, nome)))) {
    return yield* new PreRequisitoAusente({
      falta: `o manifesto ${nome}`,
      caminho: origem,
      comoGerar: `gere antes: pnpm fabrica canal --versao ${opcoes.versao} --repositorio ${Option.getOrElse(opcoes.repositorio, () => "dono/repo")}`,
    });
  }
  const texto = yield* fs.readFileString(path.join(origem, nome));
  const assinatura = yield* fs.readFileString(path.join(origem, `${nome}${SUFIXO_ASSINATURA}`));
  const chave = yield* lerChave(contexto.raiz);
  // A referência é o manifesto publicado do canal de destino: a versão promovida é mais nova que ele, de
  // commit que descende do dele, e não tira retirada.
  const publicado = yield* manifestoPublicado({
    arquivo: opcoes.manifestoPublicado,
    url: Option.map(opcoes.repositorio, (repositorio) => urlManifesto(feedGitHub(repositorio), opcoes.para)),
    primeiraPublicacao: opcoes.primeiraPublicacao,
    chave,
    canal: opcoes.para,
  });
  const origemManifesto = yield* etapa("ler o manifesto a promover", () =>
    lerManifestoPublicado({ texto, assinatura, chave, canal: opcoes.de }),
  );
  if (Option.isSome(publicado)) yield* conferirDescendencia(publicado.value, origemManifesto.commit, contexto.raiz);
  const agora = DateTime.toDateUtc(yield* DateTime.now);
  const { manifesto, arquivos } = yield* etapa("promover o manifesto", () =>
    promoverManifesto({
      texto,
      assinatura,
      de: opcoes.de,
      para: opcoes.para,
      chave,
      agora,
      ...(Option.isSome(publicado) ? { publicado: publicado.value } : {}),
    }),
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
      comoGerar: `rode antes: pnpm fabrica canal --versao ${opcoes.versao} --repositorio ${opcoes.repositorio}`,
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
            Flag.withDescription("publica mesmo sem mudança nas fontes da base (só skills ou tarefas novas)"),
            Flag.withDefault(false),
          ),
          repositorio: flagRepositorio.pipe(Flag.optional),
          anterior: Flag.String("anterior").pipe(
            Flag.withDescription("kb.sqlite de uma versão anterior (um patch de cada)"),
            Flag.atLeast(0),
          ),
          appMinimo: Flag.String("app-minimo").pipe(Flag.withDefault(APP_MINIMO_PADRAO)),
          manifestoPublicado: Flag.String("manifesto-publicado").pipe(
            Flag.withDescription(
              "o manifesto publicado do canal (beta.json, com o .minisig ao lado), no lugar de baixá-lo de --repositorio",
            ),
            Flag.optional,
          ),
          primeiraPublicacao: Flag.Boolean("primeira-publicacao").pipe(
            Flag.withDescription("o canal ainda não tem manifesto publicado: gera sem conferir contra ele"),
            Flag.withDefault(false),
          ),
        },
        ({ versao, mesmasFontes, repositorio, anterior, appMinimo, manifestoPublicado, primeiraPublicacao }) =>
          canal(contexto, {
            versao,
            mesmasFontes,
            repositorio,
            manifestoPublicado,
            primeiraPublicacao,
            anteriores: anterior,
            appMinimo,
          }),
      ).pipe(Command.withDescription("compila, empacota e assina uma versão nova da base no beta")),
      Command.make(
        "promover",
        {
          de: flagCanal("de", "beta"),
          para: flagCanal("para", "estavel"),
          versao: flagVersao,
          repositorio: flagRepositorio.pipe(Flag.optional),
          manifestoPublicado: Flag.String("manifesto-publicado").pipe(
            Flag.withDescription(
              "o manifesto publicado do canal de destino (estavel.json, com o .minisig ao lado), no lugar de baixá-lo de --repositorio",
            ),
            Flag.optional,
          ),
          primeiraPublicacao: Flag.Boolean("primeira-publicacao").pipe(
            Flag.withDescription("o canal de destino ainda não tem manifesto publicado"),
            Flag.withDefault(false),
          ),
        },
        (opcoes) => promover(contexto, opcoes),
      ).pipe(
        Command.withDescription("promove uma versão a outro canal (só o manifesto), conferida contra o publicado nele"),
      ),
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
