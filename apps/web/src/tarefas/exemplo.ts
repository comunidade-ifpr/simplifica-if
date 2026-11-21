/**
 * A tarefa de exemplo do terceiro passo das boas-vindas (M1.8): a mais útil para o perfil, que gaste
 * pouco da cota.
 *
 * - Para quem cuida de PPC (coordenações de curso e de ensino, pedagogia, direção de ensino, PROENS/DENS): "Revisar um PPC",
 *   com o PPC que a pessoa escolher. A pré-conferência roda no computador, sem IA e sem gastar a cota; a
 *   revisão com IA é opcional e mostra a estimativa antes.
 * - Para os demais, e como segunda opção: "Conferir a fundamentação normativa" de um trecho real e curto
 *   de PPC publicado na base, que cita a Res. CNE/CP nº 1/2021 sem o órgão completo (a norma foi
 *   revogada pela Res. CNE/CP nº 2/2026: a resposta mostra a regra de transição).
 */
import { type Perfil, type Publico, publicosDoPerfil, type ResumoSkill } from "@simplifica-if/contratos-app";

/** A skill do exemplo de conversa. */
export const SKILL_EXEMPLO = "verificar-fundamentacao-normativa";

/** De `base-conhecimento/institucional/ifpr/ppcs/londrina/tecnico-em-enfermagem.md`, linha 431. */
export const TRECHO_EXEMPLO =
  "A carga horária de alguns componentes curriculares será desenvolvida com atividades à distância em conformidade com a Resolução 01/2021 do Conselho Nacional de Educação, artigo 26, e o CNCT (Catálogo Nacional de Cursos Técnicos) que prevê em cursos de modalidades presenciais, a possibilidade de até 20% da sua carga horária diária em atividades não presenciais (BRASIL, 2020).";

export const ORIGEM_TRECHO = "PPC do Técnico em Enfermagem do Campus Londrina, publicado na base";

export const PEDIDO_EXEMPLO = `Confira a fundamentação normativa deste trecho de PPC (${ORIGEM_TRECHO}):\n\n> ${TRECHO_EXEMPLO}`;

export type Exemplo =
  | {
      readonly tipo: "revisar-ppc";
      readonly titulo: string;
      readonly frase: string;
      readonly custo: string;
    }
  | {
      readonly tipo: "conversa";
      readonly skill: string;
      readonly titulo: string;
      readonly frase: string;
      readonly custo: string;
      readonly pedido: string;
    };

const CUIDAM_DE_PPC: ReadonlyArray<Publico> = [
  "coordenacao-curso",
  "coordenacao-ensino",
  "pedagogia",
  "direcao-ensino",
  "proens",
  "dens",
];

/** As sugestões, a mais útil primeiro. A conversa só entra se a skill estiver no catálogo. */
export function exemplosDoPerfil(
  perfil: Perfil | undefined,
  skills: ReadonlyArray<ResumoSkill>,
): ReadonlyArray<Exemplo> {
  const conversa: ReadonlyArray<Exemplo> = skills.some((skill) => skill.nome === SKILL_EXEMPLO)
    ? [
        {
          tipo: "conversa",
          skill: SKILL_EXEMPLO,
          titulo: "Conferir a fundamentação normativa de um trecho",
          frase: `A IA confere as normas citadas num trecho curto do ${ORIGEM_TRECHO}, com o texto das normas da base.`,
          custo: "Cerca de 2 minutos. Usa pouco da sua cota: mais ou menos o que três ou quatro perguntas comuns.",
          pedido: PEDIDO_EXEMPLO,
        },
      ]
    : [];
  const ppc: Exemplo = {
    tipo: "revisar-ppc",
    titulo: "Revisar um PPC",
    frase:
      "Escolha o arquivo .docx do PPC. O app o confere com as normas, o CNCT e a matriz da base e devolve uma cópia do documento com comentários.",
    custo: "Alguns segundos. A pré-conferência roda no computador, sem IA: não gasta a sua cota.",
  };
  return publicosDoPerfil(perfil).some((publico) => CUIDAM_DE_PPC.includes(publico))
    ? [ppc, ...conversa]
    : [...conversa, ppc];
}
