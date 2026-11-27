/**
 * A montagem única da base da revisão prévia (`BaseRevisaoPrevia`), pelos serviços do kb sobre o
 * `kb.sqlite`: o registro, as relações, as datas e as transições da vigência, os tópicos das fichas e
 * a data de referência de `FontesNormativas`; o CNCT de `Cursos`; os endereços oficiais de `Normas`; os
 * títulos das fichas de `PacoteRevisaoPpc`. Nada vem de arquivos do repositório.
 *
 * O servidor a monta do `kb.sqlite` que serve (o app empacotado não tem o checkout); os scripts e os
 * testes deste pacote, do `tmp/kb.sqlite` do checkout (`scripts/base-tecnica.ts`). As duas revisões
 * são, assim, a mesma.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Cursos from "@simplifica-if/kb/Cursos";
import * as Sql from "@simplifica-if/kb/db/sql";
import * as FontesNormativas from "@simplifica-if/kb/FontesNormativas";
import * as Normas from "@simplifica-if/kb/Normas";
import * as PacoteRevisaoPpc from "@simplifica-if/kb/PacoteRevisaoPpc";
import type { BaseRevisaoPrevia } from "./revisao-previa.ts";
import type { CursoCnct } from "./verificadores/comum.ts";
import type { Marco } from "./verificadores/vigencia.ts";

const EsquemaArquivoMarcos = Schema.fromJsonString(
  Schema.Struct({
    marcos: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        linha: Schema.Array(Schema.String),
        fichas_responsaveis: Schema.Array(Schema.String),
      }),
    ),
  }),
);
const decodificarArquivoMarcos = Schema.decodeUnknownEffect(EsquemaArquivoMarcos);

/** A base da revisão prévia, só com dados planos (vai ao Worker do servidor pelo `postMessage`). */
export const montarBaseRevisao = Effect.gen(function* () {
  const fontes = yield* FontesNormativas.FontesNormativas;
  const cursos = yield* Cursos.Cursos;
  const normas = yield* Normas.Normas;
  const pacotes = yield* PacoteRevisaoPpc.PacoteRevisaoPpc;
  const cncts = (yield* cursos.catalogoCnct).map(
    (curso): CursoCnct => ({ ...curso.dados, slug: curso.slug }) as CursoCnct,
  );
  const fichas: Record<string, string> = {};
  for (const ficha of yield* pacotes.fichas()) fichas[ficha.id] = String(ficha.titulo);
  const { arquivos } = yield* fontes.conteudoRevisaoPpc();
  const arquivoMarcos = arquivos.find((a) => a.arquivo.endsWith("/marcos-normativos.json"));
  const marcos: Marco[] = arquivoMarcos
    ? (yield* decodificarArquivoMarcos(arquivoMarcos.texto).pipe(
        Effect.mapError((cause) => new Sql.FalhaNaConsulta({ consulta: "marcos-normativos.json", cause })),
      )).marcos.map((m) => ({
        id: m.id,
        linha: [...m.linha],
        responsavel: m.fichas_responsaveis[0] ?? "CT-SUP-12",
      }))
    : [];
  const base: BaseRevisaoPrevia = {
    // Cópias planas: o `postMessage` não clona protótipos nem readonly profundos.
    normas: fontes.registro.entradas.map((entrada) => ({ ...entrada, aliases: [...entrada.aliases] })),
    relacoes: fontes.relacoes.map((relacao) => structuredClone(relacao)),
    marcos,
    // A vigência vem do banco, como o resto: sem ela, os verificadores leriam a do checkout.
    datas: new Map(fontes.datas),
    transicoes: fontes.transicoes.map((transicao) => structuredClone(transicao)),
    consolidado: { em: fontes.consolidado.em, status: new Map(fontes.consolidado.status) },
    cncts,
    urls: yield* normas.enderecosOficiais,
    fichas,
    topicos: fontes.topicosFichas.map((topico) => ({ id: topico.id, fichas: [...(topico.fichas ?? [])] })),
    dataBase: fontes.dataReferencia,
  };
  return base;
}).pipe(Effect.withSpan("BaseRevisao.montar"));
