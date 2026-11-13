#!/usr/bin/env bun
/**
 * Ponto de entrada único da skill analise-ppc.
 *
 * `validar-base`, `gerar-indice` e `gerar-mapa` rodam em TypeScript. Os demais
 * subcomandos ainda delegam a `analise_ppc.py` (mesmos argumentos, stdio
 * herdado e mesmo código de saída) até serem portados.
 */
import path from "node:path";
import { Command } from "commander";
import { caminhosPadrao } from "./caminhos.ts";
import { escreverIndice, indiceAtualizado } from "./indice-base.ts";
import { escreverMapa, mapaAtualizado } from "./mapa-fichas.ts";
import { validarBaseAnalise } from "./validacao-base.ts";

const COMANDO = "bun run .agents/skills/analise-ppc/scripts/analise_ppc.ts";
const SCRIPT_PYTHON = path.join(import.meta.dir, "analise_ppc.py");

/** Subcomandos ainda implementados em Python, com a descrição exibida na ajuda. */
export const SUBCOMANDOS_PYTHON: ReadonlyArray<readonly [nome: string, descricao: string]> = [
  ["preparar-documento", "Criar a rodada e o PPC.md canônico"],
  ["montar-grupos-subagents", "Listar grupos de fichas para sub-agentes e salvar grupos-subagents.json"],
  ["preparar-prompts-subagents", "Gerar pacotes Markdown autocontidos para cada grupo de sub-agente"],
  ["montar-grupo-avulso", "Montar um grupo avulso de fichas para reavaliação por sub-agente"],
  ["mesclar-resultados-avulsos", "Mesclar respostas avulsas em resultados-subagents.json"],
  ["gerar-relatorio-html", "Gerar o relatório HTML final"],
  ["validar-resultados", "Validar cobertura e contrato do JSON de resultados sem gerar HTML"],
];

/** Repassa o subcomando a `python3 -B analise_ppc.py` e devolve o código de saída. */
async function delegarAoPython(subcomando: string, argumentos: string[]): Promise<number> {
  const processo = Bun.spawn(["python3", "-B", SCRIPT_PYTHON, subcomando, ...argumentos], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return await processo.exited;
}

function validarBase(): number {
  const erros = validarBaseAnalise();
  if (erros.length) {
    for (const erro of erros) console.log(erro);
    return 1;
  }
  console.log("Base de análise válida.");
  return 0;
}

function gerarIndice(opcoes: { check?: boolean }): number {
  const caminhos = caminhosPadrao();
  if (opcoes.check) {
    if (indiceAtualizado(caminhos)) {
      console.log(`OK: ${caminhos.indicePath}`);
      return 0;
    }
    console.log(`ERRO: ${caminhos.indicePath} está desatualizado. Rode ${COMANDO} gerar-indice.`);
    return 1;
  }
  const indice = escreverIndice(caminhos);
  const resumo = indice.resumo as { total_fichas: number; total_itens: number };
  console.log(`Índice gerado em ${caminhos.indicePath} (${resumo.total_fichas} fichas, ${resumo.total_itens} itens).`);
  return 0;
}

function gerarMapa(opcoes: { check?: boolean }): number {
  const caminhos = caminhosPadrao();
  if (opcoes.check) {
    if (mapaAtualizado(caminhos)) {
      console.log(`OK: ${caminhos.mapaFichasPath}`);
      return 0;
    }
    console.log(`ERRO: ${caminhos.mapaFichasPath} está desatualizado. Rode ${COMANDO} gerar-mapa.`);
    return 1;
  }
  escreverMapa(caminhos);
  console.log(`Mapa de fichas gerado em ${caminhos.mapaFichasPath}.`);
  return 0;
}

export function criarPrograma(): Command {
  const programa = new Command()
    .name("analise_ppc.ts")
    .description("Análise de PPC por sub-agentes na conversa")
    .enablePositionalOptions();

  programa
    .command("validar-base")
    .description("Validar fichas, tópicos, marcos normativos, validações cruzadas e contratos da base de análise")
    .action(() => {
      process.exitCode = validarBase();
    });

  programa
    .command("gerar-indice")
    .description("Gerar base-analise/indice.json")
    .option("--check", "verificar se indice.json está atualizado sem reescrever")
    .action((opcoes: { check?: boolean }) => {
      process.exitCode = gerarIndice(opcoes);
    });

  programa
    .command("gerar-mapa")
    .description("Gerar base-analise/mapa-fichas.md")
    .option("--check", "verificar se mapa-fichas.md está atualizado sem reescrever")
    .action((opcoes: { check?: boolean }) => {
      process.exitCode = gerarMapa(opcoes);
    });

  for (const [nome, descricao] of SUBCOMANDOS_PYTHON) {
    programa
      .command(nome)
      .description(`${descricao} (delega a analise_ppc.py)`)
      .helpOption(false)
      .allowUnknownOption()
      .allowExcessArguments()
      .passThroughOptions()
      .argument("[argumentos...]", "repassados a analise_ppc.py; use --help para ver as opções")
      .action(async (argumentos: string[]) => {
        process.exitCode = await delegarAoPython(nome, argumentos);
      });
  }
  return programa;
}

if (import.meta.main) {
  await criarPrograma().parseAsync(process.argv);
}
