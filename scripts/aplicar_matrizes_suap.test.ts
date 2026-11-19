// @effect-diagnostics nodeBuiltinImport:off -- monta e lê os registros com node:fs síncrono, como o repositório sob teste
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it } from "@effect/vitest";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { aplicarRelatorio } from "./aplicar_matrizes_suap.ts";
import { gravarDadosInstitucionais, type CursoLocal } from "./dados/institucional.ts";

const FIXTURE = new URL("./dominio/fixtures/relatorio-matrizes-suap.json", import.meta.url);
const fixture = (): Record<string, unknown> & { cursos: Array<Record<string, unknown>> } =>
  JSON.parse(NodeFS.readFileSync(FIXTURE, "utf-8"));

const MATRIZES_ANTIGAS = {
  resumo: "10 — MATRIZ 2020 — antigo",
  urls: ["https://suap.ifpr.edu.br/edu/matriz/10/"],
  carga_horaria_comum_h: 1100,
  situacao: "Única ativa",
  coletado_em: "2026-11-05T16:04:00.000-03:00",
};
/** As matrizes que a fixture dá ao terceiro curso, já gravadas: ele não muda. */
const MATRIZES_IGUAIS = {
  resumo: "Nenhuma matriz marcada Ativa=Sim.",
  urls: [],
  situacao: "Sem matriz ativa",
  coletado_em: "2026-11-05T16:04:00.000-03:00",
};

const curso = (slug: string, id: number, codigo: string, matrizes?: object): CursoLocal => ({
  campus_id: "exemplo",
  curso_slug: slug,
  nome: `Técnico ${slug}`,
  nivel: "médio",
  forma_oferta: "integrado",
  suap: { id, codigo, vagas: 40, coletado_em: "2026-05-25", ...(matrizes ? { matrizes } : {}) },
});

/** Três cursos da fixture: um com matrizes antigas, um sem matrizes e um que já está igual. */
const semear = (raiz: string) =>
  gravarDadosInstitucionais(
    {
      campi: [{ campus_id: "exemplo", nome: "Campus Exemplo" }],
      cursos: [
        curso("tecnico-em-exemplo", 7, "EX001", MATRIZES_ANTIGAS),
        curso("tecnico-em-outro", 8, "EX002"),
        curso("tecnico-em-terceiro", 9, "EX003", MATRIZES_IGUAIS),
      ],
      processos: [],
      editais: [],
      ofertas: [],
    },
    raiz,
  );

const ARQUIVOS = ["tecnico-em-exemplo", "tecnico-em-outro", "tecnico-em-terceiro"];
const caminhoCurso = (raiz: string, slug: string) => NodePath.join(raiz, "cursos", "exemplo", `${slug}.json`);
const textos = (raiz: string) => ARQUIVOS.map((slug) => NodeFS.readFileSync(caminhoCurso(raiz, slug), "utf-8"));
const registro = (raiz: string, slug: string) => JSON.parse(NodeFS.readFileSync(caminhoCurso(raiz, slug), "utf-8"));

/** Uma pasta com os registros semeados e o relatório dado gravado nela. */
const cenario = Effect.fn("cenario")(function* (relatorio: unknown) {
  const fs = yield* FileSystem.FileSystem;
  const pasta = yield* fs.makeTempDirectoryScoped({ prefix: "aplicar-matrizes-" });
  const raiz = NodePath.join(pasta, "ifpr");
  semear(raiz);
  const arquivo = NodePath.join(pasta, "relatorio.json");
  yield* fs.writeFileString(arquivo, JSON.stringify(relatorio, null, 2));
  return { raiz, arquivo };
});

/** Data posta nos arquivos para que uma regravação, mesmo com o mesmo texto, apareça no mtime. */
const MTIME_ANTIGO_S = 1_767_225_600; // 2026-01-01T00:00:00Z

const silencioso = Effect.provideService(Console.Console, { ...globalThis.console, log: () => {} });

const aplicar = (arquivo: string, raiz: string, apply: boolean) =>
  aplicarRelatorio(arquivo, { apply, raiz }).pipe(silencioso);

describe("aplicar_matrizes_suap", () => {
  it.effect("com --apply, grava só os cursos que mudam, com a consolidação calculada na aplicação", () =>
    Effect.gen(function* () {
      const { raiz, arquivo } = yield* cenario(fixture());
      const terceiroAntes = NodeFS.readFileSync(caminhoCurso(raiz, "tecnico-em-terceiro"), "utf-8");
      const { plano, gravado } = yield* aplicar(arquivo, raiz, true);
      assert.isTrue(gravado);
      expect(plano.mudancas.map((mudanca) => mudanca.curso_id)).toEqual([
        "exemplo/tecnico-em-exemplo",
        "exemplo/tecnico-em-outro",
      ]);
      expect(plano.semMudanca).toBe(1);

      expect(registro(raiz, "tecnico-em-exemplo").suap).toEqual({
        id: 7,
        codigo: "EX001",
        vagas: 40,
        coletado_em: "2026-05-25",
        matrizes: {
          resumo:
            "10 — MATRIZ 2020 — CH exibida: 1200 h; estágio exigido: Sim; CH mínima de estágio (separada): 200 horas",
          urls: ["https://suap.ifpr.edu.br/edu/matriz/10/"],
          carga_horaria_comum_h: 1200,
          situacao: "Única ativa",
          coletado_em: "2026-11-19T10:00:00-03:00",
        },
      });
      const outro = registro(raiz, "tecnico-em-outro").suap.matrizes;
      expect(outro.situacao).toBe("Múltiplas — CH divergentes");
      expect(Object.keys(outro)).toEqual(["resumo", "urls", "situacao", "coletado_em"]);
      expect(NodeFS.readFileSync(caminhoCurso(raiz, "tecnico-em-terceiro"), "utf-8")).toBe(terceiroAntes);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("sem --apply, lista as mudanças e não grava nada", () =>
    Effect.gen(function* () {
      const { raiz, arquivo } = yield* cenario(fixture());
      const antes = textos(raiz);
      const { plano, gravado } = yield* aplicar(arquivo, raiz, false);
      assert.isFalse(gravado);
      expect(plano.mudancas.map((mudanca) => [mudanca.curso_id, mudanca.campos])).toEqual([
        ["exemplo/tecnico-em-exemplo", ["carga_horaria_comum_h", "resumo"]],
        ["exemplo/tecnico-em-outro", ["situacao", "urls", "resumo"]],
      ]);
      expect(textos(raiz)).toEqual(antes);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("um curso alterado desde a coleta recusa o relatório inteiro, sem gravar nenhum", () =>
    Effect.gen(function* () {
      const relatorio = fixture();
      relatorio.cursos[1] = { ...relatorio.cursos[1], codigo: "OUTRO" };
      relatorio.cursos.push({ curso_id: "exemplo/tecnico-sumido", suap_id: 99, codigo: "EX099", matrizes: [] });
      const { raiz, arquivo } = yield* cenario(relatorio);
      const antes = textos(raiz);
      const erro = yield* Effect.flip(aplicar(arquivo, raiz, true));
      assert.strictEqual(erro._tag, "CursosNaoConferem");
      expect(erro.message).toContain("exemplo/tecnico-em-outro: no registro, SUAP 8 código EX002");
      expect(erro.message).toContain("exemplo/tecnico-sumido: não encontrado");
      expect(textos(raiz)).toEqual(antes);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("a mesma coleta aplicada de novo não mexe em arquivo nenhum, nem no coletado_em", () =>
    Effect.gen(function* () {
      const { raiz, arquivo } = yield* cenario(fixture());
      yield* aplicar(arquivo, raiz, true);
      const depois = textos(raiz);
      for (const slug of ARQUIVOS) NodeFS.utimesSync(caminhoCurso(raiz, slug), MTIME_ANTIGO_S, MTIME_ANTIGO_S);

      const relatorio = { ...fixture(), coletado_em: "2026-12-01T10:00:00-03:00" };
      yield* FileSystem.FileSystem.pipe(Effect.flatMap((fs) => fs.writeFileString(arquivo, JSON.stringify(relatorio))));
      const { plano, gravado } = yield* aplicar(arquivo, raiz, true);
      assert.isFalse(gravado);
      expect(plano.mudancas).toEqual([]);
      expect(plano.semMudanca).toBe(3);
      expect(textos(raiz)).toEqual(depois);
      for (const slug of ARQUIVOS) {
        expect(NodeFS.statSync(caminhoCurso(raiz, slug)).mtimeMs).toBe(MTIME_ANTIGO_S * 1000);
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("carga horária que o registro não aceita (decimal) recusa o relatório antes de gravar", () =>
    Effect.gen(function* () {
      const relatorio = fixture();
      const [primeira, ...resto] = relatorio.cursos[0]!.matrizes as Array<Record<string, unknown>>;
      relatorio.cursos[0] = { ...relatorio.cursos[0], matrizes: [{ ...primeira, carga_horaria_h: 1233.5 }, ...resto] };
      const { raiz, arquivo } = yield* cenario(relatorio);
      const antes = textos(raiz);
      const erro = yield* Effect.flip(aplicar(arquivo, raiz, true));
      assert.strictEqual(erro._tag, "CursosNaoConferem");
      expect(erro.message).toContain("exemplo/tecnico-em-exemplo: o registro gravado seria inválido");
      expect(erro.message).toContain("carga_horaria_comum_h");
      expect(textos(raiz)).toEqual(antes);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("falha de disco no meio diz o que já foi gravado, e a nova aplicação completa o resto", () =>
    Effect.gen(function* () {
      const { raiz, arquivo } = yield* cenario(fixture());
      const somenteLeitura = caminhoCurso(raiz, "tecnico-em-outro");
      NodeFS.chmodSync(somenteLeitura, 0o444);
      const erro = yield* Effect.flip(aplicar(arquivo, raiz, true));
      NodeFS.chmodSync(somenteLeitura, 0o644);
      assert.strictEqual(erro._tag, "GravacaoInterrompida");
      if (erro._tag !== "GravacaoInterrompida") return;
      expect(erro.gravados).toEqual(["exemplo/tecnico-em-exemplo"]);
      expect(erro.falhou).toBe("exemplo/tecnico-em-outro");
      expect(erro.detalhe).toBe("EACCES");
      expect(registro(raiz, "tecnico-em-outro").suap.matrizes).toBeUndefined();

      const { plano, gravado } = yield* aplicar(arquivo, raiz, true);
      assert.isTrue(gravado);
      expect(plano.mudancas.map((mudanca) => mudanca.curso_id)).toEqual(["exemplo/tecnico-em-outro"]);
      expect(plano.semMudanca).toBe(2);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect.each([
    [
      "com falhas de coleta",
      { erros: [{ curso_id: "exemplo/x", suap_id: 1, codigo: "X", erro: "falhou" }] },
      "RelatorioComFalhas",
    ],
    ["de outra versão do esquema", { esquema: "matrizes-suap/2" }, "EsquemaDesconhecido"],
    ["sem esquema", { esquema: undefined }, "EsquemaDesconhecido"],
    ["com campo só do coletor", { segundos_suap: 1.5 }, "RelatorioForaDoFormato"],
  ] as const)("recusa relatório %s, sem gravar", ([, alteracao, tag]) =>
    Effect.gen(function* () {
      const { raiz, arquivo } = yield* cenario({ ...fixture(), ...alteracao });
      const antes = textos(raiz);
      const erro = yield* Effect.flip(aplicar(arquivo, raiz, true));
      assert.strictEqual(erro._tag, tag);
      expect(textos(raiz)).toEqual(antes);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
