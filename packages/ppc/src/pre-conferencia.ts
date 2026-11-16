/**
 * Pré-conferência sem IA de um PPC técnico (prova de conceito da proposta C do M1.11).
 *
 * Sete das fichas canônicas da `revisar-ppc` têm um núcleo que o código decide sozinho, com a base:
 * denominação e eixo contra o CNCT (CT-IDENT-01, CT-IDENT-13), carga horária total contra o mínimo do
 * CNCT e da forma de oferta (CT-CURR-02), normas revogadas citadas (CT-IDENT-08, CT-SUP-12),
 * legislação profissional do CNCT não citada (CT-SUP-21) e AEE lançado como componente (CT-CURR-22).
 * Somam-se as seções do modelo que não foram encontradas e o texto dirigido a uma IA (o PPC é entrada
 * não confiável).
 *
 * Cada achado traz o trecho literal do PPC (para ancorar um comentário no DOCX) e a fonte. O estado é
 * `pendencia` quando a regra é segura, e `a_conferir` quando depende de uma extração sem revisão
 * humana (fatos `extraido`, classificação de seções): nesse caso a pessoa confere, e a IA não entra.
 */
import { extrairFatosPpc, type SecaoDoPpc } from "@simplifica-if/kb/fatos/ppc";
import type { Registro } from "@simplifica-if/kb/normas/registro";
import { extrairCitacoes } from "@simplifica-if/kb/normas/resolver";
import { removerAcentos, segmentarPpc } from "@simplifica-if/kb/ppcs/secoes";

export type CursoCnct = {
  slug: string;
  denominacao: string;
  eixo_tecnologico: string;
  carga_horaria_minima_horas: number | null;
  legislacao_profissional?: string | null;
};

export type FormaOferta = "integrado" | "subsequente" | "concomitante" | "proeja" | string;

export type Achado = {
  /** Ficha canônica (ou `TRIAGEM` para o que não é ficha). */
  ficha: string;
  estado: "pendencia" | "a_conferir";
  mensagem: string;
  /** Trechos literais do PPC, do mais específico ao mais geral; vazio quando o problema é a ausência. */
  trechos: string[];
  linha: number | null;
  /** Fonte da afirmação (ID canônico, `cnct:<slug>` ou o arquivo de regra). */
  fonte: string;
};

const chave = (texto: string) => removerAcentos(texto).toLowerCase().replace(/\s+/g, " ").trim();
/** Trecho de uma linha do Markdown como ele aparece no DOCX: sem negrito, barras de tabela nem marcador de lista. */
const comoNoDocumento = (linha: string) =>
  linha
    .replace(/[*|]/g, " ")
    .replace(/^\s*[-+]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
const linhaDe = (markdown: string, posicao: number) => markdown.slice(0, posicao).split("\n").length;

/** Tipos de seção do modelo de PPC técnico que a PROENS espera encontrar (taxonomia `tecnico` do `kb`). */
const SECOES_ESPERADAS: Record<string, string> = {
  justificativa: "Justificativa",
  objetivos: "Objetivos",
  perfil_egresso: "Perfil do egresso",
  matriz_curricular: "Matriz curricular",
  ementas: "Ementário",
  avaliacao: "Avaliação da aprendizagem",
  aproveitamento_estudos: "Aproveitamento de estudos",
  certificados_diplomas: "Certificados e diplomas",
  corpo_docente: "Corpo docente",
  infraestrutura: "Infraestrutura",
  acompanhamento_egresso: "Acompanhamento de egressos",
  avaliacao_curso: "Avaliação do curso (do PPC)",
  referencias: "Referências",
};

/** Frases típicas de instrução dirigida a um modelo de IA, num documento que não deveria ter nenhuma. */
const TEXTO_PARA_IA =
  /(ignore (as|todas as) instru[cç][oõ]es|ignore (all|previous) instructions|voc[eê] [eé] um (assistente|modelo)|sistema de revis[aã]o autom|registre (como|que) (atende|conforme)|marque (todas as fichas|como atende)|system prompt)/i;

export function preConferir(
  markdown: string,
  contexto: { cnct: CursoCnct | null; forma: FormaOferta; registro: Registro },
): Achado[] {
  const achados: Achado[] = [];
  // A conversão DOCX deste pacote escreve as seções como `#`; o `kb` só toma `##` em diante como seção
  // (nos PPCs da base, `#` é o título do documento). As linhas não mudam, só o nível.
  const paraSegmentar = /^## /m.test(markdown) ? markdown : markdown.replace(/^# /gm, "## ");
  const secoes = segmentarPpc(paraSegmentar, "tecnico");
  const secoesFatos: SecaoDoPpc[] = secoes.map((s) => ({
    tipo: s.tipo,
    linha_inicio: s.linhaInicio,
    linha_fim: s.linhaFim,
  }));
  const linhas = markdown.split("\n");
  const { cnct, forma, registro } = contexto;

  // Texto dirigido à IA: vai para a pessoa antes de tudo, e o trecho é retirado do que a IA recebe.
  linhas.forEach((linha, indice) => {
    const achado = TEXTO_PARA_IA.exec(linha);
    if (achado)
      achados.push({
        ficha: "TRIAGEM",
        estado: "pendencia",
        mensagem: "Texto dirigido a um sistema de IA dentro do PPC. Remova antes de submeter.",
        trechos: [achado[0]],
        linha: indice + 1,
        fonte: "regra:texto-dirigido-a-ia",
      });
  });

  if (cnct) {
    // CT-IDENT-01: a denominação mais citada no início do documento.
    const inicio = linhas.slice(0, Math.min(linhas.length, 200)).join("\n");
    const denominacoes = [...inicio.matchAll(/t[ée]cnico em [a-záéíóúâêôãõç][^\n|*,;:.()]{2,60}/gi)].map((m) => ({
      texto: m[0].trim(),
      posicao: m.index,
    }));
    const alvo = chave(cnct.denominacao);
    if (denominacoes.length && !denominacoes.some((d) => chave(d.texto).startsWith(alvo))) {
      const primeira = denominacoes[0]!;
      achados.push({
        ficha: "CT-IDENT-01",
        estado: "pendencia",
        mensagem: `A denominação "${primeira.texto}" não corresponde à do CNCT: "${cnct.denominacao}".`,
        trechos: [primeira.texto],
        linha: linhaDe(markdown, primeira.posicao),
        fonte: `cnct:${cnct.slug}`,
      });
    }

    // CT-IDENT-13: eixo declarado. Basta uma declaração compatível (a matriz pode ter um "eixo" de núcleo).
    const eixos = [...markdown.matchAll(/Eixo\s+Tecnol[óo]gico\s*\**\s*[:\-–|]\s*\**\s*([^\n|*]+)/gi)];
    const eixoCnct = chave(cnct.eixo_tecnologico);
    if (!eixos.length)
      achados.push({
        ficha: "CT-IDENT-13",
        estado: "a_conferir",
        mensagem: `Não encontramos o eixo tecnológico declarado. Pelo CNCT, é "${cnct.eixo_tecnologico}".`,
        trechos: [],
        linha: null,
        fonte: `cnct:${cnct.slug}`,
      });
    else if (!eixos.some((eixo) => chave(eixo[1]!).includes(eixoCnct))) {
      // A conferir, e não pendência: na base, 5 de 7 divergências eram abreviação ou texto colado pela
      // conversão ("Cont. e Proc. Industriais", "Informação e"); a pessoa resolve olhando o trecho.
      const eixo = eixos[0]!;
      achados.push({
        ficha: "CT-IDENT-13",
        estado: "a_conferir",
        mensagem: `O eixo declarado ("${eixo[1]!.trim()}") difere do CNCT: "${cnct.eixo_tecnologico}".`,
        trechos: [comoNoDocumento(eixo[0]), eixo[1]!.trim()],
        linha: linhaDe(markdown, eixo.index),
        fonte: `cnct:${cnct.slug}`,
      });
    }

    // CT-CURR-02: carga horária total contra o mínimo do CNCT e o da forma (Res. CNE/CP nº 2/2026, art. 29).
    const fatos = extrairFatosPpc(markdown, secoesFatos);
    const total = fatos.find((f) => f.fato === "carga_horaria_total_h");
    const minimoForma = forma === "integrado" ? 3000 : 0;
    const minimo = Math.max(cnct.carga_horaria_minima_horas ?? 0, minimoForma);
    if (!total)
      achados.push({
        ficha: "CT-CURR-02",
        estado: "a_conferir",
        mensagem: "Não encontramos a carga horária total declarada.",
        trechos: [],
        linha: null,
        fonte: `cnct:${cnct.slug}`,
      });
    else if (total.valor_num !== null && total.valor_num < minimo)
      achados.push({
        ficha: "CT-CURR-02",
        estado: "a_conferir",
        mensagem: `Carga horária total de ${total.valor_num} h, abaixo do mínimo de ${minimo} h (CNCT${minimoForma ? " e forma integrada" : ""}).`,
        trechos: [comoNoDocumento(total.trecho_fonte)],
        linha: total.linha,
        fonte:
          minimoForma > (cnct.carga_horaria_minima_horas ?? 0) ? "br/cne-cp/res/2026/2#art29" : `cnct:${cnct.slug}`,
      });
    else if (total.alternativas.some((a) => Number.parseInt(a.valor, 10) !== total.valor_num))
      achados.push({
        ficha: "CT-CURR-02",
        estado: "a_conferir",
        mensagem: `A carga horária total aparece com valores diferentes: ${[total.valor, ...total.alternativas.map((a) => a.valor)].join(", ")} h.`,
        trechos: [comoNoDocumento(total.trecho_fonte)],
        linha: total.linha,
        fonte: `cnct:${cnct.slug}`,
      });
  }

  // CT-IDENT-08 / CT-SUP-12: normas revogadas citadas (uma pendência por norma, no primeiro trecho).
  const citacoes = extrairCitacoes(markdown, registro);
  const citados = new Set(citacoes.map((c) => c.id).filter((id): id is string => id !== null));
  const vistas = new Set<string>();
  for (const citacao of citacoes) {
    if (!citacao.id || vistas.has(citacao.id)) continue;
    const entrada = registro.obter(citacao.id);
    if (entrada?.status_vigencia !== "revogada") continue;
    vistas.add(citacao.id);
    achados.push({
      ficha: "CT-SUP-12",
      estado: "pendencia",
      mensagem: `Cita ${entrada.title}, revogada. Confira a norma que a substituiu e as regras de transição.`,
      trechos: [citacao.trecho],
      linha: citacao.linha,
      fonte: citacao.id,
    });
  }

  // CT-SUP-21: o PPC não cita nenhum dos atos de legislação profissional que o CNCT indica. Citar só
  // parte deles não é pendência: a ficha pede tratamento "reconhecível", e a lista do CNCT é longa.
  const legislacao = (cnct?.legislacao_profissional ?? "").split("\n").filter((item) => item.trim());
  const idsLegislacao = legislacao.flatMap((item) =>
    extrairCitacoes(item, registro)
      .map((c) => c.id)
      .filter((id): id is string => id !== null),
  );
  if (cnct && idsLegislacao.length && !idsLegislacao.some((id) => citados.has(id)))
    achados.push({
      ficha: "CT-SUP-21",
      estado: "pendencia",
      mensagem: `O PPC não cita a legislação profissional que o CNCT indica para o curso: ${legislacao.join("; ")}.`,
      trechos: [],
      linha: null,
      fonte: `cnct:${cnct.slug}`,
    });

  // CT-CURR-22: AEE numa linha de tabela da matriz, do ementário ou da organização curricular.
  for (const secao of secoes) {
    if (!["matriz_curricular", "organizacao_curricular", "ementas", "carga_horaria"].includes(secao.tipo)) continue;
    for (let n = secao.linhaInicio; n <= secao.linhaFim; n += 1) {
      const linha = linhas[n - 1] ?? "";
      const aee = /atendimento educacional especializado|\bAEE\b/i.exec(linha);
      if (linha.trimStart().startsWith("|") && aee)
        achados.push({
          ficha: "CT-CURR-22",
          estado: "pendencia",
          mensagem: "O AEE aparece como linha da matriz ou do quadro de componentes; ele é serviço, não componente.",
          trechos: [aee[0]],
          linha: n,
          fonte: "ifpr/proens/nt/2025/1",
        });
    }
  }

  // Seções do modelo não encontradas, num achado só (a classificação de títulos pode falhar: a pessoa confere).
  const tipos = new Set(secoes.map((s) => s.tipo));
  const ausentes = Object.entries(SECOES_ESPERADAS)
    .filter(([tipo]) => !tipos.has(tipo))
    .map(([, nome]) => nome);
  if (ausentes.length)
    achados.push({
      ficha: "TRIAGEM",
      estado: "a_conferir",
      mensagem: `Não encontramos estas seções do modelo de PPC: ${ausentes.join("; ")}.`,
      trechos: [],
      linha: null,
      fonte: "regra:secoes-do-modelo",
    });
  return achados;
}
