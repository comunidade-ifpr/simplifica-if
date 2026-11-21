/** O perfil ordena e filtra os cartões (M1.8): `publico` do manifesto × os públicos do perfil. */
import { assert, describe, it } from "@effect/vitest";
import { linhaDoPerfil, type Perfil, publicosDoPerfil, type ResumoSkill } from "@simplifica-if/contratos-app";
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

const perfil = (campos: Perfil = {}): Perfil => campos;
const docente = perfil({ categoria: "docente", cargo: "professor-ebtt" });
const pedagogo = perfil({ categoria: "tecnico-administrativo", cargo: "pedagogo" });
const outro = perfil({ categoria: "tecnico-administrativo", cargo: "contador" });
const proens = perfil({ campus: { id: "proens", nome: "Pró-Reitoria de Ensino (PROENS)" } });
const nomes = (tarefas: ReadonlyArray<Parameters<typeof nomeTarefa>[0]>) => tarefas.map(nomeTarefa);

describe("cartões pelo perfil", () => {
  it("sem perfil ou com um cargo sem público: tudo, na ordem do catálogo", () => {
    const todas = ["revisar-ppc", SKILL_EXEMPLO, "calendario", "geral"];
    assert.deepStrictEqual(nomes(tarefasDoInicio(SKILLS, undefined)), todas);
    assert.deepStrictEqual(nomes(tarefasDoInicio(SKILLS, outro)), todas);
    assert.isUndefined(servePerfil(tarefasDoPerfil(SKILLS, undefined)[0]!, undefined));
  });

  it("docente: o Início só com as que servem (e as sem público); Ver todas com o resto depois", () => {
    // "Revisar um PPC" não declara público: serve a todos.
    assert.deepStrictEqual(nomes(tarefasDoInicio(SKILLS, docente)), ["revisar-ppc", "calendario", "geral"]);
    assert.deepStrictEqual(nomes(tarefasDoPerfil(SKILLS, docente)), [
      "revisar-ppc",
      "calendario",
      "geral",
      SKILL_EXEMPLO,
    ]);
  });

  it("quem é da PROENS: os públicos proens e dens servem", () => {
    assert.deepStrictEqual(nomes(tarefasDoInicio(SKILLS, proens)), ["revisar-ppc", SKILL_EXEMPLO, "geral"]);
  });

  it("o Início nunca fica vazio: a nativa serve a todo público, e quem não tem público vê tudo", () => {
    const soDocente = [skill("calendario", ["docente"])];
    assert.deepStrictEqual(nomes(tarefasDoInicio(soDocente, pedagogo)), ["revisar-ppc"]);
    assert.deepStrictEqual(nomes(tarefasDoInicio([skill("x", ["dens"])], outro)), ["revisar-ppc", "x"]);
  });
});

describe("tarefa de exemplo das boas-vindas", () => {
  it("quem cuida de PPC: revisar um PPC primeiro", () => {
    const exemplos = exemplosDoPerfil({ categoria: "docente", funcao: "coordenacao-curso" }, SKILLS);
    assert.deepStrictEqual(
      exemplos.map((exemplo) => exemplo.titulo),
      ["Revisar um PPC", "Conferir a fundamentação normativa de um trecho"],
    );
    assert.match(exemplos[0]!.custo, /não gasta a sua cota/);
  });

  it("os demais: a conversa curta primeiro; sem a skill no catálogo, só o PPC", () => {
    assert.strictEqual(exemplosDoPerfil(docente, SKILLS)[0]?.tipo, "conversa");
    assert.deepStrictEqual(
      exemplosDoPerfil(undefined, []).map((exemplo) => exemplo.tipo),
      ["revisar-ppc"],
    );
    const conversa = exemplosDoPerfil(undefined, SKILLS)[0];
    assert.strictEqual(conversa?.tipo === "conversa" ? conversa.skill : undefined, SKILL_EXEMPLO);
    assert.match(conversa?.tipo === "conversa" ? conversa.pedido : "", /Resolução 01\/2021 do Conselho Nacional/);
  });
});

describe("públicos e linha do perfil", () => {
  it("categoria, cargo, função e unidade dão os públicos", () => {
    assert.deepStrictEqual(publicosDoPerfil(docente), ["docente"]);
    assert.deepStrictEqual(publicosDoPerfil(pedagogo), ["pedagogia"]);
    assert.deepStrictEqual(publicosDoPerfil(outro), []);
    assert.deepStrictEqual(publicosDoPerfil(proens), ["proens", "dens"]);
    assert.deepStrictEqual(publicosDoPerfil(perfil({ funcao: "coordenacao-ensino" })), ["coordenacao-ensino"]);
    assert.deepStrictEqual(publicosDoPerfil(perfil({ categoria: "docente", funcao: "direcao-ensino" })), [
      "direcao-ensino",
      "docente",
    ]);
  });

  it("a linha mostra a função, ou o cargo, ou a categoria, e onde", () => {
    const curitiba = { id: "curitiba", nome: "Curitiba" };
    assert.strictEqual(
      linhaDoPerfil(
        perfil({ campus: curitiba, categoria: "docente", cargo: "professor-ebtt", funcao: "coordenacao-curso" }),
      ),
      "Coordenação de Curso · Campus Curitiba",
    );
    assert.strictEqual(linhaDoPerfil({ ...pedagogo, campus: curitiba }), "Pedagogo · Campus Curitiba");
    assert.strictEqual(linhaDoPerfil(perfil({ categoria: "docente", cargo: "outro" })), "Docente");
    assert.strictEqual(
      linhaDoPerfil({ ...proens, categoria: "tecnico-administrativo" }),
      "Técnico-administrativo · PROENS",
    );
    assert.isUndefined(linhaDoPerfil(perfil()));
  });
});
