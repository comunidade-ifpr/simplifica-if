// @effect-diagnostics nodeBuiltinImport:off -- teste: canal gerado pela fábrica numa pasta temporária, servido em 127.0.0.1
/**
 * O `simplifica-mcp` fora do app com `--pasta-atualizacao` (M1.10): sem base instalada, baixa antes de
 * abrir; com a base instalada, baixa a nova em segundo plano e ela entra na abertura seguinte.
 */
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { gerarCanal } from "@simplifica-if/atualizacao/fabrica";
import { lerInfoBanco } from "@simplifica-if/atualizacao/local";
import { escreverChavePublica, gerarChaves } from "@simplifica-if/atualizacao/minisign";
import * as Effect from "effect/Effect";
import { prepararAtualizacao } from "../src/atualizacao.ts";
import { criarBancoFixture, diretorioTemporario, limparTemporarios } from "./fixture.ts";

afterEach(limparTemporarios);

const servir = (pasta: string) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const servidor = NodeHttp.createServer((pedido, resposta) => {
        const arquivo = NodePath.join(pasta, ...new URL(pedido.url ?? "/", "http://x").pathname.split("/"));
        if (!NodeFS.existsSync(arquivo)) return void resposta.writeHead(404).end();
        resposta.end(NodeFS.readFileSync(arquivo));
      });
      await new Promise<void>((pronto) => servidor.listen(0, "127.0.0.1", pronto));
      return { servidor, url: `http://127.0.0.1:${(servidor.address() as { port: number }).port}/` };
    }),
    ({ servidor }) => Effect.promise(() => new Promise<void>((fim) => servidor.close(() => fim()))),
  );

describe("simplifica-mcp com --pasta-atualizacao", () => {
  it.live("sem base: baixa antes de abrir; depois, a nova entra na abertura seguinte", () =>
    Effect.gen(function* () {
      const raiz = diretorioTemporario();
      const chave = gerarChaves();
      const publicar = (versao: string) => {
        const banco = criarBancoFixture({}, NodeFS.mkdtempSync(NodePath.join(raiz, "b-")));
        const db = new NodeSqlite.DatabaseSync(banco);
        db.prepare("INSERT OR REPLACE INTO meta (chave, valor) VALUES ('versao', ?)").run(versao);
        db.close();
        gerarCanal({
          saida: NodePath.join(raiz, "servido", "beta"),
          canal: "beta",
          commit: "c",
          dataCommit: "2026-11-20T12:00:00Z",
          banco,
          appMinimo: "0.0.1",
          chave,
          nivel: 3,
        });
      };
      publicar("2026.11.20");
      const { url } = yield* servir(NodePath.join(raiz, "servido"));
      const opcoes = {
        pasta: NodePath.join(raiz, "pasta"),
        banco: undefined,
        feed: `${url}{canal}/`,
        chave: escreverChavePublica(chave),
        canal: "beta" as const,
      };
      const primeira = yield* prepararAtualizacao(opcoes);
      expect(lerInfoBanco(primeira.banco)?.versao).toBe("2026.11.20");
      publicar("2026.11.21");
      yield* primeira.umaVez;
      const segunda = yield* prepararAtualizacao(opcoes);
      expect(lerInfoBanco(segunda.banco)?.versao).toBe("2026.11.21");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
