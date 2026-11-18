#!/usr/bin/env node
/**
 * Exporta os processos SEI dos cursos (`institucional/ifpr/processos-sei/index.json`) a partir da
 * base `Movimentações de Cursos` do Notion. Os demais dados institucionais não passam por aqui: os
 * registros de `base-conhecimento/institucional/ifpr/` são a fonte e são publicados como estão.
 */
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import { carregarDataSources, RAIZ_PROJETO } from "./config.ts";
import { carregarDadosInstitucionais, paraDominio } from "./dados/institucional.ts";
import {
  ARQUIVO_PROCESSOS_SEI,
  montarProcessosSei,
  processosSeiDasMovimentacoes,
  textoProcessosSei,
} from "./dados/processos-sei.ts";
import { auditarBase, type BaseInstitucional } from "./dominio/auditoria.ts";
import * as Notion from "./notion/cliente.ts";
import { carregarMovimentacoes } from "./notion/movimentacoes.ts";
import { sairCom } from "@simplifica-if/kb/principal";
import { executarPrincipal } from "./principal.ts";

export const comando = Command.make(
  "exportar_base_publica",
  {
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription("mostra o que seria gravado, sem escrever o arquivo"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn("exportar_base_publica")(function* ({ dryRun }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const { dados, erros: errosDados } = yield* Effect.sync(() => carregarDadosInstitucionais());
    if (errosDados.length) {
      yield* Console.log("\ninstitucional/ifpr/ tem registros inválidos:");
      for (const erro of errosDados) yield* Console.log(`- ${erro}`);
      return yield* sairCom(1);
    }
    // Cada movimentação aponta para o curso pela chave canônica em `Curso ID`.
    const fontes = yield* Effect.sync(() => carregarDataSources());
    const movimentacoes = yield* carregarMovimentacoes(fontes).pipe(Effect.provide(Notion.layer));
    const base: BaseInstitucional = { ...paraDominio(dados), movimentacoes };

    const erros = auditarBase(base);
    if (erros.length) {
      yield* Console.log("\nAuditoria encontrou problemas que impedem exportação confiável:");
      for (const erro of erros) yield* Console.log(`- ${erro}`);
      yield* Console.log(`\nErro: Auditoria falhou com ${erros.length} problema(s).`);
      return yield* sairCom(1);
    }

    const arquivo = montarProcessosSei(processosSeiDasMovimentacoes(movimentacoes));
    const texto = textoProcessosSei(arquivo);
    const relativo = path.relative(RAIZ_PROJETO, ARQUIVO_PROCESSOS_SEI);
    const resumo = `${movimentacoes.length} movimentações lidas, ${arquivo.total_itens} processos SEI de curso`;
    if (dryRun) {
      yield* Console.log(`planejado: ${relativo} (${texto.length} bytes); ${resumo}`);
      return;
    }
    yield* fs.makeDirectory(path.dirname(ARQUIVO_PROCESSOS_SEI), { recursive: true });
    yield* fs.writeFileString(ARQUIVO_PROCESSOS_SEI, texto);
    yield* Console.log(`exportado: ${relativo}; ${resumo}`);
  }),
).pipe(
  Command.withDescription(
    "Exporta os processos SEI dos cursos, da base Movimentações de Cursos do Notion, para institucional/ifpr/processos-sei/.",
  ),
);

if (import.meta.main) {
  executarPrincipal("exportar_base_publica", Command.run(comando, { version: "1.0.0" }));
}
