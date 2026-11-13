import { describe, expect, test } from "bun:test";
import { matrizesDoResumo } from "../institucional/dados.ts";
import { cruzarPpcSuap } from "./divergencias.ts";
import { extrairFatosPpc, horasDoTrecho } from "./ppc.ts";

describe("horasDoTrecho", () => {
  test.each([
    ["3.520 horas", 3520, "sem-marca"],
    ["1744 (horas aula)/1456 (horas relógio)", 1456, "relogio"],
    ["4200 h/a - 3532 h/r", 3532, "relogio"],
    ["3.579,34 hora relógio e/ou 4.295,20 hora-aula", 3579, "relogio"],
    ["3533 horas/relógio; 4240 horas/aula", 3533, "relogio"],
    ["3254 h/a", 3254, "aula"],
  ] as const)("%s → %d", (trecho, valor, unidade) => {
    expect(horasDoTrecho(trecho)).toEqual({ valor, unidade });
  });

  test("ano de ato não é carga horária", () => {
    expect(horasDoTrecho("conforme a Resolução nº 64/2022")).toBeNull();
  });
});

const PPC = [
  "---",
  "id: ppc:x/y",
  "---",
  "",
  "## 1 IDENTIFICAÇÃO",
  "",
  "**Carga horária total em hora-relógio:** 1.600 horas",
  "",
  "**Carga horária de estágio:** 400 horas",
  "",
  "## 6 EMENTÁRIO",
  "",
  "**Carga horária total:** 80 horas",
].join("\n");

const SECOES = [
  { tipo: "identificacao", linha_inicio: 5, linha_fim: 9 },
  { tipo: "ementas", linha_inicio: 11, linha_fim: 13 },
];

describe("extrairFatosPpc", () => {
  test("carga total e estágio do quadro, com linha e trecho literal", () => {
    const fatos = extrairFatosPpc(PPC, SECOES);
    expect(fatos.map((f) => [f.fato, f.valor, f.linha, f.status_curadoria])).toEqual([
      ["carga_horaria_total_h", "1600", 7, "extraido"],
      ["estagio_obrigatorio", "sim", 9, "extraido"],
      ["estagio_carga_h", "400", 9, "extraido"],
    ]);
    expect(fatos[0]!.trecho_fonte).toBe("**Carga horária total em hora-relógio:** 1.600 horas");
  });

  test("estágio negado no quadro", () => {
    const texto = PPC.replace("400 horas", "não há estágio obrigatório");
    const fatos = extrairFatosPpc(texto, SECOES);
    expect(fatos.find((f) => f.fato === "estagio_obrigatorio")?.valor).toBe("nao");
    expect(fatos.some((f) => f.fato === "estagio_carga_h")).toBe(false);
  });

  test("o ementário não é fonte da carga total", () => {
    const semQuadro = PPC.replace("**Carga horária total em hora-relógio:** 1.600 horas", "");
    expect(extrairFatosPpc(semQuadro, SECOES).some((f) => f.fato === "carga_horaria_total_h")).toBe(false);
  });
});

const RESUMO = [
  "71 — TÉCNICO EM ENFERMAGEM SUBSEQUENTE - 2020 CURITIBA — CH exibida: 1820 h; estágio exigido: Não; CH mínima de estágio (separada): -",
  "538 — TÉCNICO EM ENFERMAGEM SUBSEQUENTE - 2024 CURITIBA — CH exibida: 1600 h; estágio exigido: Sim; CH mínima de estágio (separada): 400",
].join("\n");

describe("SUAP", () => {
  test("matrizesDoResumo", () => {
    const m = matrizesDoResumo(RESUMO);
    expect(m.map((x) => [x.matriz_id, x.ano, x.ch_exibida_h, x.estagio_exigido, x.ch_estagio_h])).toEqual([
      [71, 2020, 1820, false, null],
      [538, 2024, 1600, true, 400],
    ]);
    expect(() => matrizesDoResumo("linha qualquer")).toThrow();
  });

  test("cruzamento PPC × SUAP", () => {
    const matrizes = matrizesDoResumo(RESUMO);
    const base = { estagioObrigatorio: "sim" as const, estagioCargaH: 400, anoPpc: 2024, chComumSuap: null, matrizes };
    const r = (chPpc: number, extra = {}) =>
      Object.fromEntries(cruzarPpcSuap({ ...base, chPpc, ...extra }).map((l) => [l.aspecto, l.resultado]));
    expect(r(1600)).toEqual({ carga_horaria: "confere-com-uma-matriz", estagio: "confere", ano: "confere" });
    expect(r(2000)).toEqual({ carga_horaria: "explicada-pelo-estagio", estagio: "confere", ano: "confere" });
    expect(r(1700).carga_horaria).toBe("diverge");
    expect(r(1600, { estagioObrigatorio: "nao" }).estagio).toBe("diverge");
    expect(r(1600, { anoPpc: 2025 }).ano).toBe("ppc-mais-recente-que-matrizes");
    expect(r(1920, { chPpcEmHoraAula: true }).carga_horaria).toBe("confere-com-uma-matriz");
    expect(cruzarPpcSuap({ ...base, chPpc: null, matrizes: [] }).map((l) => l.resultado)).toEqual([
      "sem-suap",
      "sem-suap",
      "sem-suap",
    ]);
  });
});
