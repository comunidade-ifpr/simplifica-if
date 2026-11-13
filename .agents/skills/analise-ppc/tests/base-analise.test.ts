import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { jsonIndentado, type ObjetoJson } from "@simplifica-if/kb/json";
import { lerJson, listarArquivos } from "../scripts/arquivos.ts";
import { type CaminhosAnalise, caminhosDaSkill, caminhosPadrao } from "../scripts/caminhos.ts";
import { escreverIndice, gerarIndice, indiceAtualizado } from "../scripts/indice-base.ts";
import { escreverMapa, gerarMapaFichas, mapaAtualizado } from "../scripts/mapa-fichas.ts";
import { validarBaseAnalise } from "../scripts/validacao-base.ts";

const caminhos = caminhosPadrao();
const RAIZ = path.resolve(caminhos.appDir, "../../..");
const ENTRYPOINT = path.join(caminhos.appDir, "scripts", "analise_ppc.ts");
const GERADO_EM = "2026-01-02T03:04:05+00:00";

const temporarios: string[] = [];
afterEach(() => {
  for (const dir of temporarios.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Cópia da base de análise e do registro de normas (manifesto, stubs, CNCT) num projeto temporário. */
function copiaDaBase(): CaminhosAnalise {
  const raiz = mkdtempSync(path.join(tmpdir(), "base-analise-"));
  temporarios.push(raiz);
  const app = path.join(raiz, "proj", ".agents", "skills", "analise-ppc");
  const base = path.join(raiz, "proj", "base-conhecimento");
  for (const relativo of ["manifest.json", "normas/stubs.yaml", "catalogos/cnct/index.json"]) {
    mkdirSync(path.dirname(path.join(base, relativo)), { recursive: true });
    cpSync(path.join(caminhos.baseConhecimentoDir, relativo), path.join(base, relativo));
  }
  cpSync(caminhos.baseAnaliseDir, path.join(app, "base-analise"), { recursive: true });
  return caminhosDaSkill(app);
}

function editarJson(arquivo: string, editar: (valor: ObjetoJson) => void): void {
  const valor = lerJson(arquivo) as ObjetoJson;
  editar(valor);
  writeFileSync(arquivo, jsonIndentado(valor), "utf-8");
}

describe("base de análise real", () => {
  test("é válida", () => {
    expect(validarBaseAnalise()).toEqual([]);
  });

  test("indice.json está atualizado", () => {
    const atual = readFileSync(caminhos.indicePath, "utf-8");
    const geradoEm = String((JSON.parse(atual) as ObjetoJson).gerado_em);
    expect(jsonIndentado(gerarIndice(geradoEm))).toBe(atual);
    expect(indiceAtualizado()).toBe(true);
  });

  test("mapa-fichas.md está atualizado", () => {
    expect(mapaAtualizado()).toBe(true);
  });

  test("fichas usam topicos_tematicos, sem o campo legado", () => {
    const topicos = new Set(
      ((lerJson(caminhos.topicosFichasPath) as ObjetoJson).topicos as ObjetoJson[]).map((topico) => String(topico.id)),
    );
    for (const arquivo of listarArquivos(caminhos.fichasDir, ".json")) {
      const ficha = lerJson(arquivo) as ObjetoJson;
      expect(ficha).not.toHaveProperty("secoes_preferenciais");
      const declarados = ficha.topicos_tematicos as string[];
      expect(declarados.length).toBeGreaterThan(0);
      for (const topico of declarados) expect(topicos.has(topico)).toBe(true);
      expect(["tematico", "multitematico", "transversal", "condicional"]).toContain(String(ficha.tipo_escopo));
      expect((ficha.ancoras_semanticas as string[]).length).toBeGreaterThan(0);
    }
  });
});

describe("validador em casos inválidos", () => {
  test("schema inválido da ficha, na ordem do schema", () => {
    const c = copiaDaBase();
    const arquivo = path.join(c.fichasDir, "ct-curr-01.json");
    editarJson(arquivo, (ficha) => {
      ficha.criticidade = "XX";
      ficha.evidencia_minima = 0;
      ficha.estados_permitidos = ["ATENDE", "FOO", 3];
      ficha.titulo = null;
      delete ficha.pergunta;
    });
    expect(validarBaseAnalise(c)).toEqual([
      `${arquivo}: $: campo obrigatório ausente: pergunta`,
      `${arquivo}: $.titulo: tipo null; esperado string`,
      `${arquivo}: $.criticidade: valor 'XX' fora do enum`,
      `${arquivo}: $.evidencia_minima: valor 0 menor que 1`,
      `${arquivo}: $.estados_permitidos[1]: valor 'FOO' fora do enum`,
      `${arquivo}: $.estados_permitidos[2]: tipo integer; esperado string`,
    ]);
  });

  test("anyOf e maximum no contrato de exemplo", () => {
    const c = copiaDaBase();
    const arquivo = path.join(c.contratosDir, "resposta_lote.exemplo.json");
    editarJson(arquivo, (contrato) => {
      const resultado = (contrato.resultados as ObjetoJson[])[0]!;
      resultado.confianca = 1.5;
      resultado.evidencias = [3, { secao: "x" }, "ok"];
    });
    expect(validarBaseAnalise(c)).toEqual([
      `${arquivo}: $.resultados[0].confianca: valor 1.5 maior que 1`,
      `${arquivo}: $.resultados[0].evidencias[0]: não corresponde a nenhuma alternativa de anyOf`,
      `${arquivo}: $.resultados[0].evidencias[1]: não corresponde a nenhuma alternativa de anyOf`,
    ]);
  });

  test("ficha duplicada", () => {
    const c = copiaDaBase();
    const copia = path.join(c.fichasDir, "ct-curr-99.json");
    cpSync(path.join(c.fichasDir, "ct-curr-01.json"), copia);
    expect(validarBaseAnalise(c)).toEqual([`${copia}: ficha duplicada: CT-CURR-01`]);
  });

  test("tópico desconhecido e legado na ficha", () => {
    const c = copiaDaBase();
    const arquivo = path.join(c.fichasDir, "ct-curr-03.json");
    editarJson(arquivo, (ficha) => {
      ficha.topicos_tematicos = [...(ficha.topicos_tematicos as string[]), "inexistente"];
      ficha.secoes_preferenciais = [];
    });
    const declarados = (lerJson(arquivo) as ObjetoJson).topicos_tematicos as string[];
    const esperados = declarados.filter((topico) => topico !== "inexistente").sort();
    expect(validarBaseAnalise(c)).toEqual([
      `${arquivo}: $: campo não permitido: secoes_preferenciais`,
      "CT-CURR-03: campo legado `secoes_preferenciais` não é aceito",
      "CT-CURR-03: tópicos desconhecidos: inexistente",
      `CT-CURR-03: topicos_tematicos divergente da taxonomia (ficha=['${[...declarados].sort().join("', '")}'], ` +
        `taxonomia=['${esperados.join("', '")}'])`,
    ]);
  });

  test("referência a norma revogada, substituída por marco, a dispositivo revogado e a ID inexistente", () => {
    const c = copiaDaBase();
    editarJson(path.join(c.fichasDir, "ct-sup-01.json"), (ficha) => {
      ficha.referencias_normativas = [
        { ref: "br/cne-cp/res/2021/1", dispositivo: "#art20", papel: "fundamento" },
        { ref: "br/cne-ceb/res/2012/2", papel: "fundamento" },
        { ref: "br/cne-ceb/res/2025/3", dispositivo: "#art6-iii", papel: "fundamento" },
        { ref: "br/cne-cp/res/2099/1", papel: "complementar" },
      ];
    });
    expect(validarBaseAnalise(c)).toEqual([
      "CT-SUP-01: `referencias_normativas[0]` cita norma revogada: Resolução CNE/CP nº 1/2021, art. 20 " +
        "(br/cne-cp/res/2021/1; veja `revogada_por` em base-conhecimento/normas/br/resolucoes/RESOLUCAO_CNE-CP_1-2021_dcnept.md; " +
        "atualize a ficha e base-analise/marcos-normativos.json)",
      "CT-SUP-01: `referencias_normativas[1]` cita norma substituída no marco dcnem: " +
        "Resolução CNE/CEB nº 2/2012 (br/cne-ceb/res/2012/2)",
      "CT-SUP-01: `referencias_normativas[2]` cita dispositivo revogado (marco eja): " +
        "Resolução CNE/CEB nº 3/2025, art. 6º, III",
      "CT-SUP-01: `referencias_normativas[3]` cita ID inexistente na base: br/cne-cp/res/2099/1 " +
        "(registre a norma em base-conhecimento/manifest.json ou em base-conhecimento/normas/stubs.yaml)",
    ]);
  });

  test("referência fora do contrato: ID em texto, dispositivo malformado, papel e campo desconhecidos", () => {
    const c = copiaDaBase();
    const arquivo = path.join(c.fichasDir, "ct-sup-01.json");
    editarJson(arquivo, (ficha) => {
      ficha.referencias_normativas = [
        "Resolução CNE/CP nº 2/2026, art. 38",
        { ref: "Resolução CNE/CP nº 2/2026", papel: "fundamento" },
        { ref: "br/cne-cp/res/2026/2", dispositivo: "#art38º", papel: "fundamento" },
        { ref: "br/cne-cp/res/2026/2", dispositivo: "art. 38", papel: "principal", fonte: "x" },
        { ref: "br/lei/1996/9394~compilacao", papel: "fundamento", nota: "" },
      ];
    });
    expect(validarBaseAnalise(c)).toEqual([
      `${arquivo}: $.referencias_normativas[0]: tipo string; esperado object`,
      `${arquivo}: $.referencias_normativas[1].ref: valor 'Resolução CNE/CP nº 2/2026' fora do formato`,
      `${arquivo}: $.referencias_normativas[2].dispositivo: valor '#art38º' fora do formato`,
      `${arquivo}: $.referencias_normativas[3]: campo não permitido: fonte`,
      `${arquivo}: $.referencias_normativas[3].dispositivo: valor 'art. 38' fora do formato`,
      `${arquivo}: $.referencias_normativas[3].papel: valor 'principal' fora do enum`,
      `${arquivo}: $.referencias_normativas[4].ref: valor 'br/lei/1996/9394~compilacao' fora do formato`,
      `${arquivo}: $.referencias_normativas[4].nota: valor '' menor que o tamanho mínimo 1`,
    ]);
  });

  test("schema gerado desatualizado em relação ao zod", () => {
    const c = copiaDaBase();
    editarJson(path.join(c.schemasDir, "ficha.schema.json"), (schema) => {
      schema.title = "Editado à mão";
    });
    expect(validarBaseAnalise(c)).toEqual([
      `${path.join(c.schemasDir, "ficha.schema.json")}: diverge do schema zod de scripts/esquemas.ts; ` +
        "rode `analise_ppc.ts gerar-schemas`",
    ]);
  });

  test("marco com ficha desconhecida", () => {
    const c = copiaDaBase();
    editarJson(c.marcosNormativosPath, (registro) => {
      (registro.marcos as ObjetoJson[])[0]!.fichas_base_legal = ["CT-INEXISTENTE", "CT-SUP-12"];
    });
    expect(validarBaseAnalise(c)).toEqual([
      `${c.marcosNormativosPath}: marco dcn_ept: \`fichas_base_legal\` cita ficha desconhecida: CT-INEXISTENTE`,
    ]);
  });

  test("manifesto de normas ausente", () => {
    const c = copiaDaBase();
    unlinkSync(c.manifestNormasPath);
    expect(validarBaseAnalise(c)).toEqual([
      `${c.manifestNormasPath}: manifesto de normas não encontrado; checagem de vigência não executada`,
    ]);
  });
});

describe("índice e mapa", () => {
  test("são determinísticos com gerado_em fixo e detectam desatualização", () => {
    const c = copiaDaBase();
    escreverIndice(c, GERADO_EM);
    escreverMapa(c, GERADO_EM);
    expect(indiceAtualizado(c)).toBe(true);
    expect(mapaAtualizado(c)).toBe(true);
    expect(readFileSync(c.mapaFichasPath, "utf-8")).toContain(`Gerado em: ${GERADO_EM}\n`);
    expect((lerJson(c.indicePath) as ObjetoJson).gerado_em).toBe(GERADO_EM);
    expect(gerarMapaFichas(GERADO_EM, c)).toBe(readFileSync(c.mapaFichasPath, "utf-8"));

    editarJson(path.join(c.fichasDir, "ct-curr-01.json"), (ficha) => {
      ficha.titulo = "Título alterado";
    });
    expect(indiceAtualizado(c)).toBe(false);
    expect(mapaAtualizado(c)).toBe(false);
  });

  test("gerado_em padrão usa UTC com +00:00", () => {
    expect(String(gerarIndice(undefined, caminhos).gerado_em)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/);
  });
});

describe("entrypoint analise_ppc.ts", () => {
  function executar(...argumentos: string[]) {
    const processo = Bun.spawnSync(["bun", "run", ENTRYPOINT, ...argumentos], { cwd: RAIZ });
    return { codigo: processo.exitCode, saida: processo.stdout.toString(), erro: processo.stderr.toString() };
  }

  test("validar-base, gerar-schemas --check, gerar-indice --check e gerar-mapa --check passam na base real", () => {
    expect(executar("validar-base")).toMatchObject({ codigo: 0, saida: "Base de análise válida.\n" });
    expect(executar("gerar-schemas", "--check")).toMatchObject({ codigo: 0, saida: `OK: ${caminhos.schemasDir}\n` });
    expect(executar("gerar-indice", "--check")).toMatchObject({ codigo: 0, saida: `OK: ${caminhos.indicePath}\n` });
    expect(executar("gerar-mapa", "--check")).toMatchObject({ codigo: 0, saida: `OK: ${caminhos.mapaFichasPath}\n` });
  });

  test("gerar-relatorio-html ainda é delegado ao Python com argumentos e código de saída", () => {
    const ajuda = executar("gerar-relatorio-html", "--help");
    expect(ajuda.codigo).toBe(0);
    expect(ajuda.saida).toContain("analise_ppc.py gerar-relatorio-html");
    const semArgumento = executar("gerar-relatorio-html");
    expect(semArgumento.codigo).toBe(2);
    expect(semArgumento.erro).toContain("--rodada-dir");
  });

  test("subcomandos em TypeScript exigem as opções obrigatórias", () => {
    for (const subcomando of ["validar-resultados", "montar-grupos-subagents", "montar-grupo-avulso"]) {
      const resultado = executar(subcomando);
      expect(resultado.codigo).not.toBe(0);
      expect(resultado.erro).toContain("--rodada-dir");
    }
  });
});
