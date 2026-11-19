// @effect-diagnostics nodeBuiltinImport:off -- teste: arquivos de verdade na pasta temporária
/**
 * A versão em texto dos anexos (`TextosAnexos`), direto no serviço, com o Worker de verdade: a extensão
 * decide (inclusive em maiúsculas), o tempo máximo vira motivo para a pessoa, e o nome do `.md` e o
 * cabeçalho saem seguros de nomes que o macOS aceita (barra invertida, quebra de linha, nome longo).
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, describe, it, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { montarDocx, par } from "@simplifica-if/docx/testes/sintetico";
import * as TextosAnexos from "../src/textos-anexos/TextosAnexos.ts";
import { diretorioTemporario, limparTemporarios } from "./apoio.ts";

afterAll(limparTemporarios);

const pasta = diretorioTemporario("simplifica-textos-");
const docx = (nome: string) => {
  const caminho = NodePath.join(pasta, nome);
  NodeFS.writeFileSync(caminho, montarDocx({ corpo: par("Art. 1º O estágio é obrigatório.") }));
  return caminho;
};

describe("caminhoDoTexto e cabecalhoTexto", () => {
  it("o nome do .md é o do anexo, sem barra invertida nem controle, e o longo é cortado com um resumo", () => {
    assert.strictEqual(TextosAnexos.caminhoDoTexto("Minuta (2).docx"), ".simplifica/textos/Minuta (2).docx.md");
    assert.strictEqual(TextosAnexos.caminhoDoTexto("Ata\\final\n.docx"), ".simplifica/textos/Ata_final_.docx.md");
    const longo = `${"Parecer sobre o estágio ".repeat(20)}.docx`;
    const caminho = TextosAnexos.caminhoDoTexto(longo);
    const nome = caminho.slice(".simplifica/textos/".length);
    assert.isAtMost(new TextEncoder().encode(nome).length, 255);
    assert.match(nome, /-[0-9a-f]{8}\.md$/);
    assert.notStrictEqual(caminho, TextosAnexos.caminhoDoTexto(`${longo}x`));
  });

  it("o cabeçalho fica numa linha só, mesmo com quebra de linha no nome", () => {
    const cabecalho = TextosAnexos.cabecalhoTexto("Ata\nfinal.docx", "19/11/2026");
    assert.match(
      cabecalho,
      /^> Texto extraído automaticamente de "Ata final\.docx" pelo Simplifica IF em 19\/11\/2026/,
    );
    assert.strictEqual(cabecalho.trimEnd().split("\n").length, 1);
  });
});

layer(TextosAnexos.layer().pipe(Layer.provide(NodeServices.layer)), {
  excludeTestServices: true,
})("converter", (it) => {
  it.effect("o .docx (também em maiúsculas) vira texto; o que a IA já lê não se converte", () =>
    Effect.gen(function* () {
      const textos = yield* TextosAnexos.TextosAnexos;
      const minuscula = yield* textos.converter(docx("Minuta.docx"), "Minuta.docx");
      assert.strictEqual(minuscula.tipo, "texto");
      const maiuscula = yield* textos.converter(docx("MINUTA.DOCX"), "MINUTA.DOCX");
      assert.strictEqual(maiuscula.tipo, "texto");
      if (maiuscula.tipo === "texto") assert.include(maiuscula.markdown, "Art. 1º O estágio é obrigatório.");
      const md = NodePath.join(pasta, "nota.md");
      NodeFS.writeFileSync(md, "# Nota\n");
      assert.deepStrictEqual(yield* textos.converter(md, "nota.md"), { tipo: "nao-converte" });
      // O arquivo que sumiu: sem texto, sem falhar.
      const sumiu = yield* textos.converter(NodePath.join(pasta, "nao-existe.docx"), "nao-existe.docx");
      assert.deepStrictEqual(sumiu, { tipo: "sem-texto", motivo: "O arquivo não pôde ser lido." });
    }),
  );
});

layer(TextosAnexos.layer({ limites: { tempoMs: 1 } }).pipe(Layer.provide(NodeServices.layer)), {
  excludeTestServices: true,
})("converter com o tempo máximo apertado", (it) => {
  it.effect("o Worker que passa do tempo vira o motivo para a pessoa", () =>
    Effect.gen(function* () {
      const textos = yield* TextosAnexos.TextosAnexos;
      const resultado = yield* textos.converter(docx("Lento.docx"), "Lento.docx");
      assert.deepStrictEqual(resultado, { tipo: "sem-texto", motivo: "A conversão passou do tempo máximo." });
    }),
  );
});
