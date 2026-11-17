/**
 * Seções dos PPCs convertidos: reconhecimento de títulos, segmentação com linhas de início e fim
 * e classificação por uma taxonomia própria de cada nível.
 *
 * - **Técnicos** (nível médio): os tipos cobrem os incisos do art. 28 da Res. CNE/CP nº 2/2026
 *   (estrutura mínima do PPC de EPTNM), mais as seções recorrentes do modelo do IFPR.
 * - **Geral** (graduação, pós-graduação e FIC): taxonomia geral, sem os tipos próprios do art. 28 e
 *   com os da graduação (atividades complementares, contexto institucional).
 *
 * A classificação de cada título segue três passos, registrados em `origem`:
 * 1. `titulo`: regras sobre o próprio título;
 * 2. `numeracao`: título numerado sem regra herda o tipo do ancestral numerado (6.1.1 → 6.1 → 6);
 * 3. `contexto`: título sem numeração e sem regra herda o tipo da seção anterior.
 *
 * Antes disso, cabeçalhos de página ("Campus Curitiba do IFPR", "PROENS") deixam de contar como
 * título, e rótulos internos ("EMENTA:", "Bibliografia básica", "1º ano") ficam no texto da seção
 * em que aparecem. Tudo o que vem antes do primeiro título numerado (ou, sem numeração, do primeiro
 * título reconhecido) é `pretextual`: capa, dirigentes, comissão.
 */
import {
  aparar,
  apararCaracteres,
  apararFimEnquanto,
  contarCaracteres,
  ESPACOS,
  prefixo as prefixoTexto,
} from "../texto.ts";
import { linhasFrontMatter } from "./front-matter.ts";

/* ------------------------------------------------------------------ títulos */

const RE_ESPACOS = new RegExp(`[${ESPACOS}]+`, "g");
const RE_NUMERACAO = new RegExp(`^\\p{Nd}+(?:\\.\\p{Nd}+)*[${ESPACOS}]*[-–.]?[${ESPACOS}]*`, "u");
const RE_TITULO_MARKDOWN = new RegExp(`^#{2,6}[${ESPACOS}]+([^\\n]+?)[${ESPACOS}]*#*$`);
const RE_TITULO_NEGRITO = /^\*\*([^\n]+?)\*\*$/;
const MARCADORES_TITULO_NEGRITO = [
  "identificacao",
  "justificativa",
  "objetivo",
  "perfil",
  "organizacao",
  "matriz",
  "ementa",
  "avaliacao",
  "infraestrutura",
  "referencia",
  "projeto pedagogico",
];

/** Remove acentos (NFKD sem marcas combinantes). */
export function removerAcentos(texto: string): string {
  return texto.normalize("NFKD").replace(/\p{Mn}/gu, "");
}

export function limparTexto(texto: string): string {
  const limpo = texto
    .replaceAll("\x00", "")
    .replace(new RegExp(`<br[${ESPACOS}]*/?>`, "g"), " ")
    .replace(/[*#>`_]+/g, "")
    .replace(/\|+/g, " ");
  return aparar(limpo.replace(RE_ESPACOS, " "));
}

export function limparTitulo(texto: string): string {
  const limpo = limparTexto(texto).replace(RE_NUMERACAO, (trecho) => `${aparar(trecho)} `);
  return apararCaracteres(limpo.replace(RE_ESPACOS, " "), " -");
}

/** Título de seção reconhecido numa linha do PPC, ou `null`. */
export function tituloDaLinha(linha: string): string | null {
  const limpa = aparar(linha);
  if (!limpa) return null;

  const markdown = RE_TITULO_MARKDOWN.exec(limpa);
  if (markdown) return limparTitulo(markdown[1]!);

  const negrito = RE_TITULO_NEGRITO.exec(limpa);
  if (negrito) {
    const candidato = limparTitulo(negrito[1]!);
    const normalizado = removerAcentos(candidato).toLowerCase();
    if (
      contarCaracteres(candidato) <= 180 &&
      MARCADORES_TITULO_NEGRITO.some((marcador) => normalizado.includes(marcador))
    ) {
      return candidato;
    }
  }
  return null;
}

/** Numeração do título (`6.1.1`), se houver; o primeiro número tem até dois dígitos (não é ano). */
export function numeracaoDoTitulo(titulo: string): { numeracao: string | null; resto: string } {
  const casamento = /^(\p{Nd}{1,2}(?:\.\p{Nd}{1,3})*)\.?(?![\p{Nd}ºª°])\s*[-–.]?\s*/u.exec(titulo);
  if (!casamento || casamento[0].length === titulo.length) return { numeracao: null, resto: titulo };
  return { numeracao: casamento[1]!, resto: titulo.slice(casamento[0].length) };
}

/** Título em minúsculas, sem acentos, sem numeração e com espaços simples. */
export function normalizarTitulo(titulo: string): string {
  const { resto } = numeracaoDoTitulo(titulo);
  const semAcentos = removerAcentos(resto).toLowerCase().replace(RE_ESPACOS, " ");
  return apararFimEnquanto(
    semAcentos,
    (caractere) => caractere === ":" || caractere === ";" || caractere === ".",
  ).trim();
}

/* -------------------------------------------------------------- taxonomias */

export type NomeTaxonomia = "tecnico" | "geral";

export type DefinicaoTipo = {
  tipo: string;
  rotulo: string;
  /** Incisos e parágrafos do art. 28 da Res. CNE/CP nº 2/2026 cobertos pelo tipo (só técnicos). */
  art28?: string[];
};

const TIPOS_TECNICO: DefinicaoTipo[] = [
  { tipo: "identificacao", rotulo: "Identificação do curso", art28: ["I"] },
  { tipo: "formato_oferta", rotulo: "Formato da oferta (presencial, semipresencial, a distância)", art28: ["II"] },
  { tipo: "justificativa", rotulo: "Justificativa e contexto", art28: ["III"] },
  { tipo: "objetivos", rotulo: "Objetivos", art28: ["III"] },
  { tipo: "requisitos_acesso", rotulo: "Requisitos e formas de acesso", art28: ["IV"] },
  { tipo: "acessibilidade_inclusao", rotulo: "Acessibilidade e educação inclusiva", art28: ["V"] },
  { tipo: "perfil_egresso", rotulo: "Perfil profissional de conclusão", art28: ["VI"] },
  { tipo: "itinerario_formativo", rotulo: "Itinerário formativo e certificações intermediárias", art28: ["VII"] },
  { tipo: "carga_horaria", rotulo: "Carga horária e frequência", art28: ["VIII"] },
  { tipo: "organizacao_curricular", rotulo: "Organização curricular", art28: ["IX", "§1º"] },
  { tipo: "matriz_curricular", rotulo: "Matriz curricular", art28: ["IX"] },
  { tipo: "ementas", rotulo: "Ementário e bibliografia dos componentes", art28: ["§1º-I"] },
  { tipo: "concepcao_pedagogica", rotulo: "Concepção e orientações metodológicas", art28: ["§1º-II"] },
  { tipo: "aproveitamento_estudos", rotulo: "Aproveitamento de conhecimentos e experiências", art28: ["X"] },
  { tipo: "avaliacao", rotulo: "Avaliação e recomposição da aprendizagem", art28: ["XI", "§1º-V"] },
  { tipo: "infraestrutura", rotulo: "Infraestrutura física e tecnológica", art28: ["XII"] },
  { tipo: "mundo_trabalho", rotulo: "Integração com o mundo do trabalho", art28: ["XIII"] },
  { tipo: "corpo_docente", rotulo: "Corpo docente e técnico-administrativo", art28: ["XIV"] },
  { tipo: "certificados_diplomas", rotulo: "Certificados e diplomas", art28: ["XV"] },
  { tipo: "prazo_integralizacao", rotulo: "Duração e prazo de integralização", art28: ["XVI"] },
  { tipo: "estagio_praticas", rotulo: "Estágio e prática profissional", art28: ["XVII", "§1º-III", "§1º-IV"] },
  { tipo: "acompanhamento_egresso", rotulo: "Acompanhamento de egressos", art28: ["XVIII", "§4º"] },
  { tipo: "legislacao", rotulo: "Fundamentos legais e normativos" },
  { tipo: "atendimento_estudante", rotulo: "Políticas de atendimento e permanência estudantil" },
  { tipo: "ensino_pesquisa_extensao", rotulo: "Ensino, pesquisa, extensão e inovação" },
  { tipo: "trabalho_conclusao", rotulo: "Trabalho de conclusão" },
  { tipo: "avaliacao_curso", rotulo: "Avaliação do curso e do PPC" },
  { tipo: "gestao_curso", rotulo: "Coordenação, colegiados e gestão" },
  { tipo: "referencias", rotulo: "Referências do PPC" },
  { tipo: "anexos", rotulo: "Anexos e apêndices" },
  { tipo: "pretextual", rotulo: "Elementos pré-textuais (capa, dirigentes, comissão)" },
  { tipo: "outros", rotulo: "Não classificado" },
];

const TIPOS_GERAL: DefinicaoTipo[] = [
  { tipo: "identificacao", rotulo: "Identificação, oferta e duração do curso" },
  { tipo: "contexto_institucional", rotulo: "Contexto institucional (IFPR, PDI, PPI, missão)" },
  { tipo: "justificativa", rotulo: "Justificativa" },
  { tipo: "objetivos", rotulo: "Objetivos" },
  { tipo: "requisitos_acesso", rotulo: "Requisitos e formas de acesso" },
  { tipo: "acessibilidade_inclusao", rotulo: "Acessibilidade e educação inclusiva" },
  { tipo: "perfil_egresso", rotulo: "Perfil do egresso e área de atuação" },
  { tipo: "organizacao_curricular", rotulo: "Organização curricular" },
  { tipo: "matriz_curricular", rotulo: "Matriz curricular" },
  { tipo: "ementas", rotulo: "Ementário e bibliografia dos componentes" },
  { tipo: "concepcao_pedagogica", rotulo: "Concepção e metodologia" },
  { tipo: "aproveitamento_estudos", rotulo: "Aproveitamento de estudos" },
  { tipo: "avaliacao", rotulo: "Avaliação da aprendizagem" },
  { tipo: "estagio_praticas", rotulo: "Estágio e práticas" },
  { tipo: "trabalho_conclusao", rotulo: "Trabalho de conclusão" },
  { tipo: "atividades_complementares", rotulo: "Atividades complementares" },
  { tipo: "ensino_pesquisa_extensao", rotulo: "Ensino, pesquisa, extensão e inovação" },
  { tipo: "atendimento_estudante", rotulo: "Políticas de atendimento e permanência estudantil" },
  { tipo: "certificados_diplomas", rotulo: "Certificados e diplomas" },
  { tipo: "acompanhamento_egresso", rotulo: "Acompanhamento de egressos" },
  { tipo: "avaliacao_curso", rotulo: "Avaliação do curso (autoavaliação, SINAES)" },
  { tipo: "infraestrutura", rotulo: "Infraestrutura" },
  { tipo: "corpo_docente", rotulo: "Corpo docente e técnico-administrativo" },
  { tipo: "gestao_curso", rotulo: "Coordenação, NDE, colegiados e gestão" },
  { tipo: "legislacao", rotulo: "Fundamentos legais e normativos" },
  { tipo: "referencias", rotulo: "Referências do PPC" },
  { tipo: "anexos", rotulo: "Anexos e apêndices" },
  { tipo: "pretextual", rotulo: "Elementos pré-textuais (capa, dirigentes, comissão)" },
  { tipo: "outros", rotulo: "Não classificado" },
];

export const TAXONOMIAS: Record<NomeTaxonomia, { descricao: string; niveis: string[]; tipos: DefinicaoTipo[] }> = {
  tecnico: {
    descricao: "Cursos técnicos de nível médio; tipos ligados aos incisos do art. 28 da Res. CNE/CP nº 2/2026.",
    niveis: ["médio"],
    tipos: TIPOS_TECNICO,
  },
  geral: {
    descricao: "Graduação, pós-graduação e FIC.",
    niveis: ["superior", "pós-graduação", "formação inicial e continuada"],
    tipos: TIPOS_GERAL,
  },
};

/** Tipos que não ganham arquivo em `secoes/`: sem conteúdo de curso (`pretextual`) ou sem tipo. */
export const TIPOS_NAO_INDEXADOS = new Set(["pretextual", "outros"]);

/** Taxonomia de um nível de curso (`nivel` do índice de PPCs). */
export function taxonomiaDoNivel(nivel: string): NomeTaxonomia {
  return TAXONOMIAS.tecnico.niveis.includes(nivel) ? "tecnico" : "geral";
}

/** Conceito reconhecido no título → tipo de cada taxonomia (quando o nome muda). */
const EQUIVALENCIAS: Record<NomeTaxonomia, Record<string, string>> = {
  tecnico: {
    contexto_institucional: "justificativa",
    atividades_complementares: "organizacao_curricular",
  },
  geral: {
    formato_oferta: "identificacao",
    prazo_integralizacao: "identificacao",
    carga_horaria: "identificacao",
    itinerario_formativo: "organizacao_curricular",
    mundo_trabalho: "estagio_praticas",
  },
};

/**
 * Regras sobre o título normalizado, em ordem: a primeira que casa decide. Os conceitos são os
 * tipos das duas taxonomias; `EQUIVALENCIAS` traduz os que não existem num nível.
 */
const REGRAS: Array<[string, RegExp]> = [
  ["anexos", /^(anexo|apendice)s?\b/],
  [
    "pretextual",
    /^(sumario|lista de (figuras|tabelas|quadros|siglas|abreviaturas)|reitor|vice-?reitor|pro-?reitor|diretor|diretora|ficha catalografica|projeto (politico[- ])?pedagogico (de|do) curso\b.{20,})|(aprovacao|ajuste curricular) do projeto pedagogico (de|do) curso \(/,
  ],
  // Objetivos do plano de ensino de um componente: são do ementário, não os objetivos do curso.
  ["ementas", /^objetivos? (geral |gerais )?(do|da|dos|das) (componentes?|disciplinas?|unidades? curriculares?)\b/],
  [
    "acompanhamento_egresso",
    /(acompanhamento|politica|monitoramento|insercao|relacionamento|programa).{0,40}egress|egress.{0,30}(acompanhamento|insercao)/,
  ],
  [
    "aproveitamento_estudos",
    /aproveitamento|certificacao de conhecimentos|validacao de conhecimentos|reconhecimento de (saberes|conhecimentos|competencias)/,
  ],
  [
    "itinerario_formativo",
    /itinerario|representacao grafica|fluxograma|saidas? intermediarias?|certifica(cao|coes|dos) intermediari/,
  ],
  [
    "perfil_egresso",
    /perfil.{0,30}(egress|conclusao|profissional|formando)|areas? de atuacao|campo de atuacao|atuacao (do|profissional)|registro profissional|conselho profissional|regula(menta)? a profissao|ocupac(ao|oes) (cbo|associadas)/,
  ],
  [
    "certificados_diplomas",
    /diploma|certificados|expedicao|certificacao( final)?$|titulacao|titulo (conferido|academico)/,
  ],
  ["trabalho_conclusao", /trabalho (de|final de) (conclusao|curso)|\btcc\b|monografia/],
  [
    "atividades_complementares",
    /atividades (academicas )?(complementares|formativas complementares|acadêmico-cientifico)/,
  ],
  [
    "estagio_praticas",
    /estagio|praticas? previstas|pratica profissional|praticas profissionais|pratica (como componente|supervisionada|pedagogica)|praticas (pedagogicas )?como componente|aulas praticas|atividades praticas/,
  ],
  [
    "mundo_trabalho",
    /mundo do trabalho|integracao com (as organizacoes|os setores|o setor)|setor produtivo|integracao (entre )?(a )?escola|parcerias?|convenios?|visitas? tecnicas?|empresas/,
  ],
  [
    "acessibilidade_inclusao",
    /acessibilidade|educacao inclusiva|(?<!bolsas? (academicas )?de )inclusao(?! social)|napne|necessidades (educacionais )?especificas|atendimento educacional especializado|educacao especial|deficiencia|libras/,
  ],
  [
    "infraestrutura",
    /infraestrutura|infra-estrutura|biblioteca|laborator|instalac|equipamentos|acervo|areas? de (estudo|ensino|esporte|apoio|atendimento|convivencia|vivencia|lazer)|salas? de aula|espacos? fisicos?|recursos (materiais|tecnologicos|didaticos)|projecao de aquisicao|planejamento economico|sustentabilidade financeira|investimentos|ambiente virtual|polos? de apoio/,
  ],
  [
    "requisitos_acesso",
    /requisitos?.{0,20}(acesso|ingresso)|formas? de (acesso|ingresso)|escolaridade minima|processo seletivo|(acesso|ingresso) (ao|no) curso|publico[- ]alvo/,
  ],
  [
    "atendimento_estudante",
    /atendimento (ao|aos|do|dos|as) (estudante|discente|aluno)|assistencia estudantil|acesso e permanencia|permanencia e exito|politicas? de (atendimento|apoio)|apoio (ao|aos) (estudante|discente)|mobilidade|internacionaliza|monitoria|nivelamento|programas de (ensino|bolsas|apoio)|inclusao social|\bpbis\b|bolsas? de inclusao|bolsa[- ]?atleta|estudante atleta|bolsa permanencia/,
  ],
  [
    "prazo_integralizacao",
    /integralizacao|tempo (de|para) (conclusao|duracao)|duracao do curso|tempo de duracao|prazo (maximo|minimo)/,
  ],
  ["carga_horaria", /carga[- ]?horaria|hora[- ]aula|horas? relogio|frequencia minima/],
  [
    "formato_oferta",
    /forma de oferta|formato da oferta|modalidade|regime (academico|de matricula|escolar|de oferta)|tipo de matricula|periodicidade|educacao a distancia|semipresencial/,
  ],
  [
    "identificacao",
    /identificacao|caracteristicas do curso|perfil do curso|dados (gerais|do curso)|denominacao|eixo tecnologico|informacoes do campus|endereco|vagas|turno|horario|nome do curso|^processo$|numero do processo|^ano de |habilitacao|^grau\b|apresentacao|comissao (de|responsavel pela) (estruturacao|ajuste|elaboracao)|^curso\b/,
  ],
  [
    "legislacao",
    /fundamentos? (legais|legal|normativos)|fundamentacao legal|base legal|legislacao|marco legal|aspectos legais|amparo legal|normas? (que|regulamentadoras)/,
  ],
  [
    "contexto_institucional",
    /\bmissao\b|\bvisao\b|\bvalores\b|\bpdi\b|\bppi\b|\bppp\b|plano de desenvolvimento institucional|projeto (politico )?pedagogico institucional|o instituto federal|historico (do|da) (ifpr|instituto|instituicao|campus)|contexto historico|responsabilidade social|meio ambiente e desenvolvimento|memoria, patrimonio|insercao regional|o campus/,
  ],
  [
    "justificativa",
    /justificativa|criacao do curso|demanda|contextualizacao|arranjos? produtivos?|realidade (local|regional)|caracterizacao|diagnostico|contexto (local|regional|socioeconomico)/,
  ],
  ["objetivos", /objetivo/],
  [
    "gestao_curso",
    /nucleo docente estruturante|\bnde\b|^(o |a )?(conselho (?!de classe)|colegio de|camara|comite)|\bconsepe\b|\bconsap\b|\bconsup\b/,
  ],
  [
    "ensino_pesquisa_extensao",
    /pesquisa|extensao|inovacao|pos-graduacao|curricularizacao|iniciacao cientifica|indissociabilidade/,
  ],
  [
    "avaliacao_curso",
    /avaliacao (do|de|da) (curso|ppc|projeto|proposta)|autoavaliacao|auto-avaliacao|avaliacao institucional|\bcpa\b|comissao propria|sinaes|enade|avaliacao externa|avaliacao e acompanhamento do (curso|projeto)/,
  ],
  [
    "avaliacao",
    /avaliacao|recuperacao|recomposicao|progressao parcial|aprovacao|emissao de resultados|conselho de classe|frequencia|dependencia|reprovacao|exame final/,
  ],
  [
    "concepcao_pedagogica",
    /concepcao|pressupostos|orientac(ao|oes) metodologic|metodologi|estrategias (pedagogicas|de ensino|didaticas)|tecnologias digitais|tecnologias de informacao|principios (pedagogicos|norteadores|filosoficos)|fundamentos pedagogicos|principios e fundamentos|abordagem|interdisciplinar|contextualizacao/,
  ],
  [
    "ementas",
    /ementa|ementario|^componente curricular|^componentes? curriculares?:|^disciplina\b|^unidade curricular|planos? de ensino|programas? (dos|das) (componentes|disciplinas)/,
  ],
  ["matriz_curricular", /matriz|grade curricular|quadro (de componentes|resumo)|desdobramento/],
  [
    "organizacao_curricular",
    /organizacao (curricular|didatic|do curso|pedagogica)|estrutura curricular|conteudos obrigatorios|temas transversais|componentes (curriculares )?(optativos|eletivos)|optativ|eletiv|nucleos? (de formacao|comum|basico|especific|profissional|articulador|integrador|tecnologico)|areas? de conhecimento|formacao (geral|basica|tecnica|profissional|especifica)|bncc|percurso formativo|flexibiliza|educacao (ambiental|para as relacoes|em direitos humanos)|relacoes etnico|arte e cultura|curriculo|projeto integrador|pre-?requisitos|equivalencia/,
  ],
  [
    "corpo_docente",
    /corpo docente|docentes|pessoal docente|perfil do pessoal|corpo tecnico|tecnicos?[- ]administrativos?|\btaes?\b|quadro (de pessoal|docente)|expansao do quadro|capacitacao|qualificacao (docente|do corpo)|professores|servidores|pessoas envolvidas|pessoal tecnico/,
  ],
  [
    "gestao_curso",
    /coordenac|coordenador|colegiado|\bnde\b|nucleo docente estruturante|gestao|conselho (superior|de campus|de classe)|colegio de dirigentes|representatividade|participacao da sociedade|atribuicoes|orgaos colegiados|comunicacao e relac|secretaria academica/,
  ],
  [
    "referencias",
    /^referencias|referencias bibliograficas|^bibliografia (do ppc|consultada|geral|utilizada)|^obras consultadas/,
  ],
];

/** Cabeçalhos e rodapés de página: só nomes do IFPR, do MEC, da PROENS e de campi. */
const PALAVRAS_INSTITUCIONAIS = new Set(
  (
    "instituto institutofederal federal de do da dos das e educacao ciencia tecnologia parana ifpr campus avancado " +
    "ministerio ministerioda ministeriodaeducacao secretaria profissional tecnologica pro-reitoria pro reitoria ensino proens " +
    "diretoria superior mec setec"
  ).split(" "),
);

/** Rótulos internos de uma seção, que ficam no texto em vez de abrir seção. */
const RE_ROTULO =
  /^(ementas?|bibliografias?( (basica|complementar|basicas|complementares|recomendada))?|bibliografia(basica|complementar)|(\d+\s*)?[ºo°ª]?\s*(ano|semestre|periodo|modulo|serie|etapa)s?|carga horaria( total)?|ch|pre-?requisitos?|co-?requisitos?)$/;
/** Linha comum que abre um componente do ementário ("Componente curricular: Química I"). */
const RE_LINHA_COMPONENTE =
  /^(componente curricular|unidade curricular|disciplina|nome do componente( curricular)?)\s*:/;
/** Rótulos que só são internos dentro do ementário. */
const RE_ROTULO_EMENTARIO =
  /^(objetivos?( (geral|gerais|especificos?))?|conteudos?( programaticos?)?|referencias( (basicas|complementares|bibliograficas))?|metodologia|avaliacao|habilidades|competencias)$/;

/** Palavras dos nomes de campi (sem acentos, minúsculas), para reconhecer cabeçalhos de página. */
export function palavrasDeCampi(nomes: Iterable<string>): Set<string> {
  const palavras = new Set<string>();
  for (const nome of nomes) {
    for (const palavra of removerAcentos(nome)
      .toLowerCase()
      .split(/[\s\-–]+/))
      if (palavra) palavras.add(palavra);
  }
  return palavras;
}

export function ehCabecalhoDePagina(titulo: string, palavrasCampi: ReadonlySet<string>): boolean {
  const palavras = removerAcentos(titulo)
    .toLowerCase()
    .replace(/[[\]()|,–—:.]/g, " ")
    .split(/\s+/)
    .filter((p) => p && p !== "-");
  if (!palavras.length) return true;
  return palavras.every((p) => PALAVRAS_INSTITUCIONAIS.has(p) || palavrasCampi.has(p) || /^\p{Nd}+$/u.test(p));
}

/** Conceito do título pelas regras (`REGRAS`), já traduzido para a taxonomia; `null` se nenhuma casar. */
export function classificarTitulo(titulo: string, taxonomia: NomeTaxonomia): string | null {
  const n = normalizarTitulo(titulo);
  for (const [conceito, regra] of REGRAS) {
    if (regra.test(n)) return EQUIVALENCIAS[taxonomia][conceito] ?? conceito;
  }
  return null;
}

/* -------------------------------------------------------------- segmentação */

export type OrigemTipo = "titulo" | "numeracao" | "contexto" | "pretextual";

export type SecaoPpc = {
  titulo: string;
  numeracao: string | null;
  tipo: string;
  origem: OrigemTipo;
  /** Linha do título, contando desde 1 no arquivo (front matter incluído). */
  linhaInicio: number;
  /** Última linha não vazia antes do próximo título. */
  linhaFim: number;
  /** Markdown do corpo da seção (sem a linha do título), sem linhas vazias nas pontas. */
  texto: string;
  /** Texto limpo (sem marcação), usado no limite mínimo de tamanho. */
  textoLimpo: string;
};

/** Seções com menos caracteres de texto limpo que isto ficam fora do índice. */
export const MINIMO_CARACTERES_SECAO = 40;

/**
 * Divide o PPC em seções classificadas pela taxonomia do nível. Devolve todas as seções, inclusive
 * as curtas; o índice descarta as de texto limpo menor que `MINIMO_CARACTERES_SECAO`.
 */
export function segmentarPpc(
  markdown: string,
  taxonomia: NomeTaxonomia,
  palavrasCampi: ReadonlySet<string> = new Set(),
): SecaoPpc[] {
  const linhas = markdown.split("\n");
  const inicio = linhasFrontMatter(markdown);

  type Titulo = {
    linha: number;
    titulo: string;
    normalizado: string;
    numeracao: string | null;
    regra: string | null;
    /** Linha comum "Componente curricular: X", que só abre seção dentro do ementário. */
    componente: boolean;
  };
  const candidatos: Titulo[] = [];
  for (let i = inicio; i < linhas.length; i += 1) {
    const titulo = tituloDaLinha(linhas[i]!);
    if (!titulo) {
      const limpa = limparTexto(linhas[i]!);
      if (RE_LINHA_COMPONENTE.test(removerAcentos(limpa).toLowerCase())) {
        const rotulo = prefixoTexto(limpa, 180);
        candidatos.push({ linha: i, titulo: rotulo, normalizado: "", numeracao: null, regra: null, componente: true });
      }
      continue;
    }
    if (ehCabecalhoDePagina(titulo, palavrasCampi)) continue;
    const normalizado = normalizarTitulo(titulo);
    if (RE_ROTULO.test(normalizado)) continue;
    const { numeracao } = numeracaoDoTitulo(titulo);
    const regra = classificarTitulo(titulo, taxonomia);
    candidatos.push({ linha: i, titulo, normalizado, numeracao, regra, componente: false });
  }

  // Fim da zona pré-textual: primeiro título numerado; sem numeração, o primeiro com regra.
  const indiceNumerado = candidatos.findIndex((t) => t.numeracao !== null && t.regra !== "pretextual");
  const fimPretextual =
    indiceNumerado !== -1
      ? indiceNumerado
      : candidatos.findIndex((t) => t.regra && t.regra !== "pretextual" && !t.componente);

  type Classificado = Titulo & { tipo: string; origem: OrigemTipo };
  const titulos: Classificado[] = [];
  const porNumeracao = new Map<string, string>();
  let anterior: string | null = null;
  let emAnexos = false;
  for (const [indice, t] of candidatos.entries()) {
    if (t.componente) {
      // Componente do ementário em linha comum: abre seção só dentro do ementário.
      if (anterior !== "ementas" || emAnexos) continue;
      titulos.push({ ...t, tipo: "ementas", origem: "contexto" });
      continue;
    }
    // Dentro do ementário, "Objetivos", "Conteúdos" e "Referências" sem número são rótulos do componente.
    if (!t.numeracao && anterior === "ementas" && RE_ROTULO_EMENTARIO.test(t.normalizado)) continue;
    let tipo: string;
    let origem: OrigemTipo;
    if (fimPretextual === -1 || indice < fimPretextual) {
      tipo = "pretextual";
      origem = "pretextual";
    } else if (emAnexos) {
      // Anexos e apêndices ficam no fim: tudo depois do primeiro é anexo (regulamentos, formulários).
      tipo = "anexos";
      origem = t.regra === "anexos" ? "titulo" : "contexto";
    } else if (t.regra) {
      tipo = t.regra;
      origem = "titulo";
      if (tipo === "anexos") emAnexos = true;
    } else if (t.numeracao) {
      const partes = t.numeracao.split(".");
      let herdado: string | undefined;
      for (let n = partes.length - 1; n >= 1 && !herdado; n -= 1)
        herdado = porNumeracao.get(partes.slice(0, n).join("."));
      tipo = herdado ?? "outros";
      origem = herdado ? "numeracao" : "titulo";
    } else if (anterior && anterior !== "pretextual") {
      tipo = anterior;
      origem = "contexto";
    } else {
      tipo = "outros";
      origem = "titulo";
    }
    if (t.numeracao && tipo !== "pretextual") porNumeracao.set(t.numeracao, tipo);
    anterior = tipo;
    titulos.push({ ...t, tipo, origem });
  }

  const secoes: SecaoPpc[] = [];
  for (const [indice, t] of titulos.entries()) {
    const { tipo, origem } = t;
    const proximo = titulos[indice + 1]?.linha ?? linhas.length;
    const corpo = linhas.slice(t.linha + 1, proximo);
    let primeira = 0;
    while (primeira < corpo.length && !aparar(corpo[primeira]!)) primeira += 1;
    let ultima = corpo.length - 1;
    while (ultima >= primeira && !aparar(corpo[ultima]!)) ultima -= 1;
    const texto = corpo.slice(primeira, ultima + 1).join("\n");
    secoes.push({
      titulo: t.titulo,
      numeracao: t.numeracao,
      tipo,
      origem,
      linhaInicio: t.linha + 1,
      linhaFim: ultima >= primeira ? t.linha + 1 + ultima + 1 : t.linha + 1,
      texto,
      textoLimpo: limparTexto(texto),
    });
  }
  return secoes;
}

/**
 * Seção com chave estável: `<tipo>-<n>` (n-ésima do tipo, na ordem do documento) para as que entram
 * no índice; `<tipo>-x<n>` para as que ficam fora dele (`pretextual`, `outros` ou texto limpo curto).
 */
export type SecaoComChave = SecaoPpc & { chave: string; indexada: boolean };
export type SecaoIndexada = SecaoComChave;

/** A seção entra no índice publicado: tipo indexado e texto limpo com pelo menos `MINIMO_CARACTERES_SECAO`. */
export function secaoIndexavel(secao: Pick<SecaoPpc, "tipo" | "textoLimpo">): boolean {
  return !TIPOS_NAO_INDEXADOS.has(secao.tipo) && contarCaracteres(secao.textoLimpo) >= MINIMO_CARACTERES_SECAO;
}

/**
 * Todas as seções de um PPC, com a chave: as indexáveis numeradas como no índice publicado (a chave é
 * a parte do ID depois de `#`, `curitiba/tecnico-em-enfermagem#estagio_praticas-2`), as outras numa
 * série própria (`identificacao-x1`, `pretextual-x1`), que não desloca a numeração do índice.
 */
export function secoesComChave(
  markdown: string,
  taxonomia: NomeTaxonomia,
  palavrasCampi: ReadonlySet<string> = new Set(),
): SecaoComChave[] {
  const contadores = new Map<string, number>();
  return segmentarPpc(markdown, taxonomia, palavrasCampi).map((secao) => {
    const indexada = secaoIndexavel(secao);
    const serie = indexada ? secao.tipo : `${secao.tipo}~`;
    const contador = (contadores.get(serie) ?? 0) + 1;
    contadores.set(serie, contador);
    return { ...secao, chave: indexada ? `${secao.tipo}-${contador}` : `${secao.tipo}-x${contador}`, indexada };
  });
}

/**
 * Seções de um PPC que entram no índice de seções (`secaoIndexavel`), com a chave do índice. É o
 * mesmo recorte do índice publicado (`scripts/base/indice-ppcs.ts`).
 */
export function secoesIndexadas(
  markdown: string,
  taxonomia: NomeTaxonomia,
  palavrasCampi: ReadonlySet<string> = new Set(),
): SecaoIndexada[] {
  return secoesComChave(markdown, taxonomia, palavrasCampi).filter((secao) => secao.indexada);
}

/** Limite do `preview` de cada seção no índice publicado (o texto integral fica no Markdown). */
export const LIMITE_PREVIEW_SECAO = 500;

/** Primeiros `limite` caracteres do texto limpo da seção. */
export function previewSecao(secao: Pick<SecaoPpc, "textoLimpo">, limite = LIMITE_PREVIEW_SECAO): string {
  return prefixoTexto(secao.textoLimpo, limite);
}

/**
 * Texto integral de uma seção a partir do Markdown do PPC e das linhas do índice (`linha_inicio`,
 * `linha_fim`, contadas desde 1 no arquivo, com o front matter): o corpo depois da linha do título,
 * sem linhas vazias nas pontas. Com `incluirTitulo`, a linha do título vem junto. É o mesmo texto
 * de `SecaoPpc.texto`.
 */
export function textoDaSecao(
  markdown: string,
  linhaInicio: number,
  linhaFim: number,
  opcoes: { incluirTitulo?: boolean } = {},
): string {
  if (!Number.isInteger(linhaInicio) || !Number.isInteger(linhaFim) || linhaInicio < 1 || linhaFim < linhaInicio) {
    throw new RangeError(`linhas inválidas: ${linhaInicio}-${linhaFim}`);
  }
  const linhas = markdown.split("\n");
  if (linhaFim > linhas.length) throw new RangeError(`linha_fim ${linhaFim} além do fim do arquivo (${linhas.length})`);
  const corpo = linhas.slice(linhaInicio, linhaFim);
  let primeira = 0;
  while (primeira < corpo.length && !aparar(corpo[primeira]!)) primeira += 1;
  const texto = corpo.slice(primeira).join("\n");
  return opcoes.incluirTitulo ? [linhas[linhaInicio - 1]!, ...(texto ? [texto] : [])].join("\n") : texto;
}
