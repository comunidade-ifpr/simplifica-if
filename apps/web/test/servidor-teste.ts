// @effect-diagnostics nodeBuiltinImport:off globalJsonInEffect:off -- script de teste: lê argv, gera o token e imprime a linha de partida
/**
 * O `apps/server` de verdade, com os drivers de demonstração (`drivers-demonstracao.ts`) e o banco de
 * fixture do MCP: a interface conversa com ele por RPC sem chamar provider real e sem `tmp/kb.sqlite`.
 *
 *   node apps/web/test/servidor-teste.ts [--porta 0] [--origem http://localhost:5190]… [--atraso-login 2000]
 *     [--primeiro-uso] [--claude-ausente] [--curadoria dono/repo] [--tarefas-de-teste]
 *
 * Pronto o servidor, imprime uma linha JSON com `porta`, `urlServidor`, `token` (o de
 * `SIMPLIFICA_SERVIDOR_TOKEN` ou um aleatório), `pasta`, uma pasta de trabalho temporária, `ppc`, um
 * PPC sintético em DOCX dentro dela (para a revisão prévia), e `ppcSalvo`, o mesmo PPC corrigido (para a
 * conferência ao salvar). Encerra com SIGTERM, SIGINT ou, se o stdin não for um
 * terminal, quando ele fecha (o processo que o iniciou morreu). Os logs vão para o stderr: o stdout é
 * só da linha JSON.
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeUtil from "node:util";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Redacted from "effect/Redacted";
import * as Servidor from "@simplifica-if/server";
import { criarBancoFixture, diretorioTemporario, limparTemporarios } from "../../../packages/mcp/test/fixture.ts";
import { inserirExplorar } from "../../../packages/mcp/test/fixture-explorar.ts";
import { inserirNormas } from "../../../packages/mcp/test/fixture-normas.ts";
import { par } from "../../../packages/docx/src/testes/sintetico.ts";
import { ppcSintetico } from "../../../packages/ppc/src/testes/revisao-previa.ts";
import * as Demonstracao from "./drivers-demonstracao.ts";

const { values: opcoes } = NodeUtil.parseArgs({
  options: {
    porta: { type: "string", default: "0" },
    origem: { type: "string", multiple: true, default: [] },
    "atraso-login": { type: "string", default: "2000" },
    // O primeiro uso (M1.8) por fazer: o Início leva às boas-vindas. Sem a opção, já está feito.
    "primeiro-uso": { type: "boolean", default: false },
    // O Claude Code ausente até o arquivo `sinalClaude` existir (o passo guiado das boas-vindas).
    "claude-ausente": { type: "boolean", default: false },
    // O repositório da curadoria (M1.12, "Isto está errado"); sem a opção, `null`, como na política de fábrica.
    curadoria: { type: "string" },
    // No lugar das tarefas do checkout, as de teste (`tarefasDeTeste`): uma de link, uma de módulo e duas de conversa.
    "tarefas-de-teste": { type: "boolean", default: false },
  },
});

const token = process.env.SIMPLIFICA_SERVIDOR_TOKEN ?? NodeCrypto.randomBytes(32).toString("base64url");
delete process.env.SIMPLIFICA_SERVIDOR_TOKEN;

if (!process.stdin.isTTY) {
  process.stdin.resume();
  process.stdin.on("close", () => process.kill(process.pid, "SIGTERM"));
}

const banco = criarBancoFixture();
/** Uma pasta de trabalho que existe, para as conversas dos testes de navegador. */
const pasta = diretorioTemporario("simplifica-web-pasta-");
inserirNormas(banco);
// O que o Explorar mostra além das normas: CNCT, ofertas, horários de campus, Consepe, ficha e fatos do PPC.
inserirExplorar(banco);
// A taxonomia de tópicos das fichas da revisão de PPC, para a revisão prévia agrupar por tema.
{
  const arquivo = NodePath.resolve(import.meta.dirname, "../../../base-conhecimento/revisao-ppc/topicos.json");
  const { topicos } = JSON.parse(NodeFS.readFileSync(arquivo, "utf8")) as {
    topicos: Array<{ id: string; titulo: string }>;
  };
  const db = new NodeSqlite.DatabaseSync(banco);
  const inserir = db.prepare(
    "INSERT INTO revisao_ppc_topicos (id, ordem, titulo, termos_json, path, dados_json) VALUES (?, ?, ?, '[]', ?, ?)",
  );
  topicos.forEach((topico, ordem) =>
    inserir.run(topico.id, ordem, topico.titulo, "base-conhecimento/revisao-ppc/topicos.json", JSON.stringify(topico)),
  );
  db.close();
}
// A ficha do critério do AEE (CT-CURR-22), que o PPC sintético não atende: a ficha do critério no Ler.
{
  const arquivo = NodePath.resolve(
    import.meta.dirname,
    "../../../base-conhecimento/revisao-ppc/fichas/ct-curr-22.json",
  );
  const texto = NodeFS.readFileSync(arquivo, "utf8");
  const ficha = JSON.parse(texto) as { id: string; titulo: string };
  const db = new NodeSqlite.DatabaseSync(banco);
  db.prepare("INSERT INTO revisao_ppc_fichas (id, titulo, path, dados_json, arquivo_json) VALUES (?, ?, ?, ?, ?)").run(
    ficha.id,
    ficha.titulo,
    "base-conhecimento/revisao-ppc/fichas/ct-curr-22.json",
    JSON.stringify(ficha),
    texto,
  );
  db.close();
}
/** Um PPC sintético (fictício) na pasta, para a revisão prévia. */
const ppc = NodePath.join(pasta, "PPC de teste.docx");
NodeFS.writeFileSync(ppc, ppcSintetico());
/**
 * O mesmo PPC como a pessoa o salva no Word depois de corrigir o AEE e citar uma norma revogada, numa
 * pasta à parte: a conferência ao salvar (`salvarNoWord`) o copia por cima do arquivo acompanhado.
 */
const ppcSalvo = NodePath.join(pasta, "salvo", "PPC de teste.docx");
NodeFS.mkdirSync(NodePath.dirname(ppcSalvo));
NodeFS.writeFileSync(
  ppcSalvo,
  ppcSintetico({ semAeeNaMatriz: true, corpoExtra: par("O curso segue também a Resolução CNE/CEB nº 6/2012.") }),
);

/** Um documento para anexar às tarefas (Modo Servidor). */
const parecer = NodePath.join(pasta, "parecer.md");
NodeFS.writeFileSync(parecer, "# Parecer\n\nO estágio é obrigatório, conforme a Res. CNE/CP nº 1/2021.\n");
/** Com `--claude-ausente`, o Claude Code "aparece" quando este arquivo existe. */
const sinalClaude = NodePath.join(pasta, "claude-instalado");
/** A raiz das pastas de tarefa (no app, Documentos/Simplifica IF). */
const pastaTrabalhos = NodePath.join(diretorioTemporario("simplifica-web-tarefas-"), "Simplifica IF");

/** A pasta de logs do app, com um registro curto, para "Configurações › Diagnóstico". */
const pastaLogs = NodePath.join(pasta, "logs");
NodeFS.mkdirSync(pastaLogs, { recursive: true });
NodeFS.writeFileSync(
  NodePath.join(pastaLogs, "simplifica-if.log"),
  'nivel=INFO msg="servidor pronto" conta=pessoa@ifpr.edu.br\n',
);

/**
 * As tarefas de teste, numa pasta temporária: o catálogo do checkout não tem tarefa de link, e a página
 * da tarefa precisa das três aberturas, com `limites` e `autoria`, e de duas de conversa (o formulário
 * de uma não pode sobrar na outra). Os `id` e os textos são fictícios.
 */
function tarefasDeTeste(): string {
  const destino = diretorioTemporario("simplifica-web-catalogo-");
  const manifesto = (id: string, titulo: string, linhas: ReadonlyArray<string>) =>
    NodeFS.writeFileSync(
      NodePath.join(destino, `${id}.yaml`),
      [
        `id: ${id}`,
        `titulo: ${titulo}`,
        "resumo: Uma tarefa de teste.",
        "area: ensino",
        "situacao: estavel",
        "mantenedor: { nome: Pessoa de Teste, github: pessoa-de-teste }",
        ...linhas,
        "",
      ].join("\n"),
    );
  manifesto("calendario-de-teste", "Consultar o calendário de teste", [
    "limites: Não altera o calendário.",
    "autoria: Comissão de Teste",
    'abre: { link: { url: "https://calendario.example.org:8443/letivo?ano=2026", requer_login: true } }',
  ]);
  manifesto("revisar-de-teste", "Revisar um PPC de teste", [
    "limites: Não substitui a análise do colegiado.",
    "autoria: Comissão de Teste",
    "duracao_estimada: 20min",
    "abre: { modulo: revisao-ppc }",
  ]);
  manifesto("ata-de-teste", "Resumir uma ata de teste", [
    "abre:",
    "  conversa:",
    '    pedido: "Resuma a ata {ata}."',
    "    entradas:",
    '      - { id: ata, tipo: texto, rotulo: "Ata" }',
  ]);
  manifesto("oficio-de-teste", "Redigir um ofício de teste", [
    "abre:",
    "  conversa:",
    '    pedido: "Redija um ofício sobre {assunto}."',
    "    entradas:",
    '      - { id: assunto, tipo: texto, rotulo: "Assunto" }',
  ]);
  return destino;
}

const camada = Servidor.layer({
  banco,
  token: Redacted.make(token),
  porta: Number(opcoes.porta),
  origens: opcoes.origem,
  // As tarefas e as skills do app do checkout (os cartões de tarefa e as etapas).
  pastaSkills: NodePath.resolve(import.meta.dirname, "../../../catalogo/skills"),
  pastaTarefas: opcoes["tarefas-de-teste"]
    ? tarefasDeTeste()
    : NodePath.resolve(import.meta.dirname, "../../../catalogo/tarefas"),
  pastaTrabalhos,
  primeiroUsoFeito: !opcoes["primeiro-uso"],
  relatos: { curadoria: { repositorio: opcoes.curadoria ?? null, rotulos: ["relato-do-app"] } },
  diagnostico: { pastaLogs, modoTraces: "completo" },
}).pipe(
  Layer.provide(
    Demonstracao.layer({
      atrasoLogin: Duration.millis(Number(opcoes["atraso-login"])),
      ...(opcoes["claude-ausente"] ? { claudePresente: () => NodeFS.existsSync(sinalClaude) } : {}),
    }),
  ),
  Layer.provide(NodeServices.layer),
);

const programa = Effect.gen(function* () {
  yield* Effect.addFinalizer(() => Effect.sync(limparTemporarios));
  const app = yield* Servidor.ServidorApp;
  yield* Console.log(
    JSON.stringify({
      porta: app.porta,
      urlServidor: `http://127.0.0.1:${app.porta}`,
      token,
      pasta,
      ppc,
      ppcSalvo,
      parecer,
      pastaTrabalhos,
      sinalClaude,
    }),
  );
  return yield* Effect.never;
}).pipe(Effect.scoped, Effect.provide(camada), Effect.provideService(Logger.LogToStderr, true));

NodeRuntime.runMain(programa);
