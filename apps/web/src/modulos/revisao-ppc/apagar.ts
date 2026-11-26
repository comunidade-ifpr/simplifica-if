/**
 * As frases do diálogo de apagar para a revisão de PPC, a partir do que a lista viva já tem, e o aviso de
 * que uma lista sem uso sai sozinha. O `DialogoApagar` (`../apagar/`) só mostra os `TextosApagar`. Puras,
 * para os testes.
 */
import { DIAS_LISTA, type ListaPendencias } from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import type { NomeDoItem, TextosApagar } from "../../apagar/textos.ts";
import { nomeDoArquivo, plural } from "../../lib/texto.ts";

/** O nome da revisão na nota de depois de apagar (`notaDepoisDeApagar`). */
export const REVISAO: NomeDoItem = { um: "revisão", varios: "revisões" };

/**
 * Apagar uma revisão de PPC. `lendo`: a leitura com IA da lista está em andamento (o servidor a para
 * antes de apagar).
 */
export function textosApagarRevisao(lista: ListaPendencias, lendo: boolean): TextosApagar {
  const r = lista.resultado;
  return {
    titulo: `Apagar a revisão de “${nomeDoArquivo(lista.arquivoOriginal)}”?`,
    saiDoApp: [
      `O texto do PPC convertido e ${plural(lista.pendencias.length, "pendência", "pendências")}`,
      "O que você marcou e o que escreveu ao discordar",
      ...(r.leituraIa === "nenhuma" && !lendo ? [] : ["A conferência com IA, com o que ela guardou do PPC"]),
    ],
    ficaNoComputador: [
      { texto: "Seu arquivo", caminho: lista.arquivoOriginal },
      { texto: "A cópia comentada", caminho: r.arquivoComentado },
    ],
    aviso: lendo ? "A conferência com IA está em andamento. O app para a conferência antes de apagar." : null,
    opcaoPasta: null,
    confirmar: "Apagar a revisão",
  };
}

/** Apagar várias revisões de uma vez; com uma só, os textos dela. */
export function textosApagarRevisoes(
  itens: ReadonlyArray<{ readonly lista: ListaPendencias; readonly lendo: boolean }>,
): TextosApagar {
  if (itens.length === 1) return textosApagarRevisao(itens[0]!.lista, itens[0]!.lendo);
  const n = itens.length;
  const pendencias = itens.reduce((soma, i) => soma + i.lista.pendencias.length, 0);
  const comIa = itens.some((i) => i.lendo || i.lista.resultado.leituraIa !== "nenhuma");
  const lendo = itens.filter((i) => i.lendo).length;
  return {
    titulo: `Apagar ${n} revisões?`,
    saiDoApp: [
      `O texto de ${n} PPCs convertidos e ${plural(pendencias, "pendência", "pendências")}`,
      "O que você marcou e o que escreveu ao discordar",
      ...(comIa ? ["As conferências com IA, com o que elas guardaram dos PPCs"] : []),
    ],
    ficaNoComputador: [{ texto: `Seus ${n} arquivos e as cópias comentadas, nas pastas deles` }],
    aviso:
      lendo === 0
        ? null
        : lendo === 1
          ? "Uma conferência com IA está em andamento. O app a para antes de apagar."
          : `${lendo} leituras com IA estão em andamento. O app as para antes de apagar.`,
    opcaoPasta: null,
    confirmar: `Apagar ${n} revisões`,
  };
}

/** Quantos dias faltam para a lista sair sozinha (`DIAS_LISTA` sem uso), em `agora`. */
export function diasParaSair(atualizadaEm: string, agora: number): number {
  const sai = Date.parse(atualizadaEm) + DIAS_LISTA * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((sai - agora) / (24 * 60 * 60 * 1000)));
}

/** "some em 3 dias", "some amanhã", "some hoje": só quando faltam poucos dias. */
export function avisoDeSaida(atualizadaEm: string, agora: number): string | null {
  const dias = diasParaSair(atualizadaEm, agora);
  if (dias > 7) return null;
  if (dias <= 0) return "some hoje";
  if (dias === 1) return "some amanhã";
  return `some em ${dias} dias`;
}
