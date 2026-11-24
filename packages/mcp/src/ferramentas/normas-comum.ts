/**
 * Peças comuns das ferramentas de normas (especificação M0.1, "Tipos comuns"): os schemas de entrada
 * de data e de ID e o texto para a IA (o literal de um dispositivo, a situação de uma norma e o corte
 * no teto de caracteres de cada ferramenta). A conversão do kb para `DispositivoTexto` e os avisos das
 * normas ficam no serviço `Leitura`. Nenhuma regra normativa: só formato.
 */
import type { DispositivoTexto, NormaResumo, Resposta } from "../contratos.ts";
import { texto } from "../esquema.ts";
import { citacao, montarTexto } from "../texto.ts";

/* ================================================================== schemas */

/** AAAA-MM-DD, como as datas da base. */
export const esquemaData = (descricao: string) =>
  texto({ padrao: { regex: /^\d{4}-\d{2}-\d{2}$/u, mensagem: "use AAAA-MM-DD" } }, descricao);

/** ID canônico de norma com dispositivo: `br/cne-cp/res/2026/2#art28-vii`. */
export const esquemaIdDispositivo = texto({
  padrao: {
    regex: /^[a-z0-9][a-z0-9/:~.-]*#[A-Za-z0-9-]+$/u,
    mensagem: 'use o ID canônico com dispositivo, como "br/lei/1996/9394#art36"',
  },
});

/** ID canônico de norma, com ou sem dispositivo: `br/cne-cp/res/2021/1`, `br/cne-cp/res/2021/1#art20`. */
export const esquemaIdNorma = (descricao: string) =>
  texto(
    {
      padrao: {
        regex: /^[a-z0-9][a-z0-9/:~.-]*(?:#[A-Za-z0-9-]+)?$/u,
        mensagem:
          'use o ID canônico da norma, como "br/cne-cp/res/2021/1" (sem espaços; para uma citação em texto, use resolver_citacoes)',
      },
    },
    descricao,
  );

/* ============================================================ texto e teto */

/** Texto literal de um dispositivo: caput herdado, o próprio texto e os subordinados. */
export function literalDoDispositivo(d: DispositivoTexto): string {
  return [...d.caput, d.texto, ...d.subordinados.map((s) => s.texto)].join("\n");
}

/** Linha curta da situação de uma norma: o status publicado. */
export function situacaoDaNorma(n: NormaResumo): string {
  if (n.situacao !== "base") return n.situacao === "stub" ? "sem texto na base (stub)" : "referência externa";
  return n.status_vigencia ?? "vigência não registrada";
}

export interface BlocoComLiteral {
  /** Título e detalhe do item. */
  cabecalho: string;
  /** Texto literal, sem a citação Markdown; cortado com "…" se o corpo passar do teto. */
  literal?: string;
  /** Linhas depois do literal (fonte, notas). */
  rodape?: string;
  /** Linha acrescentada quando o literal é cortado. */
  seCortado?: string;
}

const MINIMO_LITERAL = 40;

/**
 * Junta os blocos e, se o corpo passar de `teto` caracteres, corta os literais mais longos, cada
 * um com "…" e a linha `seCortado`. Os cabeçalhos e as fontes ficam inteiros; a divisão do espaço é
 * igual entre os literais (os curtos ficam inteiros e o que sobra deles vai para os longos).
 */
export function corpoNoTeto(blocos: readonly BlocoComLiteral[], teto: number): string {
  const citados = blocos.map((b) => (b.literal === undefined ? "" : citacao(b.literal)));
  const fixo = blocos.reduce(
    (soma, b) => soma + b.cabecalho.length + (b.rodape?.length ?? 0) + (b.seCortado?.length ?? 0) + 6,
    0,
  );
  const total = citados.reduce((soma, c) => soma + c.length, 0);
  let cotas = citados.map((c) => c.length);
  if (fixo + total > teto) {
    let restante = Math.max(0, teto - fixo);
    const ordem = citados.map((c, i) => ({ i, n: c.length })).sort((a, b) => a.n - b.n || a.i - b.i);
    cotas = citados.map(() => 0);
    ordem.forEach(({ i, n }, k) => {
      const parte = Math.floor(restante / (ordem.length - k));
      cotas[i] = Math.min(n, parte);
      restante -= cotas[i]!;
    });
  }
  return blocos
    .map((b, i) => {
      const citado = citados[i]!;
      const cota = cotas[i]!;
      const cortado = citado.length > cota;
      const linhas = [b.cabecalho];
      if (citado !== "" && !cortado) linhas.push(citado);
      if (cortado && cota >= MINIMO_LITERAL) linhas.push(`${citado.slice(0, cota - 1).trimEnd()}…`);
      if (cortado && b.seCortado) linhas.push(b.seCortado);
      if (b.rodape) linhas.push(b.rodape);
      return linhas.join("\n");
    })
    .join("\n\n");
}

/** Espaço do corpo dentro do teto, descontados avisos, paginação e rodapé que `montarTexto` acrescenta. */
export function tetoDoCorpo(resposta: Resposta<unknown>, teto: number): number {
  return teto - montarTexto(resposta, "").length - 2;
}

/** Último recurso: corta o corpo numa quebra de linha antes do teto, com uma linha explicando o corte. */
export function limitarTexto(corpo: string, teto: number, explicacao: string): string {
  if (corpo.length <= teto) return corpo;
  const limite = Math.max(0, teto - explicacao.length - 3);
  const quebra = corpo.lastIndexOf("\n", limite);
  return `${corpo.slice(0, quebra > 0 ? quebra : limite).trimEnd()}\n\n${explicacao}`;
}
