// @effect-diagnostics nodeBuiltinImport:off -- teste: a pasta do app, o canal da fábrica e um servidor HTTP local de pacotes
/**
 * A atualização no servidor de verdade (M1.10), pelo RPC: a base empacotada (o banco de fixture), um
 * canal gerado pela fábrica com um par minisign descartável e servido em 127.0.0.1, a conferência, o
 * download, a troca adiada enquanto o servidor está ocupado e a troca na abertura seguinte.
 */
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { gerarCanal } from "@simplifica-if/atualizacao/fabrica";
import { prepararAbertura } from "@simplifica-if/atualizacao/local";
import { escreverChavePublica, gerarChaves, lerChavePublica } from "@simplifica-if/atualizacao/minisign";
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

const AUTORIZACAO = { authorization: `Bearer ${TOKEN}` };

/** Uma versão nova da base: o banco de fixture com `meta.versao` e uma linha a mais. */
function versaoNova(origem: string, destino: string, versao: string): string {
  NodeFS.copyFileSync(origem, destino);
  const db = new NodeSqlite.DatabaseSync(destino);
  db.prepare("INSERT OR REPLACE INTO meta (chave, valor) VALUES ('versao', ?)").run(versao);
  db.exec("VACUUM");
  db.close();
  return destino;
}

const servirPasta = (pasta: string) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const servidor = NodeHttp.createServer((pedido, resposta) => {
        const arquivo = NodePath.join(pasta, ...new URL(pedido.url ?? "/", "http://x").pathname.split("/"));
        if (!arquivo.startsWith(pasta) || !NodeFS.existsSync(arquivo)) return void resposta.writeHead(404).end();
        resposta.end(NodeFS.readFileSync(arquivo));
      });
      await new Promise<void>((pronto) => servidor.listen(0, "127.0.0.1", pronto));
      return { servidor, url: `http://127.0.0.1:${(servidor.address() as { port: number }).port}/` };
    }),
    ({ servidor }) => Effect.promise(() => new Promise<void>((fim) => servidor.close(() => fim()))),
  );

it.live("atualização pelo RPC: confere, baixa, adia com o servidor ocupado e troca na abertura", () =>
  Effect.gen(function* () {
    const raiz = diretorioTemporario("simplifica-atualizacao-");
    // a do instalador é uma versão publicada (a base sem versão não tem patch)
    const empacotada = versaoNova(bancoFixture(), NodePath.join(raiz, "kb-empacotada.sqlite"), "2026.11.13");
    const pastaApp = NodePath.join(raiz, "app");
    const chave = gerarChaves();
    const nova = versaoNova(empacotada, NodePath.join(raiz, "kb-nova.sqlite"), "2026.11.20");
    gerarCanal({
      saida: NodePath.join(raiz, "servido", "beta"),
      canal: "beta",
      commit: "abc1234",
      banco: nova,
      anteriores: [empacotada],
      appMinimo: "0.1.0",
      novidades: [{ tipo: "norma-nova", titulo: "Resolução nova na base" }],
      chave,
      nivel: 3,
    });
    const { url } = yield* servirPasta(NodePath.join(raiz, "servido"));

    // Cada abertura atende a troca pendente antes de abrir, como a CLI.
    const abrir = () =>
      Layer.unwrap(
        prepararAbertura({ pasta: pastaApp, bancoEmpacotado: empacotada }).pipe(
          Effect.provide(NodeServices.layer),
          Effect.map((abertura) =>
            Servidor.layer({
              primeiroUsoFeito: true,
              banco: empacotada,
              token: Redacted.make(TOKEN),
              atualizacao: {
                desligada: null,
                feed: `${url}{canal}/`,
                chave: lerChavePublica(escreverChavePublica(chave)),
                canalPadrao: "beta",
                pasta: pastaApp,
                bancoEmpacotado: empacotada,
                versaoApp: "0.1.0",
                abertura,
                automatico: false,
              },
            }).pipe(Layer.provide(layerDriversFalsos(novoRegistro())), Layer.provide(NodeServices.layer)),
          ),
        ),
      );

    yield* Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const rpc = yield* cliente(urlRpc, AUTORIZACAO);
      const antes = yield* rpc["atualizacao.estado"]({});
      assert.strictEqual(antes.desligada, null);
      assert.strictEqual(antes.base.versao, "2026.11.13");
      assert.strictEqual(antes.base.origem, "empacotada");
      const depois = yield* rpc["atualizacao.procurar"]({});
      assert.strictEqual(depois.erro, null);
      assert.strictEqual(depois.pendente, "2026.11.20");
      assert.strictEqual(depois.situacao, "pronta");
      assert.strictEqual((yield* rpc["atualizacao.aplicar"]({})).resultado, "reiniciar");
    }).pipe(Effect.provide(abrir()), Effect.scoped);

    yield* Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const rpc = yield* cliente(urlRpc, AUTORIZACAO);
      const estado = yield* rpc["atualizacao.estado"]({});
      assert.strictEqual(estado.base.versao, "2026.11.20");
      assert.strictEqual(estado.base.origem, "baixada");
      assert.strictEqual(estado.anterior, "2026.11.13");
      assert.deepStrictEqual(
        estado.novidades?.itens.map((item) => item.titulo),
        ["Resolução nova na base"],
      );
      // A leitura já responde da base nova (o MCP e o RPC abrem o mesmo arquivo).
      assert.strictEqual((yield* rpc["atualizacao.novidadesVistas"]({})).novidades, null);
    }).pipe(Effect.provide(abrir()), Effect.scoped);
  }).pipe(Effect.scoped),
);
