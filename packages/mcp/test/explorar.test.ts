// @effect-diagnostics nodeBuiltinImport:off -- teste: confere se o tmp/kb.sqlite do checkout existe e é do esquema atual
/**
 * O Explorar do app (`explorarIndice` e `explorarBuscar` do `GrupoLeitura`), pelo cliente RPC em
 * memória: no banco de fixture (normas + `fixture-explorar.ts`) e, quando o `tmp/kb.sqlite` do
 * checkout existe no esquema atual, na base real.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { VERSAO_ESQUEMA } from "@simplifica-if/kb/db/esquema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { RpcTest } from "effect/rpc";
import type { DadosBusca } from "../src/explorar.ts";
import { GrupoLeitura } from "../src/grupo-leitura.ts";
import {
  buscarNaMemoria,
  campo,
  expressaoFts,
  item,
  termosDaConsulta,
  trechoEmVolta,
} from "../src/leitura/busca-explorar.ts";
import { layerHandlersRpc, layerLeitura } from "../src/rpc.ts";
import { criarBancoFixture, limparTemporarios } from "./fixture.ts";
import { CURSO_ENFERMAGEM, inserirExplorar, REUNIAO_CONSEPE } from "./fixture-explorar.ts";
import { inserirNormas } from "./fixture-normas.ts";

afterEach(limparTemporarios);

function bancoExplorar(): string {
  const banco = criarBancoFixture();
  inserirNormas(banco);
  inserirExplorar(banco);
  return banco;
}

const camadaRpc = (banco: string) => layerHandlersRpc.pipe(Layer.provideMerge(layerLeitura({ banco, canal: "dev" })));

const clienteDoGrupo = () => RpcTest.makeClient(GrupoLeitura);
type ClienteLeitura = Effect.Success<ReturnType<typeof clienteDoGrupo>>;

const comCliente = <A, E>(banco: string, usar: (cliente: ClienteLeitura) => Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const cliente = yield* clienteDoGrupo();
    return yield* usar(cliente);
  }).pipe(Effect.scoped, Effect.provide(camadaRpc(banco)));

const tipos = (dados: DadosBusca) => dados.grupos.map((g) => g.tipo);
const grupo = (dados: DadosBusca, tipo: string) => dados.grupos.find((g) => g.tipo === tipo)?.resultados ?? [];

describe("busca na memória", () => {
  const itens = [
    item({ tipo: "curso", titulo: "Técnico em Enfermagem", detalhe: null, link: "ifpr://curso/a/b" }, [
      campo(["Técnico em Enfermagem"], 3),
      campo(["Curitiba"], 2),
    ]),
    item({ tipo: "curso", titulo: "Técnico em Informática", detalhe: null, link: "ifpr://curso/a/c" }, [
      campo(["Técnico em Informática"], 3),
      campo(["Foz do Iguaçu"], 2),
    ]),
  ];

  it("cada termo começa uma palavra, sem acento nem maiúscula; palavras vazias saem", () => {
    expect(termosDaConsulta("Técnico em ENFERM")).toEqual(["tecnico", "enferm"]);
    expect(termosDaConsulta("de")).toEqual(["de"]);
    expect(buscarNaMemoria(itens, "enferm", 5).map((r) => r.titulo)).toEqual(["Técnico em Enfermagem"]);
    expect(buscarNaMemoria(itens, "informatica foz", 5).map((r) => r.titulo)).toEqual(["Técnico em Informática"]);
    expect(buscarNaMemoria(itens, "tecnico", 5)).toHaveLength(2);
    expect(buscarNaMemoria(itens, "enfermagem foz", 5)).toEqual([]);
  });

  it("o trecho em volta da primeira palavra achada, com reticências nas pontas cortadas", () => {
    const texto = `${"palavra ".repeat(40)}o acompanhamento de egressos ${"fim ".repeat(60)}`;
    const trecho = trechoEmVolta(texto, ["egress"], 100);
    expect(trecho).toMatch(/^….*egressos.*…$/);
    expect(trecho.length).toBeLessThanOrEqual(102);
    expect(trechoEmVolta("curto", ["x"])).toBe("curto");
  });

  it("a expressão do FTS: todos os termos, o último como prefixo", () => {
    expect(expressaoFts(["acompanhamento", "egres"], ["titulo", "texto"])).toBe(
      '{titulo texto} : ("acompanhamento" "egres"*)',
    );
    expect(expressaoFts(["de"], ["texto"])).toBe('{texto} : ("de")');
    expect(expressaoFts([], ["texto"])).toBeNull();
  });
});

describe("explorarIndice e explorarBuscar (fixture)", () => {
  it.effect("o índice traz as coleções com os campos dos filtros", () =>
    Effect.gen(function* () {
      const { dados } = yield* comCliente(bancoExplorar(), (c) => c.explorarIndice({}));
      expect(dados.normas.map((n) => n.id)).toContain("br/cne-cp/res/2026/2");
      const enfermagem = dados.cursos.find((c) => c.id === CURSO_ENFERMAGEM)!;
      expect(enfermagem).toMatchObject({
        campus_nome: "Curitiba",
        cnct: { slug: "tecnico-em-enfermagem", eixo: "Ambiente e Saúde" },
        ppc: { chave: CURSO_ENFERMAGEM, ano: 2023 },
        turnos: ["matutino", "noturno"],
        processos: ["processo-seletivo-2025", "processo-seletivo-2026"],
        link: `ifpr://curso/${CURSO_ENFERMAGEM}`,
      });
      expect(dados.campi.find((c) => c.id === "curitiba")?.horarios_url).toBe("https://ifpr.edu.br/curitiba/horarios/");
      expect(dados.ppcs[0]).toMatchObject({ chave: CURSO_ENFERMAGEM, curso: `ifpr://curso/${CURSO_ENFERMAGEM}` });
      expect(dados.cnct.map((c) => c.slug)).toEqual(["tecnico-em-agropecuaria", "tecnico-em-enfermagem"]);
      expect(dados.fichas).toEqual([expect.objectContaining({ id: "CT-CURR-12", link: "ifpr://ficha/CT-CURR-12" })]);
      const [reuniao] = dados.reunioes;
      expect(reuniao).toMatchObject({ id: REUNIAO_CONSEPE, conselho: "Consepe", data: "2026-03-20" });
      expect(reuniao!.itens[0]).toMatchObject({ curso: CURSO_ENFERMAGEM, resultado: "Favorável" });
      expect(reuniao!.documentos[0]).toMatchObject({ tipo: "parecer", numero: "07/2026" });
    }),
  );

  it.effect("uma citação vai direto ao dispositivo, no primeiro grupo", () =>
    Effect.gen(function* () {
      const { dados } = yield* comCliente(bancoExplorar(), (c) =>
        c.explorarBuscar({ consulta: "Res. CNE/CP 1/2021, art. 20", limite: 6 }),
      );
      expect(tipos(dados)[0]).toBe("dispositivo");
      expect(grupo(dados, "dispositivo")[0]).toMatchObject({
        link: "ifpr://norma/br/cne-cp/res/2021/1#art20",
        detalhe: expect.stringContaining("Citação reconhecida"),
      });
    }),
  );

  it.effect("um curso pelo nome e pelo campus; a seção do PPC pelo texto; o Consepe pelo curso", () =>
    Effect.gen(function* () {
      const banco = bancoExplorar();
      const curso = yield* comCliente(banco, (c) => c.explorarBuscar({ consulta: "enferm curitiba", limite: 6 }));
      expect(tipos(curso.dados)[0]).toBe("curso");
      expect(grupo(curso.dados, "curso")[0]).toMatchObject({
        titulo: "Técnico em Enfermagem",
        link: `ifpr://curso/${CURSO_ENFERMAGEM}`,
      });
      expect(grupo(curso.dados, "ppc")[0]?.link).toBe(`ifpr://ppc/${CURSO_ENFERMAGEM}`);
      expect(grupo(curso.dados, "consepe")[0]).toMatchObject({ reuniao: REUNIAO_CONSEPE, link: null });

      const secao = yield* comCliente(banco, (c) =>
        c.explorarBuscar({ consulta: "acompanhamento de egres", limite: 6 }),
      );
      expect(grupo(secao.dados, "secao")[0]).toMatchObject({
        link: `ifpr://ppc/${CURSO_ENFERMAGEM}#avaliacao-1`,
        trecho: expect.stringContaining("acompanhamento de egressos"),
      });

      const campus = yield* comCliente(banco, (c) => c.explorarBuscar({ consulta: "Foz", limite: 6 }));
      expect(grupo(campus.dados, "campus").map((r) => r.titulo)).toEqual(["Campus Foz do Iguaçu"]);

      const ficha = yield* comCliente(banco, (c) => c.explorarBuscar({ consulta: "ct-curr-12", limite: 6 }));
      expect(grupo(ficha.dados, "ficha")[0]?.link).toBe("ifpr://ficha/CT-CURR-12");

      const vazia = yield* comCliente(banco, (c) => c.explorarBuscar({ consulta: "   ", limite: 6 }));
      expect(vazia.dados.grupos).toEqual([]);
    }),
  );
});

/** O `tmp/kb.sqlite` do checkout, se existe no esquema que este código lê. */
function bancoReal(): string | null {
  const caminho = NodePath.resolve(import.meta.dirname, "../../../tmp/kb.sqlite");
  if (!NodeFS.existsSync(caminho)) return null;
  const db = new NodeSqlite.DatabaseSync(caminho, { readOnly: true });
  try {
    const linha = db.prepare("SELECT valor FROM meta WHERE chave = 'versao_esquema'").get() as
      | { valor: string }
      | undefined;
    return linha?.valor === String(VERSAO_ESQUEMA) ? caminho : null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

const REAL = bancoReal();

describe.skipIf(REAL === null)("Explorar na base real (tmp/kb.sqlite)", () => {
  // O tempo (menos de 200 ms por consulta, critério do Explorar) se mede fora dos testes, que não leem o
  // relógio: `node packages/mcp/scripts/medir-explorar.ts` falha se alguma consulta passar do limite.
  it.effect("as buscas de referência acham o dispositivo, o curso e as seções", () =>
    comCliente(REAL!, (c) =>
      Effect.gen(function* () {
        const indice = yield* c.explorarIndice({});
        expect(indice.dados.cursos.length).toBeGreaterThan(100);
        expect(indice.dados.reunioes.length).toBeGreaterThan(0);
        expect(indice.dados.campi.some((campus) => campus.horarios_url !== null)).toBe(true);

        const citacao = yield* c.explorarBuscar({ consulta: "Res. CNE/CP 1/2021, art. 20", limite: 6 });
        expect(citacao.dados.grupos[0]?.resultados[0]?.link).toBe("ifpr://norma/br/cne-cp/res/2021/1#art20");
        const curso = yield* c.explorarBuscar({ consulta: "enfermagem curitiba", limite: 6 });
        expect(grupo(curso.dados, "curso")[0]?.link).toBe("ifpr://curso/curitiba/tecnico-em-enfermagem");
        const comum = yield* c.explorarBuscar({ consulta: "curso", limite: 6 });
        expect(comum.dados.grupos.length).toBeGreaterThan(3);
        const secao = yield* c.explorarBuscar({ consulta: "acompanhamento de egressos", limite: 6 });
        expect(grupo(secao.dados, "secao").length).toBeGreaterThan(0);
      }),
    ),
  );
});
