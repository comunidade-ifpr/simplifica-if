/**
 * O catálogo no Início e em "Todas as tarefas": o perfil ordena e filtra os cartões (M1.8, `publico` do
 * manifesto × os públicos do perfil), o link não tira da tela a tarefa que roda no app, a tarefa que
 * saiu do catálogo ainda nomeia a conversa dela, e o exemplo das boas-vindas sai do catálogo.
 */
import { assert, describe, it } from "@effect/vitest";
import {
  type AberturaTarefa,
  linhaDoPerfil,
  type Perfil,
  type Publico,
  publicosDoPerfil,
  type ResumoTarefa,
} from "@simplifica-if/contratos-app";
import { dominioDoLink, ROTAS_MODULO } from "./abrir.ts";
import { servePerfil, tarefasDoInicio, tarefasDoPerfil, tituloDaTarefa } from "./catalogo.ts";
import { exemplosDoPerfil, SKILL_EXEMPLO } from "./exemplo.ts";

const CONVERSA: AberturaTarefa = { tipo: "conversa", pedido: "Faça.", entradas: [], etapas: [] };
const MODULO: AberturaTarefa = { tipo: "modulo", modulo: "revisao-ppc" };
const link = (url: string): AberturaTarefa => ({ tipo: "link", url, requerLogin: true });

const tarefa = (id: string, publico: ReadonlyArray<Publico>, abertura: AberturaTarefa = CONVERSA): ResumoTarefa => ({
  id,
  titulo: id,
  resumo: "Resumo.",
  area: "ensino",
  publico: [...publico],
  situacao: "estavel",
  mantenedor: { nome: "Pessoa de Teste", github: "pessoa-de-teste" },
  abre: abertura,
});

/** Na ordem do servidor (a do `id`). */
const TAREFAS = [
  tarefa("calendario", ["docente"]),
  tarefa("conferir", ["proens", "dens", "coordenacao-curso", "pedagogia"], { ...CONVERSA, skill: SKILL_EXEMPLO }),
  tarefa("geral", []),
  tarefa("revisar-ppc", [], MODULO),
];

const perfil = (campos: Perfil = {}): Perfil => campos;
const docente = perfil({ categoria: "docente", cargo: "professor-ebtt" });
const pedagogo = perfil({ categoria: "tecnico-administrativo", cargo: "pedagogo" });
const outro = perfil({ categoria: "tecnico-administrativo", cargo: "contador" });
const proens = perfil({ campus: { id: "proens", nome: "Pró-Reitoria de Ensino (PROENS)" } });
const ids = (tarefas: ReadonlyArray<ResumoTarefa>) => tarefas.map((item) => item.id);

describe("cartões pelo perfil", () => {
  it("sem perfil ou com um cargo sem público: tudo, na ordem do catálogo", () => {
    const todas = ["calendario", "conferir", "geral", "revisar-ppc"];
    assert.deepStrictEqual(ids(tarefasDoInicio(TAREFAS, undefined)), todas);
    assert.deepStrictEqual(ids(tarefasDoInicio(TAREFAS, outro)), todas);
    assert.isUndefined(servePerfil(tarefasDoPerfil(TAREFAS, undefined)[0]!, undefined));
  });

  it("docente: o Início só com as que servem (e as sem público); Ver todas com o resto depois", () => {
    assert.deepStrictEqual(ids(tarefasDoInicio(TAREFAS, docente)), ["calendario", "geral", "revisar-ppc"]);
    assert.deepStrictEqual(ids(tarefasDoPerfil(TAREFAS, docente)), ["calendario", "geral", "revisar-ppc", "conferir"]);
  });

  it("quem é da PROENS: os públicos proens e dens servem", () => {
    assert.deepStrictEqual(ids(tarefasDoInicio(TAREFAS, proens)), ["conferir", "geral", "revisar-ppc"]);
  });

  it("a tarefa sem público serve a todo perfil, e quem não tem público vê tudo", () => {
    assert.deepStrictEqual(ids(tarefasDoInicio(TAREFAS, pedagogo)), ["conferir", "geral", "revisar-ppc"]);
    assert.deepStrictEqual(ids(tarefasDoInicio([tarefa("x", ["dens"])], outro)), ["x"]);
    assert.deepStrictEqual(ids(tarefasDoInicio([tarefa("x", ["dens"])], docente)), []);
  });
});

describe("tarefas de link e de módulo", () => {
  /** Quatro links que viriam antes na ordem do `id`, e as que rodam no app depois. */
  const comLinks = [
    tarefa("a-sistema", [], link("https://suap.example.org/")),
    tarefa("b-sistema", ["docente"], link("https://sei.example.org/")),
    tarefa("c-sistema", [], link("https://biblioteca.example.org/")),
    tarefa("d-sistema", [], link("https://calendario.example.org/")),
    ...TAREFAS,
  ];

  it("no Início, a tarefa que roda no app vem antes do link: quatro links não a tiram dos quatro cartões", () => {
    const inicio = ids(tarefasDoInicio(comLinks, undefined));
    assert.deepStrictEqual(inicio.slice(0, 4), ["calendario", "conferir", "geral", "revisar-ppc"]);
    assert.deepStrictEqual(inicio.slice(4), ["a-sistema", "b-sistema", "c-sistema", "d-sistema"]);
    // O link que não serve ao perfil sai do Início, como qualquer tarefa.
    assert.deepStrictEqual(ids(tarefasDoInicio(comLinks, pedagogo)), [
      "conferir",
      "geral",
      "revisar-ppc",
      "a-sistema",
      "c-sistema",
      "d-sistema",
    ]);
  });

  it("em Ver todas, a ordem é a do catálogo: o link não desce", () => {
    assert.deepStrictEqual(ids(tarefasDoPerfil(comLinks, undefined)).slice(0, 2), ["a-sistema", "b-sistema"]);
  });

  it("o domínio de destino do link e a rota do módulo", () => {
    assert.strictEqual(dominioDoLink("https://suap.example.org/accounts/login/?next=/"), "suap.example.org");
    assert.strictEqual(dominioDoLink("https://www.example.org/calendario"), "example.org");
    assert.strictEqual(ROTAS_MODULO["revisao-ppc"], "/revisao-ppc");
  });
});

describe("título da tarefa de uma conversa", () => {
  it("a do catálogo; a que saiu dele, pelo que o servidor guarda; a desconhecida, nenhum", () => {
    const catalogo = { tarefas: TAREFAS, retiradas: [{ id: "antiga", titulo: "Tarefa antiga" }] };
    assert.strictEqual(tituloDaTarefa(catalogo, "geral"), "geral");
    assert.strictEqual(tituloDaTarefa(catalogo, "antiga"), "Tarefa antiga");
    assert.isUndefined(tituloDaTarefa(catalogo, "inventada"));
  });
});

describe("tarefa de exemplo das boas-vindas", () => {
  const catalogo: ReadonlyArray<ResumoTarefa> = [
    {
      ...tarefa("conferir", [], { ...CONVERSA, skill: SKILL_EXEMPLO }),
      titulo: "Conferir a fundamentação normativa",
    },
    { ...tarefa("revisar-ppc", [], MODULO), titulo: "Revisar um PPC" },
  ];

  it("quem cuida de PPC: revisar um PPC primeiro, com o título e o id do catálogo", () => {
    const exemplos = exemplosDoPerfil({ categoria: "docente", funcao: "coordenacao-curso" }, catalogo);
    assert.deepStrictEqual(
      exemplos.map((exemplo) => [exemplo.tipo, exemplo.tarefa, exemplo.titulo]),
      [
        ["modulo", "revisar-ppc", "Revisar um PPC"],
        ["conversa", "conferir", "Conferir a fundamentação normativa de um trecho"],
      ],
    );
    assert.match(exemplos[0]!.custo, /não gasta a sua cota/);
  });

  it("os demais: a conversa curta primeiro; o exemplo cuja tarefa o catálogo não traz não aparece", () => {
    assert.strictEqual(exemplosDoPerfil(docente, catalogo)[0]?.tipo, "conversa");
    assert.deepStrictEqual(
      exemplosDoPerfil(undefined, catalogo.slice(1)).map((exemplo) => exemplo.tipo),
      ["modulo"],
    );
    // Uma conversa de outra skill não vira o exemplo do trecho.
    assert.deepStrictEqual(exemplosDoPerfil(undefined, [tarefa("outra", [])]), []);
    const conversa = exemplosDoPerfil(undefined, catalogo)[0];
    assert.strictEqual(
      conversa?.tipo === "conversa" ? conversa.pasta : undefined,
      "Exemplo - Conferir a fundamentação normativa",
    );
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
