import { describe, expect, it } from "vite-plus/test";
import { etapasVistas, marcaDaEntrada } from "../conversa/etapas.ts";
import type { Item } from "../conversa/estado.ts";
import {
  dataDaBase,
  dispositivoPorExtenso,
  duracaoPorExtenso,
  faltando,
  montarPedido,
  nomeCurtoLink,
  tituloDoPedido,
} from "./textos.ts";

describe("nome curto das citações", () => {
  it("normas, com e sem dispositivo", () => {
    expect(nomeCurtoLink("ifpr://norma/br/cne-cp/res/2026/2#art28-xviii")).toBe("Res. CNE/CP 2/2026, art. 28, XVIII");
    expect(nomeCurtoLink("ifpr://norma/br/lei/1996/9394")).toBe("Lei 9.394/1996");
    expect(nomeCurtoLink("ifpr://norma/br/lei/1996/9394#art36A")).toBe("Lei 9.394/1996, art. 36-A");
    expect(nomeCurtoLink("ifpr://norma/ifpr/consup/res/2024/190")).toBe("Res. CONSUP/IFPR 190/2024");
  });
  it("dispositivos por extenso", () => {
    expect(dispositivoPorExtenso("art28-par1-iv")).toBe("art. 28, § 1º, IV");
    expect(dispositivoPorExtenso("art71-parunico")).toBe("art. 71, parágrafo único");
    expect(dispositivoPorExtenso("anexo1-art5")).toBe("Anexo 1, art. 5");
  });
  it("cursos, PPC, CNCT, campus, ficha e link desconhecido", () => {
    expect(nomeCurtoLink("ifpr://ppc/curitiba/tecnico-em-enfermagem#avaliacao-1")).toBe(
      "PPC · Técnico em enfermagem (Curitiba), seção",
    );
    expect(nomeCurtoLink("ifpr://cnct/tecnico-em-enfermagem")).toBe("CNCT · Técnico em enfermagem");
    expect(nomeCurtoLink("ifpr://campus/curitiba")).toBe("Campus Curitiba");
    expect(nomeCurtoLink("ifpr://ficha/CT-CURR-12")).toBe("Critério CT-CURR-12");
    expect(nomeCurtoLink("ifpr://outra/coisa")).toBe("Fonte da base");
  });
});

describe("tarefa", () => {
  const skill = {
    titulo: "Conferir a fundamentação normativa",
    entradas: [
      { id: "documento", tipo: "arquivo", rotulo: "Documento a conferir" },
      { id: "curso", tipo: "curso", rotulo: "Curso", opcional: true },
    ],
  } as const;
  it("monta o pedido com o que foi preenchido", () => {
    expect(montarPedido(skill, { documento: "parecer.md" })).toBe(
      "Conferir a fundamentação normativa.\nDocumento a conferir: parecer.md (está na pasta da tarefa).",
    );
    expect(montarPedido(skill, { documento: "p.md", curso: "Técnico em Agropecuária" })).toContain(
      "Curso: Técnico em Agropecuária.",
    );
  });
  it("diz o que falta, sem as opcionais", () => {
    expect(faltando(skill.entradas, {})).toEqual(["Documento a conferir"]);
    expect(faltando(skill.entradas, { documento: "x.md" })).toEqual([]);
  });
  it("duração, data da base e título da pasta", () => {
    expect(duracaoPorExtenso("10min")).toBe("cerca de 10 minutos");
    expect(duracaoPorExtenso("1h")).toBe("cerca de 1 hora");
    expect(duracaoPorExtenso("logo")).toBeUndefined();
    expect(dataDaBase("2026-11-12")).toBe("12/11/2026");
    expect(tituloDoPedido("  Quais normas tratam do estágio supervisionado no técnico integrado?\nmais")).toBe(
      "Quais normas tratam do estágio supervisionado no técnico",
    );
  });
});

describe("etapas", () => {
  const declaradas = [
    { id: "ler", rotulo: "Ler" },
    { id: "fontes", rotulo: "Fontes", progresso: true },
    { id: "relatorio", rotulo: "Relatório" },
  ];
  const marca = (chave: string, entrada: unknown): Item => ({
    tipo: "ferramenta",
    chave,
    id: chave,
    nome: "mcp__ifpr__etapa",
    situacao: "concluida",
    ...(marcaDaEntrada(entrada) === undefined ? {} : { etapa: marcaDaEntrada(entrada)! }),
  });
  it("sem marca, tudo pendente", () => {
    expect(etapasVistas(declaradas, [], true).map((e) => e.situacao)).toEqual(["pendente", "pendente", "pendente"]);
  });
  it("a última marcada em andamento, com o progresso; as anteriores feitas", () => {
    const vistas = etapasVistas(
      declaradas,
      [
        marca("a", { id: "ler" }),
        marca("b", { id: "fontes", progresso: { feito: 2, total: 5 } }),
        marca("c", { id: "x" }),
      ],
      true,
    );
    expect(vistas.map((e) => e.situacao)).toEqual(["feita", "atual", "pendente"]);
    expect(vistas[1]!.progresso).toEqual({ feito: 2, total: 5 });
  });
  it("turno terminado na última etapa: tudo feito", () => {
    expect(etapasVistas(declaradas, [marca("a", { id: "relatorio" })], false).map((e) => e.situacao)).toEqual([
      "feita",
      "feita",
      "feita",
    ]);
  });
  it("entrada inválida não marca", () => {
    expect(marcaDaEntrada({ id: 3 })).toBeUndefined();
    expect(marcaDaEntrada({ id: "a", progresso: { feito: 9, total: 3 } })).toEqual({
      id: "a",
      progresso: { feito: 3, total: 3 },
    });
  });
});
