// @effect-diagnostics nodeBuiltinImport:off -- teste: monta o banco num diretório temporário vazio
/**
 * Ferramentas de normas (T2) sobre a fixture: contrato (entradas válidas e inválidas, saída no
 * `outputSchema`), determinismo, orçamento (teto do texto, paginação completa e sem repetição) e
 * a chamada pelo protocolo. A paridade com a CLI sobre o banco real está em `banco-real.test.ts`.
 */
import * as fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, expectTypeOf, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import type * as Schema from "effect/Schema";
import { ehEntradaInvalida } from "../src/contratos.ts";
import { buscarNorma, TETO_BUSCAR_NORMA } from "../src/ferramentas/buscar-norma.ts";
import { correspondencia, PAGINA_CORRESPONDENCIA, TETO_CORRESPONDENCIA } from "../src/ferramentas/correspondencia.ts";
import { fichaNorma, TETO_FICHA_NORMA } from "../src/ferramentas/ficha-norma.ts";
import { lerDispositivos, TETO_LER_DISPOSITIVOS } from "../src/ferramentas/ler-dispositivos.ts";
import { resolverCitacoes, TETO_RESOLVER_CITACOES } from "../src/ferramentas/resolver-citacoes.ts";
import type { layerLeitura } from "../src/servidor.ts";
import {
  camadaFerramentas,
  conectarEmMemoria,
  type FerramentaTestada,
  mensagemDeErro,
  responder,
  saidaValida,
} from "./apoio.ts";
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

/** Um banco de fixture novo, com as normas: o "contexto" de cada teste é o caminho do banco. */
function contexto(): string {
  const banco = criarBancoFixture();
  inserirNormas(banco);
  return banco;
}

/** A chamada sobre o banco `banco`: a `Resposta` e o texto para a IA. */
const resp = <D extends Schema.Top>(ferramenta: FerramentaTestada<D>, args: unknown, banco: string) =>
  responder(ferramenta, args).pipe(Effect.provide(camadaFerramentas(banco)));

/** A mensagem do erro de uma chamada que falha. */
const erro = (ferramenta: FerramentaTestada, args: unknown, banco: string) =>
  mensagemDeErro(ferramenta, args).pipe(Effect.provide(camadaFerramentas(banco)));

/** A chamada falha com `EntradaInvalida`. */
const entradaInvalida = (ferramenta: FerramentaTestada, args: unknown, banco: string) =>
  Effect.map(Effect.flip(resp(ferramenta, args, banco)), ehEntradaInvalida);

/** A mensagem de uma entrada inválida, conferido que o erro é `EntradaInvalida`. */
const erroDeEntrada = (ferramenta: FerramentaTestada, args: unknown, banco: string) =>
  Effect.gen(function* () {
    expect(yield* entradaInvalida(ferramenta, args, banco)).toBe(true);
    return yield* erro(ferramenta, args, banco);
  });

/** Responde e confere a saída no outputSchema e o texto no teto. */
const chamar = <D extends Schema.Top>(ferramenta: FerramentaTestada<D>, args: unknown, banco: string, teto: number) =>
  Effect.gen(function* () {
    const r = yield* resp(ferramenta, args, banco);
    if (!saidaValida(ferramenta, r.resposta)) throw new Error(`${ferramenta.nome}: saída fora do outputSchema`);
    expect(r.texto.length).toBeLessThanOrEqual(teto);
    expect(r.texto.split("\n").at(-1)).toBe("Base de 13/11/2026 (versão dev).");
    return r;
  });

/** Mesma entrada e mesmo banco: mesma saída byte a byte, inclusive num contexto novo. */
const deterministico = (ferramenta: FerramentaTestada, args: unknown, banco: string) =>
  Effect.gen(function* () {
    const a = yield* resp(ferramenta, args, banco);
    const b = yield* resp(ferramenta, args, banco);
    const c = yield* resp(ferramenta, args, contexto());
    for (const x of [b, c]) {
      expect(JSON.stringify(x.resposta)).toBe(JSON.stringify(a.resposta));
      expect(x.texto).toBe(a.texto);
    }
  });

const tipos = (avisos: readonly { tipo: string; ref?: string | undefined }[]) =>
  avisos.map((a) => `${a.tipo} ${a.ref ?? ""}`.trim());

describe("buscar_norma", () => {
  it.effect("citação vai ao dispositivo, com caput herdado, norma resumida e link", () =>
    Effect.gen(function* () {
      const ctx = contexto();
      const { resposta, texto } = yield* chamar(
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
      expect(texto).toContain(
        `[Resolução CNE/CP nº 2/2026, Parágrafo único.](ifpr://norma/${DCN_2026}#art71-parunico)`,
      );
      expect(texto).toContain("> Art. 71. Para a adequação");
      expect(texto).toContain("fonte: `base-conhecimento/normas/br/resolucoes/RESOLUCAO_CNE-CP_2-2026_dcnept.md:");
    }),
  );

  it.effect("ID com dispositivo; artigo com subordinados (com rótulos)", () =>
    Effect.gen(function* () {
      const { resposta } = yield* chamar(buscarNorma, { consulta: `${DCN_2026}#art74` }, contexto(), TETO_BUSCAR_NORMA);
      const d = resposta.dados.resultados[0]!.dispositivo!;
      expect(d.id).toBe(`${DCN_2026}#art74`);
      expect(d.subordinados).toEqual([
        { id: `${DCN_2026}#art74-ii`, rotulo: "II", texto: "II – a Resolução CNE/CP nº 1, de 5 de janeiro de 2021;" },
      ]);
    }),
  );

  it.effect("dispositivo citado fora do texto: o ancestral, com aviso", () =>
    Effect.gen(function* () {
      const { resposta } = yield* chamar(
        buscarNorma,
        { consulta: `${DCN_2021}#art20-ix` },
        contexto(),
        TETO_BUSCAR_NORMA,
      );
      const r = resposta.dados.resultados[0]!;
      expect(r.dispositivo!.id).toBe(`${DCN_2021}#art20`);
      expect(r.citado_fora_do_texto).toBe(`${DCN_2021}#art20-ix`);
      expect(tipos(resposta.avisos)).toEqual([
        `nao-encontrado ${DCN_2021}#art20-ix`,
        `vigencia-a-confirmar ${DCN_2021}`,
      ]);
    }),
  );

  it.effect("termos: busca textual com pontuação; stub e externo pelos metadados, com aviso de stub", () =>
    Effect.gen(function* () {
      const ctx = contexto();
      const textual = yield* chamar(buscarNorma, { consulta: "itinerário formativo egressos" }, ctx, TETO_BUSCAR_NORMA);
      expect(textual.resposta.dados.resultados.length).toBeGreaterThan(0);
      for (const r of textual.resposta.dados.resultados) {
        expect(r.origem).toBe("busca-textual");
        expect(typeof r.pontuacao).toBe("number");
      }
      const stub = yield* chamar(buscarNorma, { consulta: "Resolução CNE/CEB nº 6/2012" }, ctx, TETO_BUSCAR_NORMA);
      const r = stub.resposta.dados.resultados[0]!;
      expect(r.norma.id).toBe(STUB);
      expect(r.metadados).toEqual({
        texto: expect.stringContaining("Resolução CNE/CEB nº 6/2012"),
        fonte: { path: "base-conhecimento/normas/stubs.yaml", linha_inicio: 10, linha_fim: 10 },
      });
      expect(tipos(stub.resposta.avisos)).toContain(`stub-sem-texto ${STUB}`);
      const externo = yield* chamar(buscarNorma, { consulta: "NBR 6023", situacao: "externo" }, ctx, TETO_BUSCAR_NORMA);
      expect(externo.resposta.dados.resultados.map((x) => x.norma.id)).toEqual([EXTERNO]);
    }),
  );

  it.effect("vigentes: tira a norma revogada na data; em: antes da revogação ela volta", () =>
    Effect.gen(function* () {
      const ctx = contexto();
      const ids = (args: object) =>
        Effect.map(resp(buscarNorma, { consulta: "resolução educação profissional", limite: 20, ...args }, ctx), (r) =>
          r.resposta.dados.resultados.map((x) => x.norma.id),
        );
      expect(yield* ids({})).toContain(DCN_2021);
      expect(yield* ids({ vigentes: true })).not.toContain(DCN_2021);
      expect(yield* ids({ vigentes: true, em: "2025-01-01" })).toContain(DCN_2021);
      expect(yield* ids({ vigentes: true, em: "2025-01-01" })).not.toContain(DCN_2026);
    }),
  );

  it.effect("nada encontrado: lista vazia e aviso", () =>
    Effect.gen(function* () {
      const { resposta, texto } = yield* chamar(
        buscarNorma,
        { consulta: "xyzzy plugh" },
        contexto(),
        TETO_BUSCAR_NORMA,
      );
      expect(resposta.dados.resultados).toEqual([]);
      expect(tipos(resposta.avisos)).toEqual(["nao-encontrado"]);
      expect(String(texto).startsWith("Atenção: nenhuma norma encontrada")).toBe(true);
    }),
  );

  it.effect(
    "orçamento: artigo longo é cortado no texto com '…' e a indicação de ler_dispositivos; o JSON fica inteiro",
    () =>
      Effect.gen(function* () {
        const ctx = contexto();
        const { resposta, texto } = yield* chamar(
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
      }),
  );

  it.effect("limite 20 com resultados longos cabe no teto", () =>
    chamar(
      buscarNorma,
      { consulta: "elemento projeto pedagógico itinerário", limite: 20 },
      contexto(),
      TETO_BUSCAR_NORMA,
    ),
  );

  it.effect("determinismo", () =>
    Effect.gen(function* () {
      const ctx = contexto();
      yield* deterministico(buscarNorma, { consulta: "Res. CNE/CP 2/2026, arts. 28 e 36" }, ctx);
      yield* deterministico(buscarNorma, { consulta: "itinerário formativo egressos", limite: 20 }, ctx);
    }),
  );

  it.effect("entrada inválida: erro legível com o campo", () =>
    Effect.gen(function* () {
      const ctx = contexto();
      expect(yield* erroDeEntrada(buscarNorma, {}, ctx)).toContain("consulta: ");
      expect(yield* entradaInvalida(buscarNorma, { consulta: "  " }, ctx)).toBe(true);
      expect(yield* erroDeEntrada(buscarNorma, { consulta: "x".repeat(301) }, ctx)).toContain("consulta: ");
      expect(yield* erroDeEntrada(buscarNorma, { consulta: "x", limite: 21 }, ctx)).toContain("limite: ");
      expect(yield* erroDeEntrada(buscarNorma, { consulta: "x", situacao: "revogada" }, ctx)).toContain("situacao: ");
      expect(yield* erro(buscarNorma, { consulta: "x", em: "13/11/2026" }, ctx)).toContain("use AAAA-MM-DD");
      expect(yield* erro(buscarNorma, { consulta: "x", outro: 1 }, ctx)).toContain('"outro"');
    }),
  );
});

describe("ler_dispositivos", () => {
  it.effect("lote: caput, notas, pai, estrutura, não encontrados, sem repetir IDs", () =>
    Effect.gen(function* () {
      const ctx = contexto();
      const { resposta, texto } = yield* chamar(
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
    }),
  );

  it.effect("filhos: subordinados com rótulo e a fonte até o último deles; revogado marcado", () =>
    Effect.gen(function* () {
      const { resposta } = yield* chamar(
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
    }),
  );

  it.effect("orçamento: 20 IDs com filhos cabem no teto, com os textos longos cortados", () =>
    Effect.gen(function* () {
      const ids = [
        `${DCN_2026}#art36`,
        `${DCN_2026}#art28`,
        ...Array.from({ length: 18 }, (_, i) => `${DCN_2021}#art${i + 1}`),
      ];
      const { resposta, texto } = yield* chamar(
        lerDispositivos,
        { ids, filhos: true },
        contexto(),
        TETO_LER_DISPOSITIVOS,
      );
      expect(resposta.dados.dispositivos).toHaveLength(2 + ARTIGOS_NUMERADOS);
      expect(texto).toContain("Texto cortado para caber na resposta: peça menos IDs por chamada.");
      expect(texto).toContain(`Disposição ${ARTIGOS_NUMERADOS} da resolução de 2021`);
    }),
  );

  it.effect("determinismo", () =>
    deterministico(
      lerDispositivos,
      { ids: [`${DCN_2026}#art28`, `${DCN_2021}#art20-i`], filhos: true },
      contexto(),
    ),
  );

  it.effect("entrada inválida: erro legível", () =>
    Effect.gen(function* () {
      const ctx = contexto();
      expect(yield* erroDeEntrada(lerDispositivos, { ids: [] }, ctx)).toContain("ids: ");
      expect(yield* erro(lerDispositivos, { ids: [DCN_2026] }, ctx)).toContain("use o ID canônico com dispositivo");
      expect(yield* entradaInvalida(lerDispositivos, { ids: ["Res. CNE/CP 2/2026, art. 28"] }, ctx)).toBe(true);
      const muitos = Array.from({ length: 21 }, (_, i) => `${DCN_2021}#art${i + 1}`);
      expect(yield* erroDeEntrada(lerDispositivos, { ids: muitos }, ctx)).toContain("ids: ");
    }),
  );
});

describe("ficha_norma", () => {
  it.effect("norma revogada: vigência a confirmar, eventos, relações nos dois sentidos, sucessora e transição", () =>
    Effect.gen(function* () {
      const ctx = contexto();
      const { resposta, texto } = yield* chamar(fichaNorma, { id: DCN_2021 }, ctx, TETO_FICHA_NORMA);
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
    }),
  );

  it.effect("em: a situação muda com a data (antes da revogação, vigente; transição a iniciar)", () =>
    Effect.gen(function* () {
      const { resposta } = yield* chamar(
        fichaNorma,
        { id: `${DCN_2021}#art20`, em: "2025-06-01" },
        contexto(),
        TETO_FICHA_NORMA,
      );
      expect(resposta.dados.norma.id).toBe(DCN_2021);
      expect(resposta.dados.vigencia.data).toBe("2025-06-01");
      expect(resposta.dados.vigencia.eventos[0]!.ocorreu).toBe("não");
      expect(resposta.dados.transicoes[0]!.situacao_na_data).toBe("a-iniciar");
    }),
  );

  it.effect("norma vigente sem pendências: sem avisos; stub e externo com aviso de sem texto", () =>
    Effect.gen(function* () {
      const ctx = contexto();
      const vigente = yield* chamar(fichaNorma, { id: DCN_2026 }, ctx, TETO_FICHA_NORMA);
      expect(vigente.resposta.dados.vigencia).toMatchObject({ status: "vigente", certo: true, pendencias: [] });
      expect(vigente.resposta.avisos).toEqual([]);
      expect(vigente.resposta.dados.relacoes.saida.map((r) => r.alvo)).toEqual([DCN_2021]);
      const stub = yield* chamar(fichaNorma, { id: STUB }, ctx, TETO_FICHA_NORMA);
      expect(stub.resposta.dados.norma.situacao).toBe("stub");
      expect(tipos(stub.resposta.avisos)).toContain(`stub-sem-texto ${STUB}`);
      const externo = yield* chamar(fichaNorma, { id: EXTERNO }, ctx, TETO_FICHA_NORMA);
      expect(tipos(externo.resposta.avisos)).toContain(`stub-sem-texto ${EXTERNO}`);
    }),
  );

  it.effect("determinismo", () =>
    deterministico(fichaNorma, { id: DCN_2021, em: "2026-11-01" }, contexto()),
  );

  it.effect("entrada inválida e norma inexistente: erro legível", () =>
    Effect.gen(function* () {
      const ctx = contexto();
      expect(yield* erroDeEntrada(fichaNorma, {}, ctx)).toContain("id: ");
      expect(yield* erro(fichaNorma, { id: "Resolução CNE/CP nº 1/2021" }, ctx)).toContain("use resolver_citacoes");
      expect(yield* erro(fichaNorma, { id: DCN_2021, em: "2026-13" }, ctx)).toContain("use AAAA-MM-DD");
      expect(yield* entradaInvalida(fichaNorma, { id: "br/lei/1900/1" }, ctx)).toBe(true);
      expect(yield* erro(fichaNorma, { id: "br/lei/1900/1" }, ctx)).toContain("norma não encontrada na base");
    }),
  );
});

describe("correspondencia", () => {
  it.effect("dispositivo: origem e destino com texto literal, nota, detalhes e aviso de rascunho", () =>
    Effect.gen(function* () {
      const ctx = contexto();
      const { resposta, texto } = yield* chamar(
        correspondencia,
        { id: `${DCN_2021}#art20` },
        ctx,
        TETO_CORRESPONDENCIA,
      );
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
      expect(String(item.destino[0]!.texto).startsWith("Art. 22.")).toBe(true);
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
      expect(String(texto).startsWith("Atenção: a tabela de correspondência")).toBe(true);
      expect(texto).toContain("nunca como fundamento");
    }),
  );

  it.effect("dispositivo sem linha própria herda do ancestral; sem equivalente fica sem destino", () =>
    Effect.gen(function* () {
      const ctx = contexto();
      const herdado = yield* chamar(correspondencia, { id: `${DCN_2021}#art20-ii` }, ctx, TETO_CORRESPONDENCIA);
      expect(herdado.resposta.dados.itens[0]).toMatchObject({ herdado_de: `${DCN_2021}#art20`, tipo: "parcial" });
      const sem = yield* chamar(correspondencia, { id: `${DCN_2021}#art63` }, ctx, TETO_CORRESPONDENCIA);
      expect(sem.resposta.dados.itens[0]).toMatchObject({ tipo: "sem-equivalente", destino: [] });
    }),
  );

  it.effect("norma inteira: páginas de 10 artigos, completas e sem repetição", () =>
    Effect.gen(function* () {
      const ctx = contexto();
      const vistos: string[] = [];
      let cursor: string | undefined;
      let paginas = 0;
      do {
        const { resposta } = yield* chamar(
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
    }),
  );

  it.effect("sem tabela e dispositivo fora dela: listas vazias com aviso", () =>
    Effect.gen(function* () {
      const ctx = contexto();
      const semTabela = yield* chamar(correspondencia, { id: `${DCN_2026}#art28` }, ctx, TETO_CORRESPONDENCIA);
      expect(semTabela.resposta.dados).toEqual({ tabela: null, itens: [] });
      expect(tipos(semTabela.resposta.avisos)).toEqual([`nao-encontrado ${DCN_2026}`]);
      const fora = yield* chamar(correspondencia, { id: `${DCN_2021}#art99` }, ctx, TETO_CORRESPONDENCIA);
      expect(fora.resposta.dados.itens).toEqual([]);
      expect(tipos(fora.resposta.avisos)).toEqual([
        `nao-encontrado ${DCN_2021}#art99`,
        `correspondencia-rascunho ${TABELA}`,
      ]);
    }),
  );

  it.effect("determinismo", () =>
    deterministico(correspondencia, { id: DCN_2021 }, contexto()),
  );

  it.effect("entrada inválida: erro legível; cursor de outra consulta ou com dispositivo", () =>
    Effect.gen(function* () {
      const ctx = contexto();
      expect(yield* erroDeEntrada(correspondencia, {}, ctx)).toContain("id: ");
      expect(yield* erro(correspondencia, { id: "Res 1/2021 art 20" }, ctx)).toContain("use o ID canônico da norma");
      const cursor = (yield* resp(correspondencia, { id: DCN_2021 }, ctx)).resposta.pagina!.cursor!;
      expect(yield* erro(correspondencia, { id: DCN_2026, cursor }, ctx)).toContain("o cursor é de outra consulta");
      expect(yield* erro(correspondencia, { id: `${DCN_2021}#art20`, cursor }, ctx)).toContain(
        "cursor só vale na consulta da norma inteira",
      );
      expect(yield* erro(correspondencia, { id: DCN_2021, cursor: "lixo" }, ctx)).toContain("cursor inválido");
    }),
  );
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

  it.effect("lote: ID, dispositivos completos, regra, confiança, situação, título e link", () =>
    Effect.gen(function* () {
      const { resposta, texto } = yield* chamar(
        resolverCitacoes,
        { citacoes: CITACOES },
        contexto(),
        TETO_RESOLVER_CITACOES,
      );
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
      expect(itens[5]).toMatchObject({
        id: null,
        dispositivos: [],
        situacao: "nao-resolvida",
        titulo: null,
        link: null,
      });
      expect(tipos(resposta.avisos)).toEqual(["nao-encontrado", `stub-sem-texto ${STUB}`, `stub-sem-texto ${EXTERNO}`]);
      expect(texto).toContain('6. "texto sem citação" → não identificada (regra `nao-reconhecida`)');
      expect(texto).toContain(`→ [Resolução CNE/CP nº 1/2021](ifpr://norma/${DCN_2021}): \`${DCN_2021}#art20\``);
    }),
  );

  it.effect("confiança abaixo de 0,9 gera aviso e pede conferência; ID fora do registro é nao-registrada", () =>
    Effect.gen(function* () {
      const { resposta, texto } = yield* chamar(
        resolverCitacoes,
        {
          citacoes: [
            "Resolução CNE/CEB nº 1, de 5 de janeiro de 2021",
            "Resolução CNE/CP nº 1, de 5 de janeiro de 2020",
          ],
        },
        contexto(),
        TETO_RESOLVER_CITACOES,
      );
      const [trocado, ausente] = resposta.dados.itens;
      expect(trocado).toMatchObject({ id: DCN_2021, regra: "dcnept-2021-orgao-trocado", confianca: 0.7 });
      expect(ausente).toMatchObject({ id: "br/cne-cp/res/2020/1", situacao: "nao-registrada", titulo: null });
      expect(tipos(resposta.avisos)).toEqual(["citacao-baixa-confianca"]);
      expect(String(resposta.avisos[0]!.mensagem).startsWith("1 citação resolvida com confiança abaixo de 0,9")).toBe(
        true,
      );
      expect(texto).toContain("confiança 0.7, base; conferir no trecho)");
    }),
  );

  it.effect("orçamento: 50 citações longas cabem no teto", () =>
    Effect.gen(function* () {
      const longas = Array.from(
        { length: 50 },
        (_, i) => `${"Considerando o disposto ".repeat(18)}Resolução CNE/CP nº 1/2021, art. ${i + 1}`,
      );
      const { resposta } = yield* chamar(resolverCitacoes, { citacoes: longas }, contexto(), TETO_RESOLVER_CITACOES);
      expect(resposta.dados.itens).toHaveLength(50);
    }),
  );

  it.effect("determinismo", () =>
    deterministico(resolverCitacoes, { citacoes: CITACOES }, contexto()),
  );

  it.effect("entrada inválida: erro legível", () =>
    Effect.gen(function* () {
      const ctx = contexto();
      expect(yield* erroDeEntrada(resolverCitacoes, { citacoes: [] }, ctx)).toContain("citacoes: ");
      expect(yield* erroDeEntrada(resolverCitacoes, { citacoes: [""] }, ctx)).toContain("citacoes.0: ");
      expect(yield* erroDeEntrada(resolverCitacoes, { citacoes: Array(51).fill("LDB") }, ctx)).toContain("citacoes: ");
      expect(yield* entradaInvalida(resolverCitacoes, { citacoes: "LDB" }, ctx)).toBe(true);
    }),
  );
});

describe("ferramentas de normas pelo protocolo MCP (em memória)", () => {
  it.effect(
    "structuredContent passa no outputSchema do cliente; erro de entrada e norma inexistente viram isError",
    () =>
      Effect.gen(function* () {
        const cliente = yield* conectarEmMemoria(contexto());
        const chamadas: [string, Record<string, unknown>][] = [
          ["buscar_norma", { consulta: "Res. CNE/CP 2/2026, art. 28" }],
          ["ler_dispositivos", { ids: [`${DCN_2026}#art71`], filhos: true }],
          ["ficha_norma", { id: DCN_2021 }],
          ["correspondencia", { id: DCN_2021 }],
          ["resolver_citacoes", { citacoes: ["LDB, art. 36", "CNCT"] }],
        ];
        for (const [name, args] of chamadas) {
          const r = yield* Effect.promise(() => cliente.callTool({ name, arguments: args }));
          expect(r.isError).toBeFalsy();
          expect(r.structuredContent).toMatchObject({ base: { data_referencia: "2026-11-13" } });
        }
        const invalida = yield* Effect.promise(() =>
          cliente.callTool({ name: "ler_dispositivos", arguments: { ids: [] } }),
        );
        expect(invalida.isError).toBe(true);
        const inexistente = yield* Effect.promise(() =>
          cliente.callTool({ name: "ficha_norma", arguments: { id: "br/lei/1900/1" } }),
        );
        expect(inexistente.isError).toBe(true);
        expect((inexistente.content as { text: string }[])[0]!.text).toContain("norma não encontrada na base");
      }).pipe(Effect.scoped),
  );
});

describe("ferramentas de normas sem o repositório", () => {
  it.effect("só com o kb.sqlite num diretório: o tipo não pede FileSystem, mesma saída", () =>
    Effect.gen(function* () {
      // a garantia é de tipo: a layer das ferramentas não exige nada do ambiente (nem FileSystem)
      expectTypeOf<Layer.Services<ReturnType<typeof layerLeitura>>>().toEqualTypeOf<never>();
      expectTypeOf<Layer.Services<ReturnType<typeof camadaFerramentas>>>().toEqualTypeOf<never>();
      const chamadas: [FerramentaTestada, unknown][] = [
        [buscarNorma, { consulta: "Res. CNE/CP 2/2026, art. 28, VII" }],
        [buscarNorma, { consulta: "itinerário formativo egressos", vigentes: true }],
        [lerDispositivos, { ids: [`${DCN_2026}#art28`, `${DCN_2021}#art20`], filhos: true }],
        [fichaNorma, { id: DCN_2021 }],
        [correspondencia, { id: DCN_2021 }],
        [correspondencia, { id: `${DCN_2021}#art20-ii` }],
        [resolverCitacoes, { citacoes: ["Resolução CNE/CP nº 1/2021, art. 20", "LDB", "CNCT", "nada"] }],
      ];
      const origem = contexto();
      const esperado = yield* Effect.forEach(chamadas, ([f, args]) => resp(f, args, origem));

      const vazio = fs.realpathSync(diretorioTemporario("simplifica-mcp-sem-repo-"));
      const banco = path.join(vazio, "kb.sqlite");
      fs.copyFileSync(origem, banco);
      const cwd = process.cwd();
      process.chdir(vazio);
      const obtido = yield* Effect.forEach(chamadas, ([f, args]) => resp(f, args, banco)).pipe(
        Effect.ensuring(Effect.sync(() => process.chdir(cwd))),
      );
      obtido.forEach((r, i) => {
        expect(JSON.stringify(r.resposta)).toBe(JSON.stringify(esperado[i]!.resposta));
        expect(r.texto).toBe(esperado[i]!.texto);
      });
      expect(fs.readdirSync(vazio)).toEqual(["kb.sqlite"]);
    }),
  );
});
