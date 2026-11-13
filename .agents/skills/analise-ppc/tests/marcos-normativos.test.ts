import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ObjetoJson } from "@simplifica-if/kb/json";
import { UniversoReferencias } from "@simplifica-if/kb/normas/referencia-estruturada";
import { type EntradaRegistro, Registro } from "@simplifica-if/kb/normas/registro";
import { lerJson, listarArquivos } from "../scripts/arquivos.ts";
import { caminhosPadrao } from "../scripts/caminhos.ts";
import { carregarUniverso, referenciasLegiveisDaFicha } from "../scripts/referencias-fichas.ts";
import {
  carregarMarcos,
  type Ficha,
  validarMarcosNormativos,
  validarReferenciasFichas,
} from "../scripts/validacao-base.ts";

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

const caminhos = caminhosPadrao();

function fichasReais(): Map<string, Ficha> {
  const fichas = new Map<string, Ficha>();
  for (const arquivo of listarArquivos(caminhos.fichasDir, ".json")) {
    if (!path.basename(arquivo).startsWith("ct-")) continue;
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
    vigente: DCN_EPT_2026,
    aplica_a: "Cursos técnicos.",
    substitui: [DCN_EPT_2021],
    antecessoras_historicas: [],
    dispositivos_revogados: [],
    fichas_responsaveis: ["CT-SUP-12"],
    fichas_base_legal: ["CT-SUP-12"],
    transicao: "",
    orientacao_analise: "Teste.",
    ...sobrescritas,
  };
}

const temporarios: string[] = [];
afterEach(() => {
  for (const dir of temporarios.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function gravarMarcos(...marcos: ObjetoJson[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), "marcos-"));
  temporarios.push(dir);
  const arquivo = path.join(dir, "marcos.json");
  writeFileSync(arquivo, JSON.stringify({ versao: 3, descricao: "teste", marcos }), "utf-8");
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
      "(registre a norma em base-conhecimento/manifest.json ou em base-conhecimento/normas/stubs.yaml)";
    expect(erros).toEqual([
      "CT-X-01: `referencias_normativas[0]` cita norma revogada: Resolução CNE/CP nº 1/2021, art. 20 " +
        "(br/cne-cp/res/2021/1; veja `revogada_por` em base-conhecimento/normas/br/resolucoes/RESOLUCAO_CNE-CP_1-2021_dcnept.md; " +
        "atualize a ficha e base-analise/marcos-normativos.json)",
      "CT-X-03: `referencias_normativas[0]` cita norma revogada: Resolução CNE/CP nº 1/2022 " +
        "(br/cne-cp/res/2022/1; veja `status_fonte` (br/cne-cp/res/2026/2#art74-iii) em base-conhecimento/normas/stubs.yaml; " +
        "atualize a ficha e base-analise/marcos-normativos.json)",
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
  test("aceita marco válido", () => {
    const arquivo = gravarMarcos(marcoValido());
    expect(validarMarcosNormativos(UNIVERSO_SINTETICO, arquivo, new Map([["CT-SUP-12", {}]]))).toEqual([]);
  });

  test("aponta marco inconsistente", () => {
    const arquivo = gravarMarcos(
      marcoValido({
        vigente: DCN_EPT_2021,
        substitui: [DCN_EPT_2026, "br/cne-cp/res/2099/9"],
        dispositivos_revogados: ["br/cne-ceb/res/2099/3#art6-iii"],
        fichas_base_legal: ["CT-INEXISTENTE"],
      }),
      marcoValido(),
    );

    const erros = validarMarcosNormativos(UNIVERSO_SINTETICO, arquivo, new Map([["CT-SUP-12", {}]]));

    expect(erros).toEqual([
      `${arquivo}: marco dcn_ept: norma marcada como vigente está revogada no manifesto: Resolução CNE/CP nº 1/2021 (${DCN_EPT_2021})`,
      `${arquivo}: marco dcn_ept: norma listada como substituída está vigente na base: Resolução CNE/CP nº 2/2026 (${DCN_EPT_2026})`,
      `${arquivo}: marco dcn_ept: \`substitui\` cita ID inexistente na base: br/cne-cp/res/2099/9`,
      `${arquivo}: marco dcn_ept: \`dispositivos_revogados\` cita ID inexistente na base: br/cne-ceb/res/2099/3`,
      `${arquivo}: marco dcn_ept: \`fichas_base_legal\` cita ficha desconhecida: CT-INEXISTENTE`,
      `${arquivo}: marco duplicado: dcn_ept`,
    ]);
  });

  test("aponta norma vigente fora do manifesto (inexistente ou só stub)", () => {
    const arquivo = gravarMarcos(
      marcoValido({ vigente: "br/cne-cp/res/1999/9" }),
      marcoValido({ id: "outro", vigente: "br/cne-ceb/res/2012/6" }),
    );
    expect(validarMarcosNormativos(UNIVERSO_SINTETICO, arquivo)).toEqual([
      `${arquivo}: marco dcn_ept: norma vigente fora do manifesto da base: br/cne-cp/res/1999/9 (br/cne-cp/res/1999/9)`,
      `${arquivo}: marco outro: norma vigente fora do manifesto da base: Resolução CNE/CEB nº 6/2012 (br/cne-ceb/res/2012/6)`,
    ]);
  });

  test("exige o schema do marco, com IDs no formato canônico", () => {
    const marco = marcoValido();
    delete marco.fichas_responsaveis;
    const arquivo = gravarMarcos(
      marco,
      marcoValido({ substitui: "texto" }),
      marcoValido({
        vigente: "Resolução CNE/CP nº 2/2026",
        dispositivos_revogados: ["br/cne-ceb/res/2025/3, art. 6º"],
      }),
    );
    expect(validarMarcosNormativos(UNIVERSO_SINTETICO, arquivo)).toEqual([
      `${arquivo}: $.marcos[0]: campo obrigatório ausente: fichas_responsaveis`,
      `${arquivo}: $.marcos[1].substitui: tipo string; esperado array`,
      `${arquivo}: $.marcos[2].vigente: valor 'Resolução CNE/CP nº 2/2026' fora do formato`,
      `${arquivo}: $.marcos[2].dispositivos_revogados[0]: valor 'br/cne-ceb/res/2025/3, art. 6º' fora do formato`,
    ]);
  });

  test("registro ausente", () => {
    const arquivo = path.join(tmpdir(), "nao-existe-marcos.json");
    expect(validarMarcosNormativos(UNIVERSO_SINTETICO, arquivo)).toEqual([
      `${arquivo}: registro de marcos normativos não encontrado`,
    ]);
  });
});

describe("base real", () => {
  test("fichas não citam norma revogada e o registro aponta a DCN EPT 2026", () => {
    const universo = carregarUniverso()!;
    const fichas = fichasReais();
    expect(universo).not.toBeNull();
    expect(validarReferenciasFichas(fichas, universo, carregarMarcos())).toEqual([]);
    expect(validarMarcosNormativos(universo, caminhos.marcosNormativosPath, fichas)).toEqual([]);

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
