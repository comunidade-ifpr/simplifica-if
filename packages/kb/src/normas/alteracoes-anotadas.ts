/**
 * As alterações que o próprio texto consolidado anota: "(Redação dada pela Lei nº 14.945, de 2024)",
 * "(Incluído pela ...)", "(Revogado pela ...)". Agrupadas pelo ato que as fez, com os dispositivos
 * atingidos.
 *
 * Não são relações de `relacoes.yaml`: o ato que altera quase nunca tem texto nem stub na base, e a
 * alteração já está na redação do arquivo, então não muda o cálculo de vigência. Servem para saber
 * quem mexeu em quê, por dispositivo. Valem o que valem as notas da fonte oficial: a alteração sem
 * nota não aparece.
 */
import type { NotaDispositivo } from "./estrutura.ts";
import { metadadosDoIdNorma, montarIdNorma } from "./ids.ts";
import type { Registro } from "./registro.ts";
import { extrairCitacoes } from "./resolver.ts";

export interface AlteracaoAnotada {
  /** O ato como se cita: `Lei nº 14.945/2024`. */
  ato: string;
  /** O ID canônico do ato (`br/lei/2024/14945`), esteja ou não na base. */
  id: string;
  ano: number;
  /** Dispositivos com a redação dada pelo ato, incluídos por ele e revogados por ele. */
  redacao: number;
  inclusao: number;
  revogacao: number;
  /** Os dispositivos atingidos, na ordem do texto (`#art36-par1`). */
  dispositivos: string[];
}

const TIPOS_FEDERAIS = [
  ["Lei Complementar", "lc"],
  ["Lei", "lei"],
  ["Medida Provisória", "mp"],
  ["Decreto-Lei", "decreto-lei"],
  ["Decreto", "decreto"],
  ["Emenda Constitucional", "ec"],
] as const;

/** `Lei nº 10.793, de 1º.12.2003`, `Lei nº 14.945, de 2024`, `Lei nº 13.281, de 4/5/2016`: tipo, número e data. */
const RE_ATO_FEDERAL = new RegExp(
  String.raw`\b(${TIPOS_FEDERAIS.map(([nome]) => nome).join("|")})\s+(?:n[ºo°]\.?\s*)?(\d[\d.]*)\s*,\s*de\s+([^()]*)`,
  "i",
);

/** O ID do ato federal que a nota cita, pela forma do Planalto (a data vem abreviada de vários jeitos). */
function idDoAtoFederal(texto: string): string | null {
  const m = RE_ATO_FEDERAL.exec(texto);
  const ano = m ? /\b(\d{4})\b/.exec(m[3]!)?.[1] : undefined;
  const tipo = m ? TIPOS_FEDERAIS.find(([nome]) => nome.toLowerCase() === m[1]!.toLowerCase()) : undefined;
  if (!m || !ano || !tipo) return null;
  return montarIdNorma({ jurisdicao: "br", orgao: null, tipo: tipo[1], ano, numero: m[2]!.replace(/\./g, "") });
}

/** O título de um ato pelo ID, como o registro o escreve: `Lei nº 14.945/2024`, `Resolução CNE/CEB nº 6/2025`. */
function tituloDoId(id: string): string {
  const meta = metadadosDoIdNorma(id);
  if (meta === null) return id;
  const numero = Number(meta.numero).toLocaleString("pt-BR");
  return meta.orgao === "Presidência da República"
    ? `${meta.tipo_documento} nº ${numero}/${meta.ano}`
    : `${meta.tipo_documento} ${meta.orgao} nº ${numero}/${meta.ano}`;
}

/**
 * O ato que uma nota de redação cita, ou `null` (nota sem ato: "(Revogado)", "(Vigência)"). O ato
 * federal sai da forma da nota; resolução e portaria, do resolvedor de citações, com o registro.
 */
export function atoDaNota(texto: string, registro?: Registro): Pick<AlteracaoAnotada, "ato" | "id" | "ano"> | null {
  const id = idDoAtoFederal(texto) ?? (registro ? (extrairCitacoes(texto, registro)[0]?.id ?? null) : null);
  const ano = id === null ? null : (metadadosDoIdNorma(id)?.ano ?? null);
  if (id === null || ano === null) return null;
  return { ato: registro?.obter(id)?.title ?? tituloDoId(id), id, ano };
}

const CAMPO = { redacao: "redacao", inclusao: "inclusao", revogacao: "revogacao", renumeracao: "redacao" } as const;

/**
 * As alterações anotadas nos dispositivos de uma norma, do ato mais recente ao mais antigo. Um
 * dispositivo conta uma vez por ato, no tipo da primeira nota dele.
 */
export function alteracoesAnotadas(
  dispositivos: ReadonlyArray<{ readonly dispositivo: string; readonly notas: ReadonlyArray<NotaDispositivo> }>,
  registro?: Registro,
): AlteracaoAnotada[] {
  const porAto = new Map<string, AlteracaoAnotada>();
  for (const d of dispositivos) {
    const vistos = new Set<string>();
    for (const nota of d.notas) {
      const campo = nota.tipo in CAMPO ? CAMPO[nota.tipo as keyof typeof CAMPO] : null;
      const ato = campo === null ? null : atoDaNota(nota.texto, registro);
      if (campo === null || ato === null || vistos.has(ato.id)) continue;
      vistos.add(ato.id);
      const item = porAto.get(ato.id) ?? { ...ato, redacao: 0, inclusao: 0, revogacao: 0, dispositivos: [] };
      item[campo]++;
      item.dispositivos.push(d.dispositivo);
      porAto.set(ato.id, item);
    }
  }
  return [...porAto.values()].sort((a, b) => b.ano - a.ano || b.id.localeCompare(a.id, "pt-BR", { numeric: true }));
}
