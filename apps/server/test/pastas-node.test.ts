// @effect-diagnostics nodeBuiltinImport:off -- teste: arquivos, links e FIFO de verdade na pasta temporária
/**
 * A leitura do documento que vira texto (`lerSemSeguirLinks`), direto na função: o arquivo comum é lido,
 * e o que a IA poderia plantar na pasta é recusado com o motivo: o arquivo trocado por um link para fora,
 * a subpasta trocada por um link para fora, a pasta ou o FIFO no lugar do arquivo, o grande demais. As
 * trocas são feitas antes da chamada; a corrida em si (troca depois da abertura) fica com o `dev`/`ino`.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { afterAll, assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ArquivoGrandeDemais, LeituraNaoFeita, LeituraRecusada, lerSemSeguirLinks } from "../src/pastas-node.ts";
import { diretorioTemporario, limparTemporarios } from "./apoio.ts";

afterAll(limparTemporarios);

const ehRecusa = Schema.is(LeituraRecusada);
const ehGrandeDemais = Schema.is(ArquivoGrandeDemais);
const ehFalhaDeLeitura = Schema.is(LeituraNaoFeita);

/** A pasta da tarefa (pelo caminho real, como o `PastasTrabalho` a passa) e uma pasta de fora com um documento. */
const pastas = () => {
  const real = NodeFS.realpathSync(diretorioTemporario("simplifica-leitura-"));
  const fora = NodeFS.realpathSync(diretorioTemporario("simplifica-leitura-fora-"));
  NodeFS.writeFileSync(NodePath.join(fora, "Segredo.docx"), "CONTEÚDO DE FORA");
  return { real, fora };
};

const motivoDe = (real: string, relativo: string, maximo = 1024) =>
  lerSemSeguirLinks(real, relativo, maximo).pipe(
    Effect.flip,
    Effect.map((erro) => {
      assert.strictEqual(erro.caminho, relativo);
      if (ehRecusa(erro)) return erro.motivo;
      if (ehGrandeDemais(erro)) return "grande-demais";
      assert.isTrue(ehFalhaDeLeitura(erro));
      return "erro";
    }),
  );

describe("lerSemSeguirLinks", () => {
  it.effect("lê o arquivo comum, também numa subpasta, até o limite exato", () =>
    Effect.gen(function* () {
      const { real } = pastas();
      NodeFS.mkdirSync(NodePath.join(real, "atas"));
      NodeFS.writeFileSync(NodePath.join(real, "atas", "Ata.docx"), "conteúdo da ata");
      const bytes = yield* lerSemSeguirLinks(real, "atas/Ata.docx", 1024);
      assert.strictEqual(new TextDecoder().decode(bytes), "conteúdo da ata");
      const tamanho = new TextEncoder().encode("conteúdo da ata").length;
      assert.strictEqual((yield* lerSemSeguirLinks(real, "atas/Ata.docx", tamanho)).length, tamanho);
    }),
  );

  it.effect("recusa o arquivo trocado por um link para fora (link)", () =>
    Effect.gen(function* () {
      const { real, fora } = pastas();
      NodeFS.symlinkSync(NodePath.join(fora, "Segredo.docx"), NodePath.join(real, "Minuta.docx"));
      assert.strictEqual(yield* motivoDe(real, "Minuta.docx"), "link");
    }),
  );

  it.effect("recusa a subpasta trocada por um link para fora (fora-da-pasta)", () =>
    Effect.gen(function* () {
      const { real, fora } = pastas();
      NodeFS.symlinkSync(fora, NodePath.join(real, "atas"));
      // No macOS, o `O_NOFOLLOW_ANY` recusa já na abertura; nos outros, o caminho real fora da pasta.
      assert.include(["link", "fora-da-pasta"], yield* motivoDe(real, "atas/Segredo.docx"));
      // O `..` no caminho relativo também não sai da pasta.
      const relativoFora = NodePath.relative(real, NodePath.join(fora, "Segredo.docx"));
      assert.strictEqual(yield* motivoDe(real, relativoFora), "fora-da-pasta");
    }),
  );

  it.effect("recusa a pasta no lugar do arquivo (nao-e-arquivo)", () =>
    Effect.gen(function* () {
      const { real } = pastas();
      NodeFS.mkdirSync(NodePath.join(real, "Minuta.docx"));
      assert.strictEqual(yield* motivoDe(real, "Minuta.docx"), "nao-e-arquivo");
    }),
  );

  // Sem `O_NONBLOCK`, a abertura de um FIFO sem quem escreva trava, e o teste passaria do prazo. O
  // `mkfifo` é do macOS e do Linux, onde os testes rodam (a CI, no Ubuntu).
  it.effect("recusa o FIFO no lugar do arquivo, sem travar (nao-e-arquivo)", () =>
    Effect.gen(function* () {
      const { real } = pastas();
      NodeChildProcess.execFileSync("mkfifo", [NodePath.join(real, "Minuta.docx")]);
      assert.strictEqual(yield* motivoDe(real, "Minuta.docx"), "nao-e-arquivo");
    }),
  );

  it.effect("recusa o arquivo acima do limite pelo tamanho do descritor (grande-demais)", () =>
    Effect.gen(function* () {
      const { real } = pastas();
      // Esparso: 1 GiB sem ocupar o disco. A recusa vem do `fstat`, antes de qualquer leitura.
      NodeFS.writeFileSync(NodePath.join(real, "Grande.docx"), "");
      NodeFS.truncateSync(NodePath.join(real, "Grande.docx"), 1024 * 1024 * 1024);
      assert.strictEqual(yield* motivoDe(real, "Grande.docx"), "grande-demais");
      NodeFS.writeFileSync(NodePath.join(real, "Pouco.docx"), "x".repeat(11));
      assert.strictEqual(yield* motivoDe(real, "Pouco.docx", 10), "grande-demais");
    }),
  );

  it.effect("o arquivo que saiu depois do retrato, ou a subpasta que virou arquivo, é troca (trocado)", () =>
    Effect.gen(function* () {
      const { real } = pastas();
      assert.strictEqual(yield* motivoDe(real, "nao-existe.docx"), "trocado");
      NodeFS.writeFileSync(NodePath.join(real, "atas"), "um arquivo no lugar da pasta");
      assert.strictEqual(yield* motivoDe(real, "atas/Ata.docx"), "trocado");
    }),
  );

  it.effect("a pasta da tarefa sem acesso é erro de E/S, com a causa (erro)", () =>
    Effect.gen(function* () {
      const erro = yield* Effect.flip(lerSemSeguirLinks("/caminho/que/nao/existe", "Minuta.docx", 1024));
      assert.isTrue(ehFalhaDeLeitura(erro));
      assert.isDefined(erro.cause);
    }),
  );

  it.effect("a pasta passada com outra caixa de letras é lida, onde o sistema não distingue (APFS, NTFS)", () =>
    Effect.gen(function* () {
      const { real } = pastas();
      NodeFS.mkdirSync(NodePath.join(real, "Revisão do PPC"));
      NodeFS.writeFileSync(NodePath.join(real, "Revisão do PPC", "Minuta.docx"), "minuta");
      const outraCaixa = NodePath.join(real, "REVISÃO DO PPC");
      // Num sistema que distingue a caixa (o ext4 da CI), essa pasta não existe e não há o que conferir.
      if (!NodeFS.existsSync(outraCaixa)) return;
      const bytes = yield* lerSemSeguirLinks(outraCaixa, "Minuta.docx", 1024);
      assert.strictEqual(new TextDecoder().decode(bytes), "minuta");
    }),
  );
});
