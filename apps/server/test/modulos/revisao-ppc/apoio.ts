// @effect-diagnostics nodeBuiltinImport:off -- apoio de teste: o banco de fixture pelo node:sqlite
/**
 * Apoio dos testes do módulo `revisao-ppc`: o apoio comum do servidor (`../../apoio.ts`), com os Workers da
 * revisão prévia no próprio processo, o banco de fixture com as fichas da revisão com IA e o
 * `revisarAteOFim`.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type {
  EtapaLeituraPpc,
  EventoRevisaoPpc,
  ListaPendencias,
} from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import * as RevisorPpc from "../../../src/modulos/revisao-ppc/RevisorPpc.ts";
import * as TrabalhoRevisao from "../../../src/modulos/revisao-ppc/trabalho.ts";
import { bancoFixture, layerWorkersNoProcessoCom, type TrabalhoNoProcesso } from "../../apoio.ts";

export * from "../../apoio.ts";

/** A revisão prévia (`RevisorPpc`) no próprio processo. */
const revisaoNoProcesso: TrabalhoNoProcesso = (url, pedido, aoAndamento) =>
  url.href === RevisorPpc.URL_TRABALHADOR.href
    ? Effect.sync(() => TrabalhoRevisao.atender(pedido as TrabalhoRevisao.PedidoTrabalhador, aoAndamento).resposta)
    : undefined;

/** Os Workers do núcleo e o da revisão prévia no próprio processo. */
export const layerWorkersNoProcesso = layerWorkersNoProcessoCom(revisaoNoProcesso);

export const PASTA_FICHAS = NodePath.join(import.meta.dirname, "../../../../../base-conhecimento/revisao-ppc/fichas");
/** Duas S de temas do modo rápido, duas J da matriz e uma transversal BLOQ. */
export const FICHAS_FIXTURE = ["CT-IDENT-02", "CT-CURR-03", "CT-CURR-12", "CT-CURR-19", "CT-TRANS-03"] as const;

/** O `kb.sqlite` de fixture com o curso Técnico em Agropecuária no CNCT e as 5 fichas da revisão com IA. */
export function bancoComFichas(): string {
  const banco = bancoFixture();
  const db = new NodeSqlite.DatabaseSync(banco);
  const curso = {
    denominacao: "Técnico em Agropecuária",
    eixo_tecnologico: "Recursos Naturais",
    carga_horaria_minima_horas: 1200,
  };
  db.prepare(
    "INSERT INTO cnct (id, slug, denominacao, eixo_tecnologico, carga_horaria_minima_h, path, dados_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "cnct:tecnico-em-agropecuaria",
    "tecnico-em-agropecuaria",
    curso.denominacao,
    curso.eixo_tecnologico,
    1200,
    "x.json",
    JSON.stringify(curso),
  );
  db.prepare("DELETE FROM fichas").run();
  for (const id of FICHAS_FIXTURE) {
    const texto = NodeFS.readFileSync(NodePath.join(PASTA_FICHAS, `${id.toLowerCase()}.json`), "utf8");
    const json = JSON.parse(texto) as { titulo: string };
    db.prepare("INSERT INTO fichas (id, titulo, path, dados_json, arquivo_json) VALUES (?, ?, ?, ?, ?)").run(
      id,
      json.titulo,
      `fichas/${id}.json`,
      JSON.stringify(json),
      texto,
    );
  }
  db.close();
  return banco;
}

/**
 * `revisaoPpc.revisar` (ou o `ListaViva.revisar`) até o fim: as etapas, na ordem em que chegaram, o id
 * da lista do `pronto` e o resultado dela. Sem `pronto`, defeito.
 */
export const revisarAteOFim = <E, R, E2, R2>(
  revisor: {
    readonly "revisaoPpc.revisar": (entrada: RevisorPpc.EntradaRevisao) => Stream.Stream<EventoRevisaoPpc, E, R>;
    readonly "revisaoPpc.lista": (entrada: { readonly lista: string }) => Effect.Effect<ListaPendencias, E2, R2>;
  },
  entrada: RevisorPpc.EntradaRevisao,
) =>
  Stream.runCollect(revisor["revisaoPpc.revisar"](entrada)).pipe(
    Effect.flatMap((eventos) => {
      const etapas: Array<EtapaLeituraPpc> = [];
      for (const evento of eventos) if (evento.tipo === "etapa") etapas.push(evento.etapa);
      const pronto = eventos.find((evento) => evento.tipo === "pronto");
      return pronto?.tipo === "pronto"
        ? revisor["revisaoPpc.lista"]({ lista: pronto.lista }).pipe(
            Effect.map((lista) => ({ etapas, lista: pronto.lista, ...lista.resultado })),
          )
        : Effect.die("revisaoPpc.revisar terminou sem a lista");
    }),
  );
