/**
 * Harness de avaliação da base (fase 1 do PLANO-ARQUITETURA.md): roda as perguntas de
 * `avaliacao/perguntas.yaml` num agente real (`claude -p`), pontua de forma determinística e grava
 * o relatório datado em `avaliacao/resultados/`.
 *
 *   node scripts/avaliar.ts --dry-run                      # mostra o que rodaria, sem custo
 *   node scripts/avaliar.ts --pergunta Q09 --execucoes 1   # roda só uma pergunta
 *   node scripts/avaliar.ts --modelo haiku                 # sobrescreve o modelo do config
 *   node scripts/avaliar.ts --pontuar avaliacao/resultados/<rodada>/relatorio.json
 *
 * Modelo, execuções por pergunta, limite de turnos e ferramentas vêm de `avaliacao/config.yaml`.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  carregarConfig,
  carregarGabaritoConjunto,
  carregarPerguntas,
  carregarUniversos,
  DIR_AVALIACAO,
  RAIZ_REPOSITORIO,
} from "./avaliacao/carregar.ts";
import type { GabaritoConjunto, Pergunta, Universos } from "./avaliacao/esquema.ts";
import { argumentosClaude, comandoLegivel, executarPergunta } from "./avaliacao/executor.ts";
import { serializarJson } from "./avaliacao/normalizar.ts";
import { pontuarResposta } from "./avaliacao/pontuacao.ts";
import { esquemaRelatorioSalvo, resumoMarkdown, type RegistroExecucao, type Relatorio } from "./avaliacao/relatorio.ts";
import type { Execucao } from "./avaliacao/stream.ts";

const AJUDA = `Uso: node scripts/avaliar.ts [opções]

  --pergunta <ids>     Só estas perguntas (Q01,Q09 ou a opção repetida)
  --execucoes <n>      Execuções por pergunta (padrão: config.yaml)
  --modelo <modelo>    Modelo do claude -p (padrão: config.yaml)
  --dry-run            Mostra perguntas, gabaritos e comandos, sem chamar o modelo
  --pontuar <arquivo>  Repontua um relatorio.json salvo, sem chamar o modelo
  --saida <dir>        Diretório da rodada (padrão: avaliacao/resultados/<data>-<modelo>)
  --config <arquivo>   Configuração alternativa (padrão: avaliacao/config.yaml)
  -h, --help           Esta ajuda`;

interface Contexto {
  perguntas: Pergunta[];
  conjuntos: Map<string, GabaritoConjunto>;
  universos: Universos;
}

function carregarContexto(filtro: readonly string[]): Contexto {
  const todas = carregarPerguntas().perguntas;
  const desconhecidas = filtro.filter((id) => !todas.some((pergunta) => pergunta.id === id));
  if (desconhecidas.length > 0) throw new Error(`Perguntas inexistentes: ${desconhecidas.join(", ")}`);
  const perguntas = filtro.length === 0 ? todas : todas.filter((pergunta) => filtro.includes(pergunta.id));
  const conjuntos = new Map<string, GabaritoConjunto>();
  for (const pergunta of perguntas) {
    if (pergunta.gabarito.conjunto) {
      conjuntos.set(pergunta.id, carregarGabaritoConjunto(pergunta.gabarito.conjunto.arquivo));
    }
  }
  return { perguntas, conjuntos, universos: carregarUniversos() };
}

function pontuar(contexto: Contexto, pergunta: Pergunta, resposta: string) {
  return pontuarResposta(pergunta, resposta, {
    conjunto: contexto.conjuntos.get(pergunta.id),
    universos: contexto.universos,
  });
}

function commitAtual(): string | null {
  const rev = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: RAIZ_REPOSITORIO, encoding: "utf-8" });
  if (rev.status !== 0) return null;
  const sujo = spawnSync("git", ["status", "--porcelain"], { cwd: RAIZ_REPOSITORIO, encoding: "utf-8" }).stdout.trim();
  return `${rev.stdout.trim()}${sujo ? " (com alterações locais)" : ""}`;
}

function carimbo(data: Date): string {
  return data
    .toISOString()
    .replace(/\.\d{3}Z$/u, "Z")
    .replace(/:/gu, "-");
}

function gravarRelatorio(dir: string, relatorio: Relatorio, perguntas: readonly Pergunta[], sufixo = ""): void {
  writeFileSync(path.join(dir, `relatorio${sufixo}.json`), serializarJson(relatorio));
  writeFileSync(path.join(dir, `resumo${sufixo}.md`), resumoMarkdown(relatorio, perguntas));
}

function listarPerguntas(id: string): string[] {
  return id
    .split(",")
    .map((parte) => parte.trim().toUpperCase())
    .filter(Boolean);
}

/* ------------------------------------------------------------------ modos */

function modoDryRun(contexto: Contexto, execucoes: number, modelo: string, configCaminho: string | undefined): void {
  const config = carregarConfig(configCaminho);
  console.log(`Modelo: ${modelo} · execuções por pergunta: ${execucoes} · max_turns: ${config.max_turns}`);
  console.log(`Total: ${contexto.perguntas.length * execucoes} chamadas de claude -p (cwd ${RAIZ_REPOSITORIO})\n`);
  for (const pergunta of contexto.perguntas) {
    const { gabarito } = pergunta;
    const conjunto = contexto.conjuntos.get(pergunta.id);
    const partes = [
      `${gabarito.deve_conter.length} deve_conter`,
      `${gabarito.nao_deve_conter.length} nao_deve_conter`,
      conjunto ? `conjunto ${conjunto.universo} com ${conjunto.esperado.length} itens` : null,
    ].filter(Boolean);
    console.log(
      `${pergunta.id} [${pergunta.categoria}, ${pergunta.tipo}, gabarito ${gabarito.status}] ${partes.join(", ")}`,
    );
    console.log(`  ${pergunta.texto}`);
  }
  const exemplo = contexto.perguntas[0];
  if (exemplo) {
    console.log(`\nComando (${exemplo.id}):`);
    console.log(comandoLegivel("claude", argumentosClaude(exemplo.texto, { config, modelo })));
  }
}

function modoPontuar(contexto: Contexto, arquivo: string, filtro: readonly string[]): void {
  const caminho = path.resolve(arquivo);
  const salvo = esquemaRelatorioSalvo.parse(JSON.parse(readFileSync(caminho, "utf-8")));
  const original = salvo as unknown as Relatorio;
  const porId = new Map(contexto.perguntas.map((pergunta) => [pergunta.id, pergunta]));
  const execucoes: RegistroExecucao[] = [];
  for (const registro of original.execucoes) {
    const pergunta = porId.get(registro.pergunta);
    if (!pergunta || (filtro.length > 0 && !filtro.includes(pergunta.id))) continue;
    execucoes.push({ ...registro, pontuacao: pontuar(contexto, pergunta, registro.execucao_agente.resposta) });
  }
  const ids = new Set(execucoes.map((registro) => registro.pergunta));
  const relatorio: Relatorio = {
    ...original,
    perguntas: contexto.perguntas
      .filter((pergunta) => ids.has(pergunta.id))
      .map((pergunta) => ({
        id: pergunta.id,
        categoria: pergunta.categoria,
        tipo: pergunta.tipo,
        status_gabarito: pergunta.gabarito.status,
      })),
    execucoes,
  };
  gravarRelatorio(path.dirname(caminho), relatorio, contexto.perguntas, "-repontuado");
  console.log(
    `${execucoes.length} execuções repontuadas em ${path.relative(RAIZ_REPOSITORIO, path.dirname(caminho))}/`,
  );
  console.log(resumoMarkdown(relatorio, contexto.perguntas).split("\n## Detalhe")[0]);
}

async function modoExecutar(
  contexto: Contexto,
  execucoes: number,
  modelo: string,
  saida: string | undefined,
  configCaminho: string | undefined,
): Promise<void> {
  const config = carregarConfig(configCaminho);
  const inicio = new Date();
  const dir = path.resolve(
    saida ?? path.join(DIR_AVALIACAO, "resultados", `${carimbo(inicio)}-${modelo.replace(/[^\w.-]+/gu, "_")}`),
  );
  mkdirSync(path.join(dir, "brutos"), { recursive: true });
  const relatorio: Relatorio = {
    versao: 1,
    iniciado_em: inicio.toISOString(),
    concluido_em: inicio.toISOString(),
    modelo_solicitado: modelo,
    config: { ...config, modelo, execucoes },
    commit: commitAtual(),
    perguntas: contexto.perguntas.map((pergunta) => ({
      id: pergunta.id,
      categoria: pergunta.categoria,
      tipo: pergunta.tipo,
      status_gabarito: pergunta.gabarito.status,
    })),
    execucoes: [],
  };
  for (const pergunta of contexto.perguntas) {
    for (let n = 1; n <= execucoes; n++) {
      process.stdout.write(`${pergunta.id} #${n} … `);
      const bruta = await executarPergunta(pergunta.texto, RAIZ_REPOSITORIO, { config, modelo });
      const arquivoBruto = path.join("brutos", `${pergunta.id}-${n}.jsonl`);
      writeFileSync(path.join(dir, arquivoBruto), bruta.saida);
      if (bruta.stderr.trim()) writeFileSync(path.join(dir, "brutos", `${pergunta.id}-${n}.stderr.txt`), bruta.stderr);
      const execucao: Execucao = bruta.execucao;
      const pontuacao = pontuar(contexto, pergunta, execucao.resposta);
      relatorio.execucoes.push({
        pergunta: pergunta.id,
        execucao: n,
        execucao_agente: execucao,
        pontuacao,
        bruto: arquivoBruto,
      });
      relatorio.concluido_em = new Date().toISOString();
      gravarRelatorio(dir, relatorio, contexto.perguntas);
      console.log(
        `nota ${pontuacao.nota.toFixed(2)} · ${execucao.desfecho} · ${execucao.chamadas_ferramenta} ferramentas · ${execucao.tokens.total} tokens · US$ ${(execucao.custo_usd ?? 0).toFixed(3)}`,
      );
    }
  }
  console.log(`\nRelatório: ${path.relative(RAIZ_REPOSITORIO, dir)}/resumo.md`);
}

/* ------------------------------------------------------------------- main */

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      pergunta: { type: "string", multiple: true },
      execucoes: { type: "string" },
      modelo: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      pontuar: { type: "string" },
      saida: { type: "string" },
      config: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(AJUDA);
    return 0;
  }
  const filtro = (values.pergunta ?? []).flatMap(listarPerguntas);
  const contexto = carregarContexto(filtro);
  if (values.pontuar) {
    modoPontuar(contexto, values.pontuar, filtro);
    return 0;
  }
  const config = carregarConfig(values.config);
  const execucoes = values.execucoes === undefined ? config.execucoes : Number.parseInt(values.execucoes, 10);
  if (!Number.isInteger(execucoes) || execucoes < 1) throw new Error(`--execucoes inválido: ${values.execucoes}`);
  const modelo = values.modelo ?? config.modelo;
  if (values["dry-run"]) {
    modoDryRun(contexto, execucoes, modelo, values.config);
    return 0;
  }
  await modoExecutar(contexto, execucoes, modelo, values.saida, values.config);
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (erro) {
    console.error((erro as Error).message);
    process.exit(1);
  }
}
