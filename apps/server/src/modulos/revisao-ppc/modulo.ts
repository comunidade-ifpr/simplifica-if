/**
 * O módulo `revisao-ppc` (a tarefa "Revisar um PPC") como o servidor o compõe: as layers dos serviços e as
 * fontes de ocupação que seguram a troca da base e a atualização dos harnesses. Quem o compõe é o
 * `servidor.ts` do núcleo (arquivo de composição), que lhe passa o banco das conversas; os handlers RPC
 * entram pelo `handlers.ts` do núcleo (`./handlers.ts`), e as tabelas, pela migração
 * (`./persistencia/tabelas.ts`).
 *
 * - `RevisorPpc`: a revisão prévia sem IA, num `Worker` com limite de memória e de tempo.
 * - `RevisaoIa`: a revisão com IA, por blocos, retomável.
 * - `ListaViva`: a lista viva de pendências, sobre as duas.
 * - `Criterios`: a ficha de um critério no painel de leitura, sobre a lista viva e o `kb.sqlite`.
 * - `RevisoesPpc` e `CopiasComentadas`: o que a revisão guarda no banco das conversas.
 * - `ConversaAoLado`: a conversa com a IA ao lado da revisão, sobre as conversas e as pastas do núcleo
 *   (`layerConversaAoLado`, composta acima delas).
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type * as SqlClient from "effect/sql/SqlClient";
import * as Criterios from "./Criterios.ts";
import * as ListaViva from "./ListaViva.ts";
import * as ConversaAoLado from "./ConversaAoLado.ts";
import * as CopiasComentadas from "./persistencia/CopiasComentadas.ts";
import * as RevisoesPpc from "./persistencia/RevisoesPpc.ts";
import * as RevisaoIa from "./RevisaoIa.ts";
import * as RevisorPpc from "./RevisorPpc.ts";

export type { OpcoesRevisaoIa } from "./RevisaoIa.ts";

/**
 * Os serviços do módulo, sobre o banco das conversas (`banco`, o mesmo do núcleo). `opcoesLista` só o
 * script de teste real passa (`scripts/modulos/revisao-ppc/lista-viva-real.ts`).
 */
export const layer = <E, R>(
  banco: Layer.Layer<SqlClient.SqlClient, E, R>,
  opcoesIa?: RevisaoIa.OpcoesRevisaoIa,
  opcoesLista?: ListaViva.OpcoesListaViva,
) =>
  Criterios.layer.pipe(
    Layer.provideMerge(ListaViva.layer(opcoesLista)),
    Layer.provideMerge(RevisaoIa.layer(opcoesIa)),
    Layer.provideMerge(RevisorPpc.layer()),
    Layer.provideMerge(RevisoesPpc.layer.pipe(Layer.provide(banco))),
    Layer.provideMerge(CopiasComentadas.layer.pipe(Layer.provide(banco))),
  );

/** A conversa ao lado: pede os serviços do módulo (`layer`) e as conversas e as pastas do núcleo. */
export const layerConversaAoLado = ConversaAoLado.layer;

/** O que, no módulo, segura a troca da base e a atualização dos harnesses (entra na lista `fontesDeOcupacao`). */
export const fontesDeOcupacao = Effect.gen(function* () {
  const revisor = yield* RevisorPpc.RevisorPpc;
  const ia = yield* RevisaoIa.RevisaoIa;
  return [
    { nome: "revisão prévia de PPC", ocupada: revisor.ocupada },
    { nome: "revisão de PPC com IA", ocupada: ia.ocupada },
  ];
});

/**
 * Os caminhos de `.docx` das revisões ativas no banco, separados por papel (`originais` e `acompanhados`),
 * já filtrados para caminhos absolutos `.docx` normalizados. Usado pela rota `GET /arquivos/liberados`
 * para o processo principal do desktop autorizar "Abrir no Word" e "Mostrar na pasta" após reiniciar o app.
 */
export const caminhosEmRevisao = Effect.fn("RevisaoPpc.caminhosEmRevisao")(function* () {
  const revisoes = yield* RevisoesPpc.RevisoesPpc;
  const path = yield* Path.Path;
  const limpar = (lista: ReadonlyArray<string>) => {
    const saida = new Set<string>();
    for (const c of lista) {
      if (!path.isAbsolute(c) || path.extname(c).toLowerCase() !== ".docx") continue;
      saida.add(path.normalize(c));
    }
    return [...saida];
  };
  const { originais, acompanhados } = yield* revisoes.caminhosEmRevisao();
  return { originais: limpar(originais), acompanhados: limpar(acompanhados) };
});
