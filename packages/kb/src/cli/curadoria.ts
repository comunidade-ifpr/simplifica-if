/**
 * Comandos de curadoria da CLI `kb`, que leem os arquivos do checkout ou medem a base:
 *
 *   pnpm kb propor-relacoes [--json]
 *   pnpm kb avaliar-resolvedor [--json]
 *   pnpm kb avaliar-busca [--json]
 *
 * As consultas à base são as ferramentas do `simplifica-mcp` (`packages/mcp/src/kb.ts` monta a CLI
 * com os dois conjuntos). Saídas sem relógio e com ordem estável.
 */
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Command from "effect/cli/Command";
import { avaliarBusca } from "../avaliacao/busca-secoes.ts";
import { avaliarResolvedor, lerAnotacoes } from "../avaliacao/resolvedor.ts";
import { carregarRegistro } from "../normas/registro.ts";
import { proporRelacoes } from "../normas/relacoes.ts";
import {
  camadaRepositorio,
  Checkout,
  FalhaNaCuradoria,
  flagJson,
  imprimir,
  paraJson,
  paraJsonCompacto,
} from "./comum.ts";

export const proporRelacoesCmd = Command.make(
  "propor-relacoes",
  { json: flagJson },
  Effect.fn("kb.proporRelacoes")(function* ({ json }) {
    const { raiz } = yield* Checkout;
    const propostas = yield* Effect.try({
      try: () => proporRelacoes(raiz),
      catch: (cause) => new FalhaNaCuradoria({ comando: "propor-relacoes", cause }),
    });
    if (json) return yield* Console.log(paraJson(propostas));
    yield* imprimir([
      `${propostas.length} propostas não registradas nem descartadas em relacoes.yaml`,
      ...propostas.map((p) => `  ${p.tipo} ${p.origem}${p.operador} → ${p.alvos.join(", ") || "?"}: ${p.trecho}`),
    ]);
  }),
).pipe(
  Command.withDescription(
    "Propostas do regex sobre o texto das normas ainda não registradas nem descartadas em relacoes.yaml.",
  ),
);

export const avaliarResolvedorCmd = Command.make(
  "avaliar-resolvedor",
  { json: flagJson },
  Effect.fn("kb.avaliarResolvedor")(function* ({ json }) {
    const { raiz } = yield* Checkout;
    const resultado = yield* Effect.try({
      try: () => avaliarResolvedor(lerAnotacoes(raiz), carregarRegistro(raiz), raiz),
      catch: (cause) => new FalhaNaCuradoria({ comando: "avaliar-resolvedor", cause }),
    });
    if (json) return yield* Console.log(paraJson(resultado));
    yield* imprimir([
      `${resultado.ppcs} PPCs, ${resultado.linhas} linhas, ${resultado.anotados} citações anotadas, ${resultado.emitidos} emitidas`,
      `precisão ${resultado.precisao}  recall ${resultado.recall}  dispositivos ${resultado.dispositivos.taxa}`,
      ...resultado.problemas.map((problema) => `PROBLEMA: ${problema}`),
      ...resultado.erros.map(
        (erro) =>
          `${erro.tipo.padEnd(15)} ${erro.id.padEnd(38)} ${(erro.regra ?? "").padEnd(24)} ${erro.ppc} L${erro.linha}`,
      ),
    ]);
  }),
).pipe(Command.withDescription("Mede precisão e recall do resolvedor no conjunto anotado (avaliacao/resolvedor/)."));

export const avaliarBuscaCmd = Command.make(
  "avaliar-busca",
  { json: flagJson },
  Effect.fn("kb.avaliarBusca")(function* ({ json }) {
    const { raiz } = yield* Checkout;
    const resultado = yield* avaliarBusca({ raiz });
    if (json) return yield* Console.log(paraJson(resultado));
    const linhas = [`${resultado.consultas} consultas, recall@${resultado.k} (meta ${resultado.meta}):`];
    for (const [m, v] of Object.entries(resultado.recall)) linhas.push(`  ${m.padEnd(9)} ${v}`);
    for (const d of resultado.detalhes) {
      const perdas = Object.entries(d.faltando).filter(([, l]) => l.length);
      if (!perdas.length) continue;
      linhas.push(`${d.id} "${d.consulta}" ${paraJsonCompacto(d.recall)}`);
      for (const [m, l] of perdas) for (const x of l) linhas.push(`    ${m}: falta ${x}`);
    }
    yield* imprimir(linhas);
  }, Effect.provide(camadaRepositorio)),
).pipe(
  Command.withDescription(
    "Recall@10 da busca de seções no conjunto rotulado (avaliacao/busca-secoes/), com e sem stemmer e sinônimos.",
  ),
);
