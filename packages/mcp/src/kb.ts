#!/usr/bin/env node
/**
 * CLI `kb`: a base de conhecimento dentro do checkout (`pnpm kb`).
 *
 *   pnpm kb buscar-norma "Resolução CNE/CP nº 2/2026, art. 28" [--limite 5] [--json]
 *   pnpm kb ficha-norma br/cne-cp/res/2021/1 --em 2026-11-01
 *   pnpm kb pacote-contexto CT-CURR-12 --arquivo rodada/PPC.md
 *   pnpm kb compilar [--destino tmp/kb.sqlite]
 *   pnpm kb --help
 *
 * As consultas são as ferramentas do servidor MCP `ifpr`, uma por comando (`consulta.ts`): a mesma
 * entrada, o mesmo serviço `Leitura` e a mesma resposta, o texto Markdown que a IA recebe ou, com
 * `--json`, a `Resposta`. Elas rodam sobre o `tmp/kb.sqlite` do checkout, recompilado quando está
 * mais velho que as fontes (`KB_SQLITE` muda o caminho; `KB_RECOMPILAR=nunca|sempre`); o `arquivo`
 * do `pacote-contexto` se lê do diretório atual. A curadoria (`compilar`, `relacoes --propor`,
 * `avaliar-resolvedor`, `avaliar-busca`) fica em `@simplifica-if/kb/cli`.
 *
 * Erros: pelo ponto de entrada comum, longe do stdout. Entrada inválida, ID fora da base e falha do
 * banco saem como `kb: <mensagem>` no stderr, com código 1.
 */
import { raizRepositorio } from "@simplifica-if/kb/caminhos";
import { compilar } from "@simplifica-if/kb/cli/compilar";
import { Checkout } from "@simplifica-if/kb/cli/comum";
import { avaliarBuscaCmd, avaliarResolvedorCmd, relacoes } from "@simplifica-if/kb/cli/curadoria";
import * as Layers from "@simplifica-if/kb/layers";
import { executarPrincipal } from "@simplifica-if/kb/principal";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Command from "effect/cli/Command";
import { comandosDeConsulta } from "./consulta.ts";
import * as Leitura from "./leitura/Leitura.ts";
import * as PastaTrabalho from "./leitura/PastaTrabalho.ts";

const raiz = raizRepositorio();

/** O `Leitura` sobre o banco do checkout, com o diretório atual como pasta de trabalho. */
const leitura = Leitura.layer({ canal: "dev" }).pipe(
  Layer.provide(PastaTrabalho.layer({ pasta: process.cwd() })),
  Layer.provide(Layers.layerRepositorio({ raiz })),
);

const kb = Command.make("kb").pipe(
  Command.withDescription(
    "A base de conhecimento do IFPR no checkout: as consultas das ferramentas do servidor MCP ifpr e a curadoria.",
  ),
  Command.withSubcommands([...comandosDeConsulta(leitura), compilar, relacoes, avaliarResolvedorCmd, avaliarBuscaCmd]),
);

executarPrincipal(
  "kb",
  Command.run(kb, { version: "0.1.0" }).pipe(Effect.provideService(Checkout, Checkout.of({ raiz }))),
);
