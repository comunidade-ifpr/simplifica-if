// @effect-diagnostics nodeBuiltinImport:off -- os testes copiam a base para diretórios temporários e chamam a CLI por processo
import { afterEach, describe, expect, test } from "vite-plus/test";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { jsonIndentado, type ObjetoJson } from "@simplifica-if/kb/json";
import { lerJson, listarArquivos } from "../scripts/arquivos.ts";
import { type CaminhosAnalise, caminhosDaSkill, caminhosPadrao } from "../scripts/caminhos.ts";
import { escreverIndice, gerarIndice, indiceAtualizado } from "../scripts/indice-base.ts";
import { escreverMapa, gerarMapaFichas, mapaAtualizado } from "../scripts/mapa-fichas.ts";
import { validarBaseAnalise, validarTopicosSecoes } from "../scripts/validacao-base.ts";

const caminhos = caminhosPadrao();
const RAIZ = NodePath.resolve(caminhos.appDir, "../../..");
const ENTRYPOINT = NodePath.join(caminhos.appDir, "scripts", "revisar_ppc.ts");
const GERADO_EM = "2026-01-02T03:04:05+00:00";

const temporarios: string[] = [];
afterEach(() => {
  for (const dir of temporarios.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});

/** Cópia da base de análise e do registro de normas (manifesto, stubs, CNCT) num projeto temporário. */
function copiaDaBase(): CaminhosAnalise {
  const raiz = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "base-analise-"));
  temporarios.push(raiz);
  const app = NodePath.join(raiz, "proj", ".agents", "skills", "revisar-ppc");
  const base = NodePath.join(raiz, "proj", "base-conhecimento");
  for (const relativo of ["manifest.json", "normas/stubs.yaml", "catalogos/cnct/index.json"]) {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(base, relativo)), { recursive: true });
    NodeFS.cpSync(NodePath.join(caminhos.baseConhecimentoDir, relativo), NodePath.join(base, relativo));
  }
  NodeFS.cpSync(caminhos.baseAnaliseDir, NodePath.join(app, "base-analise"), { recursive: true });
  return caminhosDaSkill(app);
}

function editarJson(arquivo: string, editar: (valor: ObjetoJson) => void): void {
  const valor = lerJson(arquivo) as ObjetoJson;
  editar(valor);
  NodeFS.writeFileSync(arquivo, jsonIndentado(valor), "utf-8");
}

describe("base de análise real", () => {
  test("é válida", () => {
    expect(validarBaseAnalise()).toEqual([]);
  });

  test("indice.json está atualizado", () => {
    const atual = NodeFS.readFileSync(caminhos.indicePath, "utf-8");
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

describe("mapa tópico → tipos de seção do kb", () => {
  test("todo tópico da taxonomia tem entrada, e toda entrada é tópico", () => {
    const caminhos = caminhosPadrao();
    const topicos = (lerJson(caminhos.topicosFichasPath) as { topicos: { id: string }[] }).topicos.map((t) => t.id);
    expect(validarTopicosSecoes(new Set(topicos), caminhos)).toEqual([]);
    const erros = validarTopicosSecoes(new Set([...topicos.filter((id) => id !== "estagio"), "topico_novo"]), caminhos);
    expect(erros.some((erro) => erro.endsWith("tópico sem tipos de seção: topico_novo"))).toBe(true);
    expect(erros.some((erro) => erro.endsWith("tópico desconhecido: estagio"))).toBe(true);
  });
});

describe("validador em casos inválidos", () => {
  test("ficha fora do contrato, com o caminho de cada campo", () => {
    const c = copiaDaBase();
    const arquivo = NodePath.join(c.fichasDir, "ct-curr-01.json");
    editarJson(arquivo, (ficha) => {
      ficha.criticidade = "XX";
      ficha.evidencia_minima = 0;
      ficha.estados_permitidos = ["ATENDE", "FOO", 3];
      ficha.titulo = null;
      delete ficha.pergunta;
    });
    expect(validarBaseAnalise(c)).toEqual([
      `${arquivo}: $.titulo: esperava um texto`,
      `${arquivo}: $.criticidade: esperava um destes valores: "BLOQ", "OBRIG", "REC"`,
      `${arquivo}: $.pergunta: campo obrigatório ausente`,
      `${arquivo}: $.evidencia_minima: esperava um valor maior ou igual a 1`,
      `${arquivo}: $.estados_permitidos[1]: esperava um destes valores: "ATENDE", "NAO_ATENDE", "INCONCLUSIVO", "NAO_APLICAVEL"`,
      `${arquivo}: $.estados_permitidos[2]: esperava um destes valores: "ATENDE", "NAO_ATENDE", "INCONCLUSIVO", "NAO_APLICAVEL"`,
    ]);
  });

  test("evidência fora das alternativas e confiança acima de 1 no contrato de exemplo", () => {
    const c = copiaDaBase();
    const arquivo = NodePath.join(c.contratosDir, "resposta_lote.exemplo.json");
    editarJson(arquivo, (contrato) => {
      const resultado = (contrato.resultados as ObjetoJson[])[0]!;
      resultado.confianca = 1.5;
      resultado.evidencias = [3, { secao: 1 }, "ok"];
    });
    expect(validarBaseAnalise(c)).toEqual([
      `${arquivo}: $.resultados[0].confianca: esperava um valor menor ou igual a 1`,
      `${arquivo}: $.resultados[0].evidencias[0]: esperava um texto ou um objeto`,
      `${arquivo}: $.resultados[0].evidencias[1].secao: esperava um texto ou nulo`,
    ]);
  });

  test("ficha sem execucao, D sem verificador e verificador de ficha que não é D", () => {
    const c = copiaDaBase();
    const semExecucao = NodePath.join(c.fichasDir, "ct-curr-01.json");
    editarJson(semExecucao, (ficha) => void delete ficha.execucao);
    // CT-CURR-04 vira D sem verificador; CT-CURR-02, que tem verificador, vira J.
    editarJson(NodePath.join(c.fichasDir, "ct-curr-04.json"), (ficha) => {
      ficha.execucao = { modo: "D", justificativa: "teste" };
    });
    editarJson(NodePath.join(c.fichasDir, "ct-curr-02.json"), (ficha) => {
      ficha.execucao = { modo: "J", justificativa: "teste" };
    });
    expect(validarBaseAnalise(c)).toEqual([
      `${semExecucao}: $.execucao: campo obrigatório ausente`,
      "CT-CURR-04: execucao.modo D sem verificador registrado em packages/ppc/src/verificadores/registro.ts",
      "verificador d-carga-horaria-total: registrado para CT-CURR-02, que não é ficha D",
    ]);
  });

  test("ficha duplicada", () => {
    const c = copiaDaBase();
    const copia = NodePath.join(c.fichasDir, "ct-curr-99.json");
    NodeFS.cpSync(NodePath.join(c.fichasDir, "ct-curr-01.json"), copia);
    expect(validarBaseAnalise(c)).toEqual([`${copia}: ficha duplicada: CT-CURR-01`]);
  });

  test("tópico desconhecido e legado na ficha", () => {
    const c = copiaDaBase();
    const arquivo = NodePath.join(c.fichasDir, "ct-curr-03.json");
    editarJson(arquivo, (ficha) => {
      ficha.topicos_tematicos = [...(ficha.topicos_tematicos as string[]), "inexistente"];
      ficha.secoes_preferenciais = [];
    });
    const declarados = (lerJson(arquivo) as ObjetoJson).topicos_tematicos as string[];
    const esperados = declarados.filter((topico) => topico !== "inexistente").sort();
    expect(validarBaseAnalise(c)).toEqual([
      `${arquivo}: $.secoes_preferenciais: campo não permitido`,
      "CT-CURR-03: campo legado `secoes_preferenciais` não é aceito",
      "CT-CURR-03: tópicos desconhecidos: inexistente",
      `CT-CURR-03: topicos_tematicos divergente da taxonomia (ficha=['${[...declarados].sort().join("', '")}'], ` +
        `taxonomia=['${esperados.join("', '")}'])`,
    ]);
  });

  test("referência a norma revogada, substituída por marco, a dispositivo revogado e a ID inexistente", () => {
    const c = copiaDaBase();
    editarJson(NodePath.join(c.fichasDir, "ct-sup-01.json"), (ficha) => {
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
    const arquivo = NodePath.join(c.fichasDir, "ct-sup-01.json");
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
      `${arquivo}: $.referencias_normativas[0]: esperava um objeto`,
      `${arquivo}: $.referencias_normativas[1].ref: formato inválido`,
      `${arquivo}: $.referencias_normativas[2].dispositivo: formato inválido`,
      `${arquivo}: $.referencias_normativas[3].fonte: campo não permitido`,
      `${arquivo}: $.referencias_normativas[3].dispositivo: formato inválido`,
      `${arquivo}: $.referencias_normativas[3].papel: esperava um destes valores: "fundamento", "complementar"`,
      `${arquivo}: $.referencias_normativas[4].ref: formato inválido`,
      `${arquivo}: $.referencias_normativas[4].nota: não pode ser vazio`,
    ]);
  });

  test("schema gerado desatualizado em relação ao Effect Schema", () => {
    const c = copiaDaBase();
    editarJson(NodePath.join(c.schemasDir, "ficha.schema.json"), (schema) => {
      schema.title = "Editado à mão";
    });
    expect(validarBaseAnalise(c)).toEqual([
      `${NodePath.join(c.schemasDir, "ficha.schema.json")}: diverge do Effect Schema de scripts/esquemas.ts; ` +
        "rode `revisar_ppc.ts gerar-schemas`",
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
    NodeFS.unlinkSync(c.manifestNormasPath);
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
    expect(NodeFS.readFileSync(c.mapaFichasPath, "utf-8")).toContain(`Gerado em: ${GERADO_EM}\n`);
    expect((lerJson(c.indicePath) as ObjetoJson).gerado_em).toBe(GERADO_EM);
    expect(gerarMapaFichas(GERADO_EM, c)).toBe(NodeFS.readFileSync(c.mapaFichasPath, "utf-8"));

    editarJson(NodePath.join(c.fichasDir, "ct-curr-01.json"), (ficha) => {
      ficha.titulo = "Título alterado";
    });
    expect(indiceAtualizado(c)).toBe(false);
    expect(mapaAtualizado(c)).toBe(false);
  });

  test("gerado_em padrão usa UTC com +00:00", () => {
    expect(String(gerarIndice(undefined, caminhos).gerado_em)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/);
  });
});

describe("entrypoint revisar_ppc.ts", () => {
  function executar(...argumentos: string[]) {
    const processo = NodeChildProcess.spawnSync(process.execPath, [ENTRYPOINT, ...argumentos], {
      cwd: RAIZ,
      encoding: "utf-8",
    });
    return { codigo: processo.status, saida: processo.stdout, erro: processo.stderr };
  }

  test("validar-base, gerar-schemas --check, gerar-indice --check e gerar-mapa --check passam na base real", () => {
    expect(executar("validar-base")).toMatchObject({ codigo: 0, saida: "Base de análise válida.\n" });
    expect(executar("gerar-schemas", "--check")).toMatchObject({ codigo: 0, saida: `OK: ${caminhos.schemasDir}\n` });
    expect(executar("gerar-indice", "--check")).toMatchObject({ codigo: 0, saida: `OK: ${caminhos.indicePath}\n` });
    expect(executar("gerar-mapa", "--check")).toMatchObject({ codigo: 0, saida: `OK: ${caminhos.mapaFichasPath}\n` });
  });

  test("gerar-relatorio-html: opções da linha de comando", () => {
    const ajuda = executar("gerar-relatorio-html", "--help");
    expect(ajuda.codigo).toBe(0);
    for (const opcao of ["--rodada-dir", "--resultados", "--sem-surge", "--surge-domain"])
      expect(ajuda.saida).toContain(opcao);
  });

  test("subcomandos exigem as opções obrigatórias", () => {
    for (const subcomando of [
      "validar-resultados",
      "montar-grupos-subagents",
      "montar-grupo-avulso",
      "gerar-relatorio-html",
    ]) {
      const resultado = executar(subcomando);
      expect(resultado.codigo).not.toBe(0);
      expect(resultado.erro).toContain("--rodada-dir");
    }
  });
});
