// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off -- processo de teste: bloqueia o sistema de arquivos e imprime o resultado
/**
 * A revisão prévia como no app empacotado, sem o checkout (`revisao-ppc-base.test.ts` o roda num
 * processo à parte):
 *
 *   node apps/server/test/sem-repositorio.ts <kb.sqlite> <PPC.docx>
 *
 * Antes de carregar qualquer módulo do `kb` ou do `ppc`, a leitura das pastas de dados do repositório
 * (`base-conhecimento/`, `dados/`, `.agents/`, `tmp/`, `packages/kb/dados/`) passa a falhar. A base vem
 * só do `kb.sqlite` (fora do repositório). Imprime as pendências e o controle: a leitura do registro
 * de normas do checkout, que tem de esbarrar no bloqueio.
 */
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

const raiz = NodePath.resolve(import.meta.dirname, "../../..");
const [banco, docx] = process.argv.slice(2) as [string, string];
const leituras: string[] = [];

const bloqueado = (caminho: unknown) => {
  if (typeof caminho !== "string" && !(caminho instanceof URL)) return false;
  const absoluto = NodePath.resolve(caminho instanceof URL ? caminho.pathname : caminho);
  if (!absoluto.startsWith(`${raiz}/`)) return false;
  return /^\/(base-conhecimento|dados|\.agents|tmp)\/|^\/packages\/kb\/dados\//.test(absoluto.slice(raiz.length));
};
// O objeto CommonJS do `fs` aceita a troca; `syncBuiltinESMExports` a leva aos imports ESM.
const fs = NodeModule.createRequire(import.meta.url)("node:fs") as Record<string, (...args: unknown[]) => unknown>;
for (const nome of ["readFileSync", "existsSync", "readdirSync", "statSync", "lstatSync", "openSync"]) {
  const original = fs[nome]!;
  fs[nome] = (...args: unknown[]) => {
    if (bloqueado(args[0])) {
      leituras.push(String(args[0]));
      throw Object.assign(new Error(`sem o repositório: ${String(args[0])}`), { code: "ENOENT" });
    }
    return original(...args);
  };
}
NodeModule.syncBuiltinESMExports();

const Effect = await import("effect/Effect");
const Layers = await import("@simplifica-if/kb/layers");
const { montarBase } = await import("../src/revisao-ppc/RevisorPpc.ts");
const { revisarDocx } = await import("@simplifica-if/ppc/revisao-previa");
const { carregarRegistro } = await import("@simplifica-if/kb/normas/registro");

const base = await Effect.runPromise(montarBase.pipe(Effect.provide(Layers.layerSomenteLeitura({ caminho: banco }))));
const revisao = revisarDocx(new Uint8Array(NodeFS.readFileSync(docx)), "ppc.docx", base, {
  agora: new Date("2026-11-16T12:00:00Z"),
});
const leiturasDaRevisao = leituras.length;

// Controle: a leitura do registro do checkout prova que o bloqueio pega o que a revisão não leu.
let controle = "leu o checkout";
try {
  carregarRegistro();
} catch {
  controle = "bloqueado";
}

console.log(
  JSON.stringify({
    leiturasDaRevisao,
    controle,
    pendencias: revisao.pendencias.map((p) => ({ ficha: p.ficha, estado: p.estado, mensagem: p.mensagem })),
  }),
);
