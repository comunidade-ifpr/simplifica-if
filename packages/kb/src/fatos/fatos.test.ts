import { describe, expect, test } from "vite-plus/test";
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
    ["3.360 h (hora aula de 60 minutos)", 3360, "relogio"],
    ["1.200 horas (aulas de 60 minutos)", 1200, "relogio"],
    ["1440 horas-aula (aula de 50 minutos)", 1440, "aula"],
  ] as const)("%s → %d", (trecho, valor, unidade) => {
    expect(horasDoTrecho(trecho)).toEqual({ valor, unidade });
  });

  test("a marca do rótulo vale para o número sem marca", () => {
    expect(horasDoTrecho("1.600 horas", "relogio")).toEqual({ valor: 1600, unidade: "relogio" });
    expect(horasDoTrecho("1.600 horas")).toEqual({ valor: 1600, unidade: "sem-marca" });
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
    expect(fatos.map((f) => [f.fato, f.valor, f.unidade, f.linha, f.status_curadoria])).toEqual([
      ["carga_horaria_total_h", "1600", "hora-relogio", 7, "extraido"],
      ["estagio_obrigatorio", "sim", null, 9, "extraido"],
      ["estagio_carga_h", "400", "horas", 9, "extraido"],
    ]);
    expect(fatos[0]!.trecho_fonte).toBe("**Carga horária total em hora-relógio:** 1.600 horas");
  });

  test("estágio negado no quadro", () => {
    const texto = PPC.replace("400 horas", "não há estágio obrigatório");
    const fatos = extrairFatosPpc(texto, SECOES);
    expect(fatos.find((f) => f.fato === "estagio_obrigatorio")?.valor).toBe("nao");
    expect(fatos.some((f) => f.fato === "estagio_carga_h")).toBe(false);
  });

  test("unidade do rótulo e hora-aula de 60 minutos (campo-largo/automacao-industrial, linha 103)", () => {
    const texto = PPC.replace(
      "**Carga horária total em hora-relógio:** 1.600 horas",
      "Carga horária total em hora relógio: 3.360 h (hora aula de 60 minutos)",
    );
    const total = extrairFatosPpc(texto, SECOES).find((f) => f.fato === "carga_horaria_total_h")!;
    expect([total.valor, total.regra]).toEqual(["3360", "rotulo-quadro-relogio"]);
  });

  test("o ementário não é fonte da carga total", () => {
    const semQuadro = PPC.replace("**Carga horária total em hora-relógio:** 1.600 horas", "");
    expect(extrairFatosPpc(semQuadro, SECOES).some((f) => f.fato === "carga_horaria_total_h")).toBe(false);
  });

  test("aceita 'Carga-Horária' com hífen e valor após células vazias na tabela", () => {
    const texto = [
      "---",
      "id: ppc:x/y",
      "---",
      "",
      "## 1.1.1 Dados Gerais",
      "",
      "| Carga-Horária Total do Curso: 1200h<br>Carga horária presencial: 1200h |",
      "",
      "## 5.6 Matriz Curricular",
      "",
      "| CARGA HORÁRIA TOTAL DO CURSO |  |  |  | 1600 |",
    ].join("\n");
    const secoes = [
      { tipo: "identificacao", linha_inicio: 5, linha_fim: 7 },
      { tipo: "matriz_curricular", linha_inicio: 9, linha_fim: 11 },
    ];
    const total = extrairFatosPpc(texto, secoes).find((f) => f.fato === "carga_horaria_total_h");
    expect(total).toMatchObject({
      valor: "1200",
      valor_num: 1200,
      linha: 7,
      alternativas: [{ valor: "1600", linha: 11 }],
    });
  });
});

describe("título com o valor no parágrafo seguinte", () => {
  const comParagrafo = (paragrafo: string) =>
    ["---", "id: ppc:x/y", "---", "", "## 1.1.10 Carga horária total do curso", "", paragrafo].join("\n");
  const secoes = [{ tipo: "outros", linha_inicio: 5, linha_fim: 7 }];
  const total = (paragrafo: string) =>
    extrairFatosPpc(comParagrafo(paragrafo), secoes).find((f) => f.fato === "carga_horaria_total_h")?.valor;

  test("o número é o da carga global, não o seguinte (ivaiporã, eletrotécnica, linha 273)", () => {
    expect(
      total(
        "Em consonância com a resolução CNE/CEB nº 01/2021, o curso possui carga horária global de 3.200 horas, distribuídas da seguinte forma: 1.200 horas de conteúdo técnico (núcleo técnico), 1.800 horas de fundamentos básicos.",
      ),
    ).toBe("3200");
  });

  test("número com 'horas' no fim da frase", () => {
    expect(total("O curso tem carga horária de 3.200 horas.")).toBe("3200");
  });

  test("número com 'h' e com parêntese", () => {
    expect(total("A carga horária total do curso é de 1600h.")).toBe("1600");
    expect(total("A carga horária total é de 1.200 (mil e duzentas) horas.")).toBe("1200");
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
    const base = {
      estagioObrigatorio: "sim" as const,
      estagioCargaH: 400,
      estagioCargaUnidade: "hora-relogio" as const,
      anoPpc: 2024,
      chComumSuap: null,
      matrizes,
    };
    const r = (chPpc: number, extra = {}) =>
      Object.fromEntries(
        cruzarPpcSuap({ ...base, chPpc, chPpcUnidade: "hora-relogio", ...extra }).map((l) => [l.aspecto, l.resultado]),
      );
    expect(r(1600)).toEqual({ carga_horaria: "confere-com-uma-matriz", estagio: "confere", ano: "confere" });
    expect(r(2000)).toEqual({ carga_horaria: "explicada-pelo-estagio", estagio: "confere", ano: "confere" });
    expect(r(1700).carga_horaria).toBe("diverge");
    expect(r(1600, { estagioObrigatorio: "nao" }).estagio).toBe("diverge");
    expect(r(1600, { anoPpc: 2025 }).ano).toBe("ppc-mais-recente-que-matrizes");
    // hora-aula com a duração revisada: 1920 aulas de 50 min = 1600 h
    expect(r(1920, { chPpcUnidade: "hora-aula-50min" }).carga_horaria).toBe("confere-com-uma-matriz");
    expect(r(1920, { chPpcUnidade: "hora-aula-45min" }).carga_horaria).toBe("diverge");
    // sem a duração, a unidade não é escolhida para bater com o SUAP: nada se afirma
    expect(r(1920, { chPpcUnidade: "hora-aula" }).carga_horaria).toBe("unidade-desconhecida");
    expect(r(1600, { chPpcUnidade: "hora-aula" }).carga_horaria).toBe("unidade-desconhecida");
    // "horas" sem unidade: o mesmo número do SUAP confere; outro número não é divergência afirmada
    expect(r(1600, { chPpcUnidade: "horas" }).carga_horaria).toBe("confere-com-uma-matriz");
    expect(r(1700, { chPpcUnidade: "horas" }).carga_horaria).toBe("unidade-desconhecida");
    expect(r(2000, { chPpcUnidade: "horas" }).carga_horaria).toBe("unidade-desconhecida");
    // estágio: 480 aulas de 50 min = 400 h, só com a duração revisada
    expect(r(1600, { estagioCargaH: 480, estagioCargaUnidade: "hora-aula-50min" }).estagio).toBe("confere");
    expect(r(1600, { estagioCargaH: 480, estagioCargaUnidade: "hora-aula" }).estagio).toBe("unidade-desconhecida");
    expect(r(1600, { estagioCargaH: 480 }).estagio).toBe("diverge-carga");
    expect(r(1600, { estagioCargaH: 480, estagioCargaUnidade: "horas" }).estagio).toBe("unidade-desconhecida");
    expect(r(1600, { estagioCargaH: 400, estagioCargaUnidade: "horas" }).estagio).toBe("confere");
    expect(r(1600, { estagioCargaH: 500, estagioCargaUnidade: "hora-aula-50min" }).estagio).toBe("diverge-carga");
    expect(cruzarPpcSuap({ ...base, chPpc: null, matrizes: [] }).map((l) => l.resultado)).toEqual([
      "sem-suap",
      "sem-suap",
      "sem-suap",
    ]);
  });
});
