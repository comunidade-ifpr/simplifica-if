/**
 * Instruções do servidor (T5): o módulo gerado corresponde a `instrucoes.md` (`pnpm mcp:instrucoes
 * --check`), o texto cabe em 400 palavras e cobre o que a especificação pede (seção "Instruções do
 * servidor"): todas as ferramentas, por intenção; citação com link `ifpr://` e texto literal; os selos
 * norma ainda não vigente e `extraido`; PPC como exemplo, não norma; e quando usar o `pacote_contexto`.
 */
import { describe, expect, test } from "vite-plus/test";
import { instrucoesAtualizadas } from "../scripts/gerar-instrucoes.ts";
import { FERRAMENTAS } from "../src/ferramentas/toolkit.ts";
import { INSTRUCOES } from "../src/servidor.ts";

describe("instruções do servidor", () => {
  test("src/instrucoes.gerado.ts corresponde a instrucoes.md (rode pnpm mcp:instrucoes)", () => {
    expect(instrucoesAtualizadas()).toBe(true);
  });

  test("no máximo 400 palavras (muitos clientes as injetam em toda conversa)", () => {
    expect(INSTRUCOES.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(400);
  });

  test("todas as ferramentas aparecem, e nenhuma descrição é repetida", () => {
    for (const f of FERRAMENTAS) {
      expect(INSTRUCOES).toContain(`\`${f.nome}\``);
      // por intenção, não pela descrição: nenhuma frase da descrição volta inteira nas instruções
      for (const frase of f.descricao.split(/(?<=[.:;])\s+/).filter((frase) => frase.length > 40)) {
        expect(INSTRUCOES).not.toContain(frase);
      }
    }
  });

  test("citação, selos de confiança, PPC como exemplo e o pacote_contexto na revisão de PPC", () => {
    expect(INSTRUCOES).toContain("`ifpr://`");
    expect(INSTRUCOES).toContain("texto literal");
    expect(INSTRUCOES).toContain("aguardando publicação");
    expect(INSTRUCOES).toContain("`extraido`");
    expect(INSTRUCOES).toMatch(/exemplos institucionais, não norma/);
    expect(INSTRUCOES).toMatch(/Revisão de PPC[^\n]*`pacote_contexto`/);
    expect(INSTRUCOES).toMatch(/não preencha com memória/);
  });
});
