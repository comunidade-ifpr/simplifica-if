import { describe, expect, test } from "vite-plus/test";
import { extrairFatosPpc } from "./ppc.ts";
import { aplicarRevisoes, linhaDoTrecho, revisoesDoYaml } from "./revisoes.ts";

const PPC = [
  "---",
  "id: ppc:x/y/2024",
  "---",
  "",
  "## 1 IDENTIFICAÇÃO",
  "",
  "**Carga horária total:** 1.920 horas-aula",
  "",
  "**Carga horária de estágio:** 400 horas",
  "",
  "A hora-aula do curso tem 50 minutos.",
].join("\n");
const SECOES = [{ tipo: "identificacao", linha_inicio: 5, linha_fim: 11 }];

const revisao = (campos: Record<string, string>) =>
  [
    "revisoes:",
    "  - ppc: ppc:x/y/2024",
    ...Object.entries({
      fato: "carga_horaria_total_h",
      valor: "1920",
      unidade: "hora-aula-50min",
      trecho: "A hora-aula do curso tem 50 minutos.",
      revisor: "Pessoa Revisora",
      revisado_em: "2026-11-25",
      ...campos,
    }).map(([chave, valor]) => `    ${chave}: "${valor}"`),
  ].join("\n");

describe("revisão dos fatos de PPC", () => {
  test("o contrato: unidade conhecida nas horas, sim/nao no estágio, versão do PPC", () => {
    expect(revisoesDoYaml("revisoes: []")).toEqual([]);
    expect(revisoesDoYaml(revisao({}))[0]!.unidade).toBe("hora-aula-50min");
    // a unidade sem a duração não é revisão: a revisão diz a unidade conhecida
    expect(() => revisoesDoYaml(revisao({ unidade: "hora-aula" }))).toThrow();
    expect(() => revisoesDoYaml(revisao({ valor: "1.920" }))).toThrow();
    expect(() => revisoesDoYaml(revisao({ revisado_em: "25/11/2026" }))).toThrow();
    expect(() => revisoesDoYaml(revisao({ fato: "estagio_obrigatorio", valor: "sim" }))).toThrow();
    expect(() => revisoesDoYaml(revisao({ revisor: "" }))).toThrow();
    expect(() => revisoesDoYaml(revisao({}).replace("ppc:x/y/2024", "ppc:x/y"))).toThrow();
    expect(() => revisoesDoYaml(`${revisao({})}\n${revisao({}).split("\n").slice(1).join("\n")}`)).toThrow();
  });

  test("a revisão troca o fato extraído e leva revisor e data; o resto fica extraído", () => {
    const extraidos = extrairFatosPpc(PPC, SECOES);
    expect(extraidos.find((f) => f.fato === "carga_horaria_total_h")?.unidade).toBe("hora-aula");
    const fatos = aplicarRevisoes(extraidos, revisoesDoYaml(revisao({})), PPC);
    expect(fatos.map((f) => [f.fato, f.valor, f.unidade, f.status_curadoria, f.revisor, f.linha])).toEqual([
      ["carga_horaria_total_h", "1920", "hora-aula-50min", "revisado", "Pessoa Revisora", 11],
      ["estagio_obrigatorio", "sim", null, "extraido", null, 9],
      ["estagio_carga_h", "400", "horas", "extraido", null, 9],
    ]);
  });

  test("estágio revisado como não tira a carga extraída", () => {
    const revisoes = revisoesDoYaml(
      revisao({ fato: "estagio_obrigatorio", valor: "nao", trecho: "**Carga horária de estágio:** 400 horas" }).replace(
        /\n {4}unidade: .*$/m,
        "",
      ),
    );
    const fatos = aplicarRevisoes(extrairFatosPpc(PPC, SECOES), revisoes, PPC);
    expect(fatos.map((f) => f.fato)).toEqual(["carga_horaria_total_h", "estagio_obrigatorio"]);
  });

  test("o trecho é procurado literal, numa linha", () => {
    expect(linhaDoTrecho(PPC, "tem 50 minutos")).toBe(11);
    expect(linhaDoTrecho(PPC, "tem 50 minutos.\nOutra")).toBeNull();
  });
});
