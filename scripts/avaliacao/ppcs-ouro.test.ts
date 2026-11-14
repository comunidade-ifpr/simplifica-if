import { describe, expect, test } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { carregarPpcOuro, DIR_AVALIACAO, RAIZ_REPOSITORIO } from "./carregar.ts";

const DIR_OURO = NodePath.join(DIR_AVALIACAO, "ppcs-ouro");
const DIR_FICHAS = NodePath.join(RAIZ_REPOSITORIO, ".agents", "skills", "revisar-ppc", "base-analise", "fichas");
const arquivos = NodeFS.readdirSync(DIR_OURO)
  .filter((nome) => nome.endsWith(".yaml"))
  .sort();

function idsFichas(): Set<string> {
  return new Set(
    NodeFS.readdirSync(DIR_FICHAS)
      .filter((nome) => /^ct-.*\.json$/u.test(nome))
      .map((nome) => (JSON.parse(NodeFS.readFileSync(NodePath.join(DIR_FICHAS, nome), "utf-8")) as { id: string }).id),
  );
}

function ler(relativo: string): string {
  return NodeFS.readFileSync(NodePath.join(RAIZ_REPOSITORIO, relativo), "utf-8");
}

describe("PPCs-ouro", () => {
  test("são três PPCs técnicos distintos", () => {
    expect(arquivos).toHaveLength(3);
    const ppcs = arquivos.map((nome) => carregarPpcOuro(NodePath.join(DIR_OURO, nome)).ppc);
    expect(new Set(ppcs).size).toBe(3);
  });

  test.each(arquivos)("%s: schema, fichas existentes e trechos literais", (nome) => {
    const ouro = carregarPpcOuro(NodePath.join(DIR_OURO, nome));
    expect(nome).toBe(`${ouro.ppc.slice("curso:".length).replace("/", "--")}.yaml`);
    expect(NodeFS.existsSync(NodePath.join(RAIZ_REPOSITORIO, ouro.arquivo))).toBe(true);
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
      const ouro = carregarPpcOuro(NodePath.join(DIR_OURO, nome));
      if (ouro.revisado_por === null) {
        expect(ouro.status).toBe("rascunho");
        expect(ouro.achados.every((achado) => achado.status === "rascunho")).toBe(true);
      }
    }
  });
});
