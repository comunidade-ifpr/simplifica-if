/**
 * Cruzamento dos fatos do PPC com o SUAP (`dados/institucional/cursos/*.json`, `suap.matrizes`).
 *
 * Aspectos e resultados:
 * - `carga_horaria`: a carga total do PPC contra a CH exibida das matrizes do SUAP.
 *   `confere` (igual à CH comum, ou à da matriz única), `confere-com-uma-matriz` (o SUAP tem matrizes
 *   com CH diferentes e uma delas é a do PPC), `explicada-pelo-estagio` (a diferença é a carga do
 *   estágio obrigatório, somada num lado e não no outro), `diverge`, `sem-fato-ppc`, `sem-suap`.
 * - `estagio`: o estágio obrigatório do PPC (sim/não e carga) contra a matriz mais recente do SUAP
 *   (maior ano, depois maior ID). `confere`, `diverge` (sim × não), `diverge-carga`, `sem-fato-ppc`,
 *   `sem-suap`.
 * - `ano`: o ano do PPC (`dados/institucional`) contra o ano da matriz mais recente. `confere` (há
 *   matriz do ano do PPC ou posterior), `ppc-mais-recente-que-matrizes` (o SUAP não tem matriz do
 *   PPC vigente), `sem-ano`, `sem-suap`.
 *
 * Os fatos do PPC têm status `extraido`: uma divergência pode ser erro de extração. Por isso cada
 * linha leva os dois valores e a explicação, e a conferência começa pelo `trecho_fonte` do fato.
 */
import type { MatrizSuap } from "../institucional/dados.ts";

export interface LinhaCruzamento {
  aspecto: "carga_horaria" | "estagio" | "ano";
  resultado: string;
  valor_ppc: string | null;
  valor_suap: string | null;
  explicacao: string;
}

export const RESULTADOS_DIVERGENTES = new Set(["diverge", "diverge-carga", "ppc-mais-recente-que-matrizes"]);

export interface EntradaCruzamento {
  chPpc: number | null;
  /** A carga do PPC só veio em hora-aula (regra terminada em `-aula`). */
  chPpcEmHoraAula?: boolean;
  estagioObrigatorio: "sim" | "nao" | null;
  estagioCargaH: number | null;
  anoPpc: number | null;
  chComumSuap: number | null;
  matrizes: readonly MatrizSuap[];
}

function maisRecente(matrizes: readonly MatrizSuap[]): MatrizSuap | null {
  return [...matrizes].sort((a, b) => (b.ano ?? 0) - (a.ano ?? 0) || b.matriz_id - a.matriz_id)[0] ?? null;
}

function descreverMatriz(m: MatrizSuap): string {
  return `matriz ${m.matriz_id}${m.ano ? ` (${m.ano})` : ""}: ${m.ch_exibida_h} h`;
}

export function cruzarPpcSuap(e: EntradaCruzamento): LinhaCruzamento[] {
  const saida: LinhaCruzamento[] = [];
  const temSuap = e.matrizes.length > 0;
  const chs = [...new Set(e.matrizes.map((m) => m.ch_exibida_h))];
  const valorSuapCh = e.chComumSuap !== null ? String(e.chComumSuap) : chs.length ? chs.join(" | ") : null;

  // carga horária
  if (!temSuap) {
    saida.push({
      aspecto: "carga_horaria",
      resultado: "sem-suap",
      valor_ppc: e.chPpc?.toString() ?? null,
      valor_suap: null,
      explicacao: "curso sem matriz no SUAP",
    });
  } else if (e.chPpc === null) {
    saida.push({
      aspecto: "carga_horaria",
      resultado: "sem-fato-ppc",
      valor_ppc: null,
      valor_suap: valorSuapCh,
      explicacao: "carga horária total não extraída do PPC",
    });
  } else {
    // carga só em hora-aula: confere também convertida (aula de 50 ou 45 minutos)
    const conversoes = e.chPpcEmHoraAula
      ? [
          { ch: e.chPpc, nota: "" },
          { ch: Math.round((e.chPpc * 50) / 60), nota: " (convertendo hora-aula de 50 min)" },
          { ch: Math.round((e.chPpc * 45) / 60), nota: " (convertendo hora-aula de 45 min)" },
        ]
      : [{ ch: e.chPpc, nota: "" }];
    const convertida = conversoes.find((c) => e.matrizes.some((m) => m.ch_exibida_h === c.ch)) ?? conversoes[0]!;
    const ch = convertida.ch;
    const estagio = e.estagioCargaH ?? 0;
    const igual = e.matrizes.filter((m) => m.ch_exibida_h === ch);
    if (igual.length && (chs.length === 1 || e.chComumSuap === ch)) {
      saida.push({
        aspecto: "carga_horaria",
        resultado: "confere",
        valor_ppc: String(ch),
        valor_suap: valorSuapCh,
        explicacao: `igual a ${igual.map(descreverMatriz).join("; ")}${convertida.nota}`,
      });
    } else if (igual.length) {
      saida.push({
        aspecto: "carga_horaria",
        resultado: "confere-com-uma-matriz",
        valor_ppc: String(ch),
        valor_suap: valorSuapCh,
        explicacao: `igual a ${igual.map(descreverMatriz).join("; ")}${convertida.nota}; o SUAP tem matrizes com CH diferentes (${e.matrizes.map(descreverMatriz).join("; ")})`,
      });
    } else {
      const porEstagio =
        estagio > 0 ? e.matrizes.filter((m) => m.ch_exibida_h + estagio === ch || m.ch_exibida_h - estagio === ch) : [];
      const proxima = [...e.matrizes].sort(
        (a, b) => Math.abs(a.ch_exibida_h - ch) - Math.abs(b.ch_exibida_h - ch) || a.ordem - b.ordem,
      )[0]!;
      if (porEstagio.length) {
        saida.push({
          aspecto: "carga_horaria",
          resultado: "explicada-pelo-estagio",
          valor_ppc: String(ch),
          valor_suap: valorSuapCh,
          explicacao: `difere de ${porEstagio.map(descreverMatriz).join("; ")} exatamente pela carga do estágio obrigatório (${estagio} h)`,
        });
      } else {
        const diferenca = ch - proxima.ch_exibida_h;
        saida.push({
          aspecto: "carga_horaria",
          resultado: "diverge",
          valor_ppc: String(ch),
          valor_suap: valorSuapCh,
          explicacao: `PPC ${ch} h${e.chPpcEmHoraAula ? " (hora-aula: o PPC não dá a carga em hora-relógio)" : ""}; mais próxima: ${descreverMatriz(proxima)} (diferença ${diferenca > 0 ? "+" : ""}${diferenca} h)`,
        });
      }
    }
  }

  // estágio
  const recente = maisRecente(e.matrizes);
  if (!recente) {
    saida.push({
      aspecto: "estagio",
      resultado: "sem-suap",
      valor_ppc: e.estagioObrigatorio,
      valor_suap: null,
      explicacao: "curso sem matriz no SUAP",
    });
  } else {
    const suap = recente.estagio_exigido
      ? `sim${recente.ch_estagio_h !== null ? ` (${recente.ch_estagio_h} h)` : ""}`
      : "nao";
    const ppc =
      e.estagioObrigatorio === null
        ? null
        : e.estagioObrigatorio === "sim" && e.estagioCargaH !== null
          ? `sim (${e.estagioCargaH} h)`
          : e.estagioObrigatorio;
    const base = `matriz mais recente: ${recente.matriz_id}${recente.ano ? ` (${recente.ano})` : ""}`;
    if (e.estagioObrigatorio === null) {
      saida.push({
        aspecto: "estagio",
        resultado: "sem-fato-ppc",
        valor_ppc: null,
        valor_suap: suap,
        explicacao: `estágio obrigatório não extraído do PPC; ${base}`,
      });
    } else if ((e.estagioObrigatorio === "sim") !== recente.estagio_exigido) {
      saida.push({
        aspecto: "estagio",
        resultado: "diverge",
        valor_ppc: ppc,
        valor_suap: suap,
        explicacao: `PPC ${e.estagioObrigatorio === "sim" ? "prevê" : "não prevê"} estágio obrigatório; SUAP ${recente.estagio_exigido ? "exige" : "não exige"} (${base})`,
      });
    } else if (
      e.estagioObrigatorio === "sim" &&
      e.estagioCargaH !== null &&
      recente.ch_estagio_h !== null &&
      recente.ch_estagio_h > 0 &&
      e.estagioCargaH !== recente.ch_estagio_h
    ) {
      saida.push({
        aspecto: "estagio",
        resultado: "diverge-carga",
        valor_ppc: ppc,
        valor_suap: suap,
        explicacao: `carga do estágio: PPC ${e.estagioCargaH} h, SUAP ${recente.ch_estagio_h} h (${base})`,
      });
    } else {
      saida.push({ aspecto: "estagio", resultado: "confere", valor_ppc: ppc, valor_suap: suap, explicacao: base });
    }
  }

  // ano
  const anos = e.matrizes.map((m) => m.ano).filter((a): a is number => a !== null);
  if (!temSuap || anos.length === 0) {
    saida.push({
      aspecto: "ano",
      resultado: "sem-suap",
      valor_ppc: e.anoPpc?.toString() ?? null,
      valor_suap: null,
      explicacao: "sem matriz do SUAP com ano",
    });
  } else if (e.anoPpc === null) {
    saida.push({
      aspecto: "ano",
      resultado: "sem-ano",
      valor_ppc: null,
      valor_suap: String(Math.max(...anos)),
      explicacao: "PPC sem ano_documento em dados/institucional",
    });
  } else if (Math.max(...anos) < e.anoPpc) {
    saida.push({
      aspecto: "ano",
      resultado: "ppc-mais-recente-que-matrizes",
      valor_ppc: String(e.anoPpc),
      valor_suap: String(Math.max(...anos)),
      explicacao: `nenhuma matriz do SUAP é de ${e.anoPpc} ou posterior (anos: ${[...new Set(anos)].sort().join(", ")})`,
    });
  } else {
    saida.push({
      aspecto: "ano",
      resultado: "confere",
      valor_ppc: String(e.anoPpc),
      valor_suap: String(Math.max(...anos)),
      explicacao: `anos das matrizes: ${[...new Set(anos)].sort().join(", ")}`,
    });
  }
  return saida;
}
