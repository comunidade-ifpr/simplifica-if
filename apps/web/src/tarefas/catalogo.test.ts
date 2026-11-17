/** O perfil ordena e filtra os cartões (M1.8): `publico` do manifesto × função da pessoa. */
import { assert, describe, it } from "@effect/vitest";
import type { Perfil, ResumoSkill } from "@simplifica-if/contratos-app";
import { nomeTarefa, servePerfil, tarefasDoInicio, tarefasDoPerfil } from "./catalogo.ts";
import { exemplosDoPerfil, SKILL_EXEMPLO } from "./exemplo.ts";

const skill = (nome: string, publico: ReadonlyArray<string>): ResumoSkill => ({
  nome,
  titulo: nome,
  resumo: "Resumo.",
  area: "ensino",
  publico: [...publico],
  entradas: [],
  etapas: [],
});

const SKILLS = [
  skill(SKILL_EXEMPLO, ["proens", "dens", "coordenacao-curso", "pedagogia"]),
  skill("calendario", ["docente"]),
  skill("geral", []),
];

const perfil = (funcao: Perfil["funcao"]): Perfil => ({ ...(funcao === undefined ? {} : { funcao }), cursos: [] });
const nomes = (tarefas: ReadonlyArray<Parameters<typeof nomeTarefa>[0]>) => tarefas.map(nomeTarefa);

describe("cartões pelo perfil", () => {
  it("sem perfil ou com função 'outra': tudo, na ordem do catálogo", () => {
    const todas = ["analisar-ppc", SKILL_EXEMPLO, "calendario", "geral"];
    assert.deepStrictEqual(nomes(tarefasDoInicio(SKILLS, undefined)), todas);
    assert.deepStrictEqual(nomes(tarefasDoInicio(SKILLS, perfil("outra"))), todas);
    assert.isUndefined(servePerfil(tarefasDoPerfil(SKILLS, undefined)[0]!, undefined));
  });

  it("docente: o Início só com as que servem (e as sem público); Ver todas com o resto depois", () => {
    assert.deepStrictEqual(nomes(tarefasDoInicio(SKILLS, perfil("docente"))), ["calendario", "geral"]);
    assert.deepStrictEqual(nomes(tarefasDoPerfil(SKILLS, perfil("docente"))), [
      "calendario",
      "geral",
      "analisar-ppc",
      SKILL_EXEMPLO,
    ]);
  });

  it("PROENS/DENS: os dois públicos do manifesto servem", () => {
    assert.deepStrictEqual(nomes(tarefasDoInicio(SKILLS, perfil("proens-dens"))), [
      "analisar-ppc",
      SKILL_EXEMPLO,
      "geral",
    ]);
  });

  it("nenhuma serve: o Início não fica vazio", () => {
    const soDocente = [skill("calendario", ["docente"])];
    assert.deepStrictEqual(nomes(tarefasDoInicio(soDocente, perfil("pedagogia"))), ["analisar-ppc"]);
    assert.deepStrictEqual(nomes(tarefasDoInicio([skill("x", ["dens"])], perfil("docente"))), ["analisar-ppc", "x"]);
  });
});

describe("tarefa de exemplo das boas-vindas", () => {
  it("quem cuida de PPC: analisar o PPC do próprio curso primeiro", () => {
    const exemplos = exemplosDoPerfil(
      { funcao: "coordenacao-curso", cursos: [{ id: "curso:curitiba/enf", nome: "Técnico em Enfermagem" }] },
      SKILLS,
    );
    assert.deepStrictEqual(
      exemplos.map((exemplo) => exemplo.titulo),
      ["Analisar o PPC de Técnico em Enfermagem", "Conferir a fundamentação normativa de um trecho"],
    );
    assert.match(exemplos[0]!.custo, /não gasta a sua cota/);
  });

  it("os demais: a conversa curta primeiro; sem a skill no catálogo, só o PPC", () => {
    assert.strictEqual(exemplosDoPerfil(perfil("docente"), SKILLS)[0]?.tipo, "conversa");
    assert.deepStrictEqual(
      exemplosDoPerfil(undefined, []).map((exemplo) => exemplo.tipo),
      ["analisar-ppc"],
    );
    const conversa = exemplosDoPerfil(undefined, SKILLS)[0];
    assert.strictEqual(conversa?.tipo === "conversa" ? conversa.skill : undefined, SKILL_EXEMPLO);
    assert.match(conversa?.tipo === "conversa" ? conversa.pedido : "", /Resolução 01\/2021 do Conselho Nacional/);
  });
});
