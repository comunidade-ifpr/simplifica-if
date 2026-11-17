// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- teste: compila um kb.sqlite temporário, roda um processo filho e fixa o relógio da rodada
/**
 * A base da revisão prévia vinda do `kb.sqlite` (o que o app empacotado tem) é a mesma lida dos
 * arquivos do checkout, e a revisão prévia roda sem o repositório:
 *
 * - compila a base real num diretório temporário (`Compilador`), monta a base do banco
 *   (`montarBase`) e a compara, campo a campo, com `baseRevisaoDeArquivos`; a revisão prévia dos PPCs
 *   sintéticos dá o mesmo resultado com as duas;
 * - num processo filho (`sem-repositorio.ts`), com a leitura das pastas de dados do checkout
 *   bloqueada, a revisão prévia sobre o banco dá o mesmo resultado, sem tentar ler nada delas; e a
 *   pré-conferência sem `vigencia` (o controle) esbarra no bloqueio.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Compilador from "@simplifica-if/kb/Compilador";
import * as Layers from "@simplifica-if/kb/layers";
import { revisarDocx, type BaseRevisaoPrevia } from "@simplifica-if/ppc/revisao-previa";
import { ppcSintetico } from "@simplifica-if/ppc/testes/revisao-previa";
import { baseRevisaoDeArquivos } from "../../../packages/ppc/scripts/base-tecnica.ts";
import { montarBase } from "../src/revisao-ppc/RevisorPpc.ts";

const raiz = NodePath.resolve(import.meta.dirname, "../../..");
const AGORA = new Date("2026-11-16T12:00:00Z");

/** A base real compilada num diretório temporário, e as duas bases da revisão prévia. */
class Bases extends Context.Service<
  Bases,
  {
    readonly pasta: string;
    readonly banco: string;
    readonly doBanco: BaseRevisaoPrevia;
    readonly dosArquivos: BaseRevisaoPrevia;
  }
>()("@simplifica-if/server/test/revisao-ppc-base.test/Bases") {}

const layerBases = Layer.effect(
  Bases,
  Effect.gen(function* () {
    const pasta = yield* Effect.acquireRelease(
      Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "simplifica-base-revisao-"))),
      (dir) => Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
    );
    const banco = NodePath.join(pasta, "kb.sqlite");
    const compilador = yield* Compilador.Compilador;
    yield* compilador.compilar({ raiz, destino: banco });
    const doBanco = yield* montarBase.pipe(Effect.provide(Layers.layerSomenteLeitura({ caminho: banco })));
    return Bases.of({ pasta, banco, doBanco, dosArquivos: baseRevisaoDeArquivos(raiz) });
  }),
).pipe(Layer.provide(Compilador.layer.pipe(Layer.provide(NodeServices.layer))));

/** As normas por id, sem as chaves ausentes (o banco e os arquivos as omitem de modos diferentes). */
const porId = <T extends { id: string }>(lista: readonly T[]) =>
  Object.fromEntries(
    [...lista]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((item) => [item.id, JSON.parse(JSON.stringify(item)) as unknown]),
  );

layer(layerBases, { timeout: "300 seconds", excludeTestServices: true })("base da revisão prévia", (it) => {
  describe("kb.sqlite × arquivos", () => {
    it.effect("mesmos registros, relações, datas, transições, CNCT, fichas, tópicos, endereços e data", () =>
      Effect.gen(function* () {
        const { doBanco, dosArquivos } = yield* Bases;
        expect(porId(doBanco.normas)).toEqual(porId(dosArquivos.normas));
        expect(doBanco.relacoes).toEqual(dosArquivos.relacoes);
        expect(new Map(doBanco.datas)).toEqual(new Map(dosArquivos.datas));
        expect(doBanco.transicoes).toEqual(dosArquivos.transicoes);
        expect(Object.fromEntries(doBanco.cncts.map((c) => [c.slug, c]))).toEqual(
          Object.fromEntries(dosArquivos.cncts.map((c) => [c.slug, c])),
        );
        expect(doBanco.fichas).toEqual(dosArquivos.fichas);
        expect(doBanco.topicos).toEqual(dosArquivos.topicos);
        // O banco tem também os endereços dos stubs; os da base publicada são os mesmos.
        for (const [id, url] of Object.entries(dosArquivos.urls)) expect(doBanco.urls[id], id).toBe(url);
        expect(doBanco.dataBase).toBe(dosArquivos.dataBase);
        expect(doBanco.normas.length).toBeGreaterThan(100);
        expect(doBanco.transicoes.length).toBeGreaterThan(0);
      }),
    );

    it.effect("a revisão prévia dá o mesmo resultado com as duas bases", () =>
      Effect.gen(function* () {
        const { doBanco, dosArquivos } = yield* Bases;
        for (const docx of [ppcSintetico(), ppcSintetico({ controleDeAlteracoes: true })]) {
          const a = revisarDocx(docx, "ppc.docx", doBanco, { agora: AGORA });
          const b = revisarDocx(docx, "ppc.docx", dosArquivos, { agora: AGORA });
          expect(a.pendencias).toEqual(b.pendencias);
          expect(a.criterios).toEqual(b.criterios);
          expect(a.aviso).toEqual(b.aviso);
        }
      }),
    );
  });

  it.effect("sem o repositório: a revisão prévia só com o kb.sqlite, e o controle esbarra no bloqueio", () =>
    Effect.gen(function* () {
      const { pasta, banco, doBanco } = yield* Bases;
      const docx = NodePath.join(pasta, "PPC.docx");
      NodeFS.writeFileSync(docx, ppcSintetico());
      const saida = NodeChildProcess.execFileSync(
        process.execPath,
        [NodePath.join(import.meta.dirname, "sem-repositorio.ts"), banco, docx],
        { encoding: "utf8", cwd: pasta },
      );
      const resultado = JSON.parse(saida.trim().split("\n").at(-1)!) as {
        leiturasDaRevisao: number;
        controle: string;
        pendencias: { ficha: string; estado: string; mensagem: string }[];
      };
      expect(resultado.leiturasDaRevisao).toBe(0);
      expect(resultado.controle).toBe("bloqueado");
      const esperado = revisarDocx(ppcSintetico(), "ppc.docx", doBanco, { agora: AGORA }).pendencias.map((p) => ({
        ficha: p.ficha,
        estado: p.estado,
        mensagem: p.mensagem,
      }));
      expect(resultado.pendencias).toEqual(esperado);
    }),
  );
});
