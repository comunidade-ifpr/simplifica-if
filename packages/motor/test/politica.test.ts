/**
 * A política de fábrica e a classificação dos pedidos de aprovação: funções puras e os pedidos reais
 * das gravações (`test/fixtures/*-aprovacao.jsonl`), decididos para a pasta da gravação e para outra.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import {
  arquivosDaSessaoAntigravity,
  classificarAcp,
  FERRAMENTAS_ANTIGRAVITY,
  FERRAMENTAS_BUSCA_WEB_ANTIGRAVITY,
  FERRAMENTAS_NAVEGADOR_ANTIGRAVITY,
  ferramentasDesligadasAntigravity,
} from "../src/drivers/antigravity.ts";
import { classificarClaude, envSessaoClaude } from "../src/drivers/claude.ts";
import {
  classificarComandoCodex,
  configThreadCodex,
  modoBuscaWebCodex,
  SEM_FERRAMENTAS_CODEX,
} from "../src/drivers/codex.ts";
import {
  ambienteSemTelemetria,
  avaliar,
  buscaWebLigada,
  caminhosDoComando,
  type ClassePedido,
  dentroDaPasta,
  LIMITE_QUERY_WEB,
  LIMITE_URL_WEB,
  motivoRecusaUrlWeb,
  Politica,
  POLITICA_FABRICA,
  POLITICA_JULGAMENTO,
} from "../src/politica.ts";

const PASTA = "/Users/servidor/Documentos/tarefa";
const decodificarPolitica = Schema.decodeSync(Politica);
const decodificarPoliticaExit = Schema.decodeExit(Politica);
const regra = (classe: ClassePedido, pasta = PASTA) => avaliar(POLITICA_FABRICA, classe, pasta).regra;

const lerLinhas = Effect.fn("teste.lerLinhas")(function* (nome: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const texto = yield* fs.readFileString(path.join(import.meta.dirname, "fixtures", nome));
  return texto
    .split("\n")
    .filter((linha) => linha.trim() !== "")
    .map((linha) => JSON.parse(linha) as { readonly mensagem: Record<string, unknown> });
});

describe("política de fábrica", () => {
  it("é um Politica válido, congelado, com os três providers", () => {
    assert.deepStrictEqual(decodificarPolitica(POLITICA_FABRICA), POLITICA_FABRICA);
    assert.deepStrictEqual(POLITICA_FABRICA.providers, ["claude", "codex", "antigravity"]);
    assert.isTrue(Object.isFrozen(POLITICA_FABRICA));
    assert.isTrue(Object.isFrozen(POLITICA_FABRICA.ferramentas.escrita));
    assert.deepStrictEqual(POLITICA_FABRICA.codex, { sandbox: "read-only", aprovacao: "on-request" });
    assert.strictEqual(POLITICA_FABRICA.telemetria, "desligada");
  });

  it("Claude: retomada de sessão e semFerramentas preservam telemetria desligada", () => {
    const base = { PATH: "/usr/bin", HOME: "/home/u" };
    const semTelemetria = ambienteSemTelemetria("claude", base);
    const retomada = envSessaoClaude(base, { retomar: "sessao-1" });
    assert.strictEqual(retomada.MCP_CONNECTION_NONBLOCKING, "0");
    for (const [chave, valor] of Object.entries(semTelemetria)) {
      if (!(chave in base)) assert.strictEqual(retomada[chave], valor, chave);
    }
    const julgamento = envSessaoClaude(base, { semFerramentas: true });
    assert.strictEqual(julgamento.DISABLE_PROMPT_CACHING, "1");
    for (const [chave, valor] of Object.entries(semTelemetria)) {
      if (!(chave in base)) assert.strictEqual(julgamento[chave], valor, chave);
    }
  });

  it("curadoria (M1.12): null de fábrica; o repositório é dono/repo, sem `.` nem `..`", () => {
    assert.deepStrictEqual(POLITICA_FABRICA.curadoria, { repositorio: null, rotulos: ["relato-do-app"] });
    const comRepositorio = (repositorio: string) =>
      decodificarPoliticaExit({ ...POLITICA_FABRICA, curadoria: { repositorio, rotulos: [] } })._tag;
    assert.strictEqual(comRepositorio("ifpr/simplifica-if"), "Success");
    assert.strictEqual(comRepositorio("dono/repo.site"), "Success");
    for (const invalido of ["dono/..", "dono/.", "../repo", "dono/repo/issues", "dono", "https://x/y", "do.no/repo"])
      assert.strictEqual(comRepositorio(invalido), "Failure", invalido);
  });

  it("busca web: ligada na de fábrica; desligada no julgamento ou quando a política proíbe", () => {
    assert.isTrue(buscaWebLigada(POLITICA_FABRICA));
    assert.isFalse(buscaWebLigada(POLITICA_JULGAMENTO));
    assert.isFalse(
      buscaWebLigada({
        ...POLITICA_FABRICA,
        isolamento: { ...POLITICA_FABRICA.isolamento, buscaWeb: "desligada" as const },
      }),
    );
    assert.isFalse(
      buscaWebLigada({
        ...POLITICA_FABRICA,
        ferramentas: { ...POLITICA_FABRICA.ferramentas, web: "negar" as const },
      }),
    );
  });

  it("filtro determinístico de URL em leitura web: aceita pública; nega intranet, loopback, IP, esquema e URL longa", () => {
    assert.isUndefined(motivoRecusaUrlWeb("https://www.planalto.gov.br/ccivil_03/leis/l9394.htm"));
    assert.isUndefined(motivoRecusaUrlWeb("http://portal.mec.gov.br/docman/doc.pdf?id=1"));
    const bloqueadas = [
      "file:///etc/passwd",
      "ftp://ftp.exemplo.gov.br/a",
      "https://user:pass@www.planalto.gov.br/",
      "http://localhost:8080/api",
      "http://localhost../api",
      "http://sub.localhost/a",
      "http://intranet.local/sigiloso",
      "http://painel.internal/x",
      "http://impressora.lan/x",
      "http://router.home.arpa/",
      "http://portal.intranet/x",
      "http://app.corp/x",
      "http://servidor/sei",
      "http://127.0.0.1:4321/",
      "http://127.0.0.1../",
      "http://10.0.0.1/admin",
      "http://172.16.0.5/",
      "http://192.168.1.10/",
      "http://169.254.169.254/latest/meta-data",
      "http://2130706433/",
      "http://[::1]/x",
      "http://[::ffff:127.0.0.1]/x",
      `https://www.planalto.gov.br/${"a".repeat(LIMITE_URL_WEB)}`,
      `https://www.planalto.gov.br/busca?q=${"a".repeat(LIMITE_QUERY_WEB)}`,
      "nao-e-url",
    ];
    for (const url of bloqueadas) {
      assert.isDefined(motivoRecusaUrlWeb(url), url);
      assert.strictEqual(regra({ tipo: "web", caminhos: [], urls: [url] }), "negar", url);
    }
    assert.strictEqual(
      regra({ tipo: "web", caminhos: [], urls: ["https://www.planalto.gov.br/ccivil_03/leis/l9394.htm"] }),
      "permitir",
    );
    // Leitura de página sem URL extraída falha fechada (negar), nunca passa sem filtro.
    assert.strictEqual(regra({ tipo: "web", caminhos: [], exigeUrl: true }), "negar");
    const perguntando = {
      ...POLITICA_FABRICA,
      ferramentas: { ...POLITICA_FABRICA.ferramentas, web: "perguntar" as const },
    };
    const av = avaliar(perguntando, { tipo: "web", caminhos: [] }, PASTA);
    assert.strictEqual(av.regra, "perguntar");
    assert.match(av.motivo, /pede aprovação/);
  });

  it("dentro da pasta: relativo, absoluto, subida, pasta pessoal e /tmp do macOS", () => {
    assert.isTrue(dentroDaPasta("notas.md", PASTA));
    assert.isTrue(dentroDaPasta(`${PASTA}/sub/a.txt`, PASTA));
    assert.isTrue(dentroDaPasta(PASTA, PASTA));
    assert.isFalse(dentroDaPasta("../fora.txt", PASTA));
    assert.isFalse(dentroDaPasta(`${PASTA}-irma/a.txt`, PASTA));
    assert.isFalse(dentroDaPasta("/etc/passwd", PASTA));
    assert.isFalse(dentroDaPasta("~/.ssh/id_rsa", PASTA));
    assert.isTrue(dentroDaPasta("/tmp/simplifica-x/a.txt", "/private/tmp/simplifica-x"));
    assert.isTrue(dentroDaPasta("/private/tmp/simplifica-x/a.txt", "/tmp/simplifica-x"));
  });

  it("caminhos de um comando: absolutos, pasta pessoal e subida; sem executáveis do sistema nem /dev/null", () => {
    assert.deepStrictEqual(caminhosDoComando("ls -la"), []);
    assert.deepStrictEqual(caminhosDoComando("cat /etc/hosts > saida.txt 2>/dev/null"), ["/etc/hosts"]);
    assert.deepStrictEqual(caminhosDoComando("cp ~/segredo.txt ../copia.txt"), ["~/segredo.txt", "../copia.txt"]);
    assert.deepStrictEqual(caminhosDoComando("/bin/zsh -lc 'printf ok > teste.txt'"), []);
    assert.deepStrictEqual(caminhosDoComando('echo x >"/Users/outro/a.txt"'), ["/Users/outro/a.txt"]);
  });

  it("avalia por tipo e lugar", () => {
    assert.strictEqual(regra({ tipo: "mcp-app", caminhos: [] }), "permitir");
    assert.strictEqual(regra({ tipo: "mcp-outro", caminhos: [] }), "negar");
    assert.strictEqual(regra({ tipo: "web", caminhos: [] }), "permitir");
    assert.strictEqual(regra({ tipo: "comando-rede", caminhos: [], host: "exemplo.com" }), "negar");
    assert.match(
      avaliar(POLITICA_FABRICA, { tipo: "comando-rede", caminhos: [], host: "exemplo.com" }, PASTA).motivo,
      /não permite rodar comandos com acesso à rede \(exemplo\.com\)/,
    );
    assert.strictEqual(regra({ tipo: "outra", caminhos: [] }), "perguntar");
    assert.strictEqual(regra({ tipo: "leitura", caminhos: ["a.md"] }), "permitir");
    assert.strictEqual(regra({ tipo: "leitura", caminhos: ["/etc/hosts"] }), "negar");
    assert.strictEqual(regra({ tipo: "escrita", caminhos: [`${PASTA}/a.md`] }), "perguntar");
    assert.strictEqual(regra({ tipo: "escrita", caminhos: [`${PASTA}/a.md`, "/tmp/b.md"] }), "negar");
    assert.strictEqual(regra({ tipo: "comando", caminhos: [] }), "perguntar");
    assert.strictEqual(regra({ tipo: "comando", caminhos: ["~/x"] }), "negar");
    assert.match(
      avaliar(POLITICA_FABRICA, { tipo: "escrita", caminhos: ["/tmp/b.md"] }, PASTA).motivo,
      /não permite alterar arquivos fora da pasta de trabalho/,
    );
  });

  it("telemetria: sem OTEL_* herdadas; variáveis do Claude e do Antigravity", () => {
    const ambiente = { PATH: "/bin", OTEL_EXPORTER_OTLP_ENDPOINT: "https://coletor", OTEL_SERVICE_NAME: "x" };
    const claude = ambienteSemTelemetria("claude", ambiente);
    assert.strictEqual(claude.PATH, "/bin");
    assert.isUndefined(claude.OTEL_EXPORTER_OTLP_ENDPOINT);
    assert.strictEqual(claude.DISABLE_TELEMETRY, "1");
    assert.strictEqual(claude.CLAUDE_CODE_ENABLE_TELEMETRY, "0");
    assert.strictEqual(claude.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, "1");
    assert.deepStrictEqual(ambienteSemTelemetria("codex", ambiente), { PATH: "/bin" });
    assert.strictEqual(ambienteSemTelemetria("antigravity", ambiente).ANTIGRAVITY_SENTRY_SAMPLE_RATE, "0");
  });
});

describe("classificação por provider", () => {
  it("Claude: nomes do Claude Code e MCP", () => {
    const app = ["ifpr"];
    assert.deepStrictEqual(classificarClaude("mcp__ifpr__buscar_norma", {}, app), { tipo: "mcp-app", caminhos: [] });
    assert.deepStrictEqual(classificarClaude("mcp__pessoal__x", {}, app), { tipo: "mcp-outro", caminhos: [] });
    assert.deepStrictEqual(classificarClaude("ReadMcpResourceTool", { server: "ifpr", uri: "ifpr://x" }, app), {
      tipo: "mcp-app",
      caminhos: [],
    });
    assert.deepStrictEqual(classificarClaude("Read", { file_path: "/etc/hosts" }, app), {
      tipo: "leitura",
      caminhos: ["/etc/hosts"],
    });
    assert.deepStrictEqual(classificarClaude("Grep", { pattern: "x" }, app), { tipo: "leitura", caminhos: [] });
    assert.deepStrictEqual(classificarClaude("Edit", { file_path: "a.md" }, app), {
      tipo: "escrita",
      caminhos: ["a.md"],
    });
    assert.deepStrictEqual(classificarClaude("Bash", { command: "rm -rf ~/x" }, app), {
      tipo: "comando",
      caminhos: ["~/x"],
    });
    assert.deepStrictEqual(classificarClaude("WebFetch", { url: "https://x" }, app), {
      tipo: "web",
      caminhos: [],
      urls: ["https://x"],
      exigeUrl: true,
    });
    assert.strictEqual(regra(classificarClaude("WebFetch", {}, app)), "negar");
    assert.deepStrictEqual(classificarClaude("WebSearch", { query: "cofen" }, app), { tipo: "web", caminhos: [] });
    assert.deepStrictEqual(classificarClaude("Task", {}, app), { tipo: "outra", caminhos: [] });
  });

  it("Codex: comando com cwd e caminhos citados; rede é comando-rede (negado mesmo com web permitir)", () => {
    assert.deepStrictEqual(classificarComandoCodex({ command: "/bin/zsh -lc 'cat /etc/hosts'", cwd: PASTA }), {
      tipo: "comando",
      caminhos: [PASTA, "/etc/hosts"],
    });
    const rede = classificarComandoCodex({ command: "curl x", cwd: PASTA, networkApprovalContext: { host: "x" } });
    assert.deepStrictEqual(rede, { tipo: "comando-rede", caminhos: [], host: "x" });
    assert.strictEqual(regra(rede), "negar");
  });

  it("Antigravity: kind do ACP, locations, entrada, MCP do app e classificação estreita de web", () => {
    const app = ["ifpr"];
    assert.deepStrictEqual(classificarAcp({ name: "mcp_ifpr_buscar_norma", kind: "other" }, app), {
      tipo: "mcp-app",
      caminhos: [],
    });
    assert.deepStrictEqual(
      classificarAcp({ name: "read_resource", kind: "read", rawInput: { ServerName: "ifpr", Uri: "ifpr://x" } }, app),
      { tipo: "mcp-app", caminhos: [] },
    );
    assert.deepStrictEqual(classificarAcp({ name: "mcp_pessoal_x", kind: "other" }, app), {
      tipo: "mcp-outro",
      caminhos: [],
    });
    assert.deepStrictEqual(
      classificarAcp(
        { name: "run_command", kind: "execute", rawInput: { CommandLine: "cat /etc/hosts", Cwd: PASTA } },
        app,
      ),
      { tipo: "comando", caminhos: [PASTA, "/etc/hosts"] },
    );
    assert.deepStrictEqual(classificarAcp({ name: "search_web", kind: "fetch" }, app), { tipo: "web", caminhos: [] });
    // Mesmo com kind "read", read_url_content é classificado pelo nome antes do kind, levando a URL ao filtro.
    assert.deepStrictEqual(
      classificarAcp(
        { name: "read_url_content", kind: "read", rawInput: { TargetUrl: "https://www.planalto.gov.br/a" } },
        app,
      ),
      { tipo: "web", caminhos: [], urls: ["https://www.planalto.gov.br/a"], exigeUrl: true },
    );
    // Sem URL reconhecível em read_url_content, falha fechado (negar) no avaliar.
    assert.strictEqual(
      regra(classificarAcp({ name: "read_url_content", kind: "read", rawInput: { desconhecida: "x" } }, app)),
      "negar",
    );
    // Outro kind "fetch" (ex.: browser ou ferramenta nova) cai em outra (pergunta), nunca em web.
    assert.deepStrictEqual(classificarAcp({ name: "browser_subagent", kind: "fetch" }, app), {
      tipo: "outra",
      caminhos: [],
    });
    assert.deepStrictEqual(classificarAcp({ name: "ferramenta_nova", kind: "fetch" }, app), {
      tipo: "outra",
      caminhos: [],
    });
  });

  it.layer(NodeServices.layer)((it) => {
    it.effect("pedidos reais das gravações: pergunta na pasta da sessão, nega fora dela", () =>
      Effect.gen(function* () {
        // Claude: o `canUseTool` do Write em teste.txt.
        const claude = (yield* lerLinhas("claude-aprovacao.jsonl"))
          .map((linha) => linha.mensagem)
          .filter((m) => m.type === "can_use_tool");
        assert.strictEqual(claude.length, 2);
        for (const pedido of claude) {
          const classe = classificarClaude(String(pedido.toolName), pedido.input as Record<string, unknown>, ["ifpr"]);
          assert.strictEqual(classe.tipo, "escrita");
          assert.strictEqual(regra(classe, "/private/tmp/simplifica-poc-eKZkgv"), "perguntar");
          assert.strictEqual(regra(classe), "negar");
        }

        // Codex: o `fileChange` (os caminhos vêm do item) e o comando que grava teste.txt.
        const codex = (yield* lerLinhas("codex-aprovacao.jsonl")).map((linha) => linha.mensagem);
        const itens = codex
          .filter((m) => m.metodo === "item/started")
          .map((m) => (m.parametros as { item: Record<string, unknown> }).item);
        const arquivo = itens.find((item) => item.type === "fileChange") as { changes: Array<{ path: string }> };
        const escrita: ClassePedido = { tipo: "escrita", caminhos: arquivo.changes.map((mudanca) => mudanca.path) };
        assert.strictEqual(regra(escrita, "/private/tmp/simplifica-poc-zbMkpj"), "perguntar");
        assert.strictEqual(regra(escrita), "negar");
        const comando = itens.find(
          (item) => item.type === "commandExecution" && String(item.command).includes("printf"),
        ) as { command: string; cwd: string };
        const classeComando = classificarComandoCodex(comando);
        assert.strictEqual(classeComando.tipo, "comando");
        assert.strictEqual(regra(classeComando, "/private/tmp/simplifica-poc-zbMkpj"), "perguntar");
        assert.strictEqual(regra(classeComando), "negar");

        // Antigravity: o `session/request_permission` do write_file.
        const acp = (yield* lerLinhas("antigravity-aprovacao.jsonl"))
          .map((linha) => linha.mensagem)
          .filter((m) => m.tipo === "session/request_permission" && m.pedido !== undefined);
        assert.isAbove(acp.length, 0);
        for (const { pedido } of acp) {
          const classe = classificarAcp((pedido as { toolCall: Record<string, unknown> }).toolCall, ["ifpr"]);
          assert.strictEqual(classe.tipo, "escrita");
          assert.strictEqual(regra(classe, "/private/tmp/simplifica-poc-UtCcAk"), "perguntar");
          assert.strictEqual(regra(classe), "negar");
        }
      }),
    );
  });
});

describe("sessão de julgamento e busca web nos drivers", () => {
  it("Codex: shell, leitura de imagem, subagentes, apply_patch e busca web desligados no julgamento; live com fallback na conversa", () => {
    assert.deepStrictEqual(
      Object.entries(SEM_FERRAMENTAS_CODEX).filter(([, v]) => v === false || v === "disabled").length,
      Object.keys(SEM_FERRAMENTAS_CODEX).length,
    );
    assert.strictEqual(SEM_FERRAMENTAS_CODEX["features.shell_tool"], false);
    assert.strictEqual(SEM_FERRAMENTAS_CODEX["features.unified_exec"], false);
    // `configThreadCodex` garante `web_search: "disabled"` com `semFerramentas: true` mesmo com política de fábrica.
    const julgamento = configThreadCodex({
      configUsuario: {},
      config: { provider: "codex", pastaTrabalho: PASTA, servidoresMcp: [], semFerramentas: true },
      politica: POLITICA_FABRICA,
    });
    assert.strictEqual(julgamento.web_search, "disabled");
    assert.strictEqual(julgamento["features.shell_tool"], false);
    const conversa = configThreadCodex({
      configUsuario: {},
      config: { provider: "codex", pastaTrabalho: PASTA, servidoresMcp: [] },
      politica: POLITICA_FABRICA,
    });
    assert.strictEqual(conversa.web_search, "live");
    assert.strictEqual(modoBuscaWebCodex(POLITICA_FABRICA), "live");
    assert.strictEqual(modoBuscaWebCodex(POLITICA_FABRICA, ["live", "cached"]), "live");
    assert.strictEqual(modoBuscaWebCodex(POLITICA_FABRICA, ["cached"]), "cached");
    assert.strictEqual(modoBuscaWebCodex(POLITICA_FABRICA, ["indexed"]), "indexed");
    assert.strictEqual(modoBuscaWebCodex(POLITICA_FABRICA, ["disabled"]), "disabled");
    assert.strictEqual(modoBuscaWebCodex(POLITICA_JULGAMENTO, ["live"]), "disabled");
  });
  it("Antigravity: browser sempre em disabledTools com web ligada; julgamento desliga tudo e limpa o perfil", () => {
    const conversa = ferramentasDesligadasAntigravity(POLITICA_FABRICA, false);
    for (const nav of FERRAMENTAS_NAVEGADOR_ANTIGRAVITY) assert.include(conversa, nav);
    for (const busca of FERRAMENTAS_BUSCA_WEB_ANTIGRAVITY) assert.notInclude(conversa, busca);
    const semWeb = ferramentasDesligadasAntigravity(POLITICA_JULGAMENTO, false);
    for (const busca of FERRAMENTAS_BUSCA_WEB_ANTIGRAVITY) assert.include(semWeb, busca);
    for (const nav of FERRAMENTAS_NAVEGADOR_ANTIGRAVITY) assert.include(semWeb, nav);
    assert.strictEqual(ferramentasDesligadasAntigravity(POLITICA_FABRICA, true), FERRAMENTAS_ANTIGRAVITY);
    for (const nome of ["read_file", "view_file", "list_dir", "grep_search", "run_command"])
      assert.include(FERRAMENTAS_ANTIGRAVITY as ReadonlyArray<string>, nome);
    const juntar = (...p: string[]) => p.join("/");
    assert.deepStrictEqual(arquivosDaSessaoAntigravity(juntar, "/perfil", "d830e70b-6578-4b2c-b1af-20dc2ecadd41"), [
      "/perfil/antigravity-acp/conversations/d830e70b-6578-4b2c-b1af-20dc2ecadd41.db",
      "/perfil/antigravity-acp/conversations/d830e70b-6578-4b2c-b1af-20dc2ecadd41.db-wal",
      "/perfil/antigravity-acp/conversations/d830e70b-6578-4b2c-b1af-20dc2ecadd41.db-shm",
      "/perfil/antigravity-acp/brain/d830e70b-6578-4b2c-b1af-20dc2ecadd41",
      "/perfil/antigravity-acp/annotations/d830e70b-6578-4b2c-b1af-20dc2ecadd41.pbtxt",
    ]);
    assert.deepStrictEqual(arquivosDaSessaoAntigravity(juntar, "/perfil", "../../etc"), []);
  });
});
