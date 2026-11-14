/**
 * O grupo RPC de leitura (`GrupoLeitura`) pelo cliente em memória do `RpcTest`, sobre os handlers
 * (`layerHandlersRpc`) e o `Leitura` de um banco de fixture: cada uma das 8 operações devolve o mesmo
 * que a ferramenta MCP de mesmo nome pelo caminho de `responder` (um contrato só para as duas), e o
 * erro tipado chega ao cliente com a mesma mensagem da ferramenta.
 *
 * Dois bancos: o de normas (`fixture.ts` + `fixture-normas.ts`, com dispositivos e um PPC sem índice
 * FTS) e o de PPCs (`fixture-ppcs.ts`, com normas sem dispositivos, PPCs, cursos e o FTS das seções).
 * Cada operação roda sobre o banco em que tem dados.
 */
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Schema from "effect/Schema";
import { RpcTest } from "effect/rpc";
import { ehEntradaInvalida, type ErroDeLeitura } from "../src/contratos.ts";
import { buscarNorma } from "../src/ferramentas/buscar-norma.ts";
import { buscarSecoes } from "../src/ferramentas/buscar-secoes.ts";
import { fichaCurso } from "../src/ferramentas/ficha-curso.ts";
import { fichaNorma } from "../src/ferramentas/ficha-norma.ts";
import { lerDispositivos } from "../src/ferramentas/ler-dispositivos.ts";
import { lerSecao } from "../src/ferramentas/ler-secao.ts";
import { listarCursos } from "../src/ferramentas/listar-cursos.ts";
import { sobreABase } from "../src/ferramentas/sobre-a-base.ts";
import { GrupoLeitura, layerHandlersRpc, layerLeitura } from "../src/rpc.ts";
import { camadaFerramentas, type FerramentaTestada, mensagemDeErro, responder } from "./apoio.ts";
import { criarBancoFixture, limparTemporarios } from "./fixture.ts";
import { DCN_2021, DCN_2026, inserirNormas } from "./fixture-normas.ts";
import { criarBancoFixturePpcs, PPC_ENFERMAGEM, PPC_INFORMATICA } from "./fixture-ppcs.ts";

afterEach(limparTemporarios);

function bancoNormas(): string {
  const banco = criarBancoFixture();
  inserirNormas(banco);
  return banco;
}

/** O cliente RPC em memória sobre o banco `banco`, no canal `dev` (o mesmo de `camadaFerramentas`). */
const camadaRpc = (banco: string) => layerHandlersRpc.pipe(Layer.provideMerge(layerLeitura({ banco, canal: "dev" })));

const clienteDoGrupo = () => RpcTest.makeClient(GrupoLeitura);
type ClienteLeitura = Effect.Success<ReturnType<typeof clienteDoGrupo>>;

/** Chama o RPC com o cliente do `RpcTest` sobre o banco `banco`. */
const viaRpc = <A>(banco: string, chamar: (cliente: ClienteLeitura) => Effect.Effect<A, ErroDeLeitura>) =>
  Effect.gen(function* () {
    const cliente = yield* clienteDoGrupo();
    return yield* chamar(cliente);
  }).pipe(Effect.scoped, Effect.provide(camadaRpc(banco)));

/** A `Resposta` da ferramenta MCP de mesmo nome, pelo caminho de `responder`. */
const viaFerramenta = <D extends Schema.Top>(ferramenta: FerramentaTestada<D>, args: unknown, banco: string) =>
  responder(ferramenta, args).pipe(
    Effect.map((r) => r.resposta),
    Effect.provide(camadaFerramentas(banco)),
  );

/** Mesma resposta pelo RPC e pela ferramenta. */
const mesmaResposta = <D extends Schema.Top, A>(
  ferramenta: FerramentaTestada<D>,
  args: unknown,
  banco: string,
  chamar: (cliente: ClienteLeitura) => Effect.Effect<A, ErroDeLeitura>,
) =>
  Effect.gen(function* () {
    const rpc = yield* viaRpc(banco, chamar);
    const mcp = yield* viaFerramenta(ferramenta, args, banco);
    expect(rpc).toEqual(mcp);
    return rpc;
  });

describe("GrupoLeitura: mesma resposta que a ferramenta MCP", () => {
  it.effect("fichaNorma ↔ ficha_norma", () =>
    mesmaResposta(fichaNorma, { id: DCN_2021 }, bancoNormas(), (c) => c.fichaNorma({ id: DCN_2021 })),
  );

  it.effect("lerDispositivos ↔ ler_dispositivos", () =>
    Effect.gen(function* () {
      const ids = [`${DCN_2026}#art28`, `${DCN_2021}#art20`];
      const r = yield* mesmaResposta(lerDispositivos, { ids, filhos: true }, bancoNormas(), (c) =>
        c.lerDispositivos({ ids, filhos: true }),
      );
      expect(r.dados.dispositivos.length).toBeGreaterThan(0);
    }),
  );

  it.effect("buscarNorma ↔ buscar_norma", () =>
    Effect.gen(function* () {
      const consulta = "Resolução CNE/CP nº 2/2026, art. 71, parágrafo único";
      const r = yield* mesmaResposta(buscarNorma, { consulta }, bancoNormas(), (c) =>
        c.buscarNorma({ consulta, limite: 8 }),
      );
      expect(r.dados.resultados).toHaveLength(1);
    }),
  );

  it.effect("fichaCurso ↔ ficha_curso", () =>
    mesmaResposta(fichaCurso, { curso: PPC_ENFERMAGEM }, criarBancoFixturePpcs(), (c) =>
      c.fichaCurso({ curso: PPC_ENFERMAGEM }),
    ),
  );

  it.effect("lerSecao ↔ ler_secao", () =>
    Effect.gen(function* () {
      const id = `${PPC_INFORMATICA}#estagio_praticas-1`;
      const r = yield* mesmaResposta(lerSecao, { id }, criarBancoFixturePpcs(), (c) => c.lerSecao({ id }));
      expect(r.dados.secao.id).toBe(id);
    }),
  );

  it.effect("buscarSecoes ↔ buscar_secoes", () =>
    Effect.gen(function* () {
      const consulta = "estágio obrigatório";
      const r = yield* mesmaResposta(buscarSecoes, { consulta }, criarBancoFixturePpcs(), (c) =>
        c.buscarSecoes({ consulta, limite: 8, integral: false }),
      );
      expect(r.dados.resultados.length).toBeGreaterThan(0);
    }),
  );

  it.effect("listarCursos ↔ listar_cursos (com página)", () =>
    Effect.gen(function* () {
      const r = yield* mesmaResposta(listarCursos, { limite: 1 }, criarBancoFixturePpcs(), (c) =>
        c.listarCursos({ limite: 1 }),
      );
      expect(r.pagina?.cursor).toBeDefined();
    }),
  );

  it.effect("sobreABase ↔ sobre_a_base", () =>
    Effect.gen(function* () {
      const r = yield* mesmaResposta(sobreABase, {}, criarBancoFixturePpcs(), (c) => c.sobreABase({}));
      expect(r.base.canal).toBe("dev");
    }),
  );
});

describe("GrupoLeitura: erro tipado", () => {
  it.effect("fichaNorma de ID inexistente falha com EntradaInvalida, com a mensagem da ferramenta", () =>
    Effect.gen(function* () {
      const banco = bancoNormas();
      const id = "br/lei/1900/1";
      const falha = yield* Effect.flip(viaRpc(banco, (c) => c.fichaNorma({ id })));
      expect(ehEntradaInvalida(falha)).toBe(true);
      const mensagem = yield* mensagemDeErro(fichaNorma, { id }).pipe(Effect.provide(camadaFerramentas(banco)));
      expect(falha.message).toBe(mensagem);
      expect(mensagem).toContain("norma não encontrada na base");
    }),
  );
});
