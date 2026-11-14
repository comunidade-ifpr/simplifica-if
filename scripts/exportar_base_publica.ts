#!/usr/bin/env node
/**
 * Exporta os JSONs públicos de campi e processos seletivos. A fonte é `dados/institucional/`; só as
 * movimentações de cursos (processos SEI publicados em cada curso) ainda vêm do Notion.
 */
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import { carregarDataSources, RAIZ_BASE } from "./config.ts";
import { carregarDadosInstitucionais, paraDominio } from "./dados/institucional.ts";
import { dataLocalIso } from "./datas.ts";
import { auditarBase, type BaseInstitucional } from "./dominio/auditoria.ts";
import { montarCampi, montarIndiceCampi, montarIndiceProcessos, montarProcessos } from "./exportacao/base-publica.ts";
import * as Notion from "./notion/cliente.ts";
import { carregarMovimentacoes } from "./notion/movimentacoes.ts";
import { executarPrincipal, sairCom } from "./principal.ts";

/** JSON com recuo de 2 e quebra de linha final, como os arquivos publicados sempre foram. */
const textoJson = (dados: unknown) => `${JSON.stringify(dados, null, 2)}\n`;

const gravarJson = Effect.fn("exportar.gravarJson")(function* (caminho: string, dados: unknown, dryRun: boolean) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const texto = textoJson(dados);
  const relativo = path.relative(RAIZ_BASE, caminho);
  if (dryRun) {
    yield* Console.log(`planejado: ${relativo} (${texto.length} bytes)`);
    return;
  }
  yield* fs.makeDirectory(path.dirname(caminho), { recursive: true });
  yield* fs.writeFileString(caminho, texto);
  yield* Console.log(`exportado: ${relativo}`);
});

const somar = <T>(itens: T[], tamanho: (item: T) => number) => itens.reduce((total, item) => total + tamanho(item), 0);

export const comando = Command.make(
  "exportar_base_publica",
  {
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription("lista o que seria gravado, sem escrever arquivos"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn("exportar_base_publica")(function* ({ dryRun }) {
    const path = yield* Path.Path;
    const raizIfpr = path.join(RAIZ_BASE, "institucional", "ifpr");
    const raizCampi = path.join(raizIfpr, "campi");
    const raizProcessos = path.join(raizIfpr, "processos-seletivos");

    const { dados, erros: errosDados } = yield* Effect.sync(() => carregarDadosInstitucionais());
    if (errosDados.length) {
      yield* Console.log("\ndados/institucional/ tem registros inválidos:");
      for (const erro of errosDados) yield* Console.log(`- ${erro}`);
      return yield* sairCom(1);
    }
    const local = paraDominio(dados);
    // Cada movimentação aponta para o curso pela chave canônica em `Curso ID`.
    const fontes = yield* Effect.sync(() => carregarDataSources());
    const movimentacoes = yield* carregarMovimentacoes(fontes).pipe(Effect.provide(Notion.layer));
    const base: BaseInstitucional = { ...local, movimentacoes };
    const contagem = {
      campi: base.campi.length,
      cursos: base.cursos.length,
      processos_seletivos: base.processos.length,
      editais_ingresso: base.editais.length,
      ofertas_ingresso: base.ofertas.length,
      movimentacoes_cursos_notion: movimentacoes.length,
    };
    yield* Console.log(`\nRegistros lidos:\n${textoJson(contagem).trimEnd()}`);

    const erros = auditarBase(base);
    if (erros.length) {
      yield* Console.log("\nAuditoria encontrou problemas que impedem exportação confiável:");
      for (const erro of erros) yield* Console.log(`- ${erro}`);
      yield* Console.log(`\nErro: Auditoria falhou com ${erros.length} problema(s).`);
      return yield* sairCom(1);
    }

    const hoje = dataLocalIso(DateTime.toDateUtc(yield* DateTime.now));
    const campi = montarCampi(base);
    const processos = montarProcessos(base, hoje);

    for (const campus of campi) yield* gravarJson(path.join(raizCampi, `${campus.id}.json`), campus, dryRun);
    yield* gravarJson(path.join(raizCampi, "index.json"), montarIndiceCampi(campi, hoje), dryRun);
    for (const processo of processos) {
      yield* gravarJson(path.join(raizProcessos, `${processo.id}.json`), processo, dryRun);
    }
    yield* gravarJson(path.join(raizProcessos, "index.json"), montarIndiceProcessos(processos), dryRun);

    const resumo = {
      lidos: contagem,
      campi: campi.length,
      cursos: somar(campi, (campus) => campus.cursos.length),
      processos_seletivos: processos.length,
      editais: somar(processos, (processo) => processo.editais.length),
      ofertas: somar(processos, (processo) => processo.ofertas.length),
    };
    yield* Console.log(`\nResumo:\n${textoJson(resumo).trimEnd()}`);
  }),
).pipe(Command.withDescription("Exporta dados/institucional/ e as movimentações do Notion para os JSONs públicos."));

if (import.meta.main) {
  executarPrincipal("exportar_base_publica", Command.run(comando, { version: "1.0.0" }));
}
