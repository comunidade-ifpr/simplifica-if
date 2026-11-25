/**
 * O grupo RPC de leitura (`GrupoLeitura`) pelo cliente em memória do `RpcTest`, sobre os handlers
 * (`layerHandlersRpc`) e o `Leitura` de um banco de fixture: cada uma das 8 operações das ferramentas
 * devolve o mesmo que a ferramenta MCP de mesmo nome pelo caminho de `responder` (um contrato só para
 * as duas), e o erro tipado chega ao cliente com a mesma mensagem da ferramenta.
 *
 * As leituras de link: o `resources/read` (`lerRecurso`) resolve cada tipo de link `ifpr://` com a
 * resposta da ferramenta de mesmo conteúdo ou a dos RPCs próprios dos recursos (`lerPpc`, `lerCnct`,
 * `lerCampus`, `lerFicha`).
 *
 * Dois bancos: o de normas (`fixture.ts` + `fixture-normas.ts`, com dispositivos e um PPC sem índice
 * FTS) e o de PPCs (`fixture-ppcs.ts`, com normas sem dispositivos, PPCs, cursos e o FTS das seções).
 * Cada operação roda sobre o banco em que tem dados.
 */
import { afterEach, assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import type * as Schema from "effect/Schema";
import { RpcTest } from "effect/rpc";
import { ehEntradaInvalida, ehFalhaNaBase, type ErroDeLeitura, FalhaNaBase } from "../src/contratos.ts";
import { fichaCurso } from "../src/ferramentas/ficha-curso.ts";
import { fichaNorma } from "../src/ferramentas/ficha-norma.ts";
import { lerDispositivos } from "../src/ferramentas/ler-dispositivos.ts";
import { lerSecao } from "../src/ferramentas/ler-secao.ts";
import { sobreABase } from "../src/ferramentas/sobre-a-base.ts";
import { lerRecurso } from "../src/recursos/recursos.ts";
import { GrupoLeitura } from "../src/grupo-leitura.ts";
import { Leitura, layerHandlersRpc, layerLeitura } from "../src/rpc.ts";
import { camadaFerramentas, type FerramentaTestada, mensagemDeErro, responder } from "./apoio.ts";
import { criarBancoFixture, limparTemporarios } from "./fixture.ts";
import { DCN_2021, DCN_2026, inserirNormas } from "./fixture-normas.ts";
import {
  criarBancoFixturePpcs,
  CURSO_ENFERMAGEM,
  CURSO_FISICA,
  PPC_ENFERMAGEM,
  PPC_INFORMATICA,
} from "./fixture-ppcs.ts";

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

  it.effect("fichaCurso ↔ ficha_curso", () =>
    mesmaResposta(fichaCurso, { curso: CURSO_ENFERMAGEM }, criarBancoFixturePpcs(), (c) =>
      c.fichaCurso({ curso: CURSO_ENFERMAGEM }),
    ),
  );

  it.effect("lerSecao ↔ ler_secao", () =>
    Effect.gen(function* () {
      const id = `${PPC_INFORMATICA}#estagio_praticas-1`;
      const r = yield* mesmaResposta(lerSecao, { id }, criarBancoFixturePpcs(), (c) => c.lerSecao({ id }));
      expect(r.dados.secao.id).toBe(id);
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

/** O que `lerRecurso` (o `resources/read`) devolve para `link`, direto sobre o `Leitura` do banco. */
const viaRecurso = (banco: string, link: string) =>
  Effect.gen(function* () {
    yield* Leitura;
    return yield* lerRecurso(link);
  }).pipe(Effect.provide(layerLeitura({ banco, canal: "dev" })));

describe("GrupoLeitura: links ifpr://", () => {
  it.effect("resources/read de norma, dispositivo, curso e seção: a resposta da ferramenta e o texto", () =>
    Effect.gen(function* () {
      const normas = bancoNormas();
      const norma = yield* viaRecurso(normas, `ifpr://norma/${DCN_2021}`);
      expect(norma.tipo).toBe("norma");
      expect(norma.resposta).toEqual(yield* viaFerramenta(fichaNorma, { id: DCN_2021 }, normas));

      const id = `${DCN_2026}#art28`;
      const dispositivo = yield* viaRecurso(normas, `ifpr://norma/${id}`);
      expect(dispositivo.tipo).toBe("dispositivo");
      expect(dispositivo.resposta).toEqual(yield* viaFerramenta(lerDispositivos, { ids: [id], filhos: true }, normas));

      const ppcs = criarBancoFixturePpcs();
      const curso = yield* viaRecurso(ppcs, `ifpr://curso/${CURSO_ENFERMAGEM}`);
      expect(curso.tipo).toBe("curso");
      expect(curso.resposta).toEqual(yield* viaFerramenta(fichaCurso, { curso: CURSO_ENFERMAGEM }, ppcs));
      expect(curso.texto).toContain(`## [Técnico em Enfermagem](ifpr://curso/${CURSO_ENFERMAGEM})`);
      expect(curso.texto.endsWith("Base de desenvolvimento (versão `dev-ab12cd34`).")).toBe(true);

      const secaoId = `${PPC_INFORMATICA}#estagio_praticas-1`;
      const secao = yield* viaRecurso(ppcs, `ifpr://ppc/${secaoId}`);
      expect(secao.tipo).toBe("secao");
      expect(secao.resposta).toEqual(yield* viaFerramenta(lerSecao, { id: secaoId }, ppcs));
    }),
  );

  it.effect("lerPpc, lerCnct, lerCampus e lerFicha: a mesma resposta que o resources/read traz no tipo", () =>
    Effect.gen(function* () {
      const banco = criarBancoFixturePpcs();
      const casos = [
        ["ppc", `ifpr://ppc/${PPC_ENFERMAGEM}`, (c: ClienteLeitura) => c.lerPpc({ ppc: PPC_ENFERMAGEM })],
        [
          "cnct",
          "ifpr://cnct/tecnico-em-enfermagem",
          (c: ClienteLeitura) => c.lerCnct({ cnct: "tecnico-em-enfermagem" }),
        ],
        ["campus", "ifpr://campus/foz-do-iguacu", (c: ClienteLeitura) => c.lerCampus({ campus: "foz-do-iguacu" })],
        ["ficha", "ifpr://ficha/CT-CURR-12", (c: ClienteLeitura) => c.lerFicha({ ficha: "CT-CURR-12" })],
      ] as const satisfies ReadonlyArray<
        readonly [string, string, (c: ClienteLeitura) => Effect.Effect<unknown, ErroDeLeitura>]
      >;
      for (const [tipo, link, chamar] of casos) {
        const porLink = yield* viaRecurso(banco, link);
        expect(porLink.tipo, link).toBe(tipo);
        expect(yield* viaRpc<unknown>(banco, chamar), link).toEqual(porLink.resposta);
      }
      const ppc = yield* viaRpc(banco, (c) => c.lerPpc({ ppc: PPC_ENFERMAGEM }));
      expect(ppc.dados.ppc.link).toBe(`ifpr://ppc/${PPC_ENFERMAGEM}`);
      expect(ppc.dados.secoes.length).toBeGreaterThan(0);
      expect(ppc.avisos.map((a) => a.tipo)).toEqual(["fato-extraido"]);
      const cnct = yield* viaRpc(banco, (c) => c.lerCnct({ cnct: "tecnico-em-enfermagem" }));
      expect(cnct.dados.cursos_ifpr.map((c) => c.link)).toContain(`ifpr://curso/${CURSO_ENFERMAGEM}`);
      const campus = yield* viaRpc(banco, (c) => c.lerCampus({ campus: "foz-do-iguacu" }));
      expect(campus.dados.cursos.map((c) => c.link)).toContain(`ifpr://curso/${CURSO_FISICA}`);
      const ficha = yield* viaRpc(banco, (c) => c.lerFicha({ ficha: "ct-curr-12" }));
      expect(ficha.dados.ficha.link).toBe("ifpr://ficha/CT-CURR-12");
    }),
  );

  it.effect("link malformado, desconhecido ou inexistente: EntradaInvalida com a mensagem do resources/read", () =>
    Effect.gen(function* () {
      const banco = criarBancoFixturePpcs();
      const casos: ReadonlyArray<readonly [string, RegExp]> = [
        ["ifpr://curso/curitiba", /^link ifpr:\/\/ malformado: "ifpr:\/\/curso\/curitiba"/],
        ["https://exemplo.org/x", /^link desconhecido: "https:\/\/exemplo\.org\/x"/],
        ["ifpr://campus/marte", /^campus não encontrado na base: "marte"/],
      ];
      for (const [link, mensagem] of casos) {
        const falha = yield* Effect.flip(viaRecurso(banco, link));
        expect(ehEntradaInvalida(falha), link).toBe(true);
        expect(falha.message, link).toMatch(mensagem);
      }
      const cnct = yield* Effect.flip(viaRpc(banco, (c) => c.lerCnct({ cnct: "tecnico-em-astronautica" })));
      expect(ehEntradaInvalida(cnct)).toBe(true);
      expect(cnct.message).toContain('curso não encontrado no CNCT: "tecnico-em-astronautica"');
    }),
  );
});

describe("GrupoLeitura: lerDocumento (o leitor do app, M1.6)", () => {
  it.effect("norma com dispositivo: o Markdown com as linhas do arquivo, as âncoras e o alvo", () =>
    Effect.gen(function* () {
      const banco = bancoNormas();
      const { dados, avisos } = yield* viaRpc(banco, (c) =>
        c.lerDocumento({ link: `ifpr://norma/${DCN_2026}#art28-xviii` }),
      );
      expect(dados).toMatchObject({
        tipo: "norma",
        id: DCN_2026,
        titulo: "Resolução CNE/CP nº 2/2026",
        link: `ifpr://norma/${DCN_2026}`,
        alvo: "art28-xviii",
      });
      expect(avisos).toEqual([]);
      // o front matter fica em branco: a linha de cada âncora é a linha do texto
      expect(dados.markdown.startsWith("\n\n\n")).toBe(true);
      const linhas = dados.markdown.split("\n");
      const art28 = dados.ancoras.find((a) => a.id === "art28")!;
      expect(art28).toMatchObject({ tipo: "artigo", pai: null, rotulo: "Art. 28." });
      expect(linhas[art28.linha_inicio - 1]).toMatch(/^#### Art\. 28\./);
      const inciso = dados.ancoras.find((a) => a.id === "art28-xviii")!;
      expect(inciso).toMatchObject({ tipo: "inciso", pai: "art28", rotulo: "XVIII" });
      expect(linhas[inciso.linha_inicio - 1]).toMatch(/^XVIII – /);
      // o sumário: a norma da fixture não tem divisões nem anexos
      expect(dados.sumario).toEqual([]);
      // na ordem do documento
      const inicios = dados.ancoras.map((a) => a.linha_inicio);
      expect(inicios).toEqual([...inicios].sort((a, b) => a - b));
    }),
  );

  it.effect("PPC com seção: o arquivo inteiro, inclusive o que fica fora das seções do índice", () =>
    Effect.gen(function* () {
      const banco = bancoNormas();
      const { dados } = yield* viaRpc(banco, (c) =>
        c.lerDocumento({ link: "ifpr://ppc/curitiba/tecnico-em-enfermagem#avaliacao-1" }),
      );
      expect(dados).toMatchObject({
        tipo: "ppc",
        // sem a versão, o link abre o PPC vigente, com o ID permanente dele
        id: "curitiba/tecnico-em-enfermagem/2023",
        titulo: "Técnico em Enfermagem (Curitiba)",
        alvo: "avaliacao-1",
        sumario: [],
      });
      expect(dados.ancoras.map((a) => a.id)).toEqual(["avaliacao-1", "estagio-1", "estagio-2"]);
      expect(dados.markdown).toContain("# Projeto Pedagógico do Curso Técnico em Enfermagem");
      expect(dados.markdown.split("\n")[120 - 1]).toBe("## avaliacao-1");
    }),
  );

  it.effect("fragmento que não existe: o documento abre no começo, com aviso", () =>
    Effect.gen(function* () {
      const banco = bancoNormas();
      const { dados, avisos } = yield* viaRpc(banco, (c) =>
        c.lerDocumento({ link: `ifpr://norma/${DCN_2021}#art999` }),
      );
      expect(dados.alvo).toBeNull();
      expect(avisos).toEqual([
        expect.objectContaining({ tipo: "nao-encontrado", ref: `ifpr://norma/${DCN_2021}#art999` }),
      ]);
    }),
  );

  it.effect("stub, curso e link malformado: EntradaInvalida em português", () =>
    Effect.gen(function* () {
      const banco = bancoNormas();
      const casos: ReadonlyArray<readonly [string, RegExp]> = [
        ["ifpr://norma/br/cne-ceb/res/2012/6", /não tem o texto na base, só a referência/],
        ["ifpr://norma/br/lei/2099/1", /^norma não encontrada na base/],
        ["ifpr://curso/curitiba/tecnico-em-enfermagem", /^o leitor abre como documento só links de norma e de PPC/],
        ["ifpr://ppc/curitiba/tecnico-em-astronautica", /^PPC não encontrado na base/],
        ["texto qualquer", /^o leitor abre como documento só links de norma e de PPC/],
      ];
      for (const [link, mensagem] of casos) {
        const falha = yield* Effect.flip(viaRpc(banco, (c) => c.lerDocumento({ link })));
        expect(ehEntradaInvalida(falha), link).toBe(true);
        expect(falha.message, link).toMatch(mensagem);
      }
    }),
  );
});

describe("GrupoLeitura: a falha da base", () => {
  it.effect("chega à interface sem o cause e fica no log com ele", () =>
    Effect.gen(function* () {
      const causa = new Error("SQLITE_CORRUPT em /Users/maria/kb.sqlite");
      const logs: Array<ReadonlyArray<unknown>> = [];
      const registrar = Logger.make<unknown, void>(({ message }) => {
        logs.push(Array.isArray(message) ? message : [message]);
      });
      // O `Leitura` do banco de fixture com o `sobreABase` quebrado.
      const leituraQuebrada = Layer.effect(
        Leitura,
        Effect.gen(function* () {
          const leitura = yield* Leitura;
          return Leitura.of({
            ...leitura,
            sobreABase: () => Effect.fail(new FalhaNaBase({ operacao: "consulta ao kb.sqlite", cause: causa })),
          });
        }),
      ).pipe(Layer.provide(layerLeitura({ banco: bancoNormas(), canal: "dev" })));
      const erro = yield* Effect.gen(function* () {
        const cliente = yield* clienteDoGrupo();
        return yield* cliente.sobreABase({});
      }).pipe(
        Effect.flip,
        Effect.scoped,
        Effect.provide(
          Layer.mergeAll(layerHandlersRpc.pipe(Layer.provideMerge(leituraQuebrada)), Logger.layer([registrar])),
        ),
      );
      assert(ehFalhaNaBase(erro));
      expect(erro.operacao).toBe("consulta ao kb.sqlite");
      expect(erro.cause).toBeUndefined();
      const registrado = logs.find((linha) => linha[0] === "RPC sobreABase falhou");
      expect(registrado?.[1]).toMatchObject({ _tag: "FalhaNaBase", cause: causa });
    }),
  );
});
