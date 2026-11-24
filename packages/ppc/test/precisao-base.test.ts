// @effect-diagnostics nodeBuiltinImport:off -- o teste confere que as fontes do CNCT existem nos arquivos
/**
 * Invariantes da pré-conferência nos PPCs técnicos da base, que valem com qualquer PPC, norma ou
 * relação nova: todo trecho é literal da linha; toda fonte resolve; nenhum `nao_atende` vem de
 * citação de confiança menor nem de norma com vigência a confirmar. Os números exatos por ficha
 * dependem da base e ficam fora do `pnpm test`: `node packages/ppc/scripts/pre-conferencia.ts --base
 * --check` (ver `PRECISAO.md`).
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { raizRepositorio } from "@simplifica-if/kb/caminhos";
import { type Citacao, extrairCitacoes } from "@simplifica-if/kb/normas/resolver";
import { describe, expect, test } from "vite-plus/test";
import { preConferir } from "../src/pre-conferencia.ts";
import { citacaoSegura } from "../src/verificadores/comum.ts";
import { verificacaoDaBase } from "../src/revisao-previa.ts";
import { carregarBaseRevisao, lerPpc, ppcsTecnicos } from "../scripts/base-tecnica.ts";

const FICHAS_DE_CITACAO = new Set(["CT-IDENT-08", "CT-SUP-09", "CT-SUP-12", "CT-SUP-24"]);

const raiz = raizRepositorio();
const base = await carregarBaseRevisao(raiz);

describe("pré-conferência nos PPCs técnicos da base: invariantes", () => {
  const ppcs = ppcsTecnicos(raiz, base.cncts);
  const comum = verificacaoDaBase(base);
  const resultados = ppcs.map((ppc) => {
    const markdown = lerPpc(ppc);
    return {
      markdown,
      resultado: preConferir(markdown, {
        ...comum,
        cnct: ppc.cnct,
        forma: ppc.forma,
        dataPpc: ppc.ano === null ? null : String(ppc.ano),
      }),
    };
  });
  const apontamentos = resultados.flatMap(({ markdown, resultado }) =>
    resultado.fichas.flatMap((f) => f.apontamentos.map((a) => ({ markdown, ficha: f.ficha, ...a }))),
  );

  const citacoes = new Map<string, Citacao[]>();
  /** Citações resolvidas do PPC, pelo mesmo extrator dos verificadores. */
  const citacoesDoPpc = (markdown: string) => {
    if (!citacoes.has(markdown)) citacoes.set(markdown, extrairCitacoes(markdown, comum.registro));
    return citacoes.get(markdown)!;
  };

  test("há PPCs técnicos e um resultado por ficha D em cada um", () => {
    expect(ppcs.length).toBeGreaterThan(50);
    for (const { resultado } of resultados) expect(resultado.fichas).toHaveLength(12);
  });

  test("todo trecho apontado ou de evidência é literal da linha", () => {
    for (const { markdown, resultado } of resultados) {
      const linhas = markdown.split("\n");
      for (const ficha of resultado.fichas)
        for (const t of [...ficha.apontamentos.flatMap((a) => a.trechos), ...ficha.evidencias])
          expect(linhas[t.linha - 1]).toContain(t.texto);
    }
  });

  test("toda fonte resolve: norma no registro, curso no CNCT", () => {
    const fontes = new Set(resultados.flatMap(({ resultado }) => resultado.fichas.flatMap((f) => f.fontes)));
    for (const fonte of fontes) {
      const [, tipo, id] = /^ifpr:\/\/(norma|cnct)\/([^#]+)/.exec(fonte) ?? [];
      if (tipo === "norma") expect(comum.registro.obter(id!), fonte).toBeDefined();
      else if (tipo === "cnct")
        expect(
          NodeFS.existsSync(NodePath.join(raiz, "base-conhecimento/catalogos/cnct/cursos", `${id}.json`)),
          fonte,
        ).toBe(true);
      else throw new Error(`fonte fora do formato: ${fonte}`);
    }
  });

  test("nenhum nao_atende de norma ainda não vigente ou de citação de confiança menor", () => {
    for (const a of apontamentos.filter((a) => a.estado === "nao_atende")) {
      const norma = /^ifpr:\/\/norma\/([^#]+)$/.exec(a.fontes[0] ?? "")?.[1];
      if (!norma) continue;
      expect(comum.vigencia(norma).status, `${a.ficha}: ${a.mensagem}`).not.toBe("ainda-nao-vigente");
      const ids = new Set(a.fontes.map((f) => /^ifpr:\/\/norma\/([^#]+)$/.exec(f)?.[1]).filter(Boolean));
      // As regras que apontam citações: o trecho é a citação da norma, e ela tem de ser segura.
      if (!FICHAS_DE_CITACAO.has(a.ficha)) continue;
      for (const t of a.trechos) {
        const naLinha = citacoesDoPpc(a.markdown).filter((c) => c.linha === t.linha && c.id !== null && ids.has(c.id));
        expect(naLinha.some(citacaoSegura), `${a.ficha} L${t.linha}: ${t.texto}`).toBe(true);
      }
    }
  });
}, 120_000);
