/**
 * Pré-conferência sem IA de um PPC técnico (M1.11, etapa 2): roda os verificadores das 12 fichas D
 * (`verificadores/registro.ts`) e a triagem, e devolve o resultado por ficha.
 *
 * A triagem não é ficha: acha texto dirigido a uma IA (o PPC é entrada não confiável; o trecho é
 * retirado do que a IA recebe) e as seções do modelo que não foram encontradas (a conferir: a
 * classificação de títulos pode falhar).
 *
 * Cada resultado traz o estado (`atende`, `nao_atende`, `a_conferir`, `nao_se_aplica`), os trechos
 * literais do PPC com linha e seção e as fontes `ifpr://`. Para os comentários do Word,
 * `achadosParaComentarios` converte os trechos para o texto como está no DOCX.
 */
import {
  type BaseVerificacao,
  type Fonte,
  prepararPpcComCitacoes,
  type PpcPreparado,
  type ResultadoFicha,
  type Trecho,
  trecho,
} from "./verificadores/comum.ts";
import { comoNoDocumento } from "./verificadores/curriculo.ts";
import { VERIFICADORES } from "./verificadores/registro.ts";

export type {
  BaseVerificacao,
  CursoCnct,
  EstadoVerificacao,
  FormaOferta,
  ResultadoFicha,
  Trecho,
} from "./verificadores/comum.ts";

export type AchadoTriagem = {
  regra: "texto-dirigido-a-ia" | "secoes-do-modelo";
  estado: "nao_atende" | "a_conferir";
  mensagem: string;
  trechos: Trecho[];
};

export type PreConferencia = {
  /** Um resultado por ficha D, na ordem do registro. */
  fichas: ResultadoFicha[];
  triagem: AchadoTriagem[];
};

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

export function triar(ppc: PpcPreparado): AchadoTriagem[] {
  const achados: AchadoTriagem[] = [];
  ppc.linhas.forEach((linha, indice) => {
    const achado = TEXTO_PARA_IA.exec(linha);
    if (achado)
      achados.push({
        regra: "texto-dirigido-a-ia",
        estado: "nao_atende",
        mensagem: "Texto dirigido a um sistema de IA dentro do PPC. Remova antes de submeter.",
        trechos: [trecho(ppc, indice + 1, achado[0])],
      });
  });
  const tipos = new Set(ppc.secoes.map((s) => s.tipo));
  const ausentes = Object.entries(SECOES_ESPERADAS)
    .filter(([tipo]) => !tipos.has(tipo))
    .map(([, nome]) => nome);
  if (ausentes.length)
    achados.push({
      regra: "secoes-do-modelo",
      estado: "a_conferir",
      mensagem: `Não encontramos estas seções do modelo de PPC: ${ausentes.join("; ")}.`,
      trechos: [],
    });
  return achados;
}

/** Roda a triagem e todos os verificadores D sobre o PPC (Markdown convertido). */
export function preConferir(markdown: string, base: BaseVerificacao): PreConferencia {
  const ppc = prepararPpcComCitacoes(markdown, base.registro);
  return { fichas: VERIFICADORES.map((v) => v.verificar(ppc, base)), triagem: triar(ppc) };
}

/** Item para `comentarDocx`: um por apontamento (e por achado da triagem), com os trechos como no DOCX. */
export type ItemComentario = {
  ficha: string;
  estado: "nao_atende" | "a_conferir";
  mensagem: string;
  /** Trechos como aparecem no documento (sem a marcação do Markdown), do mais específico ao mais geral. */
  trechos: string[];
  fontes: Fonte[];
};

export function achadosParaComentarios(resultado: PreConferencia): ItemComentario[] {
  const itens: ItemComentario[] = resultado.triagem.map((a) => ({
    ficha: "TRIAGEM",
    estado: a.estado,
    mensagem: a.mensagem,
    trechos: a.trechos.map((t) => comoNoDocumento(t.texto)),
    fontes: [],
  }));
  for (const ficha of resultado.fichas)
    for (const apontamento of ficha.apontamentos)
      itens.push({
        ficha: ficha.ficha,
        estado: apontamento.estado,
        mensagem: apontamento.mensagem,
        trechos: apontamento.trechos.map((t) => comoNoDocumento(t.texto)).filter(Boolean),
        fontes: apontamento.fontes,
      });
  return itens;
}
