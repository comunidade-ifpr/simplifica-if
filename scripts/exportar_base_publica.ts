#!/usr/bin/env node
/**
 * Exporta os JSONs públicos de campi e processos seletivos. A fonte é `dados/institucional/`; só as
 * movimentações de cursos (processos SEI publicados em cada curso) ainda vêm do Notion.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { lerArgumentos } from "./cli.ts";
import { carregarDataSources, RAIZ_BASE } from "./config.ts";
import { carregarDadosInstitucionais, paraDominio } from "./dados/institucional.ts";
import { auditarBase, type BaseInstitucional } from "./dominio/auditoria.ts";
import { montarCampi, montarIndiceCampi, montarIndiceProcessos, montarProcessos } from "./exportacao/base-publica.ts";
import { dataLocalIso } from "./datas.ts";
import { ClienteNotion } from "./notion/cliente.ts";
import { carregarMovimentacoes } from "./notion/movimentacoes.ts";

const USO = `uso: node scripts/exportar_base_publica.ts [--dry-run]

Exporta dados/institucional/ e as movimentações do Notion para os JSONs públicos.

  --dry-run   lista o que seria gravado, sem escrever arquivos
  -h, --help  mostra esta ajuda`;

const RAIZ_IFPR = path.join(RAIZ_BASE, "institucional", "ifpr");
const RAIZ_CAMPI = path.join(RAIZ_IFPR, "campi");
const RAIZ_PROCESSOS = path.join(RAIZ_IFPR, "processos-seletivos");

function gravarJson(caminho: string, dados: unknown, dryRun: boolean) {
  const texto = `${JSON.stringify(dados, null, 2)}\n`;
  const relativo = path.relative(RAIZ_BASE, caminho);
  if (dryRun) {
    console.log(`planejado: ${relativo} (${texto.length} bytes)`);
    return;
  }
  mkdirSync(path.dirname(caminho), { recursive: true });
  writeFileSync(caminho, texto, "utf-8");
  console.log(`exportado: ${relativo}`);
}

async function main(): Promise<number> {
  const args = lerArgumentos(process.argv.slice(2), { "dry-run": { type: "boolean" } }, { uso: USO });
  if ("codigo" in args) return args.codigo;
  const dryRun = args.values["dry-run"] ?? false;

  const { dados, erros: errosDados } = carregarDadosInstitucionais();
  if (errosDados.length) {
    console.log("\ndados/institucional/ tem registros inválidos:");
    for (const erro of errosDados) console.log(`- ${erro}`);
    return 1;
  }
  const local = paraDominio(dados);
  // Cada movimentação aponta para o curso pela chave canônica em `Curso ID`.
  const movimentacoes = await carregarMovimentacoes(ClienteNotion.doAmbiente(), carregarDataSources());
  const base: BaseInstitucional = { ...local, movimentacoes };
  const contagem = {
    campi: base.campi.length,
    cursos: base.cursos.length,
    processos_seletivos: base.processos.length,
    editais_ingresso: base.editais.length,
    ofertas_ingresso: base.ofertas.length,
    movimentacoes_cursos_notion: movimentacoes.length,
  };
  console.log(`\nRegistros lidos:\n${JSON.stringify(contagem, null, 2)}`);

  const erros = auditarBase(base);
  if (erros.length) {
    console.log("\nAuditoria encontrou problemas que impedem exportação confiável:");
    for (const erro of erros) console.log(`- ${erro}`);
    console.log(`\nErro: Auditoria falhou com ${erros.length} problema(s).`);
    return 1;
  }

  const hoje = dataLocalIso();
  const campi = montarCampi(base);
  const processos = montarProcessos(base, hoje);

  for (const campus of campi) gravarJson(path.join(RAIZ_CAMPI, `${campus.id}.json`), campus, dryRun);
  gravarJson(path.join(RAIZ_CAMPI, "index.json"), montarIndiceCampi(campi, hoje), dryRun);
  for (const processo of processos) gravarJson(path.join(RAIZ_PROCESSOS, `${processo.id}.json`), processo, dryRun);
  gravarJson(path.join(RAIZ_PROCESSOS, "index.json"), montarIndiceProcessos(processos), dryRun);

  const somar = <T>(itens: T[], tamanho: (item: T) => number) =>
    itens.reduce((total, item) => total + tamanho(item), 0);
  const resumo = {
    lidos: contagem,
    campi: campi.length,
    cursos: somar(campi, (campus) => campus.cursos.length),
    processos_seletivos: processos.length,
    editais: somar(processos, (processo) => processo.editais.length),
    ofertas: somar(processos, (processo) => processo.ofertas.length),
  };
  console.log(`\nResumo:\n${JSON.stringify(resumo, null, 2)}`);
  return 0;
}

process.exitCode = await main();
