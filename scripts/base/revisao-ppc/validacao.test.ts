// @effect-diagnostics nodeBuiltinImport:off -- os testes copiam a base para diretórios temporários
/**
 * Validação da base da revisão de PPC (`base-conhecimento/revisao-ppc/`): a base real é válida, e
 * cada desvio (ficha fora do contrato, tópico, execução, referência normativa, marco) é recusado
 * com a mensagem certa.
 */
import { afterEach, describe, expect, test } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { CAMINHOS } from "@simplifica-if/kb/caminhos";
import { jsonIndentado, type ObjetoJson } from "@simplifica-if/kb/json";
import { UniversoReferencias } from "@simplifica-if/kb/normas/referencia-estruturada";
import { type EntradaRegistro, Registro } from "@simplifica-if/kb/normas/registro";
import type { LinhaDerivada } from "@simplifica-if/kb/normas/vigencia";
import { type CaminhosRevisaoPpc, caminhosRevisaoPpc } from "./caminhos.ts";
import { type Derivacao, derivacaoPadrao } from "./marcos.ts";
import { carregarUniverso, referenciasLegiveisDaFicha } from "./referencias.ts";
import {
  carregarMarcos,
  type Ficha,
  lerJson,
  listarJson,
  validarMarcosNormativos,
  validarReferenciasFichas,
  validarRevisaoPpc,
  validarTopicosSecoes,
} from "./validacao.ts";

const caminhos = caminhosRevisaoPpc();
const derivarReal = derivacaoPadrao();

const temporarios: string[] = [];
afterEach(() => {
  for (const dir of temporarios.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});

/** Cópia da base da revisão e do registro de normas (normas, stubs, CNCT) num projeto temporário. */
function copiaDaBase(): CaminhosRevisaoPpc {
  const raiz = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "revisao-ppc-"));
  temporarios.push(raiz);
  for (const relativo of [
    CAMINHOS.normas,
    "base-conhecimento/catalogos/cnct/index.json",
    CAMINHOS.topicosSecoes,
    CAMINHOS.revisaoPpc,
  ]) {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(raiz, relativo)), { recursive: true });
    NodeFS.cpSync(NodePath.join(caminhos.raiz, relativo), NodePath.join(raiz, relativo), { recursive: true });
  }
  return caminhosRevisaoPpc(raiz);
}

const validar = (c: CaminhosRevisaoPpc) => validarRevisaoPpc(c, derivarReal);

function editarJson(arquivo: string, editar: (valor: ObjetoJson) => void): void {
  const valor = lerJson(arquivo) as ObjetoJson;
  editar(valor);
  NodeFS.writeFileSync(arquivo, jsonIndentado(valor), "utf-8");
}

describe("base da revisão de PPC real", () => {
  test("é válida", () => {
    expect(validarRevisaoPpc()).toEqual([]);
  });

  test("fichas usam topicos_tematicos, sem o campo legado", () => {
    const topicos = new Set(
      ((lerJson(caminhos.topicosFichas) as ObjetoJson).topicos as ObjetoJson[]).map((topico) => String(topico.id)),
    );
    for (const arquivo of listarJson(caminhos.fichas)) {
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
    const topicos = (lerJson(caminhos.topicosFichas) as { topicos: { id: string }[] }).topicos.map((t) => t.id);
    expect(validarTopicosSecoes(new Set(topicos), caminhos)).toEqual([]);
    const erros = validarTopicosSecoes(new Set([...topicos.filter((id) => id !== "estagio"), "topico_novo"]), caminhos);
    expect(erros.some((erro) => erro.endsWith("tópico sem tipos de seção: topico_novo"))).toBe(true);
    expect(erros.some((erro) => erro.endsWith("tópico desconhecido: estagio"))).toBe(true);
  });
});

describe("validador em casos inválidos", () => {
  test("ficha fora do contrato, com o caminho de cada campo", () => {
    const c = copiaDaBase();
    const arquivo = NodePath.join(c.fichas, "ct-curr-01.json");
    editarJson(arquivo, (ficha) => {
      ficha.criticidade = "XX";
      ficha.evidencia_minima = 0;
      ficha.estados_permitidos = ["ATENDE", "FOO", 3];
      ficha.titulo = null;
      delete ficha.pergunta;
    });
    expect(validar(c)).toEqual([
      `${arquivo}: $.titulo: esperava um texto`,
      `${arquivo}: $.criticidade: esperava um destes valores: "BLOQ", "OBRIG", "REC"`,
      `${arquivo}: $.pergunta: campo obrigatório ausente`,
      `${arquivo}: $.evidencia_minima: esperava um valor maior ou igual a 1`,
      `${arquivo}: $.estados_permitidos[1]: esperava um destes valores: "ATENDE", "NAO_ATENDE", "INCONCLUSIVO", "NAO_APLICAVEL"`,
      `${arquivo}: $.estados_permitidos[2]: esperava um destes valores: "ATENDE", "NAO_ATENDE", "INCONCLUSIVO", "NAO_APLICAVEL"`,
    ]);
  });

  test("ficha sem execucao, D sem verificador e verificador de ficha que não é D", () => {
    const c = copiaDaBase();
    const semExecucao = NodePath.join(c.fichas, "ct-curr-01.json");
    editarJson(semExecucao, (ficha) => void delete ficha.execucao);
    // CT-CURR-04 vira D sem verificador; CT-CURR-02, que tem verificador, vira J.
    editarJson(NodePath.join(c.fichas, "ct-curr-04.json"), (ficha) => {
      ficha.execucao = { modo: "D", justificativa: "teste" };
    });
    editarJson(NodePath.join(c.fichas, "ct-curr-02.json"), (ficha) => {
      ficha.execucao = { modo: "J", justificativa: "teste" };
    });
    expect(validar(c)).toEqual([
      `${semExecucao}: $.execucao: campo obrigatório ausente`,
      "CT-CURR-04: execucao.modo D sem verificador registrado em packages/ppc/src/verificadores/registro.ts",
      "verificador d-carga-horaria-total: registrado para CT-CURR-02, que não é ficha D",
    ]);
  });

  test("ficha duplicada", () => {
    const c = copiaDaBase();
    const copia = NodePath.join(c.fichas, "ct-curr-99.json");
    NodeFS.cpSync(NodePath.join(c.fichas, "ct-curr-01.json"), copia);
    expect(validar(c)).toEqual([`${copia}: ficha duplicada: CT-CURR-01`]);
  });

  test("tópico desconhecido e legado na ficha", () => {
    const c = copiaDaBase();
    const arquivo = NodePath.join(c.fichas, "ct-curr-03.json");
    editarJson(arquivo, (ficha) => {
      ficha.topicos_tematicos = [...(ficha.topicos_tematicos as string[]), "inexistente"];
      ficha.secoes_preferenciais = [];
    });
    const declarados = (lerJson(arquivo) as ObjetoJson).topicos_tematicos as string[];
    const esperados = declarados.filter((topico) => topico !== "inexistente").sort();
    expect(validar(c)).toEqual([
      `${arquivo}: $.secoes_preferenciais: campo não permitido`,
      "CT-CURR-03: campo legado `secoes_preferenciais` não é aceito",
      "CT-CURR-03: tópicos desconhecidos: inexistente",
      `CT-CURR-03: topicos_tematicos divergente da taxonomia (ficha=['${[...declarados].sort().join("', '")}'], ` +
        `taxonomia=['${esperados.join("', '")}'])`,
    ]);
  });

  test("referência a norma revogada, substituída por marco, a dispositivo revogado e a ID inexistente", () => {
    const c = copiaDaBase();
    editarJson(NodePath.join(c.fichas, "ct-sup-01.json"), (ficha) => {
      ficha.referencias_normativas = [
        { ref: "br/cne-cp/res/2021/1", dispositivo: "#art20", papel: "fundamento" },
        { ref: "br/cne-ceb/res/2012/2", papel: "fundamento" },
        { ref: "br/cne-ceb/res/2025/3", dispositivo: "#art6-iii", papel: "fundamento" },
        { ref: "br/cne-cp/res/2099/1", papel: "complementar" },
      ];
    });
    expect(validar(c)).toEqual([
      "CT-SUP-01: `referencias_normativas[0]` cita norma revogada: Resolução CNE/CP nº 1/2021, art. 20 " +
        "(br/cne-cp/res/2021/1; veja `revogada_por` em base-conhecimento/normas/br/resolucoes/RESOLUCAO_CNE-CP_1-2021_dcnept.md; " +
        "atualize a ficha e base-conhecimento/revisao-ppc/marcos-normativos.json)",
      "CT-SUP-01: `referencias_normativas[1]` cita norma substituída no marco dcnem: " +
        "Resolução CNE/CEB nº 2/2012 (br/cne-ceb/res/2012/2)",
      "CT-SUP-01: `referencias_normativas[2]` cita dispositivo revogado (marco eja): " +
        "Resolução CNE/CEB nº 3/2025, art. 6º, III",
      "CT-SUP-01: `referencias_normativas[3]` cita ID inexistente na base: br/cne-cp/res/2099/1 " +
        "(inclua a norma em base-conhecimento/normas/ ou registre-a em base-conhecimento/normas/stubs.yaml)",
    ]);
  });

  test("referência fora do contrato: ID em texto, dispositivo malformado, papel e campo desconhecidos", () => {
    const c = copiaDaBase();
    const arquivo = NodePath.join(c.fichas, "ct-sup-01.json");
    editarJson(arquivo, (ficha) => {
      ficha.referencias_normativas = [
        "Resolução CNE/CP nº 2/2026, art. 38",
        { ref: "Resolução CNE/CP nº 2/2026", papel: "fundamento" },
        { ref: "br/cne-cp/res/2026/2", dispositivo: "#art38º", papel: "fundamento" },
        { ref: "br/cne-cp/res/2026/2", dispositivo: "art. 38", papel: "principal", fonte: "x" },
        { ref: "br/lei/1996/9394~compilacao", papel: "fundamento", nota: "" },
      ];
    });
    expect(validar(c)).toEqual([
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

  test("marco com ficha desconhecida", () => {
    const c = copiaDaBase();
    editarJson(c.marcos, (registro) => {
      (registro.marcos as ObjetoJson[])[0]!.fichas_base_legal = ["CT-INEXISTENTE", "CT-SUP-12"];
    });
    expect(validar(c)).toEqual([
      `${c.marcos}: marco dcn_ept: \`fichas_base_legal\` cita ficha desconhecida: CT-INEXISTENTE`,
    ]);
  });

  test("pasta de normas ausente", () => {
    const c = copiaDaBase();
    NodeFS.rmSync(c.normas, { recursive: true });
    expect(validar(c)).toEqual([`${c.normas}: pasta de normas não encontrada; checagem de vigência não executada`]);
  });
});

const DCN_EPT_2026 = "br/cne-cp/res/2026/2";
const DCN_EPT_2021 = "br/cne-cp/res/2021/1";

function entrada(id: string, title: string, situacao: EntradaRegistro["situacao"], extra = {}): EntradaRegistro {
  return { id, title, situacao, aliases: [], ...extra };
}

const UNIVERSO_SINTETICO = new UniversoReferencias(
  new Registro([
    entrada(DCN_EPT_2021, "Resolução CNE/CP nº 1/2021", "base", {
      status_vigencia: "revogada",
      path: "normas/br/resolucoes/RESOLUCAO_CNE-CP_1-2021_dcnept.md",
    }),
    entrada(DCN_EPT_2026, "Resolução CNE/CP nº 2/2026", "base", { status_vigencia: "vigente", path: "normas/x.md" }),
    entrada("br/cne-ceb/res/2025/3", "Resolução CNE/CEB nº 3/2025", "base", {
      status_vigencia: "parcialmente revogada",
      path: "normas/y.md",
    }),
    entrada("br/cne-cp/res/2022/1", "Resolução CNE/CP nº 1/2022", "stub", {
      status_vigencia: "revogada",
      status_fonte: "br/cne-cp/res/2026/2#art74-iii",
    }),
    entrada("br/cne-ceb/res/2012/6", "Resolução CNE/CEB nº 6/2012", "stub", { status_vigencia: "a confirmar" }),
    entrada("br/lei/1996/9394", "Lei nº 9.394/1996", "base", { status_vigencia: "alterada", path: "normas/z.md" }),
    entrada("externo:abnt/nbr/6023", "ABNT NBR 6023", "externo"),
  ]),
  new Map([["tecnico-em-informatica", "Técnico em Informática"]]),
);

const MARCOS_SINTETICOS = [
  {
    id: "dcn_ept",
    substitui: [DCN_EPT_2021, "br/cne-cp/res/2022/1"],
    antecessoras_historicas: ["br/cne-ceb/res/2012/6"],
    dispositivos_revogados: ["br/cne-ceb/res/2025/3#art6-iii"],
  },
];

function fichasReais(): Map<string, Ficha> {
  const fichas = new Map<string, Ficha>();
  for (const arquivo of listarJson(caminhos.fichas)) {
    const ficha = lerJson(arquivo) as Ficha;
    fichas.set(String(ficha.id), ficha);
  }
  return fichas;
}

function texto(ficha: Ficha | undefined): string {
  return ["pergunta", "rubrica", "boa_evidencia", "ma_evidencia", "escalonar_quando"]
    .map((campo) => String(ficha?.[campo] ?? ""))
    .join(" ");
}

function marcoValido(sobrescritas: ObjetoJson = {}): ObjetoJson {
  return {
    id: "dcn_ept",
    tema: "DCN da EPT",
    linha: [DCN_EPT_2021, DCN_EPT_2026],
    aplica_a: "Cursos técnicos.",
    fichas_responsaveis: ["CT-SUP-12"],
    fichas_base_legal: ["CT-SUP-12"],
    transicao: "",
    orientacao_analise: "Teste.",
    ...sobrescritas,
  };
}

/** Derivação sintética: o resultado depende só do último ato da linha. */
const DERIVACOES: Record<string, LinhaDerivada> = {
  [DCN_EPT_2026]: {
    vigente: DCN_EPT_2026,
    substitui: [DCN_EPT_2021],
    antecessoras_historicas: [],
    dispositivos_revogados: [],
  },
  [DCN_EPT_2021]: {
    vigente: DCN_EPT_2021,
    substitui: [DCN_EPT_2026, "br/cne-cp/res/2099/9"],
    antecessoras_historicas: [],
    dispositivos_revogados: ["br/cne-ceb/res/2099/3#art6-iii"],
  },
  "br/cne-cp/res/1999/9": {
    vigente: "br/cne-cp/res/1999/9",
    substitui: [],
    antecessoras_historicas: [],
    dispositivos_revogados: [],
  },
  "br/cne-ceb/res/2012/6": {
    vigente: "br/cne-ceb/res/2012/6",
    substitui: [],
    antecessoras_historicas: [],
    dispositivos_revogados: [],
  },
};
const derivarSintetico: Derivacao = (linha) => {
  const derivado = DERIVACOES[linha.at(-1)!];
  if (!derivado) throw new Error(`linha normativa sem derivação: ${linha.join(", ")}`);
  return derivado;
};

function gravarMarcos(...marcos: ObjetoJson[]): string {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "marcos-"));
  temporarios.push(dir);
  const arquivo = NodePath.join(dir, "marcos.json");
  NodeFS.writeFileSync(arquivo, JSON.stringify({ versao: 3, descricao: "teste", marcos }), "utf-8");
  return arquivo;
}

function ref(id: string, dispositivo?: string, papel = "fundamento"): ObjetoJson {
  return dispositivo === undefined ? { ref: id, papel } : { ref: id, dispositivo, papel };
}

describe("referências das fichas", () => {
  test("aponta ID inexistente, norma revogada, norma substituída, dispositivo revogado e repetição", () => {
    const fichas = new Map<string, Ficha>([
      ["CT-X-01", { referencias_normativas: [ref(DCN_EPT_2021, "#art20")] }],
      ["CT-X-02", { referencias_normativas: [ref(DCN_EPT_2026, "#art29"), ref("br/cne-ceb/res/2025/3", "#art5")] }],
      ["CT-X-03", { referencias_normativas: [ref("br/cne-cp/res/2022/1")] }],
      [
        "CT-X-04",
        {
          referencias_normativas: [
            ref("br/cne-ceb/res/2025/3", "#art6-iii"),
            ref("br/cne-ceb/res/2025/3", "#art6-iii-al-a"),
          ],
        },
      ],
      ["CT-X-05", { referencias_normativas: [ref("br/cne-ceb/res/2012/6")] }],
      ["CT-X-06", { referencias_normativas: [ref("br/cne-cp/res/2099/9"), ref("cnct:tecnico-em-nada")] }],
      [
        "CT-X-07",
        {
          referencias_normativas: [
            ref("cnct:catalogo"),
            ref("cnct:tecnico-em-informatica"),
            ref("br/lei/1996/9394~compilacao"),
          ],
        },
      ],
      [
        "CT-X-08",
        { referencias_normativas: [ref(DCN_EPT_2026, "#art28-vii"), ref(DCN_EPT_2026, "#art28-vii", "complementar")] },
      ],
    ]);

    const erros = validarReferenciasFichas(fichas, UNIVERSO_SINTETICO, MARCOS_SINTETICOS);

    const inexistente =
      "(inclua a norma em base-conhecimento/normas/ ou registre-a em base-conhecimento/normas/stubs.yaml)";
    expect(erros).toEqual([
      "CT-X-01: `referencias_normativas[0]` cita norma revogada: Resolução CNE/CP nº 1/2021, art. 20 " +
        "(br/cne-cp/res/2021/1; veja `revogada_por` em base-conhecimento/normas/br/resolucoes/RESOLUCAO_CNE-CP_1-2021_dcnept.md; " +
        "atualize a ficha e base-conhecimento/revisao-ppc/marcos-normativos.json)",
      "CT-X-03: `referencias_normativas[0]` cita norma revogada: Resolução CNE/CP nº 1/2022 " +
        "(br/cne-cp/res/2022/1; veja `status_fonte` (br/cne-cp/res/2026/2#art74-iii) em base-conhecimento/normas/stubs.yaml; " +
        "atualize a ficha e base-conhecimento/revisao-ppc/marcos-normativos.json)",
      "CT-X-04: `referencias_normativas[0]` cita dispositivo revogado (marco dcn_ept): Resolução CNE/CEB nº 3/2025, art. 6º, III",
      'CT-X-04: `referencias_normativas[1]` cita dispositivo revogado (marco dcn_ept): Resolução CNE/CEB nº 3/2025, art. 6º, III, alínea "a"',
      "CT-X-05: `referencias_normativas[0]` cita norma substituída no marco dcn_ept: Resolução CNE/CEB nº 6/2012 (br/cne-ceb/res/2012/6)",
      `CT-X-06: \`referencias_normativas[0]\` cita ID inexistente na base: br/cne-cp/res/2099/9 ${inexistente}`,
      `CT-X-06: \`referencias_normativas[1]\` cita ID inexistente na base: cnct:tecnico-em-nada ${inexistente}`,
      "CT-X-08: `referencias_normativas[1]` repete a referência: Resolução CNE/CP nº 2/2026, art. 28, VII",
    ]);
  });
});

describe("registro de marcos normativos", () => {
  const validar = (arquivo: string, fichas?: Map<string, Ficha>) =>
    validarMarcosNormativos(UNIVERSO_SINTETICO, arquivo, fichas, derivarSintetico);

  test("aceita marco válido", () => {
    const arquivo = gravarMarcos(marcoValido());
    expect(validar(arquivo, new Map([["CT-SUP-12", {}]]))).toEqual([]);
  });

  test("deriva vigente e substituídas da linha", () => {
    const arquivo = gravarMarcos(marcoValido());
    const [marco] = carregarMarcos(arquivo, derivarSintetico);
    expect(marco).toMatchObject({ id: "dcn_ept", vigente: DCN_EPT_2026, substitui: [DCN_EPT_2021] });
    expect(marco).not.toHaveProperty("linha");
  });

  test("aponta marco inconsistente (campos derivados)", () => {
    const arquivo = gravarMarcos(
      marcoValido({ linha: [DCN_EPT_2021], fichas_base_legal: ["CT-INEXISTENTE"] }),
      marcoValido(),
    );

    const erros = validar(arquivo, new Map([["CT-SUP-12", {}]]));

    expect(erros).toEqual([
      `${arquivo}: marco dcn_ept: norma marcada como vigente está revogada no registro: Resolução CNE/CP nº 1/2021 (${DCN_EPT_2021})`,
      `${arquivo}: marco dcn_ept: norma listada como substituída está vigente na base: Resolução CNE/CP nº 2/2026 (${DCN_EPT_2026})`,
      `${arquivo}: marco dcn_ept: \`substitui\` cita ID inexistente na base: br/cne-cp/res/2099/9`,
      `${arquivo}: marco dcn_ept: \`dispositivos_revogados\` cita ID inexistente na base: br/cne-ceb/res/2099/3`,
      `${arquivo}: marco dcn_ept: \`fichas_base_legal\` cita ficha desconhecida: CT-INEXISTENTE`,
      `${arquivo}: marco duplicado: dcn_ept`,
    ]);
  });

  test("aponta norma vigente fora da base (inexistente ou só stub) e linha sem derivação", () => {
    const arquivo = gravarMarcos(
      marcoValido({ linha: ["br/cne-cp/res/1999/9"] }),
      marcoValido({ id: "outro", linha: ["br/cne-ceb/res/2012/6"] }),
      marcoValido({ id: "terceiro", linha: ["br/lei/1996/9394"] }),
    );
    expect(validar(arquivo)).toEqual([
      `${arquivo}: marco dcn_ept: \`linha\` cita ID inexistente na base: br/cne-cp/res/1999/9`,
      `${arquivo}: marco dcn_ept: norma vigente fora da base: br/cne-cp/res/1999/9 (br/cne-cp/res/1999/9)`,
      `${arquivo}: marco outro: norma vigente fora da base: Resolução CNE/CEB nº 6/2012 (br/cne-ceb/res/2012/6)`,
      `${arquivo}: marco terceiro: linha normativa sem derivação: br/lei/1996/9394`,
    ]);
  });

  test("exige o schema do marco, com IDs no formato canônico e sem campos derivados", () => {
    const marco = marcoValido();
    delete marco.fichas_responsaveis;
    const arquivo = gravarMarcos(
      marco,
      marcoValido({ linha: "texto" }),
      marcoValido({ linha: ["Resolução CNE/CP nº 2/2026"] }),
      marcoValido({ vigente: DCN_EPT_2026 }),
    );
    expect(validar(arquivo)).toEqual([
      `${arquivo}: $.marcos[0].fichas_responsaveis: campo obrigatório ausente`,
      `${arquivo}: $.marcos[1].linha: esperava uma lista`,
      `${arquivo}: $.marcos[2].linha[0]: formato inválido`,
      `${arquivo}: $.marcos[3].vigente: campo não permitido`,
    ]);
  });

  test("registro ausente", () => {
    const arquivo = NodePath.join(NodeOS.tmpdir(), "nao-existe-marcos.json");
    expect(validar(arquivo)).toEqual([`${arquivo}: registro de marcos normativos não encontrado`]);
  });
});

describe("base real", () => {
  test("fichas não citam norma revogada e o registro aponta a DCN EPT 2026", () => {
    const universo = carregarUniverso()!;
    const fichas = fichasReais();
    expect(universo).not.toBeNull();
    expect(validarReferenciasFichas(fichas, universo, carregarMarcos())).toEqual([]);
    expect(validarMarcosNormativos(universo, caminhos.marcos, fichas)).toEqual([]);

    const marcos = new Map(carregarMarcos().map((marco) => [String(marco.id), marco]));
    const dcnEpt = marcos.get("dcn_ept")!;
    expect(dcnEpt.vigente).toBe(DCN_EPT_2026);
    expect(dcnEpt.substitui).toEqual(
      expect.arrayContaining([DCN_EPT_2021, "br/cne-ceb/res/2014/1", "br/cne-cp/res/2022/1", "br/cne-cp/res/2022/3"]),
    );
    expect(String(dcnEpt.transicao)).toContain("art. 70");
    expect(String(dcnEpt.transicao)).toContain("têm assegurado o direito de concluir");
    expect(dcnEpt.fichas_responsaveis).toEqual(["CT-SUP-12"]);
  });

  test("fichas aplicam regras materiais da DCN EPT 2026", () => {
    const fichas = fichasReais();
    const curr02 = texto(fichas.get("CT-CURR-02"));
    expect(curr02).toContain("3.000 horas");
    expect(curr02).toContain("art. 37, § 3º");
    expect(curr02).toContain("até 300 horas");
    expect(curr02).toContain("art. 30 e parágrafo único");
    expect(texto(fichas.get("CT-CURR-03"))).toContain("300 horas");
    expect(texto(fichas.get("CT-CURR-03"))).toContain("2.100 horas");
    expect(texto(fichas.get("CT-CURR-20"))).toContain("um terço da carga horária mínima");
    expect(texto(fichas.get("CT-IDENT-18"))).toContain("dois anos");
    expect(texto(fichas.get("CT-CURR-19"))).toContain("prática profissional supervisionada");
    expect(texto(fichas.get("CT-CURR-17"))).toContain("itinerário formativo profissional é obrigatória");
    expect(texto(fichas.get("CT-CURR-15"))).toContain("art. 42, II, dispensa");
    expect(texto(fichas.get("CT-IDENT-02"))).toContain("art. 69");
  });

  test("ficha de formato de oferta separa as bases de cálculo", () => {
    const formato = fichasReais().get("CT-CURR-27")!;
    const conteudo = texto(formato);
    for (const trecho of [
      "exclusivamente atividades presenciais",
      "30% da carga horária mínima do curso no CNCT",
      "70% da carga horária total",
      "5% da carga horária total",
      "190/2024, art. 5º",
      "art. 53, § 7º",
    ]) {
      expect(conteudo).toContain(trecho);
    }
    expect(new Set(formato.topicos_tematicos as string[])).toEqual(
      new Set(["identificacao_oferta", "matriz_curricular"]),
    );
  });

  test("fichas de base legal tratam a DCNEPT 2021 como revogada", () => {
    const fichas = fichasReais();
    const universo = carregarUniverso()!;
    for (const fichaId of ["CT-IDENT-05", "CT-IDENT-08", "CT-SUP-09", "CT-SUP-12", "CT-SUP-14"]) {
      const ficha = fichas.get(fichaId)!;
      const referencias = referenciasLegiveisDaFicha(ficha, universo);
      expect(referencias.some((referencia) => referencia.ref === DCN_EPT_2026)).toBe(true);
      expect(referencias.some((referencia) => referencia.texto.startsWith("Resolução CNE/CP nº 2/2026"))).toBe(true);
      expect(texto(ficha)).not.toContain("DCNEPT 2021");
    }
    expect(fichas.get("CT-SUP-12")!.criticidade).toBe("OBRIG");
  });
});
