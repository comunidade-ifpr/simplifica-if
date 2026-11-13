import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ObjetoJson } from "@simplifica-if/kb/json";
import type { NormaManifesto } from "@simplifica-if/kb/normas/referencias";
import { lerJson, listarArquivos } from "../scripts/arquivos.ts";
import { caminhosPadrao } from "../scripts/caminhos.ts";
import {
  carregarManifestNormas,
  carregarMarcos,
  type Ficha,
  validarMarcosNormativos,
  validarReferenciasVigentes,
} from "../scripts/validacao-base.ts";

const DCN_EPT_2026 = "Resolução CNE/CP nº 2/2026";

const MANIFEST_SINTETICO: NormaManifesto[] = [
  {
    title: "Resolução CNE/CP nº 1/2021",
    tipo_documento: "Resolução",
    numero: "1",
    ano: 2021,
    orgao: "CNE/CP",
    aliases: ["Resolução CNE/CP nº 1/2021", "DCNEPT"],
    status_vigencia: "revogada",
    path: "normas/br/resolucoes/RESOLUCAO_CNE-CP_1-2021_dcnept.md",
  },
  {
    title: DCN_EPT_2026,
    tipo_documento: "Resolução",
    numero: "2",
    ano: 2026,
    orgao: "CNE/CP",
    aliases: ["DCNEPT 2026"],
    status_vigencia: "vigente",
  },
  {
    title: "Resolução CNE/CEB nº 3/2025",
    tipo_documento: "Resolução",
    numero: "3",
    ano: 2025,
    orgao: "CNE/CEB",
    aliases: [],
    status_vigencia: "parcialmente revogada",
  },
  {
    title: "Resolução CONSUP/IFPR nº 64/2022",
    tipo_documento: "Resolução",
    numero: "64",
    ano: 2022,
    orgao: "CONSUP/IFPR",
    aliases: [],
    status_vigencia: "vigente",
  },
  {
    title: "Lei nº 9.394/1996",
    tipo_documento: "Lei",
    numero: "9394",
    ano: 1996,
    orgao: "Presidência da República",
    aliases: [],
    status_vigencia: "vigente",
  },
];

const MARCOS_SINTETICOS = [
  {
    id: "dcn_ept",
    substitui: ["Resolução CNE/CP nº 1/2021", "Resolução CNE/CP nº 1/2022"],
    antecessoras_historicas: ["Resolução CNE/CEB nº 6/2012"],
    dispositivos_revogados: ["Resolução CNE/CEB nº 3/2025, art. 6º, III"],
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
    substitui: ["Resolução CNE/CP nº 1/2021"],
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
  writeFileSync(arquivo, JSON.stringify({ versao: 2, descricao: "teste", marcos }), "utf-8");
  return arquivo;
}

describe("referências das fichas", () => {
  test("aponta norma revogada, norma substituída e dispositivo revogado", () => {
    const fichas = new Map<string, Ficha>([
      ["CT-X-01", { referencias_normativas: ["Res. CNE/CP n° 1/2021, art. 20"] }],
      ["CT-X-02", { referencias_normativas: [`${DCN_EPT_2026}, art. 29`, "Resolução CNE/CEB nº 3/2025, art. 5º"] }],
      ["CT-X-03", { referencias_normativas: ["Resolução CNE/CP nº 1/2022"] }],
      ["CT-X-04", { referencias_normativas: ["Resolução CNE/CEB nº 3/2025, art. 6º, III"] }],
      ["CT-X-05", { referencias_normativas: ["Resolução CNE/CEB nº 6/2012"] }],
    ]);

    const erros = validarReferenciasVigentes(fichas, MANIFEST_SINTETICO, MARCOS_SINTETICOS);

    expect(new Set(erros.map((erro) => erro.split(":", 1)[0]))).toEqual(
      new Set(["CT-X-01", "CT-X-03", "CT-X-04", "CT-X-05"]),
    );
    expect(erros).toEqual([
      "CT-X-01: `referencias_normativas` cita norma revogada: Res. CNE/CP n° 1/2021, art. 20 " +
        "(veja `revogada_por` em base-conhecimento/normas/br/resolucoes/RESOLUCAO_CNE-CP_1-2021_dcnept.md; " +
        "atualize a ficha e base-analise/marcos-normativos.json)",
      "CT-X-03: `referencias_normativas` cita norma substituída no marco dcn_ept: " +
        "Resolução CNE/CP nº 1/2022 (Resolução CNE/CP nº 1/2022)",
      "CT-X-04: `referencias_normativas` cita dispositivo revogado (marco dcn_ept): " +
        "Resolução CNE/CEB nº 3/2025, art. 6º, III",
      "CT-X-05: `referencias_normativas` cita norma substituída no marco dcn_ept: " +
        "Resolução CNE/CEB nº 6/2012 (Resolução CNE/CEB nº 6/2012)",
    ]);
  });
});

describe("registro de marcos normativos", () => {
  test("aceita marco válido", () => {
    const arquivo = gravarMarcos(marcoValido());
    expect(validarMarcosNormativos(MANIFEST_SINTETICO, arquivo, new Map([["CT-SUP-12", {}]]))).toEqual([]);
  });

  test("aponta marco inconsistente", () => {
    const arquivo = gravarMarcos(
      marcoValido({
        vigente: "Resolução CNE/CP nº 1/2021",
        substitui: [DCN_EPT_2026],
        fichas_base_legal: ["CT-INEXISTENTE"],
      }),
      marcoValido(),
    );

    const erros = validarMarcosNormativos(MANIFEST_SINTETICO, arquivo, new Map([["CT-SUP-12", {}]]));

    expect(erros).toEqual([
      `${arquivo}: marco dcn_ept: norma marcada como vigente está revogada no manifesto: Resolução CNE/CP nº 1/2021`,
      `${arquivo}: marco dcn_ept: norma listada como substituída está vigente no manifesto: ${DCN_EPT_2026}`,
      `${arquivo}: marco dcn_ept: \`fichas_base_legal\` cita ficha desconhecida: CT-INEXISTENTE`,
      `${arquivo}: marco duplicado: dcn_ept`,
    ]);
  });

  test("aponta norma vigente fora do manifesto", () => {
    const arquivo = gravarMarcos(marcoValido({ vigente: "Resolução XYZ nº 9/1999" }));
    expect(validarMarcosNormativos(MANIFEST_SINTETICO, arquivo)).toEqual([
      `${arquivo}: marco dcn_ept: norma vigente fora do manifesto da base: Resolução XYZ nº 9/1999`,
    ]);
  });

  test("exige o schema do marco", () => {
    const marco = marcoValido();
    delete marco.fichas_responsaveis;
    const arquivo = gravarMarcos(marco, marcoValido({ substitui: "texto" }));
    expect(validarMarcosNormativos(MANIFEST_SINTETICO, arquivo)).toEqual([
      `${arquivo}: $.marcos[0]: campo obrigatório ausente: fichas_responsaveis`,
      `${arquivo}: $.marcos[1].substitui: tipo string; esperado array`,
    ]);
  });

  test("registro ausente", () => {
    const arquivo = path.join(tmpdir(), "nao-existe-marcos.json");
    expect(validarMarcosNormativos(MANIFEST_SINTETICO, arquivo)).toEqual([
      `${arquivo}: registro de marcos normativos não encontrado`,
    ]);
  });
});

describe("base real", () => {
  test("fichas não citam norma revogada e o registro aponta a DCN EPT 2026", () => {
    const manifest = carregarManifestNormas();
    const fichas = fichasReais();
    expect(manifest.length).toBeGreaterThan(0);
    expect(validarReferenciasVigentes(fichas, manifest, carregarMarcos())).toEqual([]);
    expect(validarMarcosNormativos(manifest, caminhos.marcosNormativosPath, fichas)).toEqual([]);

    const marcos = new Map(carregarMarcos().map((marco) => [String(marco.id), marco]));
    const dcnEpt = marcos.get("dcn_ept")!;
    expect(dcnEpt.vigente).toBe(DCN_EPT_2026);
    expect(dcnEpt.substitui).toEqual(
      expect.arrayContaining([
        "Resolução CNE/CP nº 1/2021",
        "Resolução CNE/CEB nº 1/2014",
        "Resolução CNE/CP nº 1/2022",
        "Resolução CNE/CP nº 3/2022",
      ]),
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
    for (const fichaId of ["CT-IDENT-05", "CT-IDENT-08", "CT-SUP-09", "CT-SUP-12", "CT-SUP-14"]) {
      const ficha = fichas.get(fichaId)!;
      const referencias = ficha.referencias_normativas as string[];
      expect(referencias.some((referencia) => referencia.startsWith(DCN_EPT_2026))).toBe(true);
      expect(texto(ficha)).not.toContain("DCNEPT 2021");
    }
    expect(fichas.get("CT-SUP-12")!.criticidade).toBe("OBRIG");
  });
});
