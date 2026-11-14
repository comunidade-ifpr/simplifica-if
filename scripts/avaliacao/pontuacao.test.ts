import { describe, expect, test } from "vite-plus/test";
import { carregarGabaritoConjunto, carregarPerguntas, carregarUniversos } from "./carregar.ts";
import type { GabaritoConjunto, Pergunta, Universos } from "./esquema.ts";
import { normalizarTexto } from "./normalizar.ts";
import { pontuarConjunto, pontuarResposta } from "./pontuacao.ts";
import { detectarCursos, detectarNormas, idNorma, itemCampus, itemCurso, nucleoCurso } from "./universos.ts";

const perguntas = new Map(carregarPerguntas().perguntas.map((pergunta) => [pergunta.id, pergunta]));
const universos = carregarUniversos();

function pergunta(id: string): Pergunta {
  const encontrada = perguntas.get(id);
  if (!encontrada) throw new Error(`pergunta ${id} ausente`);
  return encontrada;
}

function pontuar(id: string, resposta: string) {
  const p = pergunta(id);
  const conjunto = p.gabarito.conjunto ? carregarGabaritoConjunto(p.gabarito.conjunto.arquivo) : undefined;
  return pontuarResposta(p, resposta, { conjunto, universos });
}

describe("normalização", () => {
  test("remove acentos, ordinais e ênfase", () => {
    expect(normalizarTexto("**Resolução CNE/CP nº 1/2021**, art. 37, § 6º")).toBe(
      "resolucao cne/cp no 1/2021, art. 37, § 6o",
    );
  });
});

describe("pontuação de perguntas pontuais", () => {
  test("resposta completa da Q09 tira nota 1", () => {
    const resposta = `O estágio obrigatório não pode ultrapassar **um terço** da carga horária mínima da habilitação
no CNCT (Resolução CNE/CP nº 2/2026, art. 37, § 6º). A carga do estágio é acrescida à carga mínima do curso
(art. 37, § 3º), em base-conhecimento/normas/br/resolucoes/RESOLUCAO_CNE-CP_2-2026_dcnept.md.`;
    const pontuacao = pontuar("Q09", resposta);
    expect(pontuacao.deve_conter.ausentes).toEqual([]);
    expect(pontuacao.nota).toBe(1);
  });

  test("resposta parcial perde cobertura e citação da norma revogada como vigente é penalizada", () => {
    const resposta = "Pela Resolução CNE/CP nº 1/2021, ainda vigente, o estágio tem limite de um terço.";
    const pontuacao = pontuar("Q09", resposta);
    expect(pontuacao.deve_conter.presentes).toEqual(["um-terco"]);
    expect(pontuacao.nao_deve_conter.encontrados).toEqual(["res-1-2021-como-vigente"]);
    expect(pontuacao.nota).toBe(0);
  });

  test("mencionar a 1/2021 como revogada ou aplicável aos matriculados não é penalizado", () => {
    for (const resposta of [
      "A Resolução CNE/CP nº 1/2021 não está mais vigente.",
      "A Res. CNE/CP 1/2021 foi revogada e só é aplicável aos matriculados, que concluem por ela.",
    ]) {
      expect(pontuar("Q09", resposta).nao_deve_conter.encontrados).toEqual([]);
    }
  });

  test("Q11 penaliza restringir o art. 71 aos cursos que citam a norma de 2021", () => {
    const certo = pontuar(
      "Q11",
      "Todos os cursos técnicos autorizados e em oferta têm até dois anos (art. 71); os matriculados podem concluir pela 1/2021; normas complementares em 180 dias (art. 73).",
    );
    expect(certo.nota).toBe(1);
    const errado = pontuar(
      "Q11",
      "Somente os cursos cujos PPCs que citam a Res. 1/2021 precisam se adequar em dois anos (art. 71).",
    );
    expect(errado.nao_deve_conter.encontrados).toEqual(["so-quem-cita"]);
  });

  test("resposta vazia tira 0 e lista todos os critérios como ausentes", () => {
    const pontuacao = pontuar("Q17", "");
    expect(pontuacao.nota).toBe(0);
    expect(pontuacao.deve_conter.ausentes.length).toBe(pergunta("Q17").gabarito.deve_conter.length);
  });
});

describe("pontuação de conjuntos", () => {
  const gabarito: GabaritoConjunto = {
    pergunta: "Q99",
    gerado_por: "teste",
    criterio: "teste",
    universo: "campus",
    avaliar_precisao: true,
    esperado: ["campus:curitiba", "campus:londrina"],
    detalhes: {},
  };

  test("precisão e recall sobre os campi citados", () => {
    const resultado = pontuarConjunto("Curitiba (noturno) e Palmas.", gabarito, universos);
    expect(resultado.verdadeiros_positivos).toEqual(["campus:curitiba"]);
    expect(resultado.falsos_positivos).toEqual(["campus:palmas"]);
    expect(resultado.faltantes).toEqual(["campus:londrina"]);
    expect(resultado.precisao).toBe(0.5);
    expect(resultado.recall).toBe(0.5);
  });

  test("conjunto esperado vazio: resposta sem itens tem precisão e recall 1", () => {
    const vazio = { ...gabarito, esperado: [] };
    expect(pontuarConjunto("Nenhum PPC cita a resolução.", vazio, universos)).toMatchObject({
      precisao: 1,
      recall: 1,
      f1: 1,
    });
    expect(pontuarConjunto("Só o de Curitiba.", vazio, universos).precisao).toBe(0);
  });

  test("sem avaliar_precisao, itens extras não pesam", () => {
    const resultado = pontuarConjunto(
      "Curitiba, Londrina e Palmas",
      { ...gabarito, avaliar_precisao: false },
      universos,
    );
    expect(resultado.precisao).toBeNull();
    expect(resultado.falsos_positivos).toEqual([]);
    expect(resultado.f1).toBe(1);
  });

  test("Q13: lista aninhada sob o campus, com desambiguação de forma e nível", () => {
    const resposta = `## Campus Curitiba

- Técnico em Enfermagem
- Técnico em Massoterapia (subsequente)
- Técnico em Mecânica — subsequente
- Telecomunicações

## Observação
- Tecnologia em Massoterapia é graduação.`;
    const resultado = pontuar("Q13", resposta).conjunto;
    expect(resultado?.verdadeiros_positivos).toEqual([
      "curso:curitiba/tecnico-em-enfermagem",
      "curso:curitiba/tecnico-em-massoterapia",
      "curso:curitiba/tecnico-em-mecanica",
      "curso:curitiba/tecnico-em-telecomunicacoes",
    ]);
    expect(resultado?.falsos_positivos).toEqual([]);
  });

  test("Q02 reconhece PPC pelo caminho do arquivo", () => {
    const resposta =
      "- base-conhecimento/institucional/ifpr/ppcs/curitiba/tecnico-em-enfermagem.md (cita CNE/CP nº 1/2021)";
    expect(pontuar("Q02", resposta).conjunto?.verdadeiros_positivos).toEqual(["curso:curitiba/tecnico-em-enfermagem"]);
  });

  test("Q04 reconhece normas por número e ano, em grafias variadas", () => {
    const resposta = `- Res. CNE/CP nº 2, de 11 de novembro de 2026: revogou a Resolução CNE/CP nº 1/2021.
- Lei 15.468/2026 acrescentou o § 9º-B ao art. 26 da LDB.
- Resolução CONSUP/IFPR nº 242/2025 alterou a Resolução CONSUP/IFPR nº 08/2014.
- Inciso III do art. 6º da Resolução CNE/CEB nº 3/2025 revogado.`;
    const pontuacao = pontuar("Q04", resposta);
    expect(pontuacao.deve_conter.ausentes).toEqual([]);
    expect(pontuacao.conjunto?.verdadeiros_positivos).toEqual([
      "br/cne-ceb/res/2025/3",
      "br/cne-cp/res/2026/2",
      "br/lei/2026/15468",
      "ifpr/consup/res/2025/242",
    ]);
    expect(pontuacao.conjunto?.precisao).toBeNull();
  });
});

describe("universos", () => {
  test("núcleo do nome do curso", () => {
    expect(nucleoCurso("Técnico em Informática para Internet Integrado ao Ensino Médio")).toBe(
      "informatica para internet",
    );
    expect(nucleoCurso("Curso Técnico de Informática Integrado ao Ensino Médio")).toBe("informatica");
    expect(nucleoCurso("Administração – PROEJA")).toBe("administracao");
    expect(nucleoCurso("Tecnologia em Análise e Desenvolvimento de Sistemas")).toBe(
      "analise e desenvolvimento de sistemas",
    );
  });

  test("informática não conta quando a linha cita informática para internet", () => {
    const campi = [itemCampus("quedas-do-iguacu", "Quedas do Iguaçu")];
    const cursos = [
      itemCurso({
        campus_id: "quedas-do-iguacu",
        curso_slug: "tecnico-em-informatica",
        nome: "Técnico em Informática",
        forma_oferta: "integrado",
      }),
      itemCurso({
        campus_id: "quedas-do-iguacu",
        curso_slug: "tecnico-em-informatica-para-internet",
        nome: "Técnico em Informática para Internet",
        forma_oferta: "integrado",
      }),
    ];
    expect([...detectarCursos("Quedas do Iguaçu: Informática para Internet", cursos, campi)]).toEqual([
      "curso:quedas-do-iguacu/tecnico-em-informatica-para-internet",
    ]);
  });

  test("IDs provisórios de norma seguem o formato do plano", () => {
    const base = { aliases: [], path: "x.md" };
    expect(
      idNorma({
        ...base,
        title: "",
        tipo_documento: "Resolução",
        numero: 2,
        ano: 2026,
        orgao: "CNE/CP",
        jurisdicao: "BR",
      }),
    ).toBe("br/cne-cp/res/2026/2");
    expect(
      idNorma({
        ...base,
        title: "",
        tipo_documento: "Lei",
        numero: "9394",
        ano: 1996,
        orgao: "Presidência da República",
        jurisdicao: "BR",
      }),
    ).toBe("br/lei/1996/9394");
    expect(
      idNorma({
        ...base,
        title: "",
        tipo_documento: "Resolução",
        numero: 190,
        ano: 2024,
        orgao: "CONSUP/IFPR",
        jurisdicao: "IFPR",
      }),
    ).toBe("ifpr/consup/res/2024/190");
  });

  test("normas: a 1/2021 não se confunde com a CNE/CEB 1/2021 nem com a CNE/CP 5/2021", () => {
    const encontrados = (texto: string) => [...detectarNormas(texto, (universos as Universos).norma)];
    expect(encontrados("Resolução CNE/CP n. 01/2021")).toEqual(["br/cne-cp/res/2021/1"]);
    expect(encontrados("Resolução CNE/CEB nº 1/2021 e CNE/CP nº 5/2021")).toEqual([]);
    expect(encontrados("Lei nº 11.788/2008 (Lei do Estágio) e LDB")).toEqual(["br/lei/1996/9394", "br/lei/2008/11788"]);
  });
});
