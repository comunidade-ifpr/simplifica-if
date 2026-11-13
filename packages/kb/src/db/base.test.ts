/**
 * O `kb.sqlite` compilado da base real (num diretório temporário): determinismo, recall da busca
 * de seções, coerência com os gabaritos da avaliação e literalidade das respostas. Compila duas
 * vezes (cerca de 6 s cada).
 */
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { lerSinonimos } from "../busca/sinonimos.ts";
import { avaliarBusca } from "../avaliacao/busca-secoes.ts";
import { raizRepositorio } from "../normas/registro.ts";
import { compilarBanco } from "./compilar.ts";
import { buscarNorma, buscarSecoes, divergenciasPpcSuap, listarCursos } from "./consultas.ts";
import { pacoteContexto } from "./pacote-contexto.ts";

const raiz = raizRepositorio();
const dir = mkdtempSync(path.join(tmpdir(), "kb-base-"));
const caminhoA = path.join(dir, "a.sqlite");
const caminhoB = path.join(dir, "b.sqlite");
let db: Database;

beforeAll(() => {
  compilarBanco({ raiz, destino: caminhoA });
  compilarBanco({ raiz, destino: caminhoB });
  db = new Database(caminhoA, { readonly: true, strict: true });
}, 120_000);

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const sha = (arquivo: string) => createHash("sha256").update(readFileSync(arquivo)).digest("hex");
const lerJson = (relativo: string) => JSON.parse(readFileSync(path.join(raiz, relativo), "utf-8"));

describe("kb.sqlite da base", () => {
  test("dois builds sobre as mesmas fontes dão o mesmo arquivo", () => {
    expect(sha(caminhoA)).toBe(sha(caminhoB));
  });

  test("recall@10 da busca de seções ≥ 0,8 (modo completo)", () => {
    const resultado = avaliarBusca(db, { lexico: lerSinonimos() });
    expect(resultado.consultas).toBeGreaterThanOrEqual(20);
    expect(resultado.recall.completo).toBeGreaterThanOrEqual(0.8);
  });

  test("cursos do eixo Informação e Comunicação no PS 2026 = gabarito da Q08", () => {
    const cursos = listarCursos(db, { eixo: "Informação e Comunicação", processo: "processo-seletivo-2026" });
    const campi = [...new Set(cursos.map((c) => `campus:${c.campus.id}`))].sort();
    expect(campi).toEqual(
      [...lerJson("avaliacao/gabaritos/q08-campi-eixo-informacao-comunicacao.json").esperado].sort(),
    );
  });

  test("PPCs que citam a Res. CNE/CP 1/2021 = gabarito da Q02", () => {
    const ppcs = (
      db.query("SELECT DISTINCT ppc_id FROM citacoes WHERE ato_id = ? ORDER BY ppc_id").all("br/cne-cp/res/2021/1") as {
        ppc_id: string;
      }[]
    ).map((l) => l.ppc_id.replace(/^ppc:/, ""));
    const gabarito = lerJson("avaliacao/gabaritos/q02-ppcs-citam-cne-cp-1-2021.json").esperado as string[];
    expect(ppcs.length).toBe(gabarito.length);
  });

  test("respostas trazem texto literal e proveniência", () => {
    const secoes = buscarSecoes(
      db,
      "acompanhamento de egressos",
      { cnct: "tecnico-em-informatica" },
      { lexico: lerSinonimos() },
    );
    expect(secoes.length).toBe(10);
    for (const s of secoes) {
      const linhas = readFileSync(path.join(raiz, s.path), "utf-8").split("\n");
      expect(s.trecho.length).toBeGreaterThan(0);
      for (const t of s.trecho) expect(linhas[t.linha - 1]).toBe(t.texto);
    }
    const [artigo] = buscarNorma(db, "Resolução CNE/CP nº 2/2026, art. 28");
    expect(artigo!.origem).toBe("citacao-resolvida");
    const linhasNorma = readFileSync(path.join(raiz, artigo!.bloco.path), "utf-8").split("\n");
    expect(linhasNorma[artigo!.bloco.linha_inicio - 1]).toContain("Art. 28");
    const { ppcs } = divergenciasPpcSuap(db, { nivel: "médio" });
    for (const p of ppcs) {
      for (const f of p.fatos.filter((x) => x.status_curadoria === "extraido")) {
        const linha = readFileSync(path.join(raiz, f.path), "utf-8").split("\n")[f.linha - 1]!;
        expect(linha).toContain(f.trecho_fonte);
      }
    }
  });

  test("pacote-contexto de uma ficha é menor que o PPC inteiro e traz o artigo citado", () => {
    const pacote = pacoteContexto(db, "CT-CURR-12", "curitiba/tecnico-em-enfermagem", { lexico: lerSinonimos(), raiz });
    expect(pacote.fichas_ids).toEqual(["CT-CURR-12"]);
    expect(pacote.tamanho.caracteres).toBeLessThan(pacote.tamanho.caracteres_ppc_inteiro);
    const dcn = pacote.normas.find((n) => n.ref === "br/cne-cp/res/2026/2");
    expect(dcn?.artigos.map((a) => a.artigo)).toEqual(["9", "28"]);
    expect(pacote.transicoes.map((t) => t.marco)).toContain("dcn_ept");
    expect(pacote.secoes.some((s) => s.tipo === "matriz_curricular")).toBe(true);
  });
});
