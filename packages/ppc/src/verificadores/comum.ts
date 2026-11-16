/**
 * Tipos e utilitários dos verificadores das fichas D da `revisar-ppc` (M1.11, etapa 2).
 *
 * Um verificador decide uma ficha canônica só com código e a base: recebe o PPC já segmentado
 * (`PpcPreparado`, montado uma vez por `prepararPpc`) e a base (`BaseVerificacao`: CNCT, forma de
 * oferta, registro de normas e relações de revogação), e devolve um `ResultadoFicha` com o estado,
 * os trechos literais do PPC (linha e seção) e as fontes `ifpr://`.
 *
 * Regra de prudência: tudo o que depende de extração incerta (fatos `extraido`, classificação de
 * títulos, citação resolvida com confiança menor, padrão de texto sem revisão) sai como
 * `a_conferir`, nunca como `nao_atende`. `nao_atende` só sai de regra cuja precisão foi medida na
 * base (`packages/ppc/PRECISAO.md`).
 */
import { extrairFatosPpc, type FatoPpc } from "@simplifica-if/kb/fatos/ppc";
import type { Registro } from "@simplifica-if/kb/normas/registro";
import { sucessorasDe, type Relacao } from "@simplifica-if/kb/normas/relacoes";
import { type Citacao, extrairCitacoes } from "@simplifica-if/kb/normas/resolver";
import { removerAcentos, type SecaoPpc, segmentarPpc } from "@simplifica-if/kb/ppcs/secoes";

export type CursoCnct = {
  slug: string;
  denominacao: string;
  eixo_tecnologico: string;
  carga_horaria_minima_horas: number | null;
  legislacao_profissional?: string | null;
  pre_requisitos_ingresso?: string | null;
};

/** Forma de oferta declarada do curso (`tipo_oferta` da base); outra forma é aceita e tratada como desconhecida. */
export type FormaOferta = "integrado" | "subsequente" | "concomitante" | "proeja" | (string & {});

/** O que vem da base, igual para qualquer PPC. */
export type BaseVerificacao = {
  cnct: CursoCnct | null;
  forma: FormaOferta;
  registro: Registro;
  /** Relações de `base-conhecimento/relacoes.yaml` (`carregarRelacoes`), para achar a norma sucessora. */
  relacoes: readonly Relacao[];
};

/** O PPC convertido e segmentado, com os fatos e as citações já extraídos (uma vez por PPC). */
export type PpcPreparado = {
  markdown: string;
  linhas: readonly string[];
  secoes: readonly SecaoPpc[];
  fatos: readonly FatoPpc[];
  citacoes: readonly Citacao[];
};

export type EstadoVerificacao = "atende" | "nao_atende" | "a_conferir" | "nao_se_aplica";

/** Trecho literal do PPC: `texto` é substring da linha `linha` do Markdown; `secao` é o título da seção. */
export type Trecho = { texto: string; linha: number; secao: string | null };

/** Link `ifpr://` (contrato com a interface do app; ver `packages/mcp/src/links.ts`). */
export type Fonte = `ifpr://${string}`;

export type Apontamento = {
  estado: "nao_atende" | "a_conferir";
  mensagem: string;
  /** Vazio quando o problema é a ausência de algo. */
  trechos: Trecho[];
  fontes: Fonte[];
};

export type ResultadoFicha = {
  ficha: string;
  verificador: string;
  estado: EstadoVerificacao;
  /** Resumo do resultado da ficha, para a lista e o comentário. */
  mensagem: string;
  apontamentos: Apontamento[];
  /** Trechos que sustentam `atende` (o que foi encontrado), quando houver. */
  evidencias: Trecho[];
  fontes: Fonte[];
};

export type Verificador = {
  /** ID estável da regra (`d-revogadas-identidade`), registrado no resultado. */
  id: string;
  ficha: string;
  /** O que o verificador confere, numa frase (vai para o README e o relatório). */
  descricao: string;
  verificar: (ppc: PpcPreparado, base: BaseVerificacao) => ResultadoFicha;
};

export const linkNorma = (id: string): Fonte => `ifpr://norma/${id}`;
export const linkCnct = (slug: string): Fonte => `ifpr://cnct/${slug}`;
export const linkFicha = (ficha: string): Fonte => `ifpr://ficha/${ficha}`;

export const chave = (texto: string) => removerAcentos(texto).toLowerCase().replace(/\s+/g, " ").trim();

export function prepararPpc(markdown: string): PpcPreparado {
  // Seções a partir de `##`, a convenção da base, do `kb` e da conversão DOCX.
  const secoes = segmentarPpc(markdown, "tecnico");
  const fatos = extrairFatosPpc(
    markdown,
    secoes.map((s) => ({ tipo: s.tipo, linha_inicio: s.linhaInicio, linha_fim: s.linhaFim })),
  );
  return { markdown, linhas: markdown.split("\n"), secoes, fatos, citacoes: [] };
}

/** `prepararPpc` com as citações normativas resolvidas pelo registro (a parte mais cara: cerca de metade do tempo). */
export function prepararPpcComCitacoes(markdown: string, registro: Registro): PpcPreparado {
  return { ...prepararPpc(markdown), citacoes: extrairCitacoes(markdown, registro) };
}

/** Seção que contém a linha (a de título mais próximo acima). */
export function secaoDaLinha(ppc: PpcPreparado, linha: number): SecaoPpc | null {
  let achada: SecaoPpc | null = null;
  for (const secao of ppc.secoes) if (secao.linhaInicio <= linha && linha <= secao.linhaFim) achada = secao;
  return achada;
}

/** Trecho literal: `texto` tem de estar na linha (senão vai a linha inteira, aparada). */
export function trecho(ppc: PpcPreparado, linha: number, texto?: string): Trecho {
  const conteudo = ppc.linhas[linha - 1] ?? "";
  const literal = texto !== undefined && conteudo.includes(texto) ? texto : conteudo.trim();
  return { texto: literal, linha, secao: secaoDaLinha(ppc, linha)?.titulo ?? null };
}

/** Linha (desde 1) de uma posição do Markdown. */
export const linhaDe = (markdown: string, posicao: number) => markdown.slice(0, posicao).split("\n").length;

/** Linhas (desde 1) das seções dos tipos dados. */
export function linhasDasSecoes(ppc: PpcPreparado, tipos: ReadonlySet<string>): number[] {
  const linhas: number[] = [];
  for (const secao of ppc.secoes)
    if (tipos.has(secao.tipo)) for (let n = secao.linhaInicio; n <= secao.linhaFim; n += 1) linhas.push(n);
  return linhas;
}

/**
 * Regras de resolução de citação com confiança menor (AGENTS.md): completam ou corrigem citações
 * incompletas, e o que depende delas sai a conferir.
 */
const REGRAS_INCERTAS = new Set(["dcnept-2021-orgao-trocado", "orgao-ausente-registro", "orgao-no-documento"]);
export const citacaoSegura = (citacao: Citacao) => citacao.confianca >= 0.85 && !REGRAS_INCERTAS.has(citacao.regra);

/** Citações por ID de ato (só as resolvidas), na ordem do texto. */
export function citacoesPorAto(citacoes: readonly Citacao[]): Map<string, Citacao[]> {
  const porId = new Map<string, Citacao[]>();
  for (const citacao of citacoes) {
    if (!citacao.id) continue;
    const lista = porId.get(citacao.id) ?? [];
    lista.push(citacao);
    porId.set(citacao.id, lista);
  }
  return porId;
}

/** Todas as normas que sucedem `id` por revogação total, em cadeia (6/2012 → 1/2021 → 2/2026). */
export function sucessorasEmCadeia(id: string, relacoes: readonly Relacao[]): string[] {
  const vistas = new Set<string>();
  const fila = [id];
  while (fila.length) {
    for (const sucessora of sucessorasDe(fila.shift()!, relacoes))
      if (!vistas.has(sucessora)) {
        vistas.add(sucessora);
        fila.push(sucessora);
      }
  }
  return [...vistas];
}

export type NormaRevogadaCitada = {
  id: string;
  titulo: string;
  citacoes: Citacao[];
  /** Sucessoras não revogadas (vigentes, alteradas ou parcialmente revogadas). */
  sucessoras: string[];
  /** Sucessora não revogada citada em algum ponto do PPC, se houver. */
  sucessoraCitada: string | null;
};

/**
 * Normas com `status_vigencia: revogada` no registro entre as citações dadas, e se o PPC também
 * cita (em qualquer ponto) uma sucessora em vigor.
 */
export function normasRevogadasCitadas(
  citacoes: readonly Citacao[],
  todasAsCitacoes: readonly Citacao[],
  base: BaseVerificacao,
): NormaRevogadaCitada[] {
  const citadas = new Set(todasAsCitacoes.map((c) => c.id).filter((id): id is string => id !== null));
  const saida: NormaRevogadaCitada[] = [];
  for (const [id, lista] of citacoesPorAto(citacoes)) {
    const entrada = base.registro.obter(id);
    if (entrada?.status_vigencia !== "revogada") continue;
    const sucessoras = sucessorasEmCadeia(id, base.relacoes).filter(
      (s) => base.registro.obter(s)?.status_vigencia !== "revogada",
    );
    saida.push({
      id,
      titulo: entrada.title,
      citacoes: lista,
      sucessoras,
      sucessoraCitada: sucessoras.find((s) => citadas.has(s)) ?? null,
    });
  }
  return saida;
}

/**
 * Apontamento de norma revogada citada: `nao_atende` quando o PPC não cita nenhuma sucessora em
 * vigor (a citação sustenta o texto sozinha) e a citação é segura; `a_conferir` quando cita a
 * sucessora (pode ser histórica ou de transição), quando a citação está numa seção de histórico,
 * quando não há sucessora registrada, ou quando a citação foi resolvida por regra de confiança menor.
 */
export function apontamentoRevogada(ppc: PpcPreparado, base: BaseVerificacao, norma: NormaRevogadaCitada): Apontamento {
  const segura = norma.citacoes.find(citacaoSegura);
  const citacao = segura ?? norma.citacoes[0]!;
  const nomeSucessora = (id: string) => base.registro.obter(id)?.title ?? id;
  const trechos = [trecho(ppc, citacao.linha, citacao.trecho)];
  const fontes = [linkNorma(norma.id), ...norma.sucessoras.slice(0, 1).map(linkNorma)];
  if (!segura)
    return {
      estado: "a_conferir",
      mensagem: `Parece citar ${norma.titulo}, revogada; a citação foi identificada com confiança menor. Confira a norma citada e as regras de transição.`,
      trechos,
      fontes,
    };
  if (norma.sucessoraCitada)
    return {
      estado: "a_conferir",
      mensagem: `Cita ${norma.titulo}, revogada, e também ${nomeSucessora(norma.sucessoraCitada)}. Confira se a citação da revogada é só histórica ou de transição.`,
      trechos,
      fontes,
    };
  if (/hist[óo]ric/i.test(trechos[0]!.secao ?? ""))
    return {
      estado: "a_conferir",
      mensagem: `Cita ${norma.titulo}, revogada, numa seção de histórico. Confira se a citação é só histórica ou se ainda sustenta o texto.`,
      trechos,
      fontes,
    };
  if (!norma.sucessoras.length)
    return {
      estado: "a_conferir",
      mensagem: `Cita ${norma.titulo}, revogada (sem norma sucessora registrada na base). Confira se a citação ainda é pertinente.`,
      trechos,
      fontes,
    };
  return {
    estado: "nao_atende",
    mensagem: `Cita ${norma.titulo}, revogada, sem citar a norma que a substituiu (${nomeSucessora(norma.sucessoras[0]!)}). Atualize a fundamentação e confira as regras de transição.`,
    trechos,
    fontes,
  };
}

/** Estado da ficha a partir dos apontamentos: o pior deles; sem apontamento, o `seVazio`. */
export function resultado(
  verificador: Pick<Verificador, "id" | "ficha">,
  apontamentos: Apontamento[],
  seVazio: { estado: EstadoVerificacao; mensagem: string; evidencias?: Trecho[]; fontes?: Fonte[] },
): ResultadoFicha {
  const fontesApontamentos = apontamentos.flatMap((a) => a.fontes);
  const fontes = [...new Set([...fontesApontamentos, ...(seVazio.fontes ?? [])])];
  const base = { ficha: verificador.ficha, verificador: verificador.id, apontamentos, fontes };
  const evidencias = seVazio.evidencias ?? [];
  if (apontamentos.some((a) => a.estado === "nao_atende")) {
    const n = apontamentos.filter((a) => a.estado === "nao_atende").length;
    return {
      ...base,
      estado: "nao_atende",
      mensagem:
        apontamentos.length === 1
          ? apontamentos[0]!.mensagem
          : `${n} pendência(s); a primeira: ${apontamentos.find((a) => a.estado === "nao_atende")!.mensagem}`,
      evidencias,
    };
  }
  if (apontamentos.length)
    return {
      ...base,
      estado: "a_conferir",
      mensagem: apontamentos.length === 1 ? apontamentos[0]!.mensagem : `${apontamentos.length} pontos a conferir.`,
      evidencias,
    };
  return { ...base, estado: seVazio.estado, mensagem: seVazio.mensagem, evidencias };
}
