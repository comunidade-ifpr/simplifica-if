/**
 * Temas na ordem do parecer da PROENS (as paradas da proposta B), com os tópicos da taxonomia de
 * cada um. A pendência vai para o tema do primeiro tópico da ficha que aparece aqui. A revisão prévia
 * e a revisão com IA agrupam pelos mesmos temas.
 */
export const TEMAS: readonly { titulo: string; topicos: readonly string[] }[] = [
  { titulo: "Antes de começar", topicos: [] },
  { titulo: "Identificação e oferta", topicos: ["identificacao_oferta"] },
  { titulo: "Matriz e estrutura curricular", topicos: ["matriz_curricular"] },
  { titulo: "Perfil do egresso e CNCT", topicos: ["perfil_egresso_mundo_trabalho"] },
  { titulo: "Ementário e referências", topicos: ["ementario_bibliografias"] },
  { titulo: "Fundamentos legais e normativos", topicos: ["referencias_normativas"] },
  {
    titulo: "Acesso, permanência, AEE e inclusão",
    topicos: ["assistencia_estudantil_permanencia", "aee_acessibilidade_inclusao"],
  },
  { titulo: "Estágio, aproveitamento e TFC", topicos: ["estagio", "aproveitamento_certificacao_tfc"] },
  {
    titulo: "Justificativa, objetivos, concepção e metodologias",
    topicos: ["justificativa_objetivos", "concepcao_metodologias"],
  },
  { titulo: "Avaliação da aprendizagem e do curso", topicos: ["avaliacao_aprendizagem", "avaliacao_ppc_egressos"] },
  { titulo: "Corpo docente, gestão e infraestrutura", topicos: ["corpo_docente_gestao", "infraestrutura"] },
  { titulo: "Temas transversais", topicos: ["temas_transversais_cidadania"] },
  { titulo: "Coerência do conjunto", topicos: ["sintese_transversal_revisao"] },
];

/**
 * O tema (índice em `TEMAS`) de uma ficha: o do primeiro tópico dela que algum tema cobre. Ficha sem
 * tópico conhecido (base sem a taxonomia) fica em "Coerência do conjunto", no fim.
 */
export function ordemDoTema(topicos: readonly string[]): number {
  const indice = TEMAS.findIndex((tema) => tema.topicos.some((t) => topicos.includes(t)));
  return indice >= 0 ? indice : TEMAS.length - 1;
}
