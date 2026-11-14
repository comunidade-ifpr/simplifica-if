import { describe, expect, test } from "vite-plus/test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  analisarNorma,
  carregarDispositivos,
  carregarEstruturas,
  dispositivosDoAto,
  indiceDispositivos,
  listarNormas,
  notasDoTexto,
  obterDispositivo,
  palavrasDosSegmentos,
} from "./estrutura.ts";
import { ehIdDispositivo } from "./ids.ts";
import { palavrasMarkdown, primeiraDivergencia } from "./markdown.ts";
import { carregarRegistro, raizRepositorio } from "./registro.ts";

const raiz = raizRepositorio();

describe("parser sintético", () => {
  const texto = [
    "---",
    "id: br/x/res/2020/1",
    "---",
    "",
    "## Resumo",
    "",
    "- resumo",
    "",
    "## Texto da norma",
    "",
    "O PRESIDENTE resolve:",
    "",
    "### CAPÍTULO I",
    "",
    "#### Art. 1º",
    "",
    "Caput do primeiro artigo:",
    "",
    "- **I –** inciso um; (Redação dada pela Lei nº 1, de 2020)",
    "- **II –** inciso dois:",
    "  - a) alínea a;",
    "    1. item um;",
    "- **III –** (Revogado pela Lei nº 2, de 2021)",
    "",
    "**§ 1º** Parágrafo um:",
    "",
    "- **I –** inciso do parágrafo.",
    "",
    "**Parágrafo único.** Só para testar a regra.",
    "",
    "#### Art. 36-A",
    "",
    "O art. 2º da Lei X passa a vigorar com a seguinte redação:",
    "",
    "> **Art. 2º** texto citado",
    ">",
    "> § 1º parágrafo citado",
    "",
    "Brasília, 1º de janeiro de 2020.",
    "",
    "FULANO DE TAL",
    "",
    "## Notas",
    "",
    "Nota editorial.",
  ].join("\n");
  const estrutura = analisarNorma(texto, { id: "br/x/res/2020/1", path: "normas/x.md" });
  const porId = new Map(estrutura.dispositivos.map((d) => [d.dispositivo, d]));

  test("IDs no formato do plano", () => {
    expect([...porId.keys()]).toEqual([
      "#art1",
      "#art1-i",
      "#art1-ii",
      "#art1-ii-al-a",
      "#art1-ii-al-a-item1",
      "#art1-iii",
      "#art1-par1",
      "#art1-par1-i",
      "#art1-parunico",
      "#art36A",
    ]);
    for (const id of porId.keys()) expect(ehIdDispositivo(id)).toBe(true);
  });

  test("caput herdado, notas, revogado e linhas", () => {
    const item = porId.get("#art1-ii-al-a-item1")!;
    expect(item.caput).toEqual(["Art. 1º Caput do primeiro artigo:", "II – inciso dois:", "a) alínea a;"]);
    expect(porId.get("#art1-i")!.notas).toEqual([{ tipo: "redacao", texto: "(Redação dada pela Lei nº 1, de 2020)" }]);
    expect(porId.get("#art1-iii")!.revogado).toBe(true);
    expect(porId.get("#art1-i")!.revogado).toBe(false);
    expect(porId.get("#art1")!.linha_inicio).toBe(15);
    expect(porId.get("#art1-par1")!.estrutura).toEqual(["CAPÍTULO I"]);
  });

  test("citação fica no artigo que altera; fecho e notas editoriais fora", () => {
    expect(porId.get("#art36A")!.texto).toContain("Art. 2º texto citado § 1º parágrafo citado");
    expect(porId.get("#art36A")!.texto).not.toContain("Brasília");
    const tipos = estrutura.segmentos.map((s) => s.tipo);
    expect(tipos).toContain("fecho");
    expect(tipos.at(-1)).toBe("editorial");
    expect(palavrasDosSegmentos(estrutura.segmentos)).toEqual(palavrasMarkdown(texto));
  });

  test("norma sem artigos é lida por seção", () => {
    const nt = analisarNorma("## Resumo\n\nx\n\n## Texto de referência\n\n> trecho\n\n## Observação\n\ny\n", {
      id: "ifpr/proens/nt/2025/1",
      path: "nt.md",
    });
    expect(nt.dispositivos.map((d) => d.dispositivo)).toEqual(["#secao1"]);
  });

  test("rótulo repetido antes de (Revogado) não esconde a revogação", () => {
    const ldb = obterDispositivo("br/lei/1996/9394#art36-par3", raiz)!;
    expect(String(ldb.texto).startsWith("§ 3o § 3º (Revogado).")).toBe(true);
    expect(ldb.revogado).toBe(true);
    const sintetico = analisarNorma(
      "## Texto da norma\n\n#### Art. 5º\n\nCaput.\n\n**§ 2o** § 2º (Revogado). (Redação dada pela Lei nº 9, de 2024)\n\n**§ 3o** § 3º do art. 4º continua.\n",
      { id: "br/x/res/2020/2", path: "x.md" },
    );
    const porDisp = new Map(sintetico.dispositivos.map((d) => [d.dispositivo, d]));
    expect(porDisp.get("#art5-par2")!.revogado).toBe(true);
    expect(porDisp.get("#art5-par3")!.revogado).toBe(false);
  });

  test("notas de redação", () => {
    expect(notasDoTexto("texto (Incluído pela Lei nº 13.415, de 2017) (Vide Decreto nº 1)").map((n) => n.tipo)).toEqual(
      ["inclusao", "vide"],
    );
  });
});

describe("normas da base", () => {
  const estruturas = carregarEstruturas(raiz);
  const arquivos = new Map(listarNormas(raiz).map((n) => [n.path, n.arquivo]));

  test("36 normas, nenhum problema de estrutura (só avisos)", () => {
    expect(estruturas.length).toBe(36);
    expect(estruturas.flatMap((e) => e.problemas.filter((p) => !p.startsWith("aviso:")))).toEqual([]);
  });

  for (const estrutura of estruturas) {
    test(`reconstituição: ${estrutura.path}`, () => {
      const texto = readFileSync(arquivos.get(estrutura.path)!, "utf-8");
      expect(primeiraDivergencia(palavrasMarkdown(texto), palavrasDosSegmentos(estrutura.segmentos))).toBeNull();
    });
  }

  test("IDs únicos e no formato canônico", () => {
    const todos = carregarDispositivos(raiz);
    expect(new Set(todos.map((d) => d.id)).size).toBe(todos.length);
    expect(todos.filter((d) => !ehIdDispositivo(d.dispositivo)).map((d) => d.id)).toEqual([]);
  });

  test("dispositivos conhecidos", () => {
    expect(String(obterDispositivo("br/cne-cp/res/2026/2#art71-parunico")?.texto).startsWith("Parágrafo único.")).toBe(
      true,
    );
    expect(String(obterDispositivo("br/cne-cp/res/2026/2#art28-xvi")?.caput[0]).startsWith("Art. 28")).toBe(true);
    expect(obterDispositivo("br/cne-cp/res/2026/2#art28-par1-iv")?.tipo).toBe("inciso");
    expect(obterDispositivo("br/lei/1996/9394#art36A")?.rotulo).toBe("Art. 36-A.");
    expect(obterDispositivo("br/lei/1996/9394#art26-par9B")?.tipo).toBe("paragrafo");
    expect(obterDispositivo("br/lei/1996/9394#art35A")?.revogado).toBe(true);
    expect(obterDispositivo("br/cne-ceb/res/2025/3#art6-iii")).toBeDefined();
    expect(obterDispositivo("ifpr/consup/res/2017/65#anexo1-art1")?.tipo).toBe("artigo");
  });

  test("compilação deduplica com o texto integral do ato", () => {
    const indice = indiceDispositivos(raiz);
    expect(indice.get("br/lei/1996/9394#art36B")?.norma).toBe("br/lei/1996/9394");
    const daCompilacao = carregarDispositivos(raiz).filter((d) => d.norma === "br/lei/1996/9394~compilacao");
    expect(daCompilacao.length).toBeGreaterThan(0);
    expect(
      daCompilacao.filter(
        (d) => !indice.has(`${d.ato}${d.dispositivo}`) || indice.get(`${d.ato}${d.dispositivo}`)!.norma !== d.ato,
      ),
    ).toEqual([]);
    expect(dispositivosDoAto("br/lei/1996/9394", raiz).every((d) => d.norma === "br/lei/1996/9394")).toBe(true);
  });

  test("100% dos dispositivos citados nas fichas e nos marcos existem (normas com texto na base)", () => {
    const indice = indiceDispositivos(raiz);
    const registro = carregarRegistro(raiz);
    const base = path.join(raiz, ".agents", "skills", "revisar-ppc", "base-analise");
    const citados: string[] = [];
    for (const nome of readdirSync(path.join(base, "fichas")).filter((n) => n.endsWith(".json"))) {
      const ficha = JSON.parse(readFileSync(path.join(base, "fichas", nome), "utf-8"));
      for (const ref of ficha.referencias_normativas ?? []) {
        if (ref.dispositivo && registro.situacao(ref.ref) === "base") citados.push(`${ref.ref}${ref.dispositivo}`);
      }
    }
    const marcos = JSON.parse(readFileSync(path.join(base, "marcos-normativos.json"), "utf-8"));
    for (const marco of marcos.marcos) {
      for (const id of marco.dispositivos_revogados ?? []) citados.push(id);
    }
    expect(citados.length).toBeGreaterThan(100);
    expect(citados.filter((id) => !indice.has(id))).toEqual([]);
  });
});
