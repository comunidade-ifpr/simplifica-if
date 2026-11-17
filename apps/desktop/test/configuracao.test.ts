// @effect-diagnostics nodeBuiltinImport:off -- teste do processo principal (sem Effect): o hash da CSP pelo node:crypto
/**
 * De onde vêm o servidor, a base, a interface e as origens, no desenvolvimento e no app empacotado,
 * e as regras de segurança da janela (CSP, navegação, links externos, arquivos do protocolo).
 */
import { describe, expect, test } from "vite-plus/test";
import { ORIGEM_APP, resolverConfiguracao, URL_APP, type Entrada } from "../src/configuracao.ts";
import * as NodeCrypto from "node:crypto";
import {
  CAMINHO_LIBERAR_ARQUIVO as LIBERAR_CONTRATO,
  EXTENSOES_DOCUMENTO as EXTENSOES_CONTRATO,
  SUFIXO_REVISAO_PREVIA as SUFIXO_CONTRATO,
} from "@simplifica-if/contratos-app";
import {
  anexoEscolhido,
  arquivoDeTarefaPermitido,
  copiaComentadaPermitida,
  EXTENSOES_DOCUMENTO,
  extensoesAnexo,
  docxEscolhido,
  hashesScriptsInline,
  isSameOriginRendererNavigation,
  politicaConteudo,
  resolverArquivo,
  tipoConteudo,
  CAMINHO_LIBERAR_ARQUIVO,
  SUFIXO_REVISAO_PREVIA,
  urlExternaSegura,
} from "../src/seguranca.ts";

const dev: Entrada = {
  empacotado: false,
  raizRepositorio: "/repo",
  pastaRecursos: "/electron/Resources",
  pastaAplicacao: "/repo/apps/desktop/dist/app",
  pastaApp: "/dados/Simplifica IF (dev)",
  pastaDocumentos: "/Users/x/Documents",
  executavel: "/electron/Electron",
  ambiente: { SIMPLIFICA_NODE: "/node26/bin/node", SIMPLIFICA_WEB_URL: "http://localhost:5190" },
  existe: () => false,
};

const empacotado: Entrada = {
  empacotado: true,
  raizRepositorio: "/",
  pastaRecursos: "/Applications/Simplifica IF.app/Contents/Resources",
  pastaAplicacao: "/Applications/Simplifica IF.app/Contents/Resources/app.asar",
  pastaApp: "/Users/x/Library/Application Support/Simplifica IF",
  pastaDocumentos: "/Users/x/Documents",
  executavel: "/Applications/Simplifica IF.app/Contents/MacOS/Simplifica IF",
  ambiente: { HOME: "/Users/x", SIMPLIFICA_WEB_URL: "http://localhost:5190" },
  existe: () => false,
};

describe("resolverConfiguracao", () => {
  test("desenvolvimento: Node 26 com o bin.ts, o tmp/kb.sqlite e o dev server do web", () => {
    const config = resolverConfiguracao(dev);
    expect(config.executor).toEqual({ tipo: "node", node: "/node26/bin/node", bin: "/repo/apps/server/src/bin.ts" });
    expect(config.banco).toBe("/repo/tmp/kb.sqlite");
    expect(config.pastaEstado).toBe("/dados/Simplifica IF (dev)");
    expect(config.urlJanela).toBe("http://localhost:5190/");
    expect(config.origens).toEqual(["http://localhost:5190"]);
    expect(config.cwd).toBe("/repo");
    // Sem a pasta, nada de --pasta-skills.
    expect(config.pastaSkills).toBeUndefined();
    // As pastas de tarefa em Documentos/Simplifica IF.
    expect(config.pastaTrabalhos).toBe("/Users/x/Documents/Simplifica IF");
  });

  test("skills: .agents/skills do repositório no desenvolvimento, <Resources>/skills no app empacotado", () => {
    expect(resolverConfiguracao({ ...dev, existe: () => true }).pastaSkills).toBe("/repo/.agents/skills");
    expect(resolverConfiguracao({ ...empacotado, existe: () => true }).pastaSkills).toBe(
      "/Applications/Simplifica IF.app/Contents/Resources/skills",
    );
  });

  test("desenvolvimento sem SIMPLIFICA_WEB_URL: o build da interface pelo protocolo próprio", () => {
    const config = resolverConfiguracao({ ...dev, ambiente: { SIMPLIFICA_WEB_URL: "" } });
    expect(config.executor).toMatchObject({ tipo: "node", node: "node" });
    expect(config.interface).toEqual({ tipo: "pasta", pasta: "/repo/apps/desktop/dist/app/web" });
    expect(config.urlJanela).toBe(URL_APP);
    expect(config.origens).toEqual([ORIGEM_APP]);
  });

  test("app empacotado: o Electron com o bundle, a base empacotada e a interface do app", () => {
    const config = resolverConfiguracao(empacotado);
    expect(config.executor).toEqual({
      tipo: "electron",
      electron: "/Applications/Simplifica IF.app/Contents/MacOS/Simplifica IF",
      bundle: "/Applications/Simplifica IF.app/Contents/Resources/servidor/bin.mjs",
    });
    expect(config.banco).toBe("/Applications/Simplifica IF.app/Contents/Resources/base/kb.sqlite");
    // O SIMPLIFICA_WEB_URL não vale no app empacotado.
    expect(config.urlJanela).toBe("simplifica://app/");
    expect(config.origens).toEqual(["simplifica://app"]);
    expect(config.cwd).toBe("/Users/x");
  });

  test("app empacotado: a base atualizada na pasta do app vence a empacotada; SIMPLIFICA_KB vence as duas", () => {
    const atualizada = "/Users/x/Library/Application Support/Simplifica IF/base/kb.sqlite";
    expect(resolverConfiguracao({ ...empacotado, existe: (c) => c === atualizada }).banco).toBe(atualizada);
    expect(
      resolverConfiguracao({ ...empacotado, ambiente: { SIMPLIFICA_KB: "/outra/kb.sqlite" }, existe: () => true })
        .banco,
    ).toBe("/outra/kb.sqlite");
  });

  test("o dev server tem de ser http(s) nesta máquina", () => {
    expect(() => resolverConfiguracao({ ...dev, ambiente: { SIMPLIFICA_WEB_URL: "https://exemplo.com" } })).toThrow(
      /localhost/,
    );
    expect(() => resolverConfiguracao({ ...dev, ambiente: { SIMPLIFICA_WEB_URL: "file:///tmp/index.html" } })).toThrow(
      /http/,
    );
  });
});

describe("segurança da janela", () => {
  test("a CSP só deixa falar com o servidor local desta execução e não aceita script inline", () => {
    const csp = politicaConteudo(61885);
    expect(csp).toContain("connect-src 'self' http://127.0.0.1:61885 ws://127.0.0.1:61885");
    expect(csp).toContain("script-src 'self';");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("object-src 'none'");
    expect(politicaConteudo(undefined)).toContain("connect-src 'self';");
  });

  test("a CSP aceita os scripts inline do index.html pelo hash, e só eles", () => {
    const tema = "\n      document.documentElement.classList.add('dark');\n    ";
    const html = `<head><script>${tema}</script><script type="module" crossorigin src="./assets/index.js"></script><script></script></head>`;
    const esperado = `'sha256-${NodeCrypto.createHash("sha256").update(tema).digest("base64")}'`;
    expect(hashesScriptsInline(html)).toEqual([esperado]);
    expect(politicaConteudo(1, hashesScriptsInline(html))).toContain(`script-src 'self' ${esperado};`);
  });

  test("navegação: só na origem da interface", () => {
    const aplicacao = "simplifica://app/";
    expect(
      isSameOriginRendererNavigation({ applicationUrl: aplicacao, navigationUrl: "simplifica://app/conversa" }),
    ).toBe(true);
    expect(isSameOriginRendererNavigation({ applicationUrl: aplicacao, navigationUrl: "simplifica://outro/" })).toBe(
      false,
    );
    expect(isSameOriginRendererNavigation({ applicationUrl: aplicacao, navigationUrl: "https://ifpr.edu.br" })).toBe(
      false,
    );
    expect(
      isSameOriginRendererNavigation({
        applicationUrl: "http://localhost:5190/",
        navigationUrl: "http://localhost:5191/",
      }),
    ).toBe(false);
    expect(isSameOriginRendererNavigation({ applicationUrl: aplicacao, navigationUrl: "não é url" })).toBe(false);
  });

  test("links externos: só http e https", () => {
    expect(urlExternaSegura("https://ifpr.edu.br/x")).toBe("https://ifpr.edu.br/x");
    expect(urlExternaSegura("http://exemplo.com")).toBe("http://exemplo.com/");
    for (const recusada of ["file:///etc/passwd", "javascript:alert(1)", "simplifica://app/", "smb://x", 42, "x"]) {
      expect(urlExternaSegura(recusada)).toBeUndefined();
    }
  });

  test("protocolo: arquivos da pasta, index.html nas rotas, nada fora da pasta", () => {
    const arquivos = new Set(["/web/index.html", "/web/assets/app.js"]);
    const pedir = (url: string, accept: string | null = null, method = "GET") =>
      resolverArquivo({ url, method, accept, host: "app", assetDirectory: "/web", isFile: (c) => arquivos.has(c) });
    expect(pedir("simplifica://app/assets/app.js")).toEqual({ tipo: "arquivo", caminho: "/web/assets/app.js" });
    expect(pedir("simplifica://app/")).toEqual({ tipo: "arquivo", caminho: "/web/index.html" });
    expect(pedir("simplifica://app/conversa/123", "text/html")).toEqual({
      tipo: "arquivo",
      caminho: "/web/index.html",
    });
    expect(pedir("simplifica://app/assets/falta.js")).toEqual({ tipo: "erro", status: 404 });
    // Recarregada numa rota funda, a página com `base: "./"` pede os assets relativos à rota.
    expect(pedir("simplifica://app/conversa/123/assets/app.js")).toEqual({
      tipo: "arquivo",
      caminho: "/web/assets/app.js",
    });
    expect(pedir("simplifica://app/../../etc/passwd")).toEqual({ tipo: "arquivo", caminho: "/web/index.html" });
    expect(pedir("simplifica://app/%2e%2e/%2e%2e/etc/passwd.txt")).toEqual({ tipo: "erro", status: 404 });
    expect(pedir("simplifica://app/%E0%A4%A")).toEqual({ tipo: "erro", status: 400 });
    expect(pedir("simplifica://outro/index.html")).toEqual({ tipo: "erro", status: 404 });
    expect(pedir("simplifica://app/index.html", null, "POST")).toEqual({ tipo: "erro", status: 405 });
    expect(tipoConteudo("/web/assets/app.js")).toBe("text/javascript; charset=utf-8");
    expect(tipoConteudo("/web/x.desconhecido")).toBe("application/octet-stream");
  });
});

describe("revisão prévia: o que a interface pode abrir", () => {
  const escolhidos = new Set(["/Users/ana/PPCs/PPC Agro.docx"]);

  test("o sufixo é o do contrato", () => {
    expect(SUFIXO_REVISAO_PREVIA).toBe(SUFIXO_CONTRATO);
    expect(CAMINHO_LIBERAR_ARQUIVO).toBe(LIBERAR_CONTRATO);
  });

  test("só .docx com caminho absoluto sai do diálogo", () => {
    expect(docxEscolhido("/Users/ana/PPCs/PPC Agro.DOCX")).toBe("/Users/ana/PPCs/PPC Agro.DOCX");
    expect(docxEscolhido("/Users/ana/PPCs/PPC Agro.pdf")).toBeUndefined();
    expect(docxEscolhido("PPC Agro.docx")).toBeUndefined();
    expect(docxEscolhido(undefined)).toBeUndefined();
  });

  test("abre a cópia comentada de um arquivo escolhido, e nada mais", () => {
    const pasta = "/Users/ana/PPCs/";
    expect(copiaComentadaPermitida(`${pasta}PPC Agro - revisão prévia (Simplifica IF).docx`, escolhidos)).toBeDefined();
    expect(
      copiaComentadaPermitida(`${pasta}PPC Agro - revisão prévia (Simplifica IF) (2).docx`, escolhidos),
    ).toBeDefined();
    expect(
      copiaComentadaPermitida(`${pasta}PPC Agro - revisão prévia (Simplifica IF) (99).docx`, escolhidos),
    ).toBeDefined();
    for (const recusado of [
      `${pasta}PPC Agro.docx`, // o original
      `${pasta}PPC Agro - revisão prévia (Simplifica IF) (1).docx`,
      `${pasta}PPC Agro - revisão prévia (Simplifica IF) (100).docx`,
      `${pasta}PPC Agro - revisão prévia (Simplifica IF).docm`,
      `${pasta}PPC Agro - revisão prévia (Simplifica IF).docx.app`,
      `${pasta}Outro - revisão prévia (Simplifica IF).docx`, // de um arquivo não escolhido
      "/Users/ana/Outra pasta/PPC Agro - revisão prévia (Simplifica IF).docx",
      `${pasta}../PPCs/PPC Agro - revisão prévia (Simplifica IF).docx`,
      "PPC Agro - revisão prévia (Simplifica IF).docx",
      42,
    ])
      expect(copiaComentadaPermitida(recusado, escolhidos), String(recusado)).toBeUndefined();
  });
});

describe("pasta das tarefas (M1.9): o que a interface pode anexar, abrir e mostrar", () => {
  const raiz = "/Users/x/Documents/Simplifica IF";

  test("a lista de extensões é a do contrato, sem os formatos com macro", () => {
    expect([...EXTENSOES_DOCUMENTO]).toEqual([...EXTENSOES_CONTRATO]);
    expect(EXTENSOES_DOCUMENTO).not.toContain(".doc");
    expect(EXTENSOES_DOCUMENTO).not.toContain(".xls");
  });

  test("anexo: só as extensões de documento pedidas; sem pedido, todas as de documento", () => {
    expect(extensoesAnexo([".md", ".TXT", ".exe", 3])).toEqual([".md", ".txt"]);
    expect(extensoesAnexo(undefined)).toContain(".docx");
    expect(extensoesAnexo([".sh"])).not.toContain(".sh");
    expect(anexoEscolhido("/a/b/Parecer.MD", [".md"])).toBe("/a/b/Parecer.MD");
    expect(anexoEscolhido("/a/b/script.command", [".md"])).toBeUndefined();
    expect(anexoEscolhido("relativo.md", [".md"])).toBeUndefined();
  });

  test("abrir e mostrar: só dentro de uma pasta de tarefa, sem parte oculta; abrir só documentos", () => {
    expect(arquivoDeTarefaPermitido(`${raiz}/Conferir base legal/resultado.md`, raiz, true)).toBeDefined();
    expect(arquivoDeTarefaPermitido(`${raiz}/Tarefa/sub/planilha.xlsx`, raiz, true)).toBeDefined();
    // Mostrar na pasta aceita qualquer arquivo comum; abrir, não.
    expect(arquivoDeTarefaPermitido(`${raiz}/Tarefa/rodar.command`, raiz, false)).toBeDefined();
    for (const recusado of [
      `${raiz}/Tarefa/rodar.command`,
      `${raiz}/Tarefa/pagina.html`,
      `${raiz}/Tarefa/antigo.doc`,
      `${raiz}/Tarefa/planilha.xls`,
      `${raiz}/Tarefa/a.md:oculto`,
      `${raiz}/Tarefa/a.md:oculto.md`,
      `${raiz}/solto.md`,
      `${raiz}/Tarefa/.simplifica/skills/x/SKILL.md`,
      `${raiz}/Tarefa/../../segredo.md`,
      "/Users/x/Documents/outro.md",
      "/Users/x/Documents/Simplifica IF Falsa/Tarefa/a.md",
      "Tarefa/a.md",
      42,
    ]) {
      expect(arquivoDeTarefaPermitido(recusado, raiz, true), String(recusado)).toBeUndefined();
    }
  });
});
