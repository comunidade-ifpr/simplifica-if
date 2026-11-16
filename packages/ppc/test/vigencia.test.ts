// @effect-diagnostics nodeBuiltinImport:off -- o teste lê o registro de marcos da skill
/** A cópia dos marcos em `verificadores/vigencia.ts` bate com `marcos-normativos.json` da `revisar-ppc`, e a vigência na data. */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { raizRepositorio } from "@simplifica-if/kb/normas/registro";
import { describe, expect, test } from "vite-plus/test";
import { carregarVigencia, MARCOS, vigenciaPadrao } from "../src/verificadores/vigencia.ts";

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
    expect(vigenciaPadrao()("br/cne-ceb/res/2018/3").transicoes.map((t) => t.id)).toEqual(["dcnem-2024-art42"]);
  });
});
