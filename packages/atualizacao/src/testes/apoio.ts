// @effect-diagnostics nodeBuiltinImport:off globalTimers:off -- testes: bancos de mentira, pastas temporárias e um servidor HTTP local
/**
 * Apoio dos testes: bancos com o `meta` da base, um par minisign descartável (gerado a cada execução,
 * nunca gravado no repositório) e um servidor HTTP local que serve uma pasta, com falhas sob pedido.
 */
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { VERSAO_ESQUEMA } from "@simplifica-if/kb/db/esquema";

const temporarios: string[] = [];

export function pastaTemporaria(prefixo = "simplifica-atualizacao-"): string {
  const pasta = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefixo));
  temporarios.push(pasta);
  return pasta;
}

export function limparTemporarios(): void {
  for (const pasta of temporarios.splice(0)) NodeFS.rmSync(pasta, { recursive: true, force: true });
}

/** Um `kb.sqlite` mínimo: `meta` como o da base e uma tabela com texto (para o patch ter o que reaproveitar). */
export function criarBanco(
  caminho: string,
  versao: string,
  opcoes: { readonly extra?: string; readonly esquema?: number } = {},
): string {
  NodeFS.mkdirSync(NodePath.dirname(caminho), { recursive: true });
  NodeFS.rmSync(caminho, { force: true });
  const db = new NodeSqlite.DatabaseSync(caminho);
  db.exec(
    "PRAGMA page_size = 4096; CREATE TABLE meta (chave TEXT PRIMARY KEY, valor TEXT); CREATE TABLE secoes (id INTEGER PRIMARY KEY, texto TEXT);",
  );
  const meta = db.prepare("INSERT INTO meta VALUES (?, ?)");
  meta.run("versao_esquema", String(opcoes.esquema ?? VERSAO_ESQUEMA));
  meta.run("data_referencia", versao.split(".").slice(0, 3).join("-"));
  meta.run("versao", versao);
  meta.run("commit", "abc1234");
  const secao = db.prepare("INSERT INTO secoes (texto) VALUES (?)");
  for (let i = 0; i < 2000; i += 1)
    secao.run(`Seção ${i}: o curso técnico observa a carga horária mínima do CNCT, item ${i * 7}.`);
  if (opcoes.extra !== undefined) secao.run(opcoes.extra);
  db.exec("VACUUM");
  db.close();
  return caminho;
}

export interface ServidorTeste {
  readonly url: string;
  readonly pedidos: string[];
  /** Caminhos (sem a barra inicial) cuja resposta cai no meio. */
  readonly cortar: Set<string>;
  /** Caminhos que respondem 404. */
  readonly sumir: Set<string>;
  fechar(): Promise<void>;
}

/** Serve `pasta` em 127.0.0.1, porta livre. */
export async function servirPasta(pasta: string): Promise<ServidorTeste> {
  const pedidos: string[] = [];
  const cortar = new Set<string>();
  const sumir = new Set<string>();
  const servidor = NodeHttp.createServer((pedido, resposta) => {
    const caminho = decodeURIComponent(new URL(pedido.url ?? "/", "http://x").pathname).replace(/^\/+/, "");
    pedidos.push(caminho);
    const arquivo = NodePath.join(pasta, ...caminho.split("/"));
    if (
      sumir.has(caminho) ||
      !arquivo.startsWith(pasta) ||
      !NodeFS.existsSync(arquivo) ||
      !NodeFS.statSync(arquivo).isFile()
    ) {
      resposta.writeHead(404).end();
      return;
    }
    const dados = NodeFS.readFileSync(arquivo);
    resposta.writeHead(200, { "content-length": String(dados.byteLength) });
    if (cortar.has(caminho)) {
      resposta.write(dados.subarray(0, Math.floor(dados.byteLength / 2)));
      setTimeout(() => pedido.socket.destroy(), 10);
      return;
    }
    resposta.end(dados);
  });
  await new Promise<void>((pronto) => servidor.listen(0, "127.0.0.1", pronto));
  const endereco = servidor.address() as { port: number };
  return {
    url: `http://127.0.0.1:${endereco.port}/`,
    pedidos,
    cortar,
    sumir,
    fechar: () =>
      new Promise((fim) => {
        servidor.closeAllConnections();
        servidor.close(() => fim());
      }),
  };
}
