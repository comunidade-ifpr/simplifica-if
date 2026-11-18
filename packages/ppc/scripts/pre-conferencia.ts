// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off -- ferramenta de desenvolvimento síncrona: arquivos, saída no console e relógio da rodada
/**
 * Pré-conferência sem IA (M1.11, etapa 2), ferramenta de desenvolvimento (não vai para o app).
 *
 *   node packages/ppc/scripts/pre-conferencia.ts --base
 *     roda os verificadores D nos PPCs técnicos da base e conta, por ficha, os estados e os PPCs
 *     com apontamento (a tabela de `PRECISAO.md`);
 *   node packages/ppc/scripts/pre-conferencia.ts --base --amostra CT-SUP-24 [--estado nao_atende] [--n 8]
 *     mostra uma amostra dos apontamentos da ficha, com o trecho, para conferir à mão (com
 *     `--evidencias`, os resultados `atende` e os trechos que os sustentam);
 *   node packages/ppc/scripts/pre-conferencia.ts --base --check   (--gravar para registrar)
 *     confere os números por ficha com os de `precisao-base.json` (fora do `pnpm test`: dependem da base);
 *   node packages/ppc/scripts/pre-conferencia.ts --docx <PPC.docx> --cnct <slug> --forma <forma> --saida <PPC-comentado.docx>
 *     converte o DOCX, pré-confere e devolve o próprio DOCX com um comentário do Word por apontamento.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { comentarDocx } from "@simplifica-if/docx/comentarios";
import { raizRepositorio } from "@simplifica-if/kb/caminhos";
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
    evidencias: { type: "boolean" },
    check: { type: "boolean" },
    gravar: { type: "boolean" },
    n: { type: "string", default: "8" },
    deslocamento: { type: "string", default: "0" },
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
    resultado: preConferir(lerPpc(ppc), {
      ...comum,
      cnct: ppc.cnct,
      forma: ppc.forma,
      dataPpc: ppc.ano === null ? null : String(ppc.ano),
    }),
  }));
  const ms = performance.now() - inicio;
  if (values.amostra && values.evidencias) {
    // Evidências dos resultados `atende` (o que sustenta a afirmação), espalhadas pela lista.
    const itens = resultados.flatMap(({ ppc, resultado }) =>
      resultado.fichas.filter((f) => f.ficha === values.amostra && f.estado === "atende").map((f) => ({ ppc, f })),
    );
    const n = Number(values.n);
    const passo = Math.max(1, Math.floor(itens.length / n));
    console.log(`${itens.length} resultados atende de ${values.amostra}`);
    const deslocamento = Number(values.deslocamento) % passo;
    for (const { ppc, f } of itens.filter((_, i) => i % passo === deslocamento).slice(0, n))
      console.log(
        `- ${ppc.id} (${ppc.forma}) | ${f.mensagem.slice(0, 120)}` +
          f.evidencias
            .slice(0, 2)
            .map((t) => `\n    L${t.linha} [${t.secao ?? "-"}]: ${t.texto.slice(0, 160)}`)
            .join(""),
      );
  } else if (values.amostra) {
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
    const deslocamento = Number(values.deslocamento) % passo;
    for (const item of itens.filter((_, i) => i % passo === deslocamento).slice(0, n))
      console.log(
        `- ${item.ppc} (${item.forma}) | ${item.estado} | ${item.mensagem.slice(0, 160)}` +
          item.trechos.map((t) => `\n    L${t.linha} [${t.secao ?? "-"}]: ${t.texto.slice(0, 140)}`).join(""),
      );
  } else if (values.check || values.gravar) {
    // Números agregados por ficha contra os registrados em `precisao-base.json` (a tabela de PRECISAO.md).
    const arquivo = NodePath.join(import.meta.dirname, "precisao-base.json");
    const atual = { ppcs: ppcs.length, fichas: contarPorFicha(resultados.map((r) => r.resultado)) };
    if (values.gravar) {
      NodeFS.writeFileSync(arquivo, `${JSON.stringify(atual, null, 2)}\n`);
      console.log(`gravado: ${arquivo}`);
    } else {
      const esperado = JSON.parse(NodeFS.readFileSync(arquivo, "utf8")) as typeof atual;
      const diferencas = Object.keys({ ...esperado.fichas, ...atual.fichas }).filter(
        (ficha) => JSON.stringify(esperado.fichas[ficha]) !== JSON.stringify(atual.fichas[ficha]),
      );
      if (esperado.ppcs !== atual.ppcs) console.log(`PPCs: registrado ${esperado.ppcs}, agora ${atual.ppcs}`);
      for (const ficha of diferencas)
        console.log(
          `${ficha}: registrado ${JSON.stringify(esperado.fichas[ficha])}\n  agora ${JSON.stringify(atual.fichas[ficha])}`,
        );
      if (diferencas.length || esperado.ppcs !== atual.ppcs) {
        console.log(
          "Os números mudaram: confira uma amostra (--amostra) e atualize PRECISAO.md e precisao-base.json (--gravar).",
        );
        process.exitCode = 1;
      } else console.log(`OK: ${atual.ppcs} PPCs, os números de PRECISAO.md`);
    }
  } else {
    console.log(
      `${ppcs.length} PPCs técnicos em ${(ms / 1000).toFixed(1)} s (${(ms / ppcs.length).toFixed(0)} ms por PPC)`,
    );
    console.log(
      "ficha | atende | não atende | a conferir | não se aplica | apontamentos nao_atende | apontamentos a_conferir",
    );
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
    `${i.estado === "nao_atende" ? "Pendência" : "A conferir"} (${i.fichas.join(", ")}): ${i.mensagem}\n\n` +
    `${i.fontes.length ? `Fonte: ${i.fontes.join(", ")}. ` : ""}Revisão prévia do Simplifica IF; não substitui a análise da PROENS.`;
  const comentado = comentarDocx(
    bytes,
    itens.map((i) => ({ trechos: i.trechos, texto: texto(i), noInicioSeAusente: true })),
    { data: new Date().toISOString(), autor: "Simplifica IF (revisão prévia)", iniciais: "SIF" },
  );
  NodeFS.writeFileSync(values.saida, comentado.docx);
  console.log(
    JSON.stringify({ resultado, ancoradas: comentado.ancoradas, naoAncoradas: comentado.naoAncoradas }, null, 2),
  );
} else {
  console.error(
    "Uso: --base [--amostra <ficha> [--estado <estado>] [--n <n>]] | --docx <arquivo> --cnct <slug> [--forma <forma>] --saida <arquivo>",
  );
  process.exitCode = 2;
}
