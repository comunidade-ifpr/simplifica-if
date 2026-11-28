// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- teste: compila um kb.sqlite temporário, roda um processo filho e fixa o relógio da rodada
/**
 * A base da revisão prévia vinda do `kb.sqlite` (o que o app empacotado tem) traz o que os arquivos do
 * checkout trazem, e a revisão prévia roda sem o repositório:
 *
 * - compila a base real num diretório temporário (`Compilador`) e monta a base pela montagem única
 *   (`montarBaseRevisao`), como no app. A referência não passa por ela: o registro, as relações, as
 *   datas, as transições e a data de referência vêm dos carregadores síncronos dos arquivos
 *   (`carregarRegistro`, `carregarRelacoes`…), e os tópicos, o CNCT, os títulos das fichas e os
 *   endereços oficiais, dos JSON lidos aqui. A base do banco é igual à referência, campo a campo, e a
 *   revisão prévia dos PPCs sintéticos dá o mesmo resultado com as duas;
 * - num processo filho (`sem-repositorio.ts`), com a leitura das pastas de dados do checkout
 *   bloqueada, a revisão prévia sobre o banco dá o mesmo resultado, sem tentar ler nada delas; e a
 *   leitura do registro do checkout (o controle) esbarra no bloqueio.
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
import { listarNormas } from "@simplifica-if/kb/normas/estrutura";
import { carregarRegistro } from "@simplifica-if/kb/normas/registro";
import { carregarRelacoes } from "@simplifica-if/kb/normas/relacoes";
import {
  carregarConsolidado,
  carregarDatas,
  carregarTransicoes,
  dataReferencia,
} from "@simplifica-if/kb/normas/vigencia";
import { montarBaseRevisao } from "@simplifica-if/ppc/base-revisao";
import { revisarDocx, textoDaPendencia, type BaseRevisaoPrevia } from "@simplifica-if/ppc/revisao-previa";
import { ppcSintetico } from "@simplifica-if/ppc/testes/revisao-previa";

const raiz = NodePath.resolve(import.meta.dirname, "../../../../..");
const AGORA = new Date("2026-11-16T12:00:00Z");

/** A base real compilada num diretório temporário, e a base da revisão prévia montada do banco. */
class Bases extends Context.Service<
  Bases,
  {
    readonly pasta: string;
    readonly banco: string;
    readonly doBanco: BaseRevisaoPrevia;
  }
>()("@simplifica-if/server/test/modulos/revisao-ppc/revisao-ppc-base.test/Bases") {}

const layerBases = Layer.effect(
  Bases,
  Effect.gen(function* () {
    const pasta = yield* Effect.acquireRelease(
      Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "simplifica-base-revisao-"))),
      (dir) => Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
    );
    const banco = NodePath.join(raiz, "tmp", "kb.sqlite");
    const compilador = yield* Compilador.Compilador;
    yield* compilador.garantirFresco({ raiz, caminho: banco, politica: "auto" });
    const doBanco = yield* montarBaseRevisao.pipe(Effect.provide(Layers.layerSomenteLeitura({ caminho: banco })));
    return Bases.of({ pasta, banco, doBanco });
  }),
).pipe(Layer.provide(Compilador.layer), Layer.provide(NodeServices.layer));

const lerJson = (arquivo: string): unknown => JSON.parse(NodeFS.readFileSync(arquivo, "utf8"));
const jsonsDe = (pasta: string) =>
  NodeFS.readdirSync(NodePath.join(raiz, pasta))
    .filter((nome) => nome.endsWith(".json"))
    .map((nome) => ({ nome, json: lerJson(NodePath.join(raiz, pasta, nome)) }));

/** `topicos.json` lido aqui: os tópicos na ordem do arquivo, com `fichas` derivado de `topicos_tematicos` das fichas. */
const topicosDoArquivo = () => {
  const porTopico = new Map<string, string[]>();
  for (const { json } of jsonsDe("base-conhecimento/revisao-ppc/fichas")) {
    const f = json as { id: string; topicos_tematicos?: string[] };
    for (const t of f.topicos_tematicos ?? []) {
      const lista = porTopico.get(t) ?? [];
      lista.push(f.id);
      porTopico.set(t, lista);
    }
  }
  return (
    lerJson(NodePath.join(raiz, "base-conhecimento/revisao-ppc/topicos.json")) as {
      topicos: { id: string }[];
    }
  ).topicos.map((topico) => ({ id: topico.id, fichas: (porTopico.get(topico.id) ?? []).sort() }));
};

/**
 * A referência da base vinda dos arquivos, sem `montarBaseRevisao`: registro, relações, datas,
 * transições, tópicos e data pelos carregadores; CNCT, fichas e endereços do banco, que o primeiro
 * teste confere contra os arquivos.
 */
const referenciaDosArquivos = (doBanco: BaseRevisaoPrevia): BaseRevisaoPrevia => ({
  normas: carregarRegistro(raiz).entradas,
  relacoes: carregarRelacoes(raiz),
  datas: carregarDatas(raiz),
  transicoes: carregarTransicoes(raiz),
  consolidado: carregarConsolidado(raiz),
  topicos: topicosDoArquivo(),
  dataBase: dataReferencia(raiz),
  cncts: doBanco.cncts,
  urls: doBanco.urls,
  fichas: doBanco.fichas,
  marcos: doBanco.marcos,
});

/** As normas por id, sem as chaves ausentes (o banco e os arquivos as omitem de modos diferentes). */
const porId = <T extends { id: string }>(lista: readonly T[]) =>
  Object.fromEntries(
    [...lista]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((item) => [item.id, JSON.parse(JSON.stringify(item)) as unknown]),
  );

layer(layerBases, { timeout: "300 seconds", excludeTestServices: true })("base da revisão prévia", (it) => {
  describe("kb.sqlite × arquivos", () => {
    it.effect(
      "mesmos registros, relações, datas, transições, tópicos e data; CNCT, fichas e endereços dos arquivos",
      () =>
        Effect.gen(function* () {
          const { doBanco } = yield* Bases;
          expect(porId(doBanco.normas)).toEqual(porId(carregarRegistro(raiz).entradas));
          expect(doBanco.relacoes).toEqual(carregarRelacoes(raiz));
          expect(new Map(doBanco.datas)).toEqual(carregarDatas(raiz));
          expect(doBanco.transicoes).toEqual(carregarTransicoes(raiz));
          expect(doBanco.topicos).toEqual(topicosDoArquivo());
          expect(doBanco.dataBase).toBe(dataReferencia(raiz));
          expect(Object.fromEntries(doBanco.cncts.map((c) => [c.slug, c]))).toEqual(
            Object.fromEntries(
              jsonsDe("base-conhecimento/catalogos/cnct/cursos").map(({ nome, json }) => [
                nome.slice(0, -5),
                { ...(json as object), slug: nome.slice(0, -5) },
              ]),
            ),
          );
          expect(doBanco.fichas).toEqual(
            Object.fromEntries(
              jsonsDe("base-conhecimento/revisao-ppc/fichas").map(({ json }) => {
                const ficha = json as { id: string; titulo: string };
                return [ficha.id, ficha.titulo];
              }),
            ),
          );
          // O banco tem também os endereços dos stubs; os da base publicada são os mesmos.
          const comUrl = listarNormas(raiz).flatMap(({ id, meta }) =>
            typeof meta.fonte_url === "string" ? [{ id, fonte_url: meta.fonte_url }] : [],
          );
          expect(comUrl.length).toBeGreaterThan(0);
          for (const { id, fonte_url } of comUrl) expect(doBanco.urls[id], id).toBe(fonte_url);
          expect(doBanco.normas.length).toBeGreaterThan(100);
          expect(doBanco.transicoes.length).toBeGreaterThan(0);
        }),
    );

    it.effect("a revisão prévia dá o mesmo resultado com as duas bases", () =>
      Effect.gen(function* () {
        const { doBanco } = yield* Bases;
        const dosArquivos = referenciaDosArquivos(doBanco);
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
        mensagem: textoDaPendencia(p),
      }));
      expect(resultado.pendencias).toEqual(esperado);
    }),
  );
});
