/**
 * Tipos dos JSON Schemas de base-conhecimento/schemas/. Arquivo gerado por
 * scripts/gerar_tipos_schemas.ts; não edite à mão. Depois de alterar um
 * schema, rode `bun run scripts/gerar_tipos_schemas.ts`.
 */

/**
 * Índice de campi do IFPR (schemas/campi_index.schema.json).
 */
export interface IndiceCampiJson {
  id: "campi-ifpr";
  title: string;
  descricao: string;
  tipo_item: "campus";
  atualizado_em: string;
  /**
   * @minItems 1
   */
  items: {
    id: string;
    nome: string;
    path: string;
  }[];
}

/**
 * Campus do IFPR (schemas/campus.schema.json).
 */
export interface CampusJson {
  id: string;
  nome: string;
  links: {
    site: string;
    calendario_academico: string;
    [k: string]: string;
  };
  horario_aulas?: {
    url?: string;
    coletado_em: string;
  };
  cursos: {
    curso_slug: string;
    notion_page_id: string;
    nome: string;
    nivel: "fundamental" | "médio" | "superior" | "pós-graduação" | "formação inicial e continuada";
    tipo_oferta:
      | "integrado"
      | "subsequente"
      | "técnico integrado"
      | "técnico subsequente"
      | "graduação tecnológica"
      | "bacharelado"
      | "licenciatura"
      | "especialização"
      | "mestrado"
      | "FIC"
      | "programa institucional";
    modalidade?: "presencial" | "ead" | "semipresencial";
    situacao?: "abertura" | "ativo" | "em_oferta" | "suspenso" | "incerto";
    url?: string;
    suap?: {
      matrizes?: {
        resumo?: string;
        urls?: string[];
        carga_horaria_comum_h?: number;
        situacao?: "Única ativa" | "Múltiplas — mesma CH" | "Múltiplas — CH divergentes" | "Sem matriz ativa";
        coletado_em?: string;
      };
      id?: number;
      codigo?: string;
      vagas?: number;
      coletado_em?: string;
      atualizado_em?: string;
    };
    sei?: {
      /**
       * @minItems 1
       */
      processos: {
        numero: string;
        tipo:
          | "abertura"
          | "abertura OLD"
          | "Abertura - PAC"
          | "Abertura - PPC"
          | "Abertura PAC"
          | "Abertura PPC"
          | "ajuste"
          | "Ajuste PPC"
          | "atualização"
          | "Atualização"
          | "atualização SUAP"
          | "correção de cadastro"
          | "suspensão"
          | "Suspensão"
          | "reversão de suspensão"
          | "Reversão Suspensão"
          | "extinção"
          | "revisão de PPC vigente"
          | "outro";
        trecho_fonte?: string;
        status_curadoria?: "precisa_revisao" | "revisado" | "inconsistente" | "pendente";
        revisado_em?: string;
      }[];
    };
    ppc?: {
      url: string;
      markdown_path?: string;
      conversao: {
        ferramenta?: string;
        versao_ferramenta?: string;
        convertido_em?: string;
        mensagem_erro?: string;
        status: "pendente" | "convertido" | "erro";
      };
      metadados?: {
        ano_documento?: {
          ano: number;
          trecho_fonte: string;
          secao?: string;
          status_curadoria: "precisa_revisao" | "revisado" | "inconsistente" | "pendente";
          revisado_em?: string;
        };
        vagas?: {
          quantidade: number;
          minimo?: number;
          maximo?: number;
          periodicidade?: string;
          turno?: string;
          forma_oferta?: string;
          trecho_fonte: string;
          pagina?: number;
          secao?: string;
          status_curadoria: "precisa_revisao" | "revisado" | "inconsistente" | "pendente";
          revisado_em?: string;
        };
      };
    };
  }[];
  programas?: {
    id: string;
    nome: string;
    tipo: "programa institucional";
    url: string;
    ofertas: {
      id: string;
      nome: string;
      nivel: "fundamental" | "médio" | "superior" | "pós-graduação" | "formação inicial e continuada";
      tipo_oferta:
        | "integrado"
        | "subsequente"
        | "técnico integrado"
        | "técnico subsequente"
        | "graduação tecnológica"
        | "bacharelado"
        | "licenciatura"
        | "especialização"
        | "mestrado"
        | "FIC";
      modalidade: "presencial" | "ead" | "semipresencial";
      situacao: "ativo" | "em_oferta" | "suspenso" | "incerto";
      url: string;
    }[];
  }[];
}

/**
 * Manifesto de catálogos estruturados (schemas/catalogos_manifest.schema.json).
 */
export interface ManifestCatalogosJson {
  title: string;
  tipo: "catalogos_estruturados";
  versao: number;
  atualizado_em: string;
  /**
   * @minItems 1
   */
  catalogos: {
    id: string;
    title: string;
    sigla: string;
    tipo_item: "curso_tecnico_cnct";
    path: string;
    total_itens: number;
  }[];
}

/**
 * Curso CNCT (schemas/cnct_curso.schema.json).
 */
export interface CursoCnctJson {
  id: string;
  indice: number;
  denominacao: string;
  denominacao_normalizada: string;
  eixo_tecnologico: string;
  area_tecnologica: string;
  carga_horaria_minima_horas: number;
  descricao_carga_horaria_minima: string;
  perfil_profissional: string;
  pre_requisitos_ingresso: string;
  itinerarios_formativos: string;
  campo_atuacao: string;
  ocupacoes_cbo: string;
  codigos_cbo: string[];
  infraestrutura_minima: string;
  legislacao_profissional: string;
}

/**
 * Índice de cursos CNCT (schemas/cnct_index.schema.json).
 */
export interface IndiceCnctJson {
  id: "cnct-cursos";
  title: string;
  descricao: string;
  tipo_item: "curso_tecnico_cnct";
  schema_version: number;
  atualizado_em: string;
  total_cursos: number;
  /**
   * @minItems 1
   */
  items: {
    id: string;
    denominacao: string;
    denominacao_normalizada: string;
    eixo_tecnologico: string;
    area_tecnologica: string;
    carga_horaria_minima_horas: number;
    codigos_cbo: string[];
    path: string;
  }[];
}

/**
 * Manifesto do CNCT (schemas/cnct_manifest.schema.json).
 */
export interface ManifestCnctJson {
  id: "cnct";
  title: string;
  sigla: "CNCT";
  tipo: "catalogo_nacional_cursos_tecnicos";
  tipo_item: "curso_tecnico_cnct";
  schema_version: number;
  edicao: string;
  atualizacao_referencia: string;
  atualizado_em: string;
  fonte: string;
  fonte_url: string;
  atos_normativos_url: string;
  catalogo_pdf_url: string;
  csv_origem_sha256: string;
  total_cursos: number;
  index_path: string;
  /**
   * @minItems 1
   */
  campos_curso: string[];
  /**
   * @minItems 1
   */
  uso_recomendado: string[];
}

/**
 * Manifesto institucional (schemas/institucional_manifest.schema.json).
 */
export interface ManifestInstitucionalJson {
  title: string;
  tipo: "cadastro_institucional";
  versao: number;
  atualizado_em: string;
  /**
   * @minItems 1
   */
  colecoes: {
    id: string;
    title: string;
    tipo_item: "campus" | "processo_seletivo" | "referencia_institucional" | "ppc" | "ppcp";
    path: string;
    total_itens: number;
  }[];
}

/**
 * Índice de PPCPs da Rede Certifica (schemas/ppcps_index.schema.json).
 */
export interface IndicePpcpsJson {
  collection: "ppcps-rede-certifica-ifpr";
  title: string;
  updated_at: string;
  total_itens: number;
  /**
   * @minItems 1
   */
  items: {
    id: string;
    title: string;
    tipo: string;
    status: string;
    path: string;
  }[];
}

/**
 * Índice de PPCs do IFPR (schemas/ppcs_index.schema.json).
 */
export interface IndicePpcsJson {
  title: string;
  tipo: "indice_ppcs";
  versao: number;
  atualizado_em: string;
  total_itens: number;
  secoes: {
    preview_limite: 500;
    paths: {
      avaliacao: "institucional/ifpr/ppcs/secoes/avaliacao.jsonl";
      concepcao_pedagogica: "institucional/ifpr/ppcs/secoes/concepcao_pedagogica.jsonl";
      corpo_docente: "institucional/ifpr/ppcs/secoes/corpo_docente.jsonl";
      ementas: "institucional/ifpr/ppcs/secoes/ementas.jsonl";
      estagio_praticas: "institucional/ifpr/ppcs/secoes/estagio_praticas.jsonl";
      identificacao: "institucional/ifpr/ppcs/secoes/identificacao.jsonl";
      infraestrutura: "institucional/ifpr/ppcs/secoes/infraestrutura.jsonl";
      justificativa: "institucional/ifpr/ppcs/secoes/justificativa.jsonl";
      matriz_curricular: "institucional/ifpr/ppcs/secoes/matriz_curricular.jsonl";
      objetivos: "institucional/ifpr/ppcs/secoes/objetivos.jsonl";
      organizacao_curricular: "institucional/ifpr/ppcs/secoes/organizacao_curricular.jsonl";
      perfil_egresso: "institucional/ifpr/ppcs/secoes/perfil_egresso.jsonl";
      referencias: "institucional/ifpr/ppcs/secoes/referencias.jsonl";
    };
  };
  /**
   * @minItems 1
   */
  items: {
    id: string;
    campus_id: string;
    campus_nome: string;
    curso_slug: string;
    curso_nome: string;
    nivel: string;
    tipo_oferta: string;
    modalidade?: string;
    situacao?: string;
    ano_documento?: number;
    vagas?: number;
    curso_url: string;
    fonte_pdf: string;
    path: string;
  }[];
}

/**
 * Processo seletivo do IFPR (schemas/processo_seletivo.schema.json).
 */
export interface ProcessoSeletivoJson {
  id: string;
  nome: string;
  ano_ingresso: number;
  instituicao: "IFPR";
  /**
   * @minItems 1
   */
  fontes: string[];
  editais: {
    id: string;
    titulo: string;
    numero?: string;
    ano?: number;
    tipo?:
      | "integrado"
      | "subsequente"
      | "técnico integrado"
      | "técnico subsequente"
      | "técnico ead"
      | "graduação"
      | "vagas remanescentes"
      | "outro";
    url: string;
  }[];
  ofertas: {
    id: string;
    campus_id: string;
    curso_slug?: string;
    curso_nome: string;
    tipo_oferta:
      | "integrado"
      | "subsequente"
      | "técnico integrado"
      | "técnico subsequente"
      | "graduação tecnológica"
      | "bacharelado"
      | "licenciatura"
      | "especialização"
      | "mestrado"
      | "FIC"
      | "outro";
    modalidade?: "presencial" | "ead" | "semipresencial";
    turno?: string;
    vagas: {
      quantidade: number;
      forma_oferta?: string;
      trecho_fonte: string;
      pagina?: number;
      status_curadoria: "precisa_revisao" | "revisado" | "inconsistente" | "pendente";
      revisado_em?: string;
    };
    cotas?: {
      categoria: string;
      vagas: number;
    }[];
    fonte: {
      edital_id?: string;
      url: string;
      pagina?: number;
    };
  }[];
  curadoria: {
    status_ofertas: "dados_pendentes" | "dados_parciais" | "dados_curados";
    observacoes?: string;
    verificado_em: string;
  };
}

/**
 * Índice de processos seletivos do IFPR (schemas/processos_seletivos_index.schema.json).
 */
export interface IndiceProcessosSeletivosJson {
  title: string;
  total_itens: number;
  /**
   * @minItems 1
   */
  items: {
    id: string;
    ano_ingresso: number;
    nome: string;
    path: string;
  }[];
}
