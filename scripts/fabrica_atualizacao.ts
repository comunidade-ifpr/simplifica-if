#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off -- script da fábrica, sem runtime Effect: subprocessos (kb compilar, git, gh), arquivos e saída no terminal
/**
 * A fábrica da atualização (M1.10). Roda no computador de quem publica, nunca no app.
 *
 *   pnpm fabrica gerar-chave --saida ~/.simplifica-fabrica          # uma vez: o par minisign (fora do repositório)
 *   pnpm fabrica canal --canal beta --versao 2026.11.20 [--repositorio dono/repo] [--anterior <kb.sqlite>]…
 *   pnpm fabrica publicar --canal beta --versao 2026.11.20 --repositorio dono/repo [--executar]
 *   pnpm fabrica publicar-app --canal beta --versao 0.2.0 --repositorio dono/repo [--executar]
 *   pnpm fabrica propor-novidades --de <kb anterior> --para <kb nova> [--versao 2026.11.20]
 *
 * `canal` compila o `kb.sqlite` publicável com `--versao`, `--commit` e `--canal` (o build é
 * determinístico: o mesmo commit refaz o mesmo banco), recusa fonte não classificada, empacota a base
 * (zstd 19), os patches das versões anteriores guardadas em `tmp/fabrica/bases/` (ou das dadas em
 * `--anterior`), as skills do app e as novidades da versão, e assina o manifesto. Saída em
 * `tmp/fabrica/<canal>-<versao>/`.
 *
 * A chave secreta vem de `SIMPLIFICA_MINISIGN_CHAVE` (caminho do arquivo, fora do repositório) e a
 * senha, se houver, de `SIMPLIFICA_MINISIGN_SENHA`. O script se recusa a ler ou gravar chave dentro do
 * checkout.
 *
 * `publicar` mostra (ou, com `--executar`, roda) os comandos `gh release` da hospedagem decidida
 * (GitHub Releases do próprio repositório; ver `packages/atualizacao/src/hospedagem.ts`). O `gh` é ferramenta de quem
 * publica; o app só baixa pelos links diretos.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import { arquivosFonte } from "@simplifica-if/kb/db/fontes";
import { lerPastaSkills } from "@simplifica-if/mcp/skills";
import { gerarCanal, type SkillDaFabrica } from "@simplifica-if/atualizacao/fabrica";
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
import {
  arquivoManifesto,
  type Canal,
  CANAIS,
  compararVersoes,
  SUFIXO_ASSINATURA,
} from "@simplifica-if/atualizacao/manifesto";
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

const RAIZ = NodePath.resolve(import.meta.dirname, "..");
const PASTA_FABRICA = NodePath.join(RAIZ, "tmp", "fabrica");
const PASTA_BASES = NodePath.join(PASTA_FABRICA, "bases");
const NOVIDADES = NodePath.join(RAIZ, "base-conhecimento", "novidades.yaml");

const falhar = (mensagem: string): never => {
  console.error(`fábrica: ${mensagem}`);
  process.exit(1);
};

const dentroDoRepositorio = (caminho: string) => {
  const relativo = NodePath.relative(RAIZ, NodePath.resolve(caminho));
  return !relativo.startsWith("..") && !NodePath.isAbsolute(relativo);
};

const expandir = (caminho: string) =>
  caminho.startsWith("~/") ? NodePath.join(NodeOS.homedir(), caminho.slice(2)) : caminho;

const git = (...args: string[]) => NodeChildProcess.execFileSync("git", args, { cwd: RAIZ, encoding: "utf8" }).trim();

function lerChave() {
  const caminho = process.env["SIMPLIFICA_MINISIGN_CHAVE"];
  if (caminho === undefined || caminho === "") {
    return falhar("defina SIMPLIFICA_MINISIGN_CHAVE com o caminho da chave secreta (fora do repositório)");
  }
  if (dentroDoRepositorio(expandir(caminho))) return falhar("a chave secreta não pode ficar dentro do repositório");
  return lerChaveSecreta(NodeFS.readFileSync(expandir(caminho), "utf8"), process.env["SIMPLIFICA_MINISIGN_SENHA"]);
}

function gerarChave(saida: string) {
  const pasta = expandir(saida);
  if (dentroDoRepositorio(pasta)) falhar("grave a chave fora do repositório (por exemplo, ~/.simplifica-fabrica)");
  NodeFS.mkdirSync(pasta, { recursive: true, mode: 0o700 });
  const secreta = NodePath.join(pasta, "simplifica-fabrica.key");
  if (NodeFS.existsSync(secreta)) falhar(`já existe uma chave em ${secreta}; não sobrescrevo`);
  const chave = gerarChaves();
  const senha = process.env["SIMPLIFICA_MINISIGN_SENHA"];
  NodeFS.writeFileSync(secreta, escreverChaveSecreta(chave, senha === undefined ? {} : { senha }), { mode: 0o600 });
  const publica = escreverChavePublica(chave);
  NodeFS.writeFileSync(NodePath.join(pasta, "simplifica-fabrica.pub"), publica);
  console.log(`chave secreta: ${secreta}${senha === undefined ? " (sem senha)" : " (cifrada com a senha)"}`);
  console.log("chave pública (vai para POLITICA_FABRICA.atualizacao.chavePublica, em packages/motor/src/politica.ts):");
  console.log(publica.split("\n")[1]);
}

async function skillsDoApp(): Promise<ReadonlyArray<SkillDaFabrica>> {
  const pasta = await Effect.runPromise(
    lerPastaSkills(NodePath.join(RAIZ, ".agents", "skills")).pipe(Effect.provide(NodeServices.layer)),
  );
  if (pasta.invalidas.length > 0)
    falhar(`skills do app inválidas:\n${pasta.invalidas.map((e) => `  ${e.message}`).join("\n")}`);
  return pasta.skills.map((skill) => ({
    nome: skill.nome,
    versao: skill.manifesto.versao ?? "0.1.0",
    appMinimo: skill.manifesto.app_minimo ?? "0.1.0",
    baseMinima: skill.manifesto.base_minima ?? "2000.01.01",
    arquivos: ["SKILL.md", ...skill.manifesto.arquivos].map((caminho) => ({
      caminho,
      conteudo: NodeFS.readFileSync(NodePath.join(skill.pasta, ...caminho.split("/"))),
    })),
  }));
}

/** As novidades conferidas: o arquivo só ganhou entradas desde a última versão publicada. */
function novidades(versao: string) {
  const atual = lerNovidades(NodeFS.readFileSync(NOVIDADES, "utf8"));
  const publicadas = NodeFS.existsSync(PASTA_BASES)
    ? NodeFS.readdirSync(PASTA_BASES)
        .filter((nome) => nome.endsWith(".json"))
        .map((nome) => JSON.parse(NodeFS.readFileSync(NodePath.join(PASTA_BASES, nome), "utf8")) as { commit: string })
    : [];
  const ultima = publicadas.at(-1);
  if (ultima !== undefined) {
    try {
      const antes = lerNovidades(git("show", `${ultima.commit}:base-conhecimento/novidades.yaml`));
      const problemas = soAcrescimos(antes, atual);
      if (problemas.length > 0) falhar(`novidades.yaml não é só de acréscimos: ${problemas.join("; ")}`);
    } catch {
      // o commit da última versão não tinha o arquivo: nada a conferir
    }
  }
  const itens = novidadesDaVersao(atual, versao);
  if (itens.length === 0) console.warn(`aviso: novidades.yaml não tem entradas da versão ${versao}`);
  return itens;
}

async function canal(opcoes: {
  canal: Canal;
  versao: string;
  repositorio?: string;
  anteriores: string[];
  appMinimo: string;
}) {
  if (!/^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(opcoes.versao)) falhar("--versao no formato AAAA.MM.DD");
  if (
    git("status", "--porcelain", "--", "base-conhecimento", "dados/institucional", "packages/kb", ".agents/skills") !==
    ""
  ) {
    console.warn("aviso: há mudanças não commitadas nas fontes; o commit gravado não refaz este banco");
  }
  const naoClassificadas = fontesNaoClassificadas(arquivosFonte(RAIZ));
  if (naoClassificadas.length > 0) {
    falhar(`fontes não classificadas como publicáveis entrariam no pacote:\n  ${naoClassificadas.join("\n  ")}`);
  }
  const chave = lerChave();
  const commit = git("rev-parse", "--short", "HEAD");
  const saida = NodePath.join(PASTA_FABRICA, `${opcoes.canal}-${opcoes.versao}`);
  NodeFS.rmSync(saida, { recursive: true, force: true });
  NodeFS.mkdirSync(PASTA_BASES, { recursive: true });
  const banco = NodePath.join(PASTA_BASES, `${opcoes.versao}.sqlite`);
  console.log(`compilando a base ${opcoes.versao} (commit ${commit})…`);
  NodeChildProcess.execFileSync(
    process.execPath,
    [
      NodePath.join(RAIZ, "packages", "kb", "src", "cli.ts"),
      "compilar",
      "--destino",
      banco,
      "--versao",
      opcoes.versao,
      "--commit",
      commit,
      "--canal",
      opcoes.canal,
    ],
    { cwd: RAIZ, stdio: "inherit" },
  );
  // As três versões anteriores guardadas, além das dadas.
  const guardadas = NodeFS.readdirSync(PASTA_BASES)
    .filter((nome) => nome.endsWith(".sqlite") && nome !== `${opcoes.versao}.sqlite`)
    .map((nome) => NodePath.join(PASTA_BASES, nome))
    .filter((caminho) => {
      const info = lerInfoBanco(caminho);
      return info !== null && compararVersoes(info.versao, opcoes.versao) < 0;
    })
    .sort()
    .slice(-3);
  const anteriores = [...new Set([...opcoes.anteriores.map((a) => NodePath.resolve(expandir(a))), ...guardadas])];
  console.log(`empacotando (zstd 19; patches de ${anteriores.length} versões anteriores)…`);
  const gerado = gerarCanal({
    saida,
    canal: opcoes.canal,
    commit,
    banco,
    anteriores,
    skills: await skillsDoApp(),
    appMinimo: opcoes.appMinimo,
    novidades: novidades(opcoes.versao),
    chave,
    ...(opcoes.repositorio === undefined ? {} : { urlPacotes: urlPacoteBase(opcoes.versao) }),
  });
  NodeFS.writeFileSync(
    NodePath.join(PASTA_BASES, `${opcoes.versao}.json`),
    `${JSON.stringify({ versao: opcoes.versao, commit, canal: opcoes.canal }, null, 2)}\n`,
  );
  for (const arquivo of gerado.arquivos) {
    const bytes = NodeFS.statSync(NodePath.join(saida, arquivo)).size;
    console.log(`  ${arquivo}  ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  }
  console.log(`saída: ${saida}`);
}

function publicar(opcoes: { canal: Canal; versao: string; repositorio: string; executar: boolean }) {
  validarRepositorio(opcoes.repositorio);
  const saida = NodePath.join(PASTA_FABRICA, `${opcoes.canal}-${opcoes.versao}`);
  if (!NodeFS.existsSync(saida))
    falhar(`rode antes: pnpm fabrica canal --canal ${opcoes.canal} --versao ${opcoes.versao}`);
  const manifesto = arquivoManifesto(opcoes.canal);
  const pacotes = NodeFS.readdirSync(saida)
    .filter((nome) => nome !== manifesto && nome !== `${manifesto}${SUFIXO_ASSINATURA}`)
    .map((nome) => NodePath.join(saida, nome));
  const repo = ["--repo", opcoes.repositorio];
  const comandos: string[][] = [
    // O release da versão: imutável, nunca "latest" (o latest fica para o app, se um dia usar).
    [
      "gh",
      "release",
      "create",
      TAG_BASE(opcoes.versao),
      ...pacotes,
      ...repo,
      "--title",
      `Base ${opcoes.versao}`,
      "--notes",
      `Base de conhecimento ${opcoes.versao} (canal ${opcoes.canal}).`,
      "--latest=false",
    ],
    // O release fixo do canal: criado uma vez; o manifesto é trocado a cada publicação.
    [
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
    [
      "gh",
      "release",
      "upload",
      TAG_CANAL(opcoes.canal),
      NodePath.join(saida, manifesto),
      NodePath.join(saida, `${manifesto}${SUFIXO_ASSINATURA}`),
      "--clobber",
      ...repo,
    ],
  ];
  for (const [indice, comando] of comandos.entries()) {
    console.log(`$ ${comando.map((parte) => (/\s/.test(parte) ? JSON.stringify(parte) : parte)).join(" ")}`);
    if (!opcoes.executar) continue;
    try {
      NodeChildProcess.execFileSync(comando[0]!, comando.slice(1), { stdio: "inherit" });
    } catch (erro) {
      // O release do canal já existe a partir da segunda publicação.
      if (indice !== 1) throw erro;
      console.log("  (o release do canal já existe)");
    }
  }
  if (!opcoes.executar) console.log("\n(só mostrei os comandos; rode de novo com --executar para publicar)");
  // Promover para o estável é publicar a mesma versão no canal estavel: pnpm fabrica canal --canal estavel …
}

/**
 * O app: os instaladores de `apps/desktop/dist/pacotes` (de `pnpm --filter @simplifica-if/desktop dist`,
 * em cada sistema) vão para o release imutável `app-v<versao>`, e os `latest*.yml`, reescritos para
 * apontar para ele, para o release fixo do canal, onde o `electron-updater` (feed `generic`) procura.
 */
function publicarApp(opcoes: { canal: Canal; versao: string; repositorio: string; executar: boolean }) {
  validarRepositorio(opcoes.repositorio);
  const pacotes = NodePath.join(RAIZ, "apps", "desktop", "dist", "pacotes");
  const ymls = ["latest-mac.yml", "latest.yml"].filter((nome) => NodeFS.existsSync(NodePath.join(pacotes, nome)));
  if (ymls.length === 0) falhar(`sem latest*.yml em ${pacotes}: rode o dist (sem --dir) antes`);
  const saida = NodePath.join(PASTA_FABRICA, `app-${opcoes.canal}-${opcoes.versao}`);
  NodeFS.rmSync(saida, { recursive: true, force: true });
  NodeFS.mkdirSync(saida, { recursive: true });
  for (const nome of ymls) {
    NodeFS.writeFileSync(
      NodePath.join(saida, nome),
      reescreverLatestYml(NodeFS.readFileSync(NodePath.join(pacotes, nome), "utf8"), opcoes.versao),
    );
  }
  const instaladores = NodeFS.readdirSync(pacotes)
    .filter((nome) => nome.includes(`-${opcoes.versao}-`) && /\.(dmg|zip|exe|blockmap)$/.test(nome))
    .map((nome) => NodePath.join(pacotes, nome));
  const repo = ["--repo", opcoes.repositorio];
  const comandos = [
    [
      "gh",
      "release",
      "create",
      TAG_APP(opcoes.versao),
      ...instaladores,
      ...repo,
      "--title",
      `Simplifica IF ${opcoes.versao}`,
      "--notes",
      "Instaladores do app.",
      "--latest=false",
    ],
    [
      "gh",
      "release",
      "upload",
      TAG_CANAL(opcoes.canal),
      ...ymls.map((nome) => NodePath.join(saida, nome)),
      "--clobber",
      ...repo,
    ],
  ];
  for (const comando of comandos) {
    console.log(`$ ${comando.map((parte) => (/\s/.test(parte) ? JSON.stringify(parte) : parte)).join(" ")}`);
    if (opcoes.executar) NodeChildProcess.execFileSync(comando[0]!, comando.slice(1), { stdio: "inherit" });
  }
  if (!opcoes.executar) console.log("\n(só mostrei os comandos; rode de novo com --executar para publicar)");
}

async function principal() {
  const [comando, ...resto] = process.argv.slice(2);
  const { values } = NodeUtil.parseArgs({
    args: resto,
    options: {
      saida: { type: "string" },
      canal: { type: "string", default: "beta" },
      versao: { type: "string" },
      repositorio: { type: "string" },
      anterior: { type: "string", multiple: true, default: [] },
      "app-minimo": { type: "string", default: "0.1.0" },
      executar: { type: "boolean", default: false },
      de: { type: "string" },
      para: { type: "string" },
    },
  });
  const canalDado = values.canal as Canal;
  if (!CANAIS.includes(canalDado)) falhar(`--canal ${CANAIS.join(" ou ")}`);
  switch (comando) {
    case "gerar-chave":
      return gerarChave(values.saida ?? falhar("--saida <pasta fora do repositório>"));
    case "canal":
      return canal({
        canal: canalDado,
        versao: values.versao ?? falhar("--versao AAAA.MM.DD"),
        ...(values.repositorio === undefined ? {} : { repositorio: values.repositorio }),
        anteriores: values.anterior,
        appMinimo: values["app-minimo"],
      });
    case "publicar":
      return publicar({
        canal: canalDado,
        versao: values.versao ?? falhar("--versao AAAA.MM.DD"),
        repositorio: values.repositorio ?? falhar("--repositorio dono/repo"),
        executar: values.executar,
      });
    case "publicar-app":
      return publicarApp({
        canal: canalDado,
        versao: values.versao ?? falhar("--versao X.Y.Z (a do apps/desktop/package.json)"),
        repositorio: values.repositorio ?? falhar("--repositorio dono/repo"),
        executar: values.executar,
      });
    case "propor-novidades": {
      const de = values.de ?? falhar("--de <kb.sqlite anterior>");
      const para = values.para ?? falhar("--para <kb.sqlite novo>");
      const versao = values.versao ?? lerInfoBanco(para)?.versao ?? "AAAA.MM.DD";
      const itens = proporNovidades(de, para);
      console.log(`# ${itens.length} entradas propostas de ${de} para ${para}; revise o texto antes de colar.`);
      return console.log(proposta(versao, new Date().toISOString().slice(0, 10), itens));
    }
    default:
      return falhar("comandos: gerar-chave, canal, publicar, publicar-app, propor-novidades");
  }
}

if (import.meta.main) await principal();
