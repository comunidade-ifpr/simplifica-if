// @effect-diagnostics nodeBuiltinImport:off -- teste: o servidor stdio como processo filho
/**
 * Os links `ifpr://` como recursos MCP (M1.5), pelo Client do SDK oficial, em stdio (o servidor como
 * processo filho) e no servidor HTTP local do app (`@simplifica-if/mcp/http`): os modelos de URI do
 * `resources/templates/list` (sem o curinga), os pontos de entrada do `resources/list`, a leitura de
 * um link de cada tipo, com e sem fragmento, e os erros em português para o link inválido.
 *
 * Dois bancos, como no `rpc.test.ts`: o de PPCs (`fixture-ppcs.ts`: normas sem dispositivos, PPCs,
 * cursos, CNCT, campi e uma ficha) e o de normas (`fixture-normas.ts`, com os dispositivos).
 */
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { afterAll, describe, expect, it } from "@effect/vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Http from "../src/http.ts";
import { MIME_RECURSO, MODELOS } from "../src/recursos/recursos.ts";
import { criarBancoFixture, limparTemporarios } from "./fixture.ts";
import { DCN_2021, DCN_2026, inserirNormas } from "./fixture-normas.ts";
import { criarBancoFixturePpcs, CURSO_ENFERMAGEM, PPC_ENFERMAGEM, SECAO_LONGA } from "./fixture-ppcs.ts";

afterAll(limparTemporarios);

const bancoPpcs = criarBancoFixturePpcs();

/** Uma ficha com os campos da revisão de PPC (a da fixture só tem o ID e as referências). */
const FICHA = {
  id: "CT-TESTE-01",
  titulo: "Acompanhamento de egressos",
  dominio: "gestao",
  criticidade: "OBRIG",
  pergunta: "O PPC descreve o acompanhamento de egressos?",
  rubrica: "Conferir a metodologia e o cronograma do acompanhamento.",
  referencias_normativas: [{ ref: "br/cne-cp/res/2026/2", dispositivo: "#art28-xviii", papel: "fundamento" }],
};
{
  const db = new NodeSqlite.DatabaseSync(bancoPpcs);
  db.prepare("INSERT INTO fichas (id, titulo, path, dados_json, arquivo_json) VALUES (?, ?, ?, ?, ?)").run(
    FICHA.id,
    FICHA.titulo,
    "base-conhecimento/revisao-ppc/fichas/ct-teste-01.json",
    JSON.stringify(FICHA),
    JSON.stringify(FICHA),
  );
  db.close();
}
const bancoNormas = criarBancoFixture();
inserirNormas(bancoNormas);

const CLI = NodePath.resolve(import.meta.dirname, "../src/cli.ts");
/** O ambiente do processo stdio, sem herdar SIMPLIFICA_KB do processo de teste. */
const AMBIENTE_STDIO = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
const RODAPE = "Base de desenvolvimento (versão `dev-ab12cd34`).";

type Abrir = (banco: string) => Effect.Effect<Client, never, Scope.Scope>;

const fechar = (cliente: Client) => Effect.promise(() => cliente.close());

/** O servidor stdio como processo filho, com o ambiente mínimo. */
const stdio: Abrir = (banco) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const cliente = new Client(
        { name: "teste-recursos", version: "0" },
        { versionNegotiation: { mode: { pin: "2026-07-28" } } },
      );
      await cliente.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [CLI, "--banco", banco],
          env: AMBIENTE_STDIO,
          stderr: "pipe",
        }),
      );
      return cliente;
    }),
    fechar,
  );

/** O servidor HTTP local do app, numa porta efêmera, com uma sessão; fecha com o escopo do teste. */
const http: Abrir = (banco) =>
  Effect.gen(function* () {
    const servidor = Context.get(yield* Layer.build(Http.layer({ banco })), Http.ServidorMcpHttp);
    const sessao = yield* servidor.abrirSessao({ rotulo: "recursos" });
    return yield* Effect.acquireRelease(
      Effect.promise(async () => {
        const cliente = new Client(
          { name: "teste-recursos", version: "0" },
          { versionNegotiation: { mode: { pin: "2026-07-28" } } },
        );
        await cliente.connect(
          new StreamableHTTPClientTransport(new URL(sessao.url), {
            requestInit: { headers: { ...sessao.cabecalhos } },
          }),
        );
        return cliente;
      }),
      fechar,
    );
  }).pipe(Effect.orDie);

interface Lido {
  readonly mimeType: string | undefined;
  readonly text: string;
  readonly _meta: Record<string, unknown> | undefined;
}

/** O primeiro (e único) conteúdo do `resources/read`. */
const ler = (cliente: Client, uri: string) =>
  Effect.promise(async () => {
    const { contents } = await cliente.readResource({ uri });
    expect(contents).toHaveLength(1);
    expect(contents[0]!.uri).toBe(uri);
    return contents[0] as unknown as Lido;
  });

/** O erro do `resources/read`: o código JSON-RPC e a mensagem. */
const erroAoLer = (cliente: Client, uri: string) =>
  Effect.promise(() =>
    cliente.readResource({ uri }).then(
      () => ({ code: 0, message: "leu sem erro" }),
      (erro: { readonly code: number; readonly message: string }) => ({ code: erro.code, message: erro.message }),
    ),
  );

/** O texto do recurso, com o tipo Markdown, o rodapé da base e a `base` no `_meta`. */
function conferirEnvelope(lido: Lido): string {
  expect(lido.mimeType).toBe(MIME_RECURSO);
  expect(lido.text.endsWith(RODAPE)).toBe(true);
  expect(lido._meta?.["ifpr/base"]).toMatchObject({ data: null, canal: "dev" });
  expect(Array.isArray(lido._meta?.["ifpr/avisos"])).toBe(true);
  return lido.text;
}

const INVALIDO = -32602;

describe.each([
  { transporte: "stdio", abrir: stdio },
  { transporte: "HTTP", abrir: http },
])("recursos ifpr:// ($transporte)", ({ abrir }) => {
  it.effect("server/discover anuncia resources; resources/templates/list traz um modelo por tipo, sem o curinga", () =>
    Effect.gen(function* () {
      const cliente = yield* abrir(bancoPpcs);
      expect(cliente.getServerCapabilities()?.resources).toMatchObject({ listChanged: true });
      const { resourceTemplates } = yield* Effect.promise(() => cliente.listResourceTemplates());
      expect(resourceTemplates.map((m) => m.uriTemplate)).toEqual([
        "ifpr://norma/{+norma}{#dispositivo}",
        "ifpr://curso/{campus}/{curso}",
        "ifpr://ppc/{campus}/{curso}{/versao}{#secao}",
        "ifpr://cnct/{slug}",
        "ifpr://campus/{campus}",
        "ifpr://ficha/{ficha}",
      ]);
      expect(resourceTemplates.map((m) => m.name)).toEqual(MODELOS.map((m) => m.tipo));
      for (const m of resourceTemplates) {
        expect(m.mimeType).toBe(MIME_RECURSO);
        expect(m.description).toMatch(/ifpr:\/\//);
      }
    }),
  );

  it.effect("resources/list traz só os pontos de entrada: as normas centrais da base e os campi", () =>
    Effect.gen(function* () {
      const cliente = yield* abrir(bancoPpcs);
      const { resources } = yield* Effect.promise(() => cliente.listResources());
      expect(resources.map((r) => r.uri)).toEqual([
        `ifpr://norma/${DCN_2026}`,
        `ifpr://norma/${DCN_2021}`,
        "ifpr://norma/br/lei/1996/9394",
        "ifpr://campus/assis-chateaubriand",
        "ifpr://campus/curitiba",
        "ifpr://campus/foz-do-iguacu",
      ]);
      expect(resources[0]).toMatchObject({ title: "Resolução CNE/CP nº 2/2026", mimeType: MIME_RECURSO });
      const campus = conferirEnvelope(yield* ler(cliente, "ifpr://campus/curitiba"));
      expect(campus).toContain("[Campus Curitiba](ifpr://campus/curitiba)");
    }),
  );

  it.effect("norma: a ficha; com #dispositivo, só o trecho, com o caput herdado", () =>
    Effect.gen(function* () {
      const cliente = yield* abrir(bancoNormas);
      const norma = conferirEnvelope(yield* ler(cliente, `ifpr://norma/${DCN_2026}`));
      expect(norma).toContain(`(ifpr://norma/${DCN_2026})`);
      // o servidor stdio calcula a vigência no dia do relógio
      expect(norma).toMatch(/\*\*Vigência em \d{2}\/\d{2}\/\d{4}:\*\*/);

      const inciso = yield* ler(cliente, `ifpr://norma/${DCN_2026}#art28-vii`);
      const texto = conferirEnvelope(inciso);
      expect(texto).toContain(`(ifpr://norma/${DCN_2026}#art28-vii)`);
      expect(texto).toContain("> Art. 28. O PPC de curso técnico deve conter, no mínimo:");
      expect(texto).toContain("> VII – elemento 7 do projeto pedagógico");
      expect(texto).toContain("nota: (Redação dada pela Resolução CNE/CP nº 3/2026)");
      expect(texto).not.toContain("VIII – elemento 8");
      expect(texto).not.toContain("**Vigência em");
    }),
  );

  it.effect("curso, PPC (índice e seção), CNCT, campus e ficha", () =>
    Effect.gen(function* () {
      const cliente = yield* abrir(bancoPpcs);
      const curso = conferirEnvelope(yield* ler(cliente, `ifpr://curso/${CURSO_ENFERMAGEM}`));
      expect(curso).toContain(`## [Técnico em Enfermagem](ifpr://curso/${CURSO_ENFERMAGEM})`);
      expect(curso).toContain("CNCT: [Técnico em Enfermagem](ifpr://cnct/tecnico-em-enfermagem)");

      const ppc = yield* ler(cliente, `ifpr://ppc/${PPC_ENFERMAGEM}`);
      const indice = conferirEnvelope(ppc);
      expect(indice).toContain(`**[PPC Técnico em Enfermagem — Curitiba](ifpr://ppc/${PPC_ENFERMAGEM})**`);
      expect(indice).toContain(`(ifpr://ppc/${PPC_ENFERMAGEM}#avaliacao-1) [avaliacao], linhas 120-130`);
      expect(indice).toContain(`Curso: [Técnico em Enfermagem](ifpr://curso/${CURSO_ENFERMAGEM})`);
      expect(indice).toContain(
        "fonte: `base-conhecimento/institucional/ifpr/ppcs/curitiba/tecnico-em-enfermagem/2023.md:1-",
      );
      expect(ppc._meta?.["ifpr/avisos"]).toEqual([expect.objectContaining({ tipo: "fato-extraido" })]);

      const secao = conferirEnvelope(yield* ler(cliente, `ifpr://ppc/${PPC_ENFERMAGEM}#avaliacao-1`));
      expect(secao).toContain("> Texto da seção avaliacao-1.");
      expect(secao).toContain(
        "fonte: `base-conhecimento/institucional/ifpr/ppcs/curitiba/tecnico-em-enfermagem/2023.md:120-130`",
      );
      expect(secao).not.toContain("estagio-1.");

      const cnct = conferirEnvelope(yield* ler(cliente, "ifpr://cnct/tecnico-em-enfermagem"));
      expect(cnct).toContain(
        "**[Técnico em Enfermagem (CNCT)](ifpr://cnct/tecnico-em-enfermagem)** — eixo Ambiente e Saúde; carga horária mínima 1200 h",
      );
      expect(cnct).toContain(`(ifpr://curso/${CURSO_ENFERMAGEM})`);

      const campus = conferirEnvelope(yield* ler(cliente, "ifpr://campus/foz-do-iguacu"));
      expect(campus).toContain("fonte: `base-conhecimento/institucional/ifpr/campi/foz-do-iguacu.json`");
      expect(campus).toContain("(ifpr://curso/foz-do-iguacu/licenciatura-em-fisica)");

      const ficha = conferirEnvelope(yield* ler(cliente, "ifpr://ficha/ct-teste-01"));
      expect(ficha).toContain(
        "**[CT-TESTE-01: Acompanhamento de egressos](ifpr://ficha/CT-TESTE-01)** — domínio gestao; criticidade OBRIG",
      );
      expect(ficha).toContain(
        "**Pergunta**\n> O PPC descreve o acompanhamento de egressos?\nfonte: `base-conhecimento/revisao-ppc/fichas/ct-teste-01.json:6-6`",
      );
      expect(ficha).toContain(
        "- [br/cne-cp/res/2026/2#art28-xviii](ifpr://norma/br/cne-cp/res/2026/2#art28-xviii) (fundamento)",
      );
      // a ficha da fixture, sem título no arquivo: o ID no lugar dele
      const curta = conferirEnvelope(yield* ler(cliente, "ifpr://ficha/CT-CURR-12"));
      expect(curta).toContain("**[CT-CURR-12: CT-CURR-12](ifpr://ficha/CT-CURR-12)**");
    }),
  );

  it.effect("seção longa: o primeiro trecho, no teto, e como continuar com ler_secao", () =>
    Effect.gen(function* () {
      const cliente = yield* abrir(bancoPpcs);
      const texto = conferirEnvelope(yield* ler(cliente, `ifpr://ppc/${SECAO_LONGA}`));
      expect(texto.length).toBeLessThanOrEqual(20_000);
      expect(texto).toContain("> Linha 1 do anexo com o plano de estágio.");
      expect(texto).not.toContain("Linha 1500 do anexo");
      expect(texto).toMatch(/Para o resto, chame `ler_secao` com `id: "[^"]+#anexos-1"` e `cursor: "[^"]+"`\./);
    }),
  );

  it.effect("link inválido ou desconhecido: InvalidParams com a mensagem em português", () =>
    Effect.gen(function* () {
      const cliente = yield* abrir(bancoPpcs);
      const casos: ReadonlyArray<readonly [string, RegExp]> = [
        [
          "ifpr://desconhecido/x",
          /^link desconhecido: "ifpr:\/\/desconhecido\/x"\. .*norma, curso, ppc, cnct, campus, ficha/,
        ],
        ["https://exemplo.org/x", /link desconhecido: "https:\/\/exemplo\.org\/x"/],
        [
          "ifpr://curso/curitiba",
          /link ifpr:\/\/ malformado: "ifpr:\/\/curso\/curitiba"; esperava, por exemplo, "ifpr:\/\/curso\/curitiba\/tecnico-em-enfermagem"/,
        ],
        ["ifpr://campus/curitiba#cursos", /o link ifpr:\/\/campus não aceita "#cursos"/],
        ["ifpr://norma/br/lei/2099/1", /norma não encontrada na base: br\/lei\/2099\/1/],
        [`ifpr://ppc/${PPC_ENFERMAGEM}#nao-existe`, /seção não encontrada/],
        ["ifpr://cnct/tecnico-em-astronautica", /curso não encontrado no CNCT: "tecnico-em-astronautica"/],
        ["ifpr://campus/marte", /campus não encontrado na base: "marte"/],
        ["ifpr://ficha/XX-0", /ficha não encontrada na base: "XX-0"/],
      ];
      for (const [uri, mensagem] of casos) {
        const erro = yield* erroAoLer(cliente, uri);
        expect(erro.code, uri).toBe(INVALIDO);
        expect(erro.message, uri).toMatch(mensagem);
      }
    }),
  );
});

describe("recursos ifpr:// (stdio, banco de normas)", () => {
  it.effect("dispositivo inexistente: InvalidParams, com o link da norma", () =>
    Effect.gen(function* () {
      const cliente = yield* stdio(bancoNormas);
      const erro = yield* erroAoLer(cliente, `ifpr://norma/${DCN_2026}#art999`);
      expect(erro.code).toBe(INVALIDO);
      expect(erro.message).toContain(`dispositivo não encontrado na base: "${DCN_2026}#art999"`);
      expect(erro.message).toContain(`ifpr://norma/${DCN_2026}`);
    }),
  );
});
