/** Relatório de uma rodada do harness: JSON completo e resumo Markdown. */
import { z } from "zod";
import type { Pergunta } from "./esquema.ts";
import type { Pontuacao } from "./pontuacao.ts";
import type { Execucao } from "./stream.ts";

export interface RegistroExecucao {
  pergunta: string;
  execucao: number;
  execucao_agente: Execucao;
  pontuacao: Pontuacao;
  /** Caminho, relativo ao relatório, do stream-json bruto (quando gravado). */
  bruto?: string | undefined;
}

export interface Relatorio {
  versao: 1;
  iniciado_em: string;
  concluido_em: string;
  modelo_solicitado: string;
  config: Record<string, unknown>;
  commit: string | null;
  perguntas: Array<{ id: string; categoria: string; tipo: string; status_gabarito: string }>;
  execucoes: RegistroExecucao[];
}

/** Validação mínima de um relatório salvo, usada por `--pontuar`. */
export const esquemaRelatorioSalvo = z.looseObject({
  versao: z.literal(1),
  modelo_solicitado: z.string(),
  execucoes: z.array(
    z.looseObject({
      pergunta: z.string(),
      execucao: z.number().int(),
      execucao_agente: z.looseObject({ resposta: z.string() }),
    }),
  ),
});

function media(valores: readonly number[]): number | null {
  if (valores.length === 0) return null;
  return valores.reduce((soma, valor) => soma + valor, 0) / valores.length;
}

function fmt(valor: number | null, casas = 2): string {
  return valor === null ? "—" : valor.toFixed(casas);
}

function fmtInteiro(valor: number | null): string {
  return valor === null ? "—" : Math.round(valor).toLocaleString("pt-BR");
}

export interface LinhaResumo {
  id: string;
  status: string;
  execucoes: number;
  nota: number | null;
  cobertura: number | null;
  recall: number | null;
  precisao: number | null;
  proibidos: number;
  ferramentas: number | null;
  tokens: number | null;
  custo: number | null;
  erros: number;
}

export function resumir(relatorio: Relatorio): LinhaResumo[] {
  return relatorio.perguntas.map((pergunta) => {
    const registros = relatorio.execucoes.filter((registro) => registro.pergunta === pergunta.id);
    const valores = (f: (registro: RegistroExecucao) => number | null | undefined) =>
      registros.map(f).filter((valor): valor is number => typeof valor === "number");
    return {
      id: pergunta.id,
      status: pergunta.status_gabarito,
      execucoes: registros.length,
      nota: media(valores((r) => r.pontuacao.nota)),
      cobertura: media(valores((r) => r.pontuacao.deve_conter.cobertura)),
      recall: media(valores((r) => r.pontuacao.conjunto?.recall)),
      precisao: media(valores((r) => r.pontuacao.conjunto?.precisao)),
      proibidos: registros.reduce((soma, r) => soma + r.pontuacao.nao_deve_conter.encontrados.length, 0),
      ferramentas: media(valores((r) => r.execucao_agente.chamadas_ferramenta)),
      tokens: media(valores((r) => r.execucao_agente.tokens.total)),
      custo: media(valores((r) => r.execucao_agente.custo_usd)),
      erros: registros.filter((r) => r.execucao_agente.erro).length,
    };
  });
}

export function resumoMarkdown(relatorio: Relatorio, perguntas: readonly Pergunta[]): string {
  const linhas = resumir(relatorio);
  const textoPorId = new Map(perguntas.map((pergunta) => [pergunta.id, pergunta.texto]));
  const modelos = [...new Set(relatorio.execucoes.map((r) => r.execucao_agente.modelo).filter(Boolean))];
  const custoTotal = relatorio.execucoes.reduce((soma, r) => soma + (r.execucao_agente.custo_usd ?? 0), 0);
  const notas = linhas.map((linha) => linha.nota).filter((nota): nota is number => nota !== null);
  const curadas = linhas
    .filter((linha) => linha.status === "curado" && linha.nota !== null)
    .map((l) => l.nota as number);
  const saida = [
    `# Avaliação da base — ${relatorio.iniciado_em}`,
    "",
    `- Modelo solicitado: \`${relatorio.modelo_solicitado}\`; efetivo: ${modelos.map((m) => `\`${m}\``).join(", ") || "—"}`,
    `- Commit: ${relatorio.commit ?? "—"}`,
    `- Execuções: ${relatorio.execucoes.length} (${linhas.length} perguntas)`,
    `- Nota média: ${fmt(media(notas))} (gabaritos curados: ${fmt(media(curadas))})`,
    `- Custo total: US$ ${custoTotal.toFixed(2)}`,
    "",
    "| Pergunta | Gabarito | Exec. | Nota | deve_conter | Recall | Precisão | Proibidos | Ferramentas | Tokens | Custo (US$) | Erros |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...linhas.map(
      (l) =>
        `| ${l.id} | ${l.status} | ${l.execucoes} | ${fmt(l.nota)} | ${fmt(l.cobertura)} | ${fmt(l.recall)} | ${fmt(l.precisao)} | ${l.proibidos} | ${fmt(l.ferramentas, 1)} | ${fmtInteiro(l.tokens)} | ${fmt(l.custo, 3)} | ${l.erros} |`,
    ),
    "",
    "## Detalhe por execução",
    "",
  ];
  for (const registro of relatorio.execucoes) {
    const { pontuacao: p, execucao_agente: e } = registro;
    saida.push(`### ${registro.pergunta} #${registro.execucao}`, "");
    saida.push(`> ${textoPorId.get(registro.pergunta) ?? ""}`, "");
    saida.push(
      `- Nota ${fmt(p.nota)}; desfecho \`${e.desfecho}\`; ${e.chamadas_ferramenta} chamadas de ferramenta (${e.chamadas_negadas ?? 0} negadas); ${fmtInteiro(e.tokens.total)} tokens`,
    );
    if (p.deve_conter.ausentes.length > 0) saida.push(`- Ausentes: ${p.deve_conter.ausentes.join(", ")}`);
    if (p.nao_deve_conter.encontrados.length > 0)
      saida.push(`- Proibidos: ${p.nao_deve_conter.encontrados.join(", ")}`);
    if (p.conjunto) {
      saida.push(
        `- Conjunto: recall ${fmt(p.conjunto.recall)}, precisão ${fmt(p.conjunto.precisao)}; faltantes ${p.conjunto.faltantes.length}, falsos positivos ${p.conjunto.falsos_positivos.length}`,
      );
    }
    saida.push("");
  }
  return `${saida.join("\n")}\n`;
}
