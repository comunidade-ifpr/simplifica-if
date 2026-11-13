import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { carregarPpcOuro, DIR_AVALIACAO, RAIZ_REPOSITORIO } from "./carregar.ts";

const DIR_OURO = path.join(DIR_AVALIACAO, "ppcs-ouro");
const DIR_FICHAS = path.join(RAIZ_REPOSITORIO, ".agents", "skills", "analise-ppc", "base-analise", "fichas");
const arquivos = readdirSync(DIR_OURO)
  .filter((nome) => nome.endsWith(".yaml"))
  .sort();

function idsFichas(): Set<string> {
  return new Set(
    readdirSync(DIR_FICHAS)
      .filter((nome) => /^ct-.*\.json$/u.test(nome))
      .map((nome) => (JSON.parse(readFileSync(path.join(DIR_FICHAS, nome), "utf-8")) as { id: string }).id),
  );
}

function ler(relativo: string): string {
  return readFileSync(path.join(RAIZ_REPOSITORIO, relativo), "utf-8");
}

describe("PPCs-ouro", () => {
  test("são três PPCs técnicos distintos", () => {
    expect(arquivos).toHaveLength(3);
    const ppcs = arquivos.map((nome) => carregarPpcOuro(path.join(DIR_OURO, nome)).ppc);
    expect(new Set(ppcs).size).toBe(3);
  });

  test.each(arquivos)("%s: schema, fichas existentes e trechos literais", (nome) => {
    const ouro = carregarPpcOuro(path.join(DIR_OURO, nome));
    expect(nome).toBe(`${ouro.ppc.slice("curso:".length).replace("/", "--")}.yaml`);
    expect(existsSync(path.join(RAIZ_REPOSITORIO, ouro.arquivo))).toBe(true);
    const fichas = idsFichas();
    const texto = ler(ouro.arquivo);
    const problemas: string[] = [];
    const vistas = new Set<string>();
    for (const achado of ouro.achados) {
      if (!fichas.has(achado.ficha)) problemas.push(`ficha inexistente: ${achado.ficha}`);
      if (vistas.has(achado.ficha)) problemas.push(`ficha repetida: ${achado.ficha}`);
      vistas.add(achado.ficha);
      for (const evidencia of achado.evidencias) {
        if (!texto.includes(evidencia.trecho))
          problemas.push(`${achado.ficha}: trecho fora do PPC: ${evidencia.trecho}`);
      }
      for (const referencia of achado.referencias) {
        if (referencia.trecho && !ler(referencia.arquivo).includes(referencia.trecho)) {
          problemas.push(`${achado.ficha}: trecho fora de ${referencia.arquivo}: ${referencia.trecho}`);
        }
      }
    }
    expect(problemas).toEqual([]);
    expect(ouro.achados.length).toBeGreaterThanOrEqual(8);
  });

  test("enquanto não houver revisão humana, tudo fica como rascunho", () => {
    for (const nome of arquivos) {
      const ouro = carregarPpcOuro(path.join(DIR_OURO, nome));
      if (ouro.revisado_por === null) {
        expect(ouro.status).toBe("rascunho");
        expect(ouro.achados.every((achado) => achado.status === "rascunho")).toBe(true);
      }
    }
  });
});
