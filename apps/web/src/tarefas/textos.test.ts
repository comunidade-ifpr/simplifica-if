import { describe, expect, it } from "vite-plus/test";
import { etapasVistas, marcaDaEntrada } from "../conversa/etapas.ts";
import type { Item } from "../conversa/estado.ts";
import {
  resumoMudancasPasta,
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
    expect(nomeCurtoLink("ifpr://revisao/lista-1/20261122#p-CT-SUP-12:abc")).toBe("PPC em revisão (texto convertido)");
    expect(nomeCurtoLink("ifpr://norma/br/lei/1996/9394#art36A")).toBe("Lei 9.394/1996, art. 36-A");
    expect(nomeCurtoLink("ifpr://norma/ifpr/consup/res/2024/190")).toBe("Res. CONSUP/IFPR 190/2024");
  });
  it("dispositivos por extenso", () => {
    expect(dispositivoPorExtenso("art28-par1-iv")).toBe("art. 28, § 1º, IV");
    expect(dispositivoPorExtenso("art71-parunico")).toBe("art. 71, parágrafo único");
    expect(dispositivoPorExtenso("anexo1-art5")).toBe("Anexo I, art. 5º");
    expect(dispositivoPorExtenso("art9-par2")).toBe("art. 9º, § 2º");
    expect(dispositivoPorExtenso("art10-par10")).toBe("art. 10, § 10");
    expect(dispositivoPorExtenso("anexo4-item3")).toBe("Anexo IV, item 3");
    expect(dispositivoPorExtenso("art4-i-al-a")).toBe("art. 4º, I, alínea a");
  });
  it("cursos, PPC, CNCT, campus, ficha e link desconhecido", () => {
    expect(nomeCurtoLink("ifpr://ppc/curitiba/tecnico-em-enfermagem#avaliacao-1")).toBe(
      "PPC · Técnico em enfermagem (Curitiba), seção de avaliação",
    );
    expect(nomeCurtoLink("ifpr://ppc/curitiba/tecnico-em-enfermagem#estagio_praticas-2")).toBe(
      "PPC · Técnico em enfermagem (Curitiba), seção de estágio e práticas",
    );
    expect(nomeCurtoLink("ifpr://ppc/curitiba/tecnico-em-enfermagem#xyz-1")).toBe(
      "PPC · Técnico em enfermagem (Curitiba), uma seção",
    );
    // Com a versão (o ano do documento), o nome a traz; sem ela, é o PPC vigente.
    expect(nomeCurtoLink("ifpr://ppc/curitiba/tecnico-em-enfermagem/2023#avaliacao-1")).toBe(
      "PPC 2023 · Técnico em enfermagem (Curitiba), seção de avaliação",
    );
    expect(nomeCurtoLink("ifpr://ppc/curitiba/tecnico-em-enfermagem/2023-2")).toBe(
      "PPC 2023-2 · Técnico em enfermagem (Curitiba)",
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
    classe: "mcp-app",
    turno: 1,
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

describe("resumoMudancasPasta", () => {
  it("conta cada grupo, com até três nomes e o resto como número", () => {
    expect(resumoMudancasPasta({ anexados: [], novos: ["Ata.docx"], mudados: [], removidos: [] })).toBe(
      "Na pasta, desde a última resposta: 1 novo (Ata.docx). A IA foi avisada.",
    );
    expect(
      resumoMudancasPasta({
        anexados: [],
        novos: [],
        mudados: ["a.md", "b.md", "c.md", "d.md", "e.md"],
        removidos: ["x\ny.md"],
      }),
    ).toBe(
      "Na pasta, desde a última resposta: 5 mudados (a.md, b.md, c.md e mais 2); 1 removido (x y.md). A IA foi avisada.",
    );
  });

  it("diz à pessoa quais documentos ficaram sem versão em texto", () => {
    expect(
      resumoMudancasPasta({
        anexados: [],
        novos: [],
        mudados: ["Minuta.docx"],
        removidos: [],
        semTexto: ["Minuta.docx"],
      }),
    ).toBe(
      "Na pasta, desde a última resposta: 1 mudado (Minuta.docx). A IA foi avisada. Sem versão em texto para a IA: Minuta.docx; a resposta pode não considerá-lo.",
    );
  });

  it("os anexos vêm antes do que mudou fora da conversa", () => {
    expect(resumoMudancasPasta({ anexados: ["Ata.docx"], novos: [], mudados: [], removidos: [] })).toBe(
      "Anexado: Ata.docx. A IA foi avisada.",
    );
    expect(resumoMudancasPasta({ anexados: ["a.pdf", "b.png"], novos: ["c.md"], mudados: [], removidos: [] })).toBe(
      "Anexados: a.pdf, b.png. Na pasta, desde a última resposta: 1 novo (c.md). A IA foi avisada.",
    );
  });
});
