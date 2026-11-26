import { describe, expect, it } from "vite-plus/test";
import { etapasVistas, marcaDaEntrada } from "../conversa/etapas.ts";
import type { Item } from "../conversa/estado.ts";
import {
  resumoMudancasPasta,
  dispositivoPorExtenso,
  duracaoPorExtenso,
  faltando,
  montarPedido,
  nomeArea,
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
  const conversa = {
    pedido: "Confira a fundamentação normativa de {documento}.\nO curso é {curso}.",
    entradas: [
      { id: "documento", tipo: "arquivo", rotulo: "Documento a conferir" },
      { id: "curso", tipo: "curso", rotulo: "Curso", opcional: true },
      { id: "norma", tipo: "norma", rotulo: "Norma de referência", opcional: true },
    ],
  } as const;
  /** O que a pessoa preencheu, pelo `id` da entrada. */
  const preenchido = (valores: Readonly<Record<string, string>>) => new Map(Object.entries(valores));
  it("monta o pedido do manifesto com o que foi preenchido", () => {
    // A linha que só cita uma entrada opcional vazia sai.
    expect(montarPedido(conversa, preenchido({ documento: "parecer.md" }))).toBe(
      "Confira a fundamentação normativa de parecer.md.",
    );
    expect(montarPedido(conversa, preenchido({ documento: "p.md", curso: "Técnico em Agropecuária" }))).toBe(
      "Confira a fundamentação normativa de p.md.\nO curso é Técnico em Agropecuária.",
    );
    // A obrigatória por preencher aparece pelo rótulo (o formulário não deixa começar sem ela).
    expect(montarPedido(conversa, preenchido({}))).toBe("Confira a fundamentação normativa de [documento a conferir].");
    // A entrada preenchida que o pedido não cita vai numa linha própria, no fim.
    expect(montarPedido(conversa, preenchido({ documento: "p.md", norma: "Resolução CNE/CP nº 2/2026" }))).toBe(
      "Confira a fundamentação normativa de p.md.\nNorma de referência: Resolução CNE/CP nº 2/2026.",
    );
    // Um `{…}` que não é entrada fica como está.
    expect(montarPedido({ pedido: "Use {chaves} assim.", entradas: [] }, new Map())).toBe("Use {chaves} assim.");
  });
  it("diz o que falta, sem as opcionais", () => {
    expect(faltando(conversa.entradas, new Map())).toEqual(["Documento a conferir"]);
    expect(faltando(conversa.entradas, preenchido({ documento: "x.md" }))).toEqual([]);
  });
  it("entrada, marcador e área com nome herdado de Object.prototype não acham o que o objeto herda", () => {
    const herdada = {
      pedido: "Confira {constructor} e {toString}.",
      entradas: [
        { id: "constructor", tipo: "texto", rotulo: "Construtor" },
        { id: "toString", tipo: "texto", rotulo: "Texto", opcional: true },
      ],
    } as const;
    // Sem nada preenchido: a obrigatória falta, e o pedido a mostra pelo rótulo.
    expect(faltando(herdada.entradas, new Map())).toEqual(["Construtor"]);
    expect(montarPedido(herdada, new Map())).toBe("Confira [construtor] e .");
    expect(faltando(herdada.entradas, preenchido({ constructor: "a ata" }))).toEqual([]);
    expect(montarPedido(herdada, preenchido({ constructor: "a ata", toString: "o parecer" }))).toBe(
      "Confira a ata e o parecer.",
    );
    // Um `{constructor}` que não é entrada fica como está.
    expect(montarPedido({ pedido: "Use {constructor}.", entradas: [] }, new Map())).toBe("Use {constructor}.");
    expect(nomeArea("ensino")).toBe("Ensino");
    expect(nomeArea("constructor")).toBe("Constructor");
    expect(nomeCurtoLink("ifpr://norma/br/constructor/1996/9394")).toBe("Norma");
    expect(nomeCurtoLink("ifpr://ppc/curitiba/tecnico-em-enfermagem#constructor-1")).toBe(
      "PPC · Técnico em enfermagem (Curitiba), uma seção",
    );
  });
  it("duração e título da pasta", () => {
    expect(duracaoPorExtenso("10min")).toBe("cerca de 10 minutos");
    expect(duracaoPorExtenso("1h")).toBe("cerca de 1 hora");
    expect(duracaoPorExtenso("logo")).toBeUndefined();
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
    expect(resumoMudancasPasta({ anexados: [], novos: ["Ata.docx"], mudados: [], removidos: [], semTexto: [] })).toBe(
      "Na pasta, desde a última resposta: 1 novo (Ata.docx). A IA foi avisada.",
    );
    expect(
      resumoMudancasPasta({
        anexados: [],
        novos: [],
        mudados: ["a.md", "b.md", "c.md", "d.md", "e.md"],
        removidos: ["x\ny.md"],
        semTexto: [],
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
    expect(resumoMudancasPasta({ anexados: ["Ata.docx"], novos: [], mudados: [], removidos: [], semTexto: [] })).toBe(
      "Anexado: Ata.docx. A IA foi avisada.",
    );
    expect(
      resumoMudancasPasta({ anexados: ["a.pdf", "b.png"], novos: ["c.md"], mudados: [], removidos: [], semTexto: [] }),
    ).toBe("Anexados: a.pdf, b.png. Na pasta, desde a última resposta: 1 novo (c.md). A IA foi avisada.");
  });
});
