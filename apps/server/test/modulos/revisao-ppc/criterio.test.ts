// @effect-diagnostics nodeBuiltinImport:off -- teste: arquivos temporários e o banco de fixture
/**
 * A ficha de um critério da revisão (`revisaoPpc.criterio`), pelo RPC, sobre o banco de fixture com as
 * fichas da revisão: o texto da ficha, o modo, as normas com a vigência e o "Neste PPC" (o estado na régua e
 * a pendência), o critério que passou, o critério que a base não tem e a revisão que não existe.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { ehFalhaRevisaoPpc } from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import { ppcSintetico } from "@simplifica-if/ppc/testes/revisao-previa";
import * as Servidor from "../../../src/servidor.ts";
import {
  bancoComFichas,
  cliente,
  diretorioTemporario,
  layerDriversFalsos,
  layerWorkersNoProcesso,
  limparTemporarios,
  novoRegistro,
  PASTA_FICHAS,
  revisarAteOFim,
  TOKEN,
} from "./apoio.ts";

afterAll(limparTemporarios);

/**
 * As fichas de fixture, a do AEE (CT-CURR-22, do código, que o PPC sintético não atende) e a do estágio
 * (CT-CURR-25, que cita o CNCT e um regulamento externo, sem texto na base).
 */
function banco(): string {
  const arquivo = bancoComFichas();
  const db = new NodeSqlite.DatabaseSync(arquivo);
  for (const id of ["CT-CURR-22", "CT-CURR-25"]) {
    const texto = NodeFS.readFileSync(NodePath.join(PASTA_FICHAS, `${id.toLowerCase()}.json`), "utf8");
    const json = JSON.parse(texto) as { titulo: string };
    db.prepare(
      "INSERT INTO revisao_ppc_fichas (id, titulo, path, dados_json, arquivo_json) VALUES (?, ?, ?, ?, ?)",
    ).run(id, json.titulo, `fichas/${id}.json`, JSON.stringify(json), texto);
  }
  db.close();
  return arquivo;
}

const pasta = diretorioTemporario("simplifica-criterio-");
const camada = Servidor.layer({ primeiroUsoFeito: true, banco: banco(), token: Redacted.make(TOKEN) }).pipe(
  Layer.provide(layerDriversFalsos(novoRegistro())),
  Layer.provide(layerWorkersNoProcesso),
  Layer.provide(NodeServices.layer),
);

layer(camada, { excludeTestServices: true })("revisaoPpc.criterio", (it) => {
  it.effect("a ficha do critério, com as normas e o estado neste PPC; o que passou; as recusas", () =>
    Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const rpc = yield* cliente(urlRpc, { authorization: `Bearer ${TOKEN}` });
      const original = NodePath.join(pasta, "PPC critério.docx");
      NodeFS.writeFileSync(original, ppcSintetico());
      const resultado = yield* revisarAteOFim(rpc, { arquivo: original });
      const lista = yield* rpc["revisaoPpc.lista"]({ lista: resultado.lista });

      // Um critério com pendência: o texto da ficha, o modo, as normas e a pendência dele.
      const aee = yield* rpc["revisaoPpc.criterio"]({ lista: resultado.lista, id: "CT-CURR-22" });
      const viva = lista.pendencias.find((v) => v.pendencia.ficha === "CT-CURR-22")!;
      assert.strictEqual(aee.titulo, "AEE não incorporado como componente curricular da matriz ou do histórico");
      assert.strictEqual(aee.criticidade, "BLOQ");
      assert.strictEqual(aee.modo, "D");
      assert.isNotNull(aee.pergunta);
      assert.isNotNull(aee.atendido);
      assert.isNotNull(aee.naoAtendido);
      assert.deepStrictEqual(
        aee.normas.map((n) => n.norma),
        ["ifpr/proens/nt/2025/1", "ifpr/consup/res/2023/159", "ifpr/consup/res/2023/148"],
      );
      assert.deepStrictEqual(aee.nestePpc.pendencia, {
        chave: viva.chave,
        situacao: "aberta",
        titulo: viva.pendencia.titulo,
        secao: viva.pendencia.secao,
        trecho: viva.pendencia.trecho,
      });
      assert.strictEqual(aee.nestePpc.estado, resultado.criterios.find((c) => c.ficha === "CT-CURR-22")!.estado);

      // As normas da base abrem no Ler, com o título.
      assert.isTrue(aee.normas.every((n) => n.tipo === "norma" && n.link === `ifpr://norma/${n.norma}`));

      // A pendência marcada como feita: o "Neste PPC" acompanha.
      yield* rpc["revisaoPpc.marcar"]({ lista: resultado.lista, chave: viva.chave, situacao: "resolvida" });
      const feita = yield* rpc["revisaoPpc.criterio"]({ lista: resultado.lista, id: "CT-CURR-22" });
      assert.strictEqual(feita.nestePpc.pendencia?.situacao, "resolvida");

      // O CNCT abre no curso da revisão; a referência externa não tem destino no Ler nem vigência.
      const estagio = yield* rpc["revisaoPpc.criterio"]({ lista: resultado.lista, id: "CT-CURR-25" });
      const cnct = estagio.normas.find((n) => n.norma === "cnct:catalogo")!;
      const curso = lista.resultado.curso.cnct;
      assert.deepInclude(cnct, {
        tipo: "cnct",
        titulo: curso === null ? "Catálogo Nacional de Cursos Técnicos (CNCT)" : `CNCT · ${curso.denominacao}`,
        link: curso === null ? null : `ifpr://cnct/${curso.slug}`,
        vigencia: null,
      });
      const externo = estagio.normas.find((n) => n.norma.startsWith("externo:"))!;
      assert.deepInclude(externo, { tipo: "externo", link: null, vigencia: null });

      // A ficha S com dispositivos: um por norma, na ordem da ficha, com a vigência do banco.
      const s = yield* rpc["revisaoPpc.criterio"]({ lista: resultado.lista, id: "CT-IDENT-02" });
      assert.strictEqual(s.modo, "S");
      assert.isAbove(s.normas.length, 0);
      assert.strictEqual(new Set(s.normas.map((n) => n.norma)).size, s.normas.length);
      assert.isTrue(s.normas.every((n) => n.dispositivos.every((d) => !d.startsWith("#"))));

      // Um critério sem pendência (a IA ainda não leu): o estado da régua, sem pendência.
      const semPendencia = FICHAS_SEM_PENDENCIA.find((f) => !lista.pendencias.some((v) => v.pendencia.ficha === f))!;
      const ficha = yield* rpc["revisaoPpc.criterio"]({ lista: resultado.lista, id: semPendencia });
      assert.isNull(ficha.nestePpc.pendencia);
      assert.strictEqual(
        ficha.nestePpc.estado,
        resultado.criterios.find((c) => c.ficha === semPendencia)?.estado ?? "nao_lido",
      );

      // Um critério que a base não tem e uma revisão que não existe (apagada): a falha da revisão.
      const semCriterio = yield* Effect.flip(rpc["revisaoPpc.criterio"]({ lista: resultado.lista, id: "CT-XX-99" }));
      assert.isTrue(ehFalhaRevisaoPpc(semCriterio));
      assert.include(semCriterio.message, "CT-XX-99");
      const semLista = yield* Effect.flip(
        rpc["revisaoPpc.criterio"]({ lista: "lista-que-nao-existe", id: "CT-CURR-22" }),
      );
      assert.isTrue(ehFalhaRevisaoPpc(semLista));
    }),
  );
});

const FICHAS_SEM_PENDENCIA = ["CT-CURR-03", "CT-CURR-12", "CT-CURR-19", "CT-TRANS-03", "CT-IDENT-02"];
