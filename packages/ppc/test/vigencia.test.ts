// @effect-diagnostics nodeBuiltinImport:off -- o teste lê o registro de marcos da skill
/** A cópia dos marcos em `verificadores/vigencia.ts` bate com `marcos-normativos.json` da `revisar-ppc`, e a vigência na data. */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { raizRepositorio } from "@simplifica-if/kb/caminhos";
import { describe, expect, test } from "vite-plus/test";
import { carregarRegistro } from "@simplifica-if/kb/normas/registro";
import { carregarRelacoes } from "@simplifica-if/kb/normas/relacoes";
import { preConferir } from "../src/pre-conferencia.ts";
import { MARCOS, revogacaoRecente } from "../src/verificadores/vigencia.ts";
import { carregarVigencia } from "../scripts/base-tecnica.ts";

describe("marcos e vigência", () => {
  test("MARCOS é a cópia de linha e ficha responsável de marcos-normativos.json", () => {
    const arquivo = NodePath.join(raizRepositorio(), ".agents/skills/revisar-ppc/base-analise/marcos-normativos.json");
    const { marcos } = JSON.parse(NodeFS.readFileSync(arquivo, "utf8")) as {
      marcos: { id: string; linha: string[]; fichas_responsaveis: string[] }[];
    };
    expect(MARCOS.map((m) => ({ id: m.id, linha: m.linha, responsavel: m.responsavel }))).toEqual(
      marcos.map((m) => ({ id: m.id, linha: m.linha, responsavel: m.fichas_responsaveis[0] })),
    );
  });

  test("data a confirmar: incerta perto da data, presumida passados 180 dias", () => {
    // A 54/2011 foi revogada pela 190/2024 (assinada em 30/04/2024, publicação não registrada).
    expect(carregarVigencia(raizRepositorio(), "2024-06-01")("ifpr/consup/res/2011/54").certo).toBe(false);
    expect(carregarVigencia(raizRepositorio(), "2026-11-13")("ifpr/consup/res/2011/54")).toMatchObject({
      status: "revogada",
      certo: true,
    });
    expect(carregarVigencia()("br/cne-ceb/res/2018/3").transicoes.map((t) => t.id)).toEqual(["dcnem-2024-art42"]);
  });

  test("revogação recente sem transição: data da revogação e a regra dos 12 meses", () => {
    const vigencia = carregarVigencia(raizRepositorio(), "2026-11-13");
    expect(vigencia.data).toBe("2026-11-13");
    expect(vigencia("ifpr/consup/res/2012/39")).toMatchObject({ status: "revogada", revogadaEm: "2026-02-04" });
    // Sem a data do PPC: recente (menos de 12 meses) basta; antiga, não.
    expect(revogacaoRecente("2026-02-04", null, "2026-11-13")).toBe(true);
    expect(revogacaoRecente("2025-10-01", null, "2026-11-13")).toBe(false);
    // Com a data do PPC: a revogação recente tem de ser posterior a ela (só o ano: o fim do ano).
    expect(revogacaoRecente("2026-02-04", "2024", "2026-11-13")).toBe(true);
    expect(revogacaoRecente("2026-02-04", "2026", "2026-11-13")).toBe(false);
    expect(revogacaoRecente("2026-02-04", "2026-01-10", "2026-11-13")).toBe(true);
    expect(revogacaoRecente(null, null, "2026-11-13")).toBe(false);
  });

  test("a CONSUP nº 39/2012 (revogada em 04/02/2026) num PPC de 2024 sai a conferir, com a data", () => {
    const markdown = "# PPC\n\n## 9 REFERÊNCIAS\n\nIFPR. Resolução CONSUP/IFPR nº 39, de 29 de novembro de 2012.\n";
    const base = {
      cnct: null,
      forma: "subsequente",
      registro: carregarRegistro(raizRepositorio()),
      relacoes: carregarRelacoes(raizRepositorio()),
    };
    const vigencia = carregarVigencia(raizRepositorio(), "2026-11-13");
    const apontamentos = (dataPpc: string | null) =>
      preConferir(markdown, { ...base, vigencia, dataPpc })
        .fichas.find((f) => f.ficha === "CT-SUP-12")!
        .apontamentos.filter((a) => a.mensagem.includes("39/2012"));
    expect(apontamentos("2024")[0]).toMatchObject({ estado: "a_conferir" });
    expect(apontamentos("2024")[0]!.mensagem).toMatch(/revogada em 04\/02\/2026 .* recomenda-se atualizar/);
    expect(apontamentos(null)[0]!.estado).toBe("a_conferir");
    // PPC escrito depois da revogação: a citação é pendência.
    expect(apontamentos("2026-06-01")[0]!.estado).toBe("nao_atende");
  });
});
