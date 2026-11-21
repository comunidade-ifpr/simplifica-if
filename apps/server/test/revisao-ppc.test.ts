// @effect-diagnostics nodeBuiltinImport:off globalTimersInEffect:off -- teste: arquivos temporários, o banco de fixture e o relógio do laço de eventos do Node (o que o Worker não pode bloquear)
/**
 * A revisão prévia sem IA no servidor (M1.11, etapa 3): o RPC `revisaoPpc.revisar` de ponta a ponta,
 * com o Worker de verdade, sobre o banco de fixture (a base vem só do `kb.sqlite`, nada do checkout):
 * as etapas da leitura em stream, a cópia comentada ao lado do original (sempre a mesma, regravada; " (2)"
 * só travada; original intacto), as recusas antes de ler,
 * o DOCX hostil, o estouro de memória e de tempo do Worker, o servidor de pé depois de tudo, e o laço
 * de eventos livre durante a revisão.
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
import { CAMINHO_LIBERAR_ARQUIVO, ehFalhaRevisaoPpc } from "@simplifica-if/contratos-app";
import * as Layers from "@simplifica-if/kb/layers";
import { par } from "@simplifica-if/docx/testes/sintetico";
import { ppcSintetico } from "@simplifica-if/ppc/testes/revisao-previa";
import * as ArquivosLiberados from "../src/ArquivosLiberados.ts";
import * as Banco from "../src/persistencia/Banco.ts";
import * as CopiasComentadas from "../src/persistencia/CopiasComentadas.ts";
import * as RevisorPpc from "../src/revisao-ppc/RevisorPpc.ts";
import * as Servidor from "../src/servidor.ts";
import {
  bancoFixture,
  cliente,
  diretorioTemporario,
  layerDriversFalsos,
  limparTemporarios,
  novoRegistro,
  pedirHttp,
  revisarAteOFim,
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

const camada = Servidor.layer({ primeiroUsoFeito: true, banco, token: Redacted.make(TOKEN) }).pipe(
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

layer(camada, { excludeTestServices: true })("revisaoPpc.revisar", (it) => {
  it.effect("revisa, grava a cópia comentada ao lado do original e não toca no original", () =>
    Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const rpc = yield* cliente(urlRpc, AUTORIZACAO);
      const original = gravar("PPC Agropecuária.docx", ppcSintetico());
      const antes = hash(original);

      // O laço de eventos do servidor anda durante a revisão (a conversão roda no Worker).
      let voltas = 0;
      const relogio = setInterval(() => (voltas += 1), 5);
      const resultado = yield* revisarAteOFim(rpc["revisaoPpc.revisar"]({ arquivo: original }));
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

      // As etapas da leitura, na ordem em que começam, antes do resultado.
      assert.deepStrictEqual(resultado.etapas, ["lendo", "identificando", "conferindo", "gravando"]);

      // De novo: a mesma cópia, regravada (a pasta fica com uma só).
      const segunda = yield* revisarAteOFim(
        rpc["revisaoPpc.revisar"]({ arquivo: original, cnct: "tecnico-em-agropecuaria" }),
      );
      assert.strictEqual(segunda.arquivoComentado, resultado.arquivoComentado);
      assert.strictEqual(segunda.curso.origem, "pessoa");
      assert.deepStrictEqual(
        NodeFS.readdirSync(pasta)
          .filter((nome) => nome.startsWith("PPC Agropecuária"))
          .sort(),
        ["PPC Agropecuária - revisão prévia (Simplifica IF).docx", "PPC Agropecuária.docx"],
      );

      // A cópia travada (aberta no Word, no Windows; aqui, sem permissão de escrita): passa a " (2)".
      NodeFS.chmodSync(resultado.arquivoComentado, 0o444);
      const travada = yield* revisarAteOFim(rpc["revisaoPpc.revisar"]({ arquivo: original })).pipe(
        Effect.ensuring(Effect.sync(() => NodeFS.chmodSync(resultado.arquivoComentado, 0o644))),
      );
      assert.strictEqual(
        travada.arquivoComentado,
        NodePath.join(pasta, "PPC Agropecuária - revisão prévia (Simplifica IF) (2).docx"),
      );
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
        const erro = yield* Effect.flip(revisarAteOFim(rpc["revisaoPpc.revisar"]({ arquivo })));
        assert.isTrue(ehFalhaRevisaoPpc(erro));
      }
    }),
  );

  it.effect("DOCX hostil (bomba de descompactação): mensagem em português, e o servidor continua", () =>
    Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const rpc = yield* cliente(urlRpc, AUTORIZACAO);
      const erro = yield* Effect.flip(
        revisarAteOFim(rpc["revisaoPpc.revisar"]({ arquivo: gravar("hostil.docx", docxHostil()) })),
      );
      assert.isTrue(ehFalhaRevisaoPpc(erro));
      assert.match(erro.message, /compressão anormal/);
      const depois = yield* revisarAteOFim(
        rpc["revisaoPpc.revisar"]({ arquivo: gravar("depois.docx", ppcSintetico()) }),
      );
      assert.isAbove(depois.pendencias.length, 0);
    }),
  );
});

/** O banco de fixture e, como no servidor sem o segredo do desktop, todo arquivo liberado. */
const semExigirLiberacao = Layer.mergeAll(
  Layers.layerSomenteLeitura({ caminho: banco }),
  ArquivosLiberados.layer({ exigirLiberacao: false }),
  CopiasComentadas.layer.pipe(Layer.provide(Banco.layerMemoria)),
);

/** O serviço direto sobre o banco de fixture, com limites apertados para provocar cada estouro. */
const revisarCom = (limites: Partial<RevisorPpc.Limites>, arquivo: string) =>
  Effect.gen(function* () {
    const revisor = yield* RevisorPpc.RevisorPpc;
    return yield* Effect.flip(revisor.revisar({ arquivo }));
  }).pipe(Effect.provide(RevisorPpc.layer({ limites }).pipe(Layer.provide(semExigirLiberacao))));

layer(NodeServices.layer, { excludeTestServices: true })("limites do Worker", (it) => {
  it.effect("arquivo acima do limite: recusado antes de ler, com a orientação de compactar as imagens", () =>
    Effect.gen(function* () {
      const erro = yield* revisarCom({ bytesDoArquivo: 1000 }, gravar("grande.docx", ppcSintetico()));
      assert.match(erro.message, /acima do limite de 0,0 MB\. Compacte as imagens/);
    }),
  );

  it.effect(
    "estouro de memória do Worker vira mensagem, e outra revisão funciona depois",
    () =>
      Effect.gen(function* () {
        // 60 mil parágrafos (170 kB compactados) não cabem em 64 MB de heap; cabem nos 512 MB do padrão.
        const extenso = Array.from({ length: 60_000 }, (_, i) => par(`Parágrafo ${i} do texto do curso.`)).join("");
        const grande = gravar("memoria.docx", ppcSintetico({ corpoExtra: extenso }));
        // Abaixo do piso (2 MB abortaria o processo inteiro): vale o piso de 64 MB.
        const erro = yield* revisarCom({ memoriaMb: 2 }, grande);
        assert.match(erro.message, /memória demais/);
        const arquivo = gravar("normal.docx", ppcSintetico());
        const ok = yield* RevisorPpc.RevisorPpc.pipe(
          Effect.flatMap((revisor) => revisor.revisar({ arquivo })),
          Effect.provide(RevisorPpc.layer().pipe(Layer.provide(semExigirLiberacao))),
        );
        assert.isAbove(ok.pendencias.length, 0);
      }),
    60_000,
  );

  it.effect("tempo máximo: o Worker é encerrado e a mensagem diz o limite", () =>
    Effect.gen(function* () {
      const erro = yield* revisarCom({ tempoMs: 1 }, gravar("tempo.docx", ppcSintetico()));
      assert.match(erro.message, /passou do tempo máximo/);
    }),
  );
});

layer(NodeServices.layer, { excludeTestServices: true })("uma revisão por vez", (it) => {
  it.effect("a segunda revisão simultânea é recusada com a mensagem, e a primeira termina", () =>
    Effect.gen(function* () {
      const arquivo = gravar("simultanea.docx", ppcSintetico());
      const [primeira, segunda] = yield* Effect.gen(function* () {
        const revisor = yield* RevisorPpc.RevisorPpc;
        return yield* Effect.all(
          [Effect.result(revisor.revisar({ arquivo })), Effect.result(revisor.revisar({ arquivo }))],
          {
            concurrency: 2,
          },
        );
      }).pipe(Effect.provide(RevisorPpc.layer().pipe(Layer.provide(semExigirLiberacao))));
      const resultados = [primeira, segunda];
      const falhas = resultados.filter((r) => r._tag === "Failure");
      assert.strictEqual(falhas.length, 1);
      assert.strictEqual(
        falhas[0]!._tag === "Failure" ? falhas[0]!.failure.message : "",
        "Já há uma revisão em andamento. Espere ela terminar e tente de novo.",
      );
      assert.strictEqual(resultados.filter((r) => r._tag === "Success").length, 1);
    }),
  );
});

/** O servidor com o segredo do desktop: só os arquivos liberados pelo processo principal. */
const TOKEN_DESKTOP = "segredo-do-processo-principal-0123456789";
const conversasDesktop = NodePath.join(diretorioTemporario("simplifica-revisao-desktop-"), "conversas.sqlite");
const camadaDesktop = Servidor.layer({
  primeiroUsoFeito: true,
  banco,
  bancoConversas: conversasDesktop,
  token: Redacted.make(TOKEN),
  tokenDesktop: Redacted.make(TOKEN_DESKTOP),
}).pipe(Layer.provide(layerDriversFalsos(novoRegistro())), Layer.provide(NodeServices.layer));

layer(camadaDesktop, { excludeTestServices: true })("liberação pelo desktop", (it) => {
  it.effect("sem liberação, recusa; a rota exige o segredo do desktop, sem Origin; liberado, revisa", () =>
    Effect.gen(function* () {
      const { urlRpc, porta } = yield* Servidor.ServidorApp;
      const rpc = yield* cliente(urlRpc, AUTORIZACAO);
      const arquivo = gravar("liberado.docx", ppcSintetico());
      const recusa = yield* Effect.flip(revisarAteOFim(rpc["revisaoPpc.revisar"]({ arquivo })));
      // O botão que existe hoje e o soltar na janela; a interface pede o arquivo de novo.
      assert.include(recusa.message, "pelo botão “Escolher o PPC” ou soltando-o na janela do app");
      assert.notInclude(recusa.message, "(.docx)…");
      assert.isTrue(ehFalhaRevisaoPpc(recusa) && recusa.escolherDeNovo === true);

      const url = `http://127.0.0.1:${porta}${CAMINHO_LIBERAR_ARQUIVO}`;
      const liberar = (cabecalhos: Record<string, string>) =>
        pedirHttp(url, {
          metodo: "POST",
          cabecalhos: { "content-type": "application/json", ...cabecalhos },
          corpo: JSON.stringify({ arquivo }),
        });
      // O token do RPC (que a janela tem) não serve; o navegador (com Origin) também não.
      assert.strictEqual((yield* liberar({ authorization: `Bearer ${TOKEN}` })).status, 401);
      assert.strictEqual(
        (yield* liberar({ authorization: `Bearer ${TOKEN_DESKTOP}`, origin: "app://simplifica" })).status,
        403,
      );
      // Corpo sem o caminho absoluto do arquivo: 400.
      for (const corpo of ["{", JSON.stringify({ arquivo: 1 }), JSON.stringify({ arquivo: "relativo.docx" })]) {
        const resposta = yield* pedirHttp(url, {
          metodo: "POST",
          cabecalhos: { "content-type": "application/json", authorization: `Bearer ${TOKEN_DESKTOP}` },
          corpo,
        });
        assert.strictEqual(resposta.status, 400);
      }
      assert.strictEqual((yield* liberar({ authorization: `Bearer ${TOKEN_DESKTOP}` })).status, 204);

      const resultado = yield* revisarAteOFim(rpc["revisaoPpc.revisar"]({ arquivo }));
      assert.isAbove(resultado.pendencias.length, 0);
      // Outro arquivo da mesma pasta continua recusado.
      const outro = gravar("outro.docx", ppcSintetico());
      assert.match(
        (yield* Effect.flip(revisarAteOFim(rpc["revisaoPpc.revisar"]({ arquivo: outro })))).message,
        /Escolha de novo o arquivo/,
      );
    }),
  );

  it.effect("retomar a leitura com IA de um arquivo não liberado (o app reiniciou) recusa antes de ler", () =>
    Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const rpc = yield* cliente(urlRpc, AUTORIZACAO);
      const arquivo = gravar("pausada.docx", ppcSintetico());
      // Uma leitura pausada de uma execução anterior do app, gravada no banco das conversas.
      const estimativa = {
        provider: "claude",
        blocos: 1,
        fichas: 1,
        tokensEntrada: 1,
        tokensSaida: 1,
        minutos: 1,
        custoUsd: null,
        percentualJanela: 1,
        nomeJanela: "uma janela de 5 horas",
      };
      const db = new NodeSqlite.DatabaseSync(conversasDesktop);
      db.prepare(
        `INSERT INTO revisoes_ia (id, arquivo, sha256, provider, modelo, modo, cnct, forma, situacao, motivo, plano,
          estimativa, criada_em, atualizada_em)
         VALUES (?, ?, ?, 'claude', NULL, 'rapido', NULL, NULL, 'pausada', 'O app foi fechado.', 'null', ?, ?, ?)`,
      ).run(
        "revisao-pausada",
        arquivo,
        hash(arquivo),
        JSON.stringify(estimativa),
        "2026-11-20T10:00:00Z",
        "2026-11-20T10:00:00Z",
      );
      db.close();
      const recusa = yield* Effect.flip(rpc["revisaoPpc.iniciarIa"]({ revisao: "revisao-pausada" }));
      assert.isTrue(ehFalhaRevisaoPpc(recusa) && recusa.escolherDeNovo === true);
      assert.include(recusa.message, "Escolha de novo o arquivo “pausada.docx”");
      // Nada começou: a leitura continua pausada, à espera do arquivo.
      const estado = (yield* rpc["revisaoPpc.listarIa"]({})).find((e) => e.id === "revisao-pausada")!;
      assert.strictEqual(estado.situacao, "pausada");
    }),
  );
});

layer(camada, { excludeTestServices: true })("a cópia comentada", (it) => {
  it.effect("a cópia editada pela pessoa e o link no lugar da cópia ficam; a cópia vai para ' (2)'", () =>
    Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const rpc = yield* cliente(urlRpc, AUTORIZACAO);
      const original = gravar("PPC anotado.docx", ppcSintetico());
      const primeira = yield* revisarAteOFim(rpc["revisaoPpc.revisar"]({ arquivo: original }));
      NodeFS.writeFileSync(primeira.arquivoComentado, "minhas anotações");
      const segunda = yield* revisarAteOFim(rpc["revisaoPpc.revisar"]({ arquivo: original }));
      assert.strictEqual(
        segunda.arquivoComentado,
        NodePath.join(pasta, "PPC anotado - revisão prévia (Simplifica IF) (2).docx"),
      );
      assert.strictEqual(NodeFS.readFileSync(primeira.arquivoComentado, "utf8"), "minhas anotações");
      // A " (2)" é a do app: regravada, sem " (3)".
      const terceira = yield* revisarAteOFim(rpc["revisaoPpc.revisar"]({ arquivo: original }));
      assert.strictEqual(terceira.arquivoComentado, segunda.arquivoComentado);
      // Nenhum temporário fica na pasta.
      assert.deepStrictEqual(
        NodeFS.readdirSync(pasta).filter((nome) => nome.startsWith(".")),
        [],
      );

      // Um link no lugar da cópia não é seguido: o arquivo para onde ele aponta fica intacto.
      const comLink = gravar("PPC link.docx", ppcSintetico());
      const alvo = gravar("alvo do link.txt", strToU8("intacto"));
      const lugar = NodePath.join(pasta, "PPC link - revisão prévia (Simplifica IF).docx");
      NodeFS.symlinkSync(alvo, lugar);
      const r = yield* revisarAteOFim(rpc["revisaoPpc.revisar"]({ arquivo: comLink }));
      assert.strictEqual(
        r.arquivoComentado,
        NodePath.join(pasta, "PPC link - revisão prévia (Simplifica IF) (2).docx"),
      );
      assert.strictEqual(NodeFS.readFileSync(alvo, "utf8"), "intacto");
      assert.isTrue(NodeFS.lstatSync(lugar).isSymbolicLink());
    }),
  );
});
