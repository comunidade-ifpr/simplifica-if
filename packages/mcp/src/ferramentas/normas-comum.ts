/**
 * Peças comuns das ferramentas de normas (especificação M0.1, "Tipos comuns"): os schemas de
 * `NormaResumo`, `DispositivoTexto` e `Relacao`, a conversão das estruturas do kb para eles e o corte
 * do texto para a IA no teto de caracteres de cada ferramenta. Nenhuma regra normativa: só formato.
 */
import type { Database } from "bun:sqlite";
import {
  descendentesBanco,
  type NormaDoBanco,
  normaBanco,
  type Relacao,
  type TrechoDispositivo,
} from "@simplifica-if/kb/db/modo-banco";
import { z } from "zod";
import { type Aviso, esquemaFonte, esquemaLink, type Resposta } from "../envelope.ts";
import { linkNorma } from "../links.ts";
import { citacao, montarTexto } from "../texto.ts";

/* ================================================================== schemas */

export const SITUACOES_NORMA = ["base", "stub", "externo"] as const;

/** AAAA-MM-DD, como as datas da base. */
export const esquemaData = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use AAAA-MM-DD");

/** ID canônico de norma com dispositivo: `br/cne-cp/res/2026/2#art28-vii`. */
export const esquemaIdDispositivo = z
  .string()
  .regex(/^[a-z0-9][a-z0-9/:~.-]*#[A-Za-z0-9-]+$/, 'use o ID canônico com dispositivo, como "br/lei/1996/9394#art36"');

/** ID canônico de norma, com ou sem dispositivo: `br/cne-cp/res/2021/1`, `br/cne-cp/res/2021/1#art20`. */
export const esquemaIdNorma = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9/:~.-]*(?:#[A-Za-z0-9-]+)?$/,
    'use o ID canônico da norma, como "br/cne-cp/res/2021/1" (sem espaços; para uma citação em texto, use resolver_citacoes)',
  );

export const esquemaNormaResumo = z.strictObject({
  id: z.string(),
  titulo: z.string(),
  situacao: z.enum(SITUACOES_NORMA),
  /** Status publicado, calculado na `data_referencia` da base. */
  status_vigencia: z.string().nullable(),
  vigencia_a_confirmar: z.boolean(),
  data_publicacao: z.string().nullable(),
  ementa: z.string().nullable(),
  link: esquemaLink,
});
export type NormaResumo = z.infer<typeof esquemaNormaResumo>;

export const esquemaDispositivoTexto = z.strictObject({
  /** ID canônico do ato com o dispositivo (`br/cne-cp/res/2026/2#art28-vii`). */
  id: z.string(),
  rotulo: z.string(),
  tipo: z.string(),
  /** Caput herdado, do mais alto ao mais próximo. */
  caput: z.array(z.string()),
  texto: z.string(),
  subordinados: z.array(z.strictObject({ id: z.string(), rotulo: z.string(), texto: z.string() })),
  revogado: z.boolean(),
  vetado: z.boolean(),
  fonte: esquemaFonte,
  link: esquemaLink,
});
export type DispositivoTexto = z.infer<typeof esquemaDispositivoTexto>;

export const esquemaRelacao = z.strictObject({
  tipo: z.string(),
  origem: z.string(),
  /** Dispositivo da origem que opera a relação (`#art74-ii`). */
  operador: z.string().nullable(),
  alvo: z.string(),
  alvo_dispositivo: z.string().nullable(),
  /** Parte do alvo atingida, quando descrita em texto. */
  alcance: z.string().nullable(),
  evidencia: z.strictObject({ em: z.string(), trecho: z.string() }),
  confirmado_em: z.string().nullable(),
  nota: z.string().nullable(),
});
export type RelacaoSaida = z.infer<typeof esquemaRelacao>;

/* ================================================================ conversões */

export function resumoDaNorma(norma: NormaDoBanco): NormaResumo {
  return {
    id: norma.id,
    titulo: norma.titulo,
    situacao: norma.situacao,
    status_vigencia: norma.status_vigencia,
    vigencia_a_confirmar: norma.vigencia_a_confirmar,
    data_publicacao: norma.data_publicacao,
    ementa: norma.ementa,
    link: linkNorma(norma.id),
  };
}

/** `normaBanco` com cache por chamada (várias respostas citam a mesma norma). */
export function leitorDeNormas(db: Database): (id: string) => NormaDoBanco | null {
  const cache = new Map<string, NormaDoBanco | null>();
  return (id) => {
    if (!cache.has(id)) cache.set(id, normaBanco(db, id));
    return cache.get(id)!;
  };
}

/**
 * `DispositivoTexto` a partir do trecho do kb. Os rótulos dos subordinados (que o trecho não traz)
 * vêm dos descendentes do mesmo arquivo.
 */
export function dispositivoTexto(db: Database, trecho: TrechoDispositivo): DispositivoTexto {
  const rotulos = new Map<string, string>();
  if (trecho.subordinados.length > 0) {
    for (const d of descendentesBanco(db, trecho.arquivo_id))
      rotulos.set(`${d.disp.ato}${d.disp.dispositivo}`, d.disp.rotulo);
  }
  return {
    id: trecho.id,
    rotulo: trecho.rotulo,
    tipo: trecho.tipo,
    caput: trecho.caput,
    texto: trecho.texto,
    subordinados: trecho.subordinados.map((s) => ({ id: s.id, rotulo: rotulos.get(s.id) ?? "", texto: s.texto })),
    revogado: trecho.revogado,
    vetado: trecho.vetado,
    fonte: { path: trecho.path, linha_inicio: trecho.linha_inicio, linha_fim: trecho.linha_fim },
    link: linkNorma(trecho.id),
  };
}

export function relacaoSaida(r: Relacao): RelacaoSaida {
  return {
    tipo: r.tipo,
    origem: r.origem,
    operador: r.operador ?? null,
    alvo: r.alvo,
    alvo_dispositivo: r.alvo_dispositivo ?? null,
    alcance: r.alcance ?? null,
    evidencia: { em: r.evidencia.em, trecho: r.evidencia.trecho },
    confirmado_em: r.confirmado_em ?? null,
    nota: r.nota ?? null,
  };
}

/* ==================================================================== avisos */

/** Avisos de vigência a confirmar e de norma sem texto, um por norma, na ordem em que aparecem. */
export function avisosDasNormas(normas: Iterable<NormaResumo>): Aviso[] {
  const vistas = new Set<string>();
  const avisos: Aviso[] = [];
  for (const n of normas) {
    if (vistas.has(n.id)) continue;
    vistas.add(n.id);
    if (n.vigencia_a_confirmar) {
      avisos.push({
        tipo: "vigencia-a-confirmar",
        mensagem: `a vigência de ${n.titulo} está a confirmar; veja ficha_norma antes de concluir`,
        ref: n.id,
      });
    }
    if (n.situacao !== "base") {
      avisos.push({
        tipo: "stub-sem-texto",
        mensagem: `${n.titulo} não tem texto na base (${n.situacao === "stub" ? "só a identificação" : "referência externa"}): não afirme o conteúdo dela`,
        ref: n.id,
      });
    }
  }
  return avisos;
}

/* ============================================================ texto e teto */

/** Texto literal de um dispositivo: caput herdado, o próprio texto e os subordinados. */
export function literalDoDispositivo(d: DispositivoTexto): string {
  return [...d.caput, d.texto, ...d.subordinados.map((s) => s.texto)].join("\n");
}

/** Linha curta da situação de uma norma: status e "a confirmar". */
export function situacaoDaNorma(n: NormaResumo): string {
  if (n.situacao !== "base") return n.situacao === "stub" ? "sem texto na base (stub)" : "referência externa";
  const status = n.status_vigencia ?? "vigência não registrada";
  return n.vigencia_a_confirmar && status !== "a confirmar" ? `${status} (a confirmar)` : status;
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
