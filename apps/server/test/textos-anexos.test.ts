/**
 * A versão em texto dos anexos (`TextosAnexos`), direto no serviço, com o Worker de verdade: os bytes
 * entram (a leitura conferida é do `PastasTrabalho`, `test/pastas-node.test.ts`), a extensão
 * decide (inclusive em maiúsculas), o tempo máximo vira motivo para a pessoa, e o nome do `.md` e o
 * cabeçalho saem seguros de nomes que o macOS aceita (barra invertida, quebra de linha, nome longo).
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { montarDocx, par } from "@simplifica-if/docx/testes/sintetico";
import { montarPdf } from "@simplifica-if/pdf/testes/sintetico";
import { montarOdt } from "@simplifica-if/docx/testes/sintetico-odt";
import * as TextosAnexos from "../src/textos-anexos/TextosAnexos.ts";

const docx = () => montarDocx({ corpo: par("Art. 1º O estágio é obrigatório.") });

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
      // O limite que quem lê confere antes de passar os bytes.
      assert.strictEqual(textos.bytesDoArquivo, TextosAnexos.LIMITES.bytesDoArquivo);
      const bytes = docx();
      const minuscula = yield* textos.converter(bytes, "Minuta.docx");
      assert.strictEqual(minuscula.tipo, "texto");
      // Os bytes de quem chama continuam dele (o Worker recebe uma cópia transferida).
      assert.isAbove(bytes.length, 0);
      const maiuscula = yield* textos.converter(docx(), "MINUTA.DOCX");
      assert.strictEqual(maiuscula.tipo, "texto");
      if (maiuscula.tipo === "texto") assert.include(maiuscula.markdown, "Art. 1º O estágio é obrigatório.");
      const md = new TextEncoder().encode("# Nota\n");
      assert.deepStrictEqual(yield* textos.converter(md, "nota.md"), { tipo: "nao-converte" });
      // O .odt (LibreOffice) também.
      const odt = montarOdt({ corpo: "<text:p>Art. 4º A minuta vale.</text:p>" });
      const doOdt = yield* textos.converter(odt, "Minuta.odt");
      assert.strictEqual(doOdt.tipo, "texto");
      if (doOdt.tipo === "texto") assert.include(doOdt.markdown, "Art. 4º A minuta vale.");
      // O PDF com texto vira texto, com o marcador de página e o cabeçalho próprio do PDF.
      const pdf = montarPdf({ paginas: [["Art. 3º O parecer vale."]] });
      const doPdf = yield* textos.converter(pdf, "Parecer.PDF");
      assert.strictEqual(doPdf.tipo, "texto");
      if (doPdf.tipo === "texto") {
        assert.include(doPdf.markdown, "<!-- página 1 -->");
        assert.include(doPdf.markdown, "Art. 3º O parecer vale.");
        assert.include(doPdf.markdown, "o PDF não guarda títulos nem tabelas como texto");
      }
      // O PDF digitalizado (só imagem, aqui uma página vazia) entra sem texto, com a frase do motivo.
      const vazio = montarPdf({ paginas: [[]] });
      const semTextoPdf = yield* textos.converter(vazio, "Digitalizado.pdf");
      assert.strictEqual(semTextoPdf.tipo, "sem-texto");
      if (semTextoPdf.tipo === "sem-texto") assert.match(semTextoPdf.motivo, /^O PDF não tem texto/);
    }),
  );
});

layer(TextosAnexos.layer({ limites: { tempoMs: 1 } }).pipe(Layer.provide(NodeServices.layer)), {
  excludeTestServices: true,
})("converter com o tempo máximo apertado", (it) => {
  it.effect("o Worker que passa do tempo vira o motivo para a pessoa", () =>
    Effect.gen(function* () {
      const textos = yield* TextosAnexos.TextosAnexos;
      const resultado = yield* textos.converter(docx(), "Lento.docx");
      assert.deepStrictEqual(resultado, { tipo: "sem-texto", motivo: "A conversão passou do tempo máximo." });
    }),
  );
});
