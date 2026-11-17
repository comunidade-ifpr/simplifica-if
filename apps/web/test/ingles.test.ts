import { assert, describe, it } from "@effect/vitest";
import { palavrasSuspeitas } from "./ingles.ts";

const palavras = (texto: string) => palavrasSuspeitas(texto).map((achado) => achado.palavra);

describe("palavrasSuspeitas", () => {
  it("acha o inglês dos componentes copiados, do roteador e das CLIs", () => {
    assert.deepStrictEqual(palavras("Loading…"), ["Loading"]);
    assert.deepStrictEqual(palavras("Close"), ["Close"]);
    assert.deepStrictEqual(palavras("Something went wrong!"), ["Something", "went", "wrong"]);
    assert.deepStrictEqual(palavras("Not Found"), ["Not", "Found"]);
    assert.deepStrictEqual(palavras("Toggle sidebar"), ["Toggle", "sidebar"]);
    assert.deepStrictEqual(palavras("Invalid API key · Please run /login"), ["Invalid", "key", "Please", "run"]);
  });

  it("acha as palavras mais comuns de interface (M1.14, sobras)", () => {
    assert.deepStrictEqual(palavras("Settings · Cancel · Retry · Loading"), ["Settings", "Cancel", "Retry", "Loading"]);
    assert.deepStrictEqual(palavras("Error: Failed (Unknown)"), ["Error", "Failed", "Unknown"]);
    assert.deepStrictEqual(palavras("Sign in · Log in"), ["Sign", "Log"]);
    assert.deepStrictEqual(palavras("Open Close Save Delete Search Submit"), [
      "Open",
      "Close",
      "Save",
      "Delete",
      "Search",
      "Submit",
    ]);
    assert.deepStrictEqual(palavras("Next Back Done Undo Copy Paste Help Warning"), [
      "Next",
      "Back",
      "Done",
      "Undo",
      "Copy",
      "Paste",
      "Help",
      "Warning",
    ]);
    // "Enter", com maiúscula, é o nome da tecla (exceção); "enter" no meio da frase, não.
    assert.deepStrictEqual(palavras("Press Enter to confirm"), ["Press", "confirm"]);
    assert.deepStrictEqual(palavras("Please enter your name"), ["Please", "enter", "your", "name"]);
    assert.deepStrictEqual(palavras("Session expired, choose a profile"), ["Session", "choose", "profile"]);
  });

  it("acha o jargão técnico, mesmo em português", () => {
    assert.deepStrictEqual(palavrasSuspeitas("A sessão já está aberta"), [
      { palavra: "sessão", motivo: "jargão", texto: "A sessão já está aberta" },
    ]);
    assert.deepStrictEqual(palavras("O provider devolveu 300 tokens"), ["provider", "tokens"]);
    assert.deepStrictEqual(palavras("A issue fica pública"), ["issue"]);
    assert.deepStrictEqual(palavras("A conexão com o servidor local caiu"), ["servidor local"]);
    assert.deepStrictEqual(palavras("O servidor recusou a credencial"), ["credencial"]);
  });

  it("deixa o português, inclusive as palavras que também existem em inglês", () => {
    for (const texto of [
      "O que você precisa hoje?",
      "Não há conversas gravadas. Comece uma no Início ou por uma tarefa.",
      "Se a IA for consultar a base, o menu mostra o total.",
      "Erro no login: tente de novo",
      "Conta Claude Pro, Max, Team ou Enterprise (ou chave de API)",
      "Abrir no GitHub",
      "Salvar como DOCX ou PDF, para abrir no Word",
      "ChatGPT (Codex) · Gemini (Antigravity) · Claude Code",
      // Palavras que existem nas duas línguas, ou o português que se parece com as da lista
      "Entrar na conta e fazer o login no navegador; o login falhou",
      "O time do campus, o item final e o status do curso: real, normal, global, local, online",
      "Note que a data da base é a de hoje. Set de 2026, menu, total, zoom, beta",
      "Servidores do IFPR: um servidor público pede ajuda à coordenação",
      "Sem conexão. Nova tentativa em 3 s · Tentar agora",
    ]) {
      assert.deepStrictEqual(palavras(texto), [], texto);
    }
  });

  it("não confere caminho, link, e-mail, arquivo, versão nem identificador", () => {
    for (const texto of [
      "/Users/voce/Documents/Simplifica IF/minha-tarefa",
      "C:\\Users\\voce\\Documents\\PPC.docx",
      "https://github.com/ifpr/simplifica-if/issues/new",
      "Abra ifpr://norma/br/cne-cp/res/2021/1",
      "Parecer final.docx",
      "Versão 2.1.30 · claude-opus-4-1 · relato-do-app",
      "nome@ifpr.edu.br",
    ]) {
      assert.deepStrictEqual(palavras(texto), [], texto);
    }
  });
});
