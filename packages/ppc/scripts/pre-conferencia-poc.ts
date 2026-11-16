// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off -- ferramenta de desenvolvimento da PoC, síncrona: arquivos, saída no console e relógio da rodada
/**
 * PoC da proposta C do M1.11 (ferramenta de desenvolvimento, não vai para o app).
 *
 *   node packages/ppc/scripts/pre-conferencia-poc.ts --base
 *     roda a pré-conferência sem IA em todos os PPCs técnicos da base e conta os achados por ficha;
 *   node packages/ppc/scripts/pre-conferencia-poc.ts --docx <PPC.docx> --cnct <slug> --forma <forma> --saida <PPC-comentado.docx>
 *     converte o DOCX, pré-confere e devolve o próprio DOCX com um comentário do Word por achado.
 *
 * Usa o `tmp/kb.sqlite` (compilado por `pnpm kb`) só para saber o CNCT e a forma de cada PPC da base.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeUtil from "node:util";
import { comentarDocx } from "@simplifica-if/docx/comentarios";
import { carregarRegistro, raizRepositorio } from "@simplifica-if/kb/normas/registro";
import { converterPpc } from "../src/conversao-docx/conversao.ts";
import { preConferir, type Achado, type CursoCnct } from "../src/pre-conferencia.ts";

const { values } = NodeUtil.parseArgs({
  options: {
    base: { type: "boolean" },
    docx: { type: "string" },
    cnct: { type: "string" },
    forma: { type: "string", default: "subsequente" },
    saida: { type: "string" },
  },
});
const raiz = raizRepositorio();
const registro = carregarRegistro(raiz);
const cnctPorSlug = (slug: string): CursoCnct =>
  JSON.parse(
    NodeFS.readFileSync(NodePath.join(raiz, "base-conhecimento/catalogos/cnct/cursos", `${slug}.json`), "utf8"),
  ) as CursoCnct;

if (values.base) {
  const banco = new NodeSqlite.DatabaseSync(NodePath.join(raiz, "tmp/kb.sqlite"), { readOnly: true });
  const linhas = banco
    .prepare(
      `select p.id, p.path, p.tipo_oferta, k.slug from ppcs p left join cursos c on c.ppc_id = p.id
       left join cnct k on k.id = c.cnct_id where p.nivel = 'médio' order by p.id`,
    )
    .all() as { id: string; path: string; tipo_oferta: string; slug: string | null }[];
  const porFicha = new Map<string, { pendencia: number; a_conferir: number; ppcs: Set<string> }>();
  const inicio = performance.now();
  let comAlgum = 0;
  for (const linha of linhas) {
    const markdown = NodeFS.readFileSync(NodePath.join(raiz, linha.path), "utf8");
    const achados = preConferir(markdown, {
      cnct: linha.slug ? cnctPorSlug(linha.slug) : null,
      forma: linha.tipo_oferta,
      registro,
    });
    if (achados.some((a) => a.estado === "pendencia")) comAlgum += 1;
    for (const achado of achados) {
      const rotulo = achado.ficha === "TRIAGEM" ? `TRIAGEM ${achado.fonte}` : achado.ficha;
      const item = porFicha.get(rotulo) ?? { pendencia: 0, a_conferir: 0, ppcs: new Set() };
      item[achado.estado] += 1;
      item.ppcs.add(linha.id);
      porFicha.set(rotulo, item);
    }
  }
  const ms = performance.now() - inicio;
  console.log(
    `${linhas.length} PPCs técnicos em ${(ms / 1000).toFixed(1)} s (${(ms / linhas.length).toFixed(0)} ms por PPC)`,
  );
  console.log(`PPCs com ao menos uma pendência segura: ${comAlgum}`);
  console.log("ficha | pendências | a conferir | PPCs");
  for (const [ficha, item] of [...porFicha].sort())
    console.log(`${ficha} | ${item.pendencia} | ${item.a_conferir} | ${item.ppcs.size}`);
} else if (values.docx && values.cnct && values.saida) {
  const bytes = new Uint8Array(NodeFS.readFileSync(values.docx));
  const conversao = converterPpc(bytes, values.docx, { agora: new Date() });
  const achados = preConferir(conversao.markdown, { cnct: cnctPorSlug(values.cnct), forma: values.forma, registro });
  const texto = (a: Achado) =>
    `${a.estado === "pendencia" ? "Pendência" : "A conferir"} (${a.ficha}): ${a.mensagem}\n\nFonte: ${a.fonte}. ` +
    "Revisão prévia do Simplifica IF; não substitui a análise da PROENS.";
  const resultado = comentarDocx(
    bytes,
    achados.map((a) => ({ trechos: a.trechos, texto: texto(a), noInicioSeAusente: true })),
    { data: new Date().toISOString() },
  );
  NodeFS.writeFileSync(values.saida, resultado.docx);
  console.log(
    JSON.stringify({ achados, ancoradas: resultado.ancoradas, naoAncoradas: resultado.naoAncoradas }, null, 2),
  );
} else {
  console.error("Uso: --base | --docx <arquivo> --cnct <slug> [--forma <forma>] --saida <arquivo>");
  process.exitCode = 2;
}
