// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off -- ferramenta de desenvolvimento síncrona: arquivos, saída no console e relógio da rodada
/**
 * Pré-conferência sem IA (M1.11, etapa 2), ferramenta de desenvolvimento (não vai para o app).
 *
 *   node packages/ppc/scripts/pre-conferencia.ts --base
 *     roda os verificadores D nos PPCs técnicos da base e conta, por ficha, os estados e os PPCs
 *     com apontamento (a tabela de `PRECISAO.md`);
 *   node packages/ppc/scripts/pre-conferencia.ts --base --amostra CT-SUP-24 [--estado nao_atende] [--n 8]
 *     mostra uma amostra dos apontamentos da ficha, com o trecho, para conferir à mão;
 *   node packages/ppc/scripts/pre-conferencia.ts --docx <PPC.docx> --cnct <slug> --forma <forma> --saida <PPC-comentado.docx>
 *     converte o DOCX, pré-confere e devolve o próprio DOCX com um comentário do Word por apontamento.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { comentarDocx } from "@simplifica-if/docx/comentarios";
import { raizRepositorio } from "@simplifica-if/kb/normas/registro";
import { converterPpc } from "../src/conversao-docx/conversao.ts";
import { achadosParaComentarios, preConferir } from "../src/pre-conferencia.ts";
import type { CursoCnct } from "../src/verificadores/comum.ts";
import { baseComum, lerPpc, ppcsTecnicos } from "./base-tecnica.ts";
import { contarPorFicha } from "./precisao.ts";

const { values } = NodeUtil.parseArgs({
  options: {
    base: { type: "boolean" },
    amostra: { type: "string" },
    estado: { type: "string" },
    n: { type: "string", default: "8" },
    docx: { type: "string" },
    cnct: { type: "string" },
    forma: { type: "string", default: "subsequente" },
    saida: { type: "string" },
  },
});
const raiz = raizRepositorio();
const comum = baseComum(raiz);

if (values.base) {
  const ppcs = ppcsTecnicos(raiz);
  const inicio = performance.now();
  const resultados = ppcs.map((ppc) => ({
    ppc,
    resultado: preConferir(lerPpc(ppc), { ...comum, cnct: ppc.cnct, forma: ppc.forma }),
  }));
  const ms = performance.now() - inicio;
  if (values.amostra) {
    const itens = resultados.flatMap(({ ppc, resultado }) =>
      resultado.fichas
        .filter((f) => f.ficha === values.amostra)
        .flatMap((f) =>
          f.apontamentos
            .filter((a) => !values.estado || a.estado === values.estado)
            .map((a) => ({ ppc: ppc.id, forma: ppc.forma, ...a })),
        ),
    );
    // Amostra espalhada pela lista (determinística), para não pegar só o começo do alfabeto.
    const n = Number(values.n);
    const passo = Math.max(1, Math.floor(itens.length / n));
    console.log(`${itens.length} apontamentos de ${values.amostra}${values.estado ? ` (${values.estado})` : ""}`);
    for (const item of itens.filter((_, i) => i % passo === 0).slice(0, n))
      console.log(
        `- ${item.ppc} (${item.forma}) | ${item.estado} | ${item.mensagem.slice(0, 160)}` +
          item.trechos.map((t) => `\n    L${t.linha} [${t.secao ?? "-"}]: ${t.texto.slice(0, 140)}`).join(""),
      );
  } else {
    console.log(`${ppcs.length} PPCs técnicos em ${(ms / 1000).toFixed(1)} s (${(ms / ppcs.length).toFixed(0)} ms por PPC)`);
    console.log("ficha | atende | não atende | a conferir | não se aplica | apontamentos nao_atende | apontamentos a_conferir");
    for (const [ficha, c] of Object.entries(contarPorFicha(resultados.map((r) => r.resultado))))
      console.log(
        `${ficha} | ${c.atende} | ${c.nao_atende} | ${c.a_conferir} | ${c.nao_se_aplica} | ${c.apontamentos_nao_atende} | ${c.apontamentos_a_conferir}`,
      );
  }
} else if (values.docx && values.cnct && values.saida) {
  const bytes = new Uint8Array(NodeFS.readFileSync(values.docx));
  const conversao = converterPpc(bytes, values.docx, { agora: new Date() });
  const cnct = {
    ...(JSON.parse(
      NodeFS.readFileSync(
        NodePath.join(raiz, "base-conhecimento/catalogos/cnct/cursos", `${values.cnct}.json`),
        "utf8",
      ),
    ) as object),
    slug: values.cnct,
  } as CursoCnct;
  const resultado = preConferir(conversao.markdown, { ...comum, cnct, forma: values.forma });
  const itens = achadosParaComentarios(resultado);
  const texto = (i: (typeof itens)[number]) =>
    `${i.estado === "nao_atende" ? "Pendência" : "A conferir"} (${i.ficha}): ${i.mensagem}\n\n` +
    `${i.fontes.length ? `Fonte: ${i.fontes.join(", ")}. ` : ""}Revisão prévia do Simplifica IF; não substitui a análise da PROENS.`;
  const comentado = comentarDocx(
    bytes,
    itens.map((i) => ({ trechos: i.trechos, texto: texto(i), noInicioSeAusente: true })),
    { data: new Date().toISOString() },
  );
  NodeFS.writeFileSync(values.saida, comentado.docx);
  console.log(JSON.stringify({ resultado, ancoradas: comentado.ancoradas, naoAncoradas: comentado.naoAncoradas }, null, 2));
} else {
  console.error(
    "Uso: --base [--amostra <ficha> [--estado <estado>] [--n <n>]] | --docx <arquivo> --cnct <slug> [--forma <forma>] --saida <arquivo>",
  );
  process.exitCode = 2;
}
