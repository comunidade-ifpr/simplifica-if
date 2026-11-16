// @effect-diagnostics nodeBuiltinImport:off globalTimersInEffect:off -- teste: arquivos temporários, o banco de fixture e o relógio do laço de eventos do Node (o que o Worker não pode bloquear)
/**
 * A revisão prévia sem IA no servidor (M1.11, etapa 3): o RPC `revisaoPpc.analisar` de ponta a ponta,
 * com o Worker de verdade, sobre o banco de fixture (a base vem só do `kb.sqlite`, nada do checkout):
 * a cópia comentada ao lado do original (sem sobrescrever, original intacto), as recusas antes de ler,
 * o DOCX hostil, o estouro de memória e de tempo do Worker, o servidor de pé depois de tudo, e o laço
 * de eventos livre durante a análise.
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { strToU8, zipSync } from "fflate";
import { ehFalhaRevisaoPpc } from "@simplifica-if/contratos-app";
import * as Layers from "@simplifica-if/kb/layers";
import { montarDocx, par } from "@simplifica-if/docx/testes/sintetico";
import { corpoPpcSintetico, ppcSintetico } from "@simplifica-if/ppc/testes/revisao-previa";
import * as AnalisePpc from "../src/revisao-ppc/AnalisePpc.ts";
import * as Servidor from "../src/servidor.ts";
import {
  bancoFixture,
  cliente,
  diretorioTemporario,
  layerDriversFalsos,
  limparTemporarios,
  novoRegistro,
  TOKEN,
} from "./apoio.ts";

afterAll(limparTemporarios);

/** O banco de fixture com um curso do CNCT e duas fichas: o resto da base é o das normas de fixture. */
function bancoComCnct(): string {
  const banco = bancoFixture();
  const db = new NodeSqlite.DatabaseSync(banco);
  const curso = {
    denominacao: "Técnico em Agropecuária",
    eixo_tecnologico: "Recursos Naturais",
    carga_horaria_minima_horas: 1200,
    pre_requisitos_ingresso: "Ensino Médio concluído ou em curso.",
    legislacao_profissional: "Lei nº 5.524, de 5 de novembro de 1968",
  };
  db.prepare(
    "INSERT INTO cnct (id, slug, denominacao, eixo_tecnologico, carga_horaria_minima_h, path, dados_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "cnct:tecnico-em-agropecuaria",
    "tecnico-em-agropecuaria",
    curso.denominacao,
    curso.eixo_tecnologico,
    1200,
    "base-conhecimento/catalogos/cnct/cursos/tecnico-em-agropecuaria.json",
    JSON.stringify(curso),
  );
  db.close();
  return banco;
}

const banco = bancoComCnct();
const pasta = diretorioTemporario("simplifica-revisao-");

const camada = Servidor.layer({ banco, token: Redacted.make(TOKEN) }).pipe(
  Layer.provide(layerDriversFalsos(novoRegistro())),
  Layer.provide(NodeServices.layer),
);

const AUTORIZACAO = { authorization: `Bearer ${TOKEN}` };
const hash = (arquivo: string) => NodeCrypto.createHash("sha256").update(NodeFS.readFileSync(arquivo)).digest("hex");

function gravar(nome: string, bytes: Uint8Array): string {
  const arquivo = NodePath.join(pasta, nome);
  NodeFS.writeFileSync(arquivo, bytes);
  return arquivo;
}

/** Uma bomba de descompactação dos testes do `packages/docx`: 15 MB de `<w:p/>` declarados como 100 bytes. */
function docxHostil(): Uint8Array {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const documento = `<?xml version="1.0"?><w:document ${W}><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p>${"<w:p/>".repeat(2_500_000)}</w:body></w:document>`;
  const relacoes =
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
  const zip = zipSync({ "_rels/.rels": strToU8(relacoes), "word/document.xml": strToU8(documento) }, { level: 9 });
  // O tamanho declarado no diretório central mente: 100 bytes.
  const nome = strToU8("word/document.xml");
  for (let i = zip.length - 22; i >= 0; i -= 1)
    if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x01 && zip[i + 3] === 0x02) {
      const tamanhoNome = zip[i + 28]! | (zip[i + 29]! << 8);
      if (tamanhoNome === nome.length && nome.every((c, j) => zip[i + 46 + j] === c))
        new DataView(zip.buffer).setUint32(i + 24, 100, true);
    }
  return zip;
}

layer(camada, { excludeTestServices: true })("revisaoPpc.analisar", (it) => {
  it.effect("analisa, grava a cópia comentada ao lado do original e não toca no original", () =>
    Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const rpc = yield* cliente(urlRpc, AUTORIZACAO);
      const original = gravar("PPC Agropecuária.docx", ppcSintetico());
      const antes = hash(original);

      // O laço de eventos do servidor anda durante a análise (a conversão roda no Worker).
      let voltas = 0;
      const relogio = setInterval(() => (voltas += 1), 5);
      const resultado = yield* rpc["revisaoPpc.analisar"]({ arquivo: original });
      clearInterval(relogio);
      assert.isAtLeast(voltas, 5);

      assert.strictEqual(
        resultado.arquivoComentado,
        NodePath.join(pasta, "PPC Agropecuária - revisão prévia (Simplifica IF).docx"),
      );
      assert.isTrue(NodeFS.existsSync(resultado.arquivoComentado));
      assert.strictEqual(hash(original), antes);
      assert.deepStrictEqual(resultado.curso, {
        cnct: { slug: "tecnico-em-agropecuaria", denominacao: "Técnico em Agropecuária" },
        forma: "subsequente",
        origem: "documento",
      });
      assert.strictEqual(resultado.conferidos, 12);
      assert.strictEqual(resultado.dataBase, "2026-11-13");
      const aee = resultado.pendencias.find((p) => p.ficha === "CT-CURR-22");
      assert.strictEqual(aee?.noDocumento, "no-trecho");

      // De novo: não sobrescreve, ganha o sufixo numérico.
      const segunda = yield* rpc["revisaoPpc.analisar"]({ arquivo: original, cnct: "tecnico-em-agropecuaria" });
      assert.strictEqual(
        segunda.arquivoComentado,
        NodePath.join(pasta, "PPC Agropecuária - revisão prévia (Simplifica IF) (2).docx"),
      );
      assert.strictEqual(segunda.curso.origem, "pessoa");
    }),
  );

  it.effect("recusa antes de ler: caminho relativo, outra extensão, arquivo ausente", () =>
    Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const rpc = yield* cliente(urlRpc, AUTORIZACAO);
      for (const arquivo of [
        "relativo.docx",
        gravar("notas.txt", strToU8("x")),
        NodePath.join(pasta, "nao-existe.docx"),
      ]) {
        const erro = yield* Effect.flip(rpc["revisaoPpc.analisar"]({ arquivo }));
        assert.isTrue(ehFalhaRevisaoPpc(erro));
      }
    }),
  );

  it.effect("DOCX hostil (bomba de descompactação): mensagem em português, e o servidor continua", () =>
    Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const rpc = yield* cliente(urlRpc, AUTORIZACAO);
      const erro = yield* Effect.flip(rpc["revisaoPpc.analisar"]({ arquivo: gravar("hostil.docx", docxHostil()) }));
      assert.isTrue(ehFalhaRevisaoPpc(erro));
      assert.match(erro.message, /compressão anormal/);
      const depois = yield* rpc["revisaoPpc.analisar"]({ arquivo: gravar("depois.docx", ppcSintetico()) });
      assert.isAbove(depois.pendencias.length, 0);
    }),
  );
});

/** O serviço direto sobre o banco de fixture, com limites apertados para provocar cada estouro. */
const analisarCom = (limites: Partial<AnalisePpc.Limites>, arquivo: string) =>
  Effect.gen(function* () {
    const analise = yield* AnalisePpc.AnalisePpc;
    return yield* Effect.flip(analise.analisar({ arquivo }));
  }).pipe(
    Effect.provide(AnalisePpc.layer({ limites }).pipe(Layer.provide(Layers.layerSomenteLeitura({ caminho: banco })))),
  );

layer(NodeServices.layer, { excludeTestServices: true })("limites do Worker", (it) => {
  it.effect("arquivo acima do limite: recusado antes de ler, com a orientação de compactar as imagens", () =>
    Effect.gen(function* () {
      const erro = yield* analisarCom({ bytesDoArquivo: 1000 }, gravar("grande.docx", ppcSintetico()));
      assert.match(erro.message, /acima do limite de 0,0 MB\. Compacte as imagens/);
    }),
  );

  it.effect(
    "estouro de memória do Worker vira mensagem, e outra análise funciona depois",
    () =>
      Effect.gen(function* () {
        // 60 mil parágrafos (170 kB compactados) não cabem em 64 MB de heap; cabem nos 512 MB do padrão.
        const extenso = Array.from({ length: 60_000 }, (_, i) => par(`Parágrafo ${i} do texto do curso.`)).join("");
        const grande = gravar("memoria.docx", montarDocx({ corpo: corpoPpcSintetico() + extenso }));
        // Abaixo do piso (2 MB abortaria o processo inteiro): vale o piso de 64 MB.
        const erro = yield* analisarCom({ memoriaMb: 2 }, grande);
        assert.match(erro.message, /memória demais/);
        const arquivo = gravar("normal.docx", ppcSintetico());
        const ok = yield* AnalisePpc.AnalisePpc.pipe(
          Effect.flatMap((analise) => analise.analisar({ arquivo })),
          Effect.provide(AnalisePpc.layer().pipe(Layer.provide(Layers.layerSomenteLeitura({ caminho: banco })))),
        );
        assert.isAbove(ok.pendencias.length, 0);
      }),
    60_000,
  );

  it.effect("tempo máximo: o Worker é encerrado e a mensagem diz o limite", () =>
    Effect.gen(function* () {
      const erro = yield* analisarCom({ tempoMs: 1 }, gravar("tempo.docx", ppcSintetico()));
      assert.match(erro.message, /passou do tempo máximo/);
    }),
  );
});
