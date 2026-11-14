/**
 * Ferramentas de normas (T2) sobre a fixture: contrato (entradas válidas e inválidas, saída no
 * `outputSchema`), determinismo, orçamento (teto do texto, paginação completa e sem repetição) e
 * a chamada pelo protocolo. A paridade com a CLI sobre o banco real está em `banco-real.test.ts`.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import * as moduloRegistro from "@simplifica-if/kb/normas/registro";
import * as moduloResolver from "@simplifica-if/kb/normas/resolver";
import { z } from "zod";
import { ErroEntrada } from "../src/envelope.ts";
import { buscarNorma, TETO_BUSCAR_NORMA } from "../src/ferramentas/buscar-norma.ts";
import { correspondencia, PAGINA_CORRESPONDENCIA, TETO_CORRESPONDENCIA } from "../src/ferramentas/correspondencia.ts";
import type { Ferramenta } from "../src/ferramentas/ferramenta.ts";
import { fichaNorma, TETO_FICHA_NORMA } from "../src/ferramentas/ficha-norma.ts";
import { lerDispositivos, TETO_LER_DISPOSITIVOS } from "../src/ferramentas/ler-dispositivos.ts";
import { resolverCitacoes, TETO_RESOLVER_CITACOES } from "../src/ferramentas/resolver-citacoes.ts";
import { criarContexto, criarServidor } from "../src/servidor.ts";
import { criarBancoFixture, diretorioTemporario, limparTemporarios } from "./fixture.ts";
import {
  ARTIGOS_NUMERADOS,
  DCN_2021,
  DCN_2026,
  EXTERNO,
  INCISOS_ART28,
  inserirNormas,
  STUB,
  TABELA,
  TAMANHO_ART36,
} from "./fixture-normas.ts";

afterEach(limparTemporarios);

function contexto() {
  const banco = criarBancoFixture();
  inserirNormas(banco);
  return criarContexto({ banco, pastaTrabalho: diretorioTemporario(), canal: "dev" });
}

type Ctx = ReturnType<typeof contexto>;

/** Responde e confere a saída no outputSchema e o texto no teto. */
function chamar<E extends z.ZodType, D extends z.ZodType>(
  ferramenta: Ferramenta<E, D>,
  args: unknown,
  ctx: Ctx,
  teto: number,
) {
  const r = ferramenta.responder(args, ctx);
  const validacao = ferramenta.saida.safeParse(r.resposta);
  if (!validacao.success) throw validacao.error;
  expect(r.texto.length).toBeLessThanOrEqual(teto);
  expect(r.texto.split("\n").at(-1)).toBe("Base de 13/11/2026 (versão dev).");
  return r;
}

/** Mesma entrada e mesmo banco: mesma saída byte a byte, inclusive num contexto novo. */
function deterministico(ferramenta: Ferramenta, args: unknown, ctx: Ctx) {
  const a = ferramenta.responder(args, ctx);
  const b = ferramenta.responder(args, ctx);
  const c = ferramenta.responder(args, contexto());
  for (const x of [b, c]) {
    expect(JSON.stringify(x.resposta)).toBe(JSON.stringify(a.resposta));
    expect(x.texto).toBe(a.texto);
  }
}

const tipos = (avisos: readonly { tipo: string; ref?: string | undefined }[]) =>
  avisos.map((a) => `${a.tipo} ${a.ref ?? ""}`.trim());

describe("buscar_norma", () => {
  test("citação vai ao dispositivo, com caput herdado, norma resumida e link", () => {
    const ctx = contexto();
    const { resposta, texto } = chamar(
      buscarNorma,
      { consulta: "Resolução CNE/CP nº 2/2026, art. 71, parágrafo único" },
      ctx,
      TETO_BUSCAR_NORMA,
    );
    expect(resposta.dados.resultados).toHaveLength(1);
    const [r] = resposta.dados.resultados;
    expect(r!.origem).toBe("citacao-resolvida");
    expect(r!.pontuacao).toBeNull();
    expect(r!.norma).toEqual({
      id: DCN_2026,
      titulo: "Resolução CNE/CP nº 2/2026",
      situacao: "base",
      status_vigencia: "vigente",
      vigencia_a_confirmar: false,
      data_publicacao: "2026-11-11",
      ementa: "Define as Diretrizes Curriculares Nacionais para a Educação Profissional e Tecnológica.",
      link: `ifpr://norma/${DCN_2026}`,
    });
    expect(r!.dispositivo).toMatchObject({
      id: `${DCN_2026}#art71-parunico`,
      rotulo: "Parágrafo único.",
      tipo: "paragrafo",
      subordinados: [],
      link: `ifpr://norma/${DCN_2026}#art71-parunico`,
    });
    expect(r!.dispositivo!.caput).toEqual([expect.stringMatching(/^Art\. 71\./)]);
    expect(resposta.avisos).toEqual([]);
    expect(texto).toContain(`[Resolução CNE/CP nº 2/2026, Parágrafo único.](ifpr://norma/${DCN_2026}#art71-parunico)`);
    expect(texto).toContain("> Art. 71. Para a adequação");
    expect(texto).toContain("fonte: `base-conhecimento/normas/br/resolucoes/RESOLUCAO_CNE-CP_2-2026_dcnept.md:");
  });

  test("ID com dispositivo; artigo com subordinados (com rótulos)", () => {
    const { resposta } = chamar(buscarNorma, { consulta: `${DCN_2026}#art74` }, contexto(), TETO_BUSCAR_NORMA);
    const d = resposta.dados.resultados[0]!.dispositivo!;
    expect(d.id).toBe(`${DCN_2026}#art74`);
    expect(d.subordinados).toEqual([
      { id: `${DCN_2026}#art74-ii`, rotulo: "II", texto: "II – a Resolução CNE/CP nº 1, de 5 de janeiro de 2021;" },
    ]);
  });

  test("dispositivo citado fora do texto: o ancestral, com aviso", () => {
    const { resposta } = chamar(buscarNorma, { consulta: `${DCN_2021}#art20-ix` }, contexto(), TETO_BUSCAR_NORMA);
    const r = resposta.dados.resultados[0]!;
    expect(r.dispositivo!.id).toBe(`${DCN_2021}#art20`);
    expect(r.citado_fora_do_texto).toBe(`${DCN_2021}#art20-ix`);
    expect(tipos(resposta.avisos)).toEqual([`nao-encontrado ${DCN_2021}#art20-ix`, `vigencia-a-confirmar ${DCN_2021}`]);
  });

  test("termos: busca textual com pontuação; stub e externo pelos metadados, com aviso de stub", () => {
    const ctx = contexto();
    const textual = chamar(buscarNorma, { consulta: "itinerário formativo egressos" }, ctx, TETO_BUSCAR_NORMA);
    expect(textual.resposta.dados.resultados.length).toBeGreaterThan(0);
    for (const r of textual.resposta.dados.resultados) {
      expect(r.origem).toBe("busca-textual");
      expect(typeof r.pontuacao).toBe("number");
    }
    const stub = chamar(buscarNorma, { consulta: "Resolução CNE/CEB nº 6/2012" }, ctx, TETO_BUSCAR_NORMA);
    const r = stub.resposta.dados.resultados[0]!;
    expect(r.norma.id).toBe(STUB);
    expect(r.metadados).toEqual({
      texto: expect.stringContaining("Resolução CNE/CEB nº 6/2012"),
      fonte: { path: "base-conhecimento/normas/stubs.yaml", linha_inicio: 10, linha_fim: 10 },
    });
    expect(tipos(stub.resposta.avisos)).toContain(`stub-sem-texto ${STUB}`);
    const externo = chamar(buscarNorma, { consulta: "NBR 6023", situacao: "externo" }, ctx, TETO_BUSCAR_NORMA);
    expect(externo.resposta.dados.resultados.map((x) => x.norma.id)).toEqual([EXTERNO]);
  });

  test("vigentes: tira a norma revogada na data; em: antes da revogação ela volta", () => {
    const ctx = contexto();
    const ids = (args: object) =>
      buscarNorma
        .responder({ consulta: "resolução educação profissional", limite: 20, ...args }, ctx)
        .resposta.dados.resultados.map((r) => r.norma.id);
    expect(ids({})).toContain(DCN_2021);
    expect(ids({ vigentes: true })).not.toContain(DCN_2021);
    expect(ids({ vigentes: true, em: "2025-01-01" })).toContain(DCN_2021);
    expect(ids({ vigentes: true, em: "2025-01-01" })).not.toContain(DCN_2026);
  });

  test("nada encontrado: lista vazia e aviso", () => {
    const { resposta, texto } = chamar(buscarNorma, { consulta: "xyzzy plugh" }, contexto(), TETO_BUSCAR_NORMA);
    expect(resposta.dados.resultados).toEqual([]);
    expect(tipos(resposta.avisos)).toEqual(["nao-encontrado"]);
    expect(texto).toStartWith("Atenção: nenhuma norma encontrada");
  });

  test("orçamento: artigo longo é cortado no texto com '…' e a indicação de ler_dispositivos; o JSON fica inteiro", () => {
    const ctx = contexto();
    const { resposta, texto } = chamar(
      buscarNorma,
      { consulta: "Res. CNE/CP 2/2026, arts. 28 e 36" },
      ctx,
      TETO_BUSCAR_NORMA,
    );
    const [art28, art36] = resposta.dados.resultados.map((r) => r.dispositivo!);
    expect(art28!.subordinados).toHaveLength(INCISOS_ART28);
    expect(art36!.texto.length).toBeGreaterThan(TAMANHO_ART36);
    expect(texto).toContain("…");
    expect(texto).toContain(`Texto cortado: leia inteiro com \`ler_dispositivos\` (\`${DCN_2026}#art36\`).`);
    expect(texto).toContain(`(\`${DCN_2026}#art28\`, \`filhos: true\`)`);
    expect(texto.length).toBeGreaterThan(TETO_BUSCAR_NORMA * 0.8);
  });

  test("limite 20 com resultados longos cabe no teto", () => {
    chamar(
      buscarNorma,
      { consulta: "elemento projeto pedagógico itinerário", limite: 20 },
      contexto(),
      TETO_BUSCAR_NORMA,
    );
  });

  test("determinismo", () => {
    const ctx = contexto();
    deterministico(buscarNorma, { consulta: "Res. CNE/CP 2/2026, arts. 28 e 36" }, ctx);
    deterministico(buscarNorma, { consulta: "itinerário formativo egressos", limite: 20 }, ctx);
  });

  test("entrada inválida: erro legível com o campo", () => {
    const ctx = contexto();
    expect(() => buscarNorma.responder({}, ctx)).toThrow("→ at consulta");
    expect(() => buscarNorma.responder({ consulta: "  " }, ctx)).toThrow(ErroEntrada);
    expect(() => buscarNorma.responder({ consulta: "x".repeat(301) }, ctx)).toThrow("→ at consulta");
    expect(() => buscarNorma.responder({ consulta: "x", limite: 21 }, ctx)).toThrow("→ at limite");
    expect(() => buscarNorma.responder({ consulta: "x", situacao: "revogada" }, ctx)).toThrow("→ at situacao");
    expect(() => buscarNorma.responder({ consulta: "x", em: "13/11/2026" }, ctx)).toThrow("use AAAA-MM-DD");
    expect(() => buscarNorma.responder({ consulta: "x", outro: 1 }, ctx)).toThrow('"outro"');
  });
});

describe("ler_dispositivos", () => {
  test("lote: caput, notas, pai, estrutura, não encontrados, sem repetir IDs", () => {
    const ctx = contexto();
    const { resposta, texto } = chamar(
      lerDispositivos,
      { ids: [`${DCN_2026}#art28-vii`, `${DCN_2026}#art28-vii`, `${DCN_2021}#art99`, `${DCN_2021}#art20`] },
      ctx,
      TETO_LER_DISPOSITIVOS,
    );
    const [vii, art20] = resposta.dados.dispositivos;
    expect(resposta.dados.dispositivos).toHaveLength(2);
    expect(vii).toMatchObject({
      id: `${DCN_2026}#art28-vii`,
      norma: "Resolução CNE/CP nº 2/2026",
      rotulo: "VII",
      tipo: "inciso",
      caput: ["Art. 28. O PPC de curso técnico deve conter, no mínimo:"],
      notas: ["(Redação dada pela Resolução CNE/CP nº 3/2026)"],
      pai: `${DCN_2026}#art28`,
      estrutura: ["CAPÍTULO V"],
      subordinados: [],
    });
    expect(art20).toMatchObject({ id: `${DCN_2021}#art20`, pai: null, subordinados: [] });
    expect(resposta.dados.nao_encontrados).toEqual([`${DCN_2021}#art99`]);
    expect(tipos(resposta.avisos)).toEqual([`nao-encontrado ${DCN_2021}#art99`, `vigencia-a-confirmar ${DCN_2021}`]);
    expect(texto).toContain("nota: (Redação dada pela Resolução CNE/CP nº 3/2026)");
    expect(texto).toContain("estrutura: CAPÍTULO V");
  });

  test("filhos: subordinados com rótulo e a fonte até o último deles; revogado marcado", () => {
    const { resposta } = chamar(
      lerDispositivos,
      { ids: [`${DCN_2026}#art28`, `${DCN_2026}#art28-xx`], filhos: true },
      contexto(),
      TETO_LER_DISPOSITIVOS,
    );
    const [art28, xx] = resposta.dados.dispositivos;
    expect(art28!.subordinados).toHaveLength(INCISOS_ART28);
    expect(art28!.subordinados[0]).toMatchObject({ id: `${DCN_2026}#art28-i`, rotulo: "I" });
    expect(art28!.fonte.linha_fim).toBeGreaterThan(art28!.fonte.linha_inicio);
    expect(xx!.revogado).toBe(true);
  });

  test("orçamento: 20 IDs com filhos cabem no teto, com os textos longos cortados", () => {
    const ids = [
      `${DCN_2026}#art36`,
      `${DCN_2026}#art28`,
      ...Array.from({ length: 18 }, (_, i) => `${DCN_2021}#art${i + 1}`),
    ];
    const { resposta, texto } = chamar(lerDispositivos, { ids, filhos: true }, contexto(), TETO_LER_DISPOSITIVOS);
    expect(resposta.dados.dispositivos).toHaveLength(2 + ARTIGOS_NUMERADOS);
    expect(texto).toContain("Texto cortado para caber na resposta: peça menos IDs por chamada.");
    expect(texto).toContain(`Disposição ${ARTIGOS_NUMERADOS} da resolução de 2021`);
  });

  test("determinismo", () => {
    deterministico(lerDispositivos, { ids: [`${DCN_2026}#art28`, `${DCN_2021}#art20-i`], filhos: true }, contexto());
  });

  test("entrada inválida: erro legível", () => {
    const ctx = contexto();
    expect(() => lerDispositivos.responder({ ids: [] }, ctx)).toThrow("→ at ids");
    expect(() => lerDispositivos.responder({ ids: [DCN_2026] }, ctx)).toThrow("use o ID canônico com dispositivo");
    expect(() => lerDispositivos.responder({ ids: ["Res. CNE/CP 2/2026, art. 28"] }, ctx)).toThrow(ErroEntrada);
    const muitos = Array.from({ length: 21 }, (_, i) => `${DCN_2021}#art${i + 1}`);
    expect(() => lerDispositivos.responder({ ids: muitos }, ctx)).toThrow("→ at ids");
  });
});

describe("ficha_norma", () => {
  test("norma revogada: vigência a confirmar, eventos, relações nos dois sentidos, sucessora e transição", () => {
    const ctx = contexto();
    const { resposta, texto } = chamar(fichaNorma, { id: DCN_2021 }, ctx, TETO_FICHA_NORMA);
    const { norma, vigencia, relacoes, sucessoras, transicoes } = resposta.dados;
    expect(norma).toMatchObject({
      id: DCN_2021,
      situacao: "base",
      status_vigencia: "revogada",
      vigencia_a_confirmar: true,
      orgao: "CNE/CP",
      tipo_documento: "Resolução",
      numero: "1",
      ano: 2021,
      fonte_oficial: "https://www.in.gov.br/dcnept-2021",
    });
    expect(vigencia).toMatchObject({ data: "2026-11-13", status: "revogada", certo: false });
    expect(vigencia.inicio).toEqual({ data: null, minimo: "2021-01-05", certo: false });
    expect(vigencia.eventos).toEqual([
      {
        tipo: "revoga",
        origem: DCN_2026,
        operador: "#art74-ii",
        alvo_dispositivo: null,
        alcance: null,
        efeito_de: "2026-11-12",
        efeito_minimo: "2026-11-12",
        ocorreu: "sim",
      },
    ]);
    expect(vigencia.pendencias.length).toBeGreaterThan(0);
    expect(relacoes.entrada.map((r) => `${r.origem} ${r.tipo}`)).toEqual([`${DCN_2026} revoga`]);
    expect(relacoes.entrada[0]!.nota).toBe("Regras de transição nos arts. 70 a 72.");
    expect(relacoes.saida.map((r) => `${r.tipo} ${r.alvo}`)).toEqual([`revoga ${STUB}`]);
    expect(sucessoras).toEqual([DCN_2026]);
    expect(transicoes).toEqual([
      {
        id: "dcnept-2026-art71",
        dispositivo: `${DCN_2026}#art71`,
        tipo: "prazo-de-adequacao",
        norma_anterior: DCN_2021,
        aplica_a: "Cursos técnicos autorizados e em oferta.",
        regra: expect.stringMatching(/^Período de transição de até dois anos/),
        situacao_na_data: "em-curso",
        inicio_em: "2026-11-12",
        fim_em: "2028-11-12",
        evidencia: "é assegurado período de transição de até dois anos",
        link: `ifpr://norma/${DCN_2026}#art71`,
      },
    ]);
    expect(resposta.avisos.map((a) => a.tipo)).toEqual(vigencia.pendencias.map(() => "vigencia-a-confirmar"));
    expect(texto).toContain("**Vigência em 13/11/2026:** revogada (a confirmar)");
    expect(texto).toContain(`**Sucessoras:** [${DCN_2026}](ifpr://norma/${DCN_2026}).`);
    expect(texto).toContain(
      "em-curso na data; início 12/11/2026, fim 12/11/2028. Aplica-se a: Cursos técnicos autorizados e em oferta.",
    );
  });

  test("em: a situação muda com a data (antes da revogação, vigente; transição a iniciar)", () => {
    const { resposta } = chamar(
      fichaNorma,
      { id: `${DCN_2021}#art20`, em: "2025-06-01" },
      contexto(),
      TETO_FICHA_NORMA,
    );
    expect(resposta.dados.norma.id).toBe(DCN_2021);
    expect(resposta.dados.vigencia.data).toBe("2025-06-01");
    expect(resposta.dados.vigencia.eventos[0]!.ocorreu).toBe("não");
    expect(resposta.dados.transicoes[0]!.situacao_na_data).toBe("a-iniciar");
  });

  test("norma vigente sem pendências: sem avisos; stub e externo com aviso de sem texto", () => {
    const ctx = contexto();
    const vigente = chamar(fichaNorma, { id: DCN_2026 }, ctx, TETO_FICHA_NORMA);
    expect(vigente.resposta.dados.vigencia).toMatchObject({ status: "vigente", certo: true, pendencias: [] });
    expect(vigente.resposta.avisos).toEqual([]);
    expect(vigente.resposta.dados.relacoes.saida.map((r) => r.alvo)).toEqual([DCN_2021]);
    const stub = chamar(fichaNorma, { id: STUB }, ctx, TETO_FICHA_NORMA);
    expect(stub.resposta.dados.norma.situacao).toBe("stub");
    expect(tipos(stub.resposta.avisos)).toContain(`stub-sem-texto ${STUB}`);
    const externo = chamar(fichaNorma, { id: EXTERNO }, ctx, TETO_FICHA_NORMA);
    expect(tipos(externo.resposta.avisos)).toContain(`stub-sem-texto ${EXTERNO}`);
  });

  test("determinismo", () => {
    deterministico(fichaNorma, { id: DCN_2021, em: "2026-11-01" }, contexto());
  });

  test("entrada inválida e norma inexistente: erro legível", () => {
    const ctx = contexto();
    expect(() => fichaNorma.responder({}, ctx)).toThrow("→ at id");
    expect(() => fichaNorma.responder({ id: "Resolução CNE/CP nº 1/2021" }, ctx)).toThrow("use resolver_citacoes");
    expect(() => fichaNorma.responder({ id: DCN_2021, em: "2026-13" }, ctx)).toThrow("use AAAA-MM-DD");
    expect(() => fichaNorma.responder({ id: "br/lei/1900/1" }, ctx)).toThrow(ErroEntrada);
    expect(() => fichaNorma.responder({ id: "br/lei/1900/1" }, ctx)).toThrow("norma não encontrada na base");
  });
});

describe("correspondencia", () => {
  test("dispositivo: origem e destino com texto literal, nota, detalhes e aviso de rascunho", () => {
    const ctx = contexto();
    const { resposta, texto } = chamar(correspondencia, { id: `${DCN_2021}#art20` }, ctx, TETO_CORRESPONDENCIA);
    expect(resposta.dados.tabela).toEqual({
      arquivo: TABELA,
      origem: DCN_2021,
      destino: DCN_2026,
      status: "rascunho",
      elaborado_em: "2026-11-13",
      revisado_por: null,
    });
    expect(resposta.dados.itens).toHaveLength(1);
    const item = resposta.dados.itens[0]!;
    expect(item.origem.id).toBe(`${DCN_2021}#art20`);
    expect(item.tipo).toBe("parcial");
    expect(item.destino.map((d) => d.id)).toEqual([`${DCN_2026}#art22`]);
    expect(item.destino[0]!.texto).toStartWith("Art. 22.");
    expect(item.nota).toBe("A lista é retomada no art. 22, com acréscimos.");
    expect(item.herdado_de).toBeNull();
    expect(item.detalhes).toEqual([
      {
        origem: `${DCN_2021}#art20-i`,
        tipo: "equivalente",
        destino: [`${DCN_2026}#art22-v`],
        nota: "Base tecnológica, agora de composição obrigatória.",
      },
    ]);
    expect(resposta.pagina).toBeUndefined();
    expect(tipos(resposta.avisos)).toEqual([`correspondencia-rascunho ${TABELA}`]);
    expect(texto).toStartWith("Atenção: a tabela de correspondência");
    expect(texto).toContain("nunca como fundamento");
  });

  test("dispositivo sem linha própria herda do ancestral; sem equivalente fica sem destino", () => {
    const ctx = contexto();
    const herdado = chamar(correspondencia, { id: `${DCN_2021}#art20-ii` }, ctx, TETO_CORRESPONDENCIA);
    expect(herdado.resposta.dados.itens[0]).toMatchObject({ herdado_de: `${DCN_2021}#art20`, tipo: "parcial" });
    const sem = chamar(correspondencia, { id: `${DCN_2021}#art63` }, ctx, TETO_CORRESPONDENCIA);
    expect(sem.resposta.dados.itens[0]).toMatchObject({ tipo: "sem-equivalente", destino: [] });
  });

  test("norma inteira: páginas de 10 artigos, completas e sem repetição", () => {
    const ctx = contexto();
    const vistos: string[] = [];
    let cursor: string | undefined;
    let paginas = 0;
    do {
      const { resposta } = chamar(
        correspondencia,
        { id: DCN_2021, ...(cursor ? { cursor } : {}) },
        ctx,
        TETO_CORRESPONDENCIA,
      );
      expect(resposta.dados.itens.length).toBeLessThanOrEqual(PAGINA_CORRESPONDENCIA);
      vistos.push(...resposta.dados.itens.map((i) => i.origem.id));
      expect(resposta.pagina!.total).toBe(ARTIGOS_NUMERADOS + 2);
      cursor = resposta.pagina!.cursor;
      paginas += 1;
    } while (cursor);
    expect(paginas).toBe(2);
    expect(new Set(vistos).size).toBe(vistos.length);
    expect(vistos).toEqual([
      ...Array.from({ length: ARTIGOS_NUMERADOS }, (_, i) => `${DCN_2021}#art${i + 1}`),
      `${DCN_2021}#art20`,
      `${DCN_2021}#art63`,
    ]);
  });

  test("sem tabela e dispositivo fora dela: listas vazias com aviso", () => {
    const ctx = contexto();
    const semTabela = chamar(correspondencia, { id: `${DCN_2026}#art28` }, ctx, TETO_CORRESPONDENCIA);
    expect(semTabela.resposta.dados).toEqual({ tabela: null, itens: [] });
    expect(tipos(semTabela.resposta.avisos)).toEqual([`nao-encontrado ${DCN_2026}`]);
    const fora = chamar(correspondencia, { id: `${DCN_2021}#art99` }, ctx, TETO_CORRESPONDENCIA);
    expect(fora.resposta.dados.itens).toEqual([]);
    expect(tipos(fora.resposta.avisos)).toEqual([
      `nao-encontrado ${DCN_2021}#art99`,
      `correspondencia-rascunho ${TABELA}`,
    ]);
  });

  test("determinismo", () => {
    deterministico(correspondencia, { id: DCN_2021 }, contexto());
  });

  test("entrada inválida: erro legível; cursor de outra consulta ou com dispositivo", () => {
    const ctx = contexto();
    expect(() => correspondencia.responder({}, ctx)).toThrow("→ at id");
    expect(() => correspondencia.responder({ id: "Res 1/2021 art 20" }, ctx)).toThrow("use o ID canônico da norma");
    const cursor = correspondencia.responder({ id: DCN_2021 }, ctx).resposta.pagina!.cursor!;
    expect(() => correspondencia.responder({ id: DCN_2026, cursor }, ctx)).toThrow("o cursor é de outra consulta");
    expect(() => correspondencia.responder({ id: `${DCN_2021}#art20`, cursor }, ctx)).toThrow(
      "cursor só vale na consulta da norma inteira",
    );
    expect(() => correspondencia.responder({ id: DCN_2021, cursor: "lixo" }, ctx)).toThrow("cursor inválido");
  });
});

describe("resolver_citacoes", () => {
  const CITACOES = [
    "Resolução CNE/CP nº 1/2021, art. 20",
    "Res. CNE/CP 2/2026, art. 28, incisos VII e VIII",
    "Resolução CNE/CEB nº 6/2012",
    "ABNT NBR 6023",
    "CNCT",
    "texto sem citação",
  ];

  test("lote: ID, dispositivos completos, regra, confiança, situação, título e link", () => {
    const { resposta, texto } = chamar(resolverCitacoes, { citacoes: CITACOES }, contexto(), TETO_RESOLVER_CITACOES);
    const itens = resposta.dados.itens;
    expect(itens.map((i) => i.texto)).toEqual(CITACOES);
    expect(itens[0]).toMatchObject({
      id: DCN_2021,
      dispositivos: [`${DCN_2021}#art20`],
      situacao: "base",
      titulo: "Resolução CNE/CP nº 1/2021",
      link: `ifpr://norma/${DCN_2021}`,
    });
    expect(itens[0]!.confianca).toBeGreaterThanOrEqual(0.9);
    expect(itens[1]!.dispositivos).toEqual([`${DCN_2026}#art28-vii`, `${DCN_2026}#art28-viii`]);
    expect(itens[2]).toMatchObject({ id: STUB, situacao: "stub" });
    expect(itens[3]).toMatchObject({ id: EXTERNO, situacao: "externo", link: `ifpr://norma/${EXTERNO}` });
    expect(itens[4]).toMatchObject({ id: "cnct:catalogo", link: "ifpr://cnct/catalogo" });
    expect(itens[5]).toMatchObject({ id: null, dispositivos: [], situacao: "nao-resolvida", titulo: null, link: null });
    expect(tipos(resposta.avisos)).toEqual(["nao-encontrado", `stub-sem-texto ${STUB}`, `stub-sem-texto ${EXTERNO}`]);
    expect(texto).toContain('6. "texto sem citação" → não identificada (regra `nao-reconhecida`)');
    expect(texto).toContain(`→ [Resolução CNE/CP nº 1/2021](ifpr://norma/${DCN_2021}): \`${DCN_2021}#art20\``);
  });

  test("confiança abaixo de 0,9 gera aviso e pede conferência; ID fora do registro é nao-registrada", () => {
    const { resposta, texto } = chamar(
      resolverCitacoes,
      {
        citacoes: ["Resolução CNE/CEB nº 1, de 5 de janeiro de 2021", "Resolução CNE/CP nº 1, de 5 de janeiro de 2020"],
      },
      contexto(),
      TETO_RESOLVER_CITACOES,
    );
    const [trocado, ausente] = resposta.dados.itens;
    expect(trocado).toMatchObject({ id: DCN_2021, regra: "dcnept-2021-orgao-trocado", confianca: 0.7 });
    expect(ausente).toMatchObject({ id: "br/cne-cp/res/2020/1", situacao: "nao-registrada", titulo: null });
    expect(tipos(resposta.avisos)).toEqual(["citacao-baixa-confianca"]);
    expect(resposta.avisos[0]!.mensagem).toStartWith("1 citação resolvida com confiança abaixo de 0,9");
    expect(texto).toContain("confiança 0.7, base; conferir no trecho)");
  });

  test("orçamento: 50 citações longas cabem no teto", () => {
    const longas = Array.from(
      { length: 50 },
      (_, i) => `${"Considerando o disposto ".repeat(18)}Resolução CNE/CP nº 1/2021, art. ${i + 1}`,
    );
    const { resposta } = chamar(resolverCitacoes, { citacoes: longas }, contexto(), TETO_RESOLVER_CITACOES);
    expect(resposta.dados.itens).toHaveLength(50);
  });

  test("determinismo", () => {
    deterministico(resolverCitacoes, { citacoes: CITACOES }, contexto());
  });

  test("entrada inválida: erro legível", () => {
    const ctx = contexto();
    expect(() => resolverCitacoes.responder({ citacoes: [] }, ctx)).toThrow("→ at citacoes");
    expect(() => resolverCitacoes.responder({ citacoes: [""] }, ctx)).toThrow("→ at citacoes[0]");
    expect(() => resolverCitacoes.responder({ citacoes: Array(51).fill("LDB") }, ctx)).toThrow("→ at citacoes");
    expect(() => resolverCitacoes.responder({ citacoes: "LDB" }, ctx)).toThrow(ErroEntrada);
  });
});

describe("ferramentas de normas pelo protocolo MCP (em memória)", () => {
  test("structuredContent passa no outputSchema do cliente; erro de entrada e norma inexistente viram isError", async () => {
    const ctx = contexto();
    const servidor = criarServidor(ctx);
    const [lado, outro] = InMemoryTransport.createLinkedPair();
    await servidor.connect(lado);
    const cliente = new Client({ name: "teste", version: "0" });
    await cliente.connect(outro);
    try {
      const chamadas: [string, Record<string, unknown>][] = [
        ["buscar_norma", { consulta: "Res. CNE/CP 2/2026, art. 28" }],
        ["ler_dispositivos", { ids: [`${DCN_2026}#art71`], filhos: true }],
        ["ficha_norma", { id: DCN_2021 }],
        ["correspondencia", { id: DCN_2021 }],
        ["resolver_citacoes", { citacoes: ["LDB, art. 36", "CNCT"] }],
      ];
      for (const [name, args] of chamadas) {
        const r = await cliente.callTool({ name, arguments: args });
        expect(r.isError).toBeFalsy();
        expect(r.structuredContent).toMatchObject({ base: { data_referencia: "2026-11-13" } });
      }
      const invalida = await cliente.callTool({ name: "ler_dispositivos", arguments: { ids: [] } });
      expect(invalida.isError).toBe(true);
      const inexistente = await cliente.callTool({ name: "ficha_norma", arguments: { id: "br/lei/1900/1" } });
      expect(inexistente.isError).toBe(true);
      expect((inexistente.content as { text: string }[])[0]!.text).toContain("norma não encontrada na base");
    } finally {
      await cliente.close();
      await servidor.close();
    }
  });
});

describe("ferramentas de normas sem o repositório", () => {
  test("só com o kb.sqlite num diretório: nenhuma leitura de arquivo fora dele, mesma saída", () => {
    const chamadas: [Ferramenta, unknown][] = [
      [buscarNorma, { consulta: "Res. CNE/CP 2/2026, art. 28, VII" }],
      [buscarNorma, { consulta: "itinerário formativo egressos", vigentes: true }],
      [lerDispositivos, { ids: [`${DCN_2026}#art28`, `${DCN_2021}#art20`], filhos: true }],
      [fichaNorma, { id: DCN_2021 }],
      [correspondencia, { id: DCN_2021 }],
      [correspondencia, { id: `${DCN_2021}#art20-ii` }],
      [resolverCitacoes, { citacoes: ["Resolução CNE/CP nº 1/2021, art. 20", "LDB", "CNCT", "nada"] }],
    ];
    const ctx = contexto();
    const esperado = chamadas.map(([f, args]) => f.responder(args, ctx));
    ctx.db.close();

    const vazio = fs.realpathSync(diretorioTemporario("simplifica-mcp-sem-repo-"));
    const banco = path.join(vazio, "kb.sqlite");
    const origem = criarBancoFixture();
    inserirNormas(origem);
    fs.copyFileSync(origem, banco);
    const cwd = process.cwd();
    process.chdir(vazio);
    const tentativas: string[] = [];
    const dentro = (alvo: unknown) =>
      typeof alvo === "string" &&
      (path.resolve(alvo) === vazio || path.resolve(alvo).startsWith(`${vazio}${path.sep}`));
    const espioes = [
      ...(["readFileSync", "readdirSync", "existsSync", "statSync", "lstatSync", "openSync"] as const).map((nome) => {
        const original = fs[nome] as (...args: unknown[]) => unknown;
        return spyOn(fs, nome).mockImplementation(((...args: unknown[]) => {
          if (dentro(args[0])) return original(...args);
          tentativas.push(`${nome} ${String(args[0])}`);
          throw new Error(`ferramenta leu arquivo fora do banco: ${nome} ${String(args[0])}`);
        }) as never);
      }),
      spyOn(moduloRegistro, "raizRepositorio").mockImplementation(() => {
        tentativas.push("raizRepositorio");
        throw new Error("ferramenta procurou a raiz do repositório");
      }),
      spyOn(moduloResolver, "registroPadrao").mockImplementation(() => {
        tentativas.push("registroPadrao");
        throw new Error("ferramenta usou o registro do checkout");
      }),
    ];
    try {
      const isolado = criarContexto({ banco, pastaTrabalho: vazio, canal: "dev" });
      try {
        chamadas.forEach(([f, args], i) => {
          const r = f.responder(args, isolado);
          expect(JSON.stringify(r.resposta)).toBe(JSON.stringify(esperado[i]!.resposta));
          expect(r.texto).toBe(esperado[i]!.texto);
        });
      } finally {
        isolado.db.close();
      }
      expect(tentativas).toEqual([]);
    } finally {
      process.chdir(cwd);
      for (const espiao of espioes) espiao.mockRestore();
    }
  });
});
