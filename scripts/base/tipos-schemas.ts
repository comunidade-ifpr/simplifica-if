/**
 * Tipos dos JSON Schemas de base-conhecimento/schemas/. Arquivo gerado por
 * scripts/gerar_tipos_schemas.ts; não edite à mão. Depois de alterar um
 * schema, rode `node scripts/gerar_tipos_schemas.ts`.
 */

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
 * Índice de PPCs do IFPR (schemas/ppcs_index.schema.json).
 */
export interface IndicePpcsJson {
  title: string;
  tipo: "indice_ppcs";
  versao: 2;
  atualizado_em: string;
  total_itens: number;
  secoes: {
    preview_limite: 500;
    minimo_caracteres: 40;
    paths: {
      acessibilidade_inclusao: "institucional/ifpr/ppcs/secoes/acessibilidade_inclusao.jsonl";
      acompanhamento_egresso: "institucional/ifpr/ppcs/secoes/acompanhamento_egresso.jsonl";
      anexos: "institucional/ifpr/ppcs/secoes/anexos.jsonl";
      aproveitamento_estudos: "institucional/ifpr/ppcs/secoes/aproveitamento_estudos.jsonl";
      atendimento_estudante: "institucional/ifpr/ppcs/secoes/atendimento_estudante.jsonl";
      atividades_complementares: "institucional/ifpr/ppcs/secoes/atividades_complementares.jsonl";
      avaliacao: "institucional/ifpr/ppcs/secoes/avaliacao.jsonl";
      avaliacao_curso: "institucional/ifpr/ppcs/secoes/avaliacao_curso.jsonl";
      carga_horaria: "institucional/ifpr/ppcs/secoes/carga_horaria.jsonl";
      certificados_diplomas: "institucional/ifpr/ppcs/secoes/certificados_diplomas.jsonl";
      concepcao_pedagogica: "institucional/ifpr/ppcs/secoes/concepcao_pedagogica.jsonl";
      contexto_institucional: "institucional/ifpr/ppcs/secoes/contexto_institucional.jsonl";
      corpo_docente: "institucional/ifpr/ppcs/secoes/corpo_docente.jsonl";
      ementas: "institucional/ifpr/ppcs/secoes/ementas.jsonl";
      ensino_pesquisa_extensao: "institucional/ifpr/ppcs/secoes/ensino_pesquisa_extensao.jsonl";
      estagio_praticas: "institucional/ifpr/ppcs/secoes/estagio_praticas.jsonl";
      formato_oferta: "institucional/ifpr/ppcs/secoes/formato_oferta.jsonl";
      gestao_curso: "institucional/ifpr/ppcs/secoes/gestao_curso.jsonl";
      identificacao: "institucional/ifpr/ppcs/secoes/identificacao.jsonl";
      infraestrutura: "institucional/ifpr/ppcs/secoes/infraestrutura.jsonl";
      itinerario_formativo: "institucional/ifpr/ppcs/secoes/itinerario_formativo.jsonl";
      justificativa: "institucional/ifpr/ppcs/secoes/justificativa.jsonl";
      legislacao: "institucional/ifpr/ppcs/secoes/legislacao.jsonl";
      matriz_curricular: "institucional/ifpr/ppcs/secoes/matriz_curricular.jsonl";
      mundo_trabalho: "institucional/ifpr/ppcs/secoes/mundo_trabalho.jsonl";
      objetivos: "institucional/ifpr/ppcs/secoes/objetivos.jsonl";
      organizacao_curricular: "institucional/ifpr/ppcs/secoes/organizacao_curricular.jsonl";
      perfil_egresso: "institucional/ifpr/ppcs/secoes/perfil_egresso.jsonl";
      prazo_integralizacao: "institucional/ifpr/ppcs/secoes/prazo_integralizacao.jsonl";
      referencias: "institucional/ifpr/ppcs/secoes/referencias.jsonl";
      requisitos_acesso: "institucional/ifpr/ppcs/secoes/requisitos_acesso.jsonl";
      trabalho_conclusao: "institucional/ifpr/ppcs/secoes/trabalho_conclusao.jsonl";
    };
    taxonomias: {
      tecnico: {
        descricao: string;
        /**
         * @minItems 1
         */
        niveis: string[];
        /**
         * @minItems 1
         */
        tipos: {
          tipo:
            | "acessibilidade_inclusao"
            | "acompanhamento_egresso"
            | "anexos"
            | "aproveitamento_estudos"
            | "atendimento_estudante"
            | "atividades_complementares"
            | "avaliacao"
            | "avaliacao_curso"
            | "carga_horaria"
            | "certificados_diplomas"
            | "concepcao_pedagogica"
            | "contexto_institucional"
            | "corpo_docente"
            | "ementas"
            | "ensino_pesquisa_extensao"
            | "estagio_praticas"
            | "formato_oferta"
            | "gestao_curso"
            | "identificacao"
            | "infraestrutura"
            | "itinerario_formativo"
            | "justificativa"
            | "legislacao"
            | "matriz_curricular"
            | "mundo_trabalho"
            | "objetivos"
            | "organizacao_curricular"
            | "outros"
            | "perfil_egresso"
            | "prazo_integralizacao"
            | "pretextual"
            | "referencias"
            | "requisitos_acesso"
            | "trabalho_conclusao";
          rotulo: string;
          indexado: boolean;
          /**
           * @minItems 1
           */
          art28?: string[];
        }[];
      };
      geral: {
        descricao: string;
        /**
         * @minItems 1
         */
        niveis: string[];
        /**
         * @minItems 1
         */
        tipos: {
          tipo:
            | "acessibilidade_inclusao"
            | "acompanhamento_egresso"
            | "anexos"
            | "aproveitamento_estudos"
            | "atendimento_estudante"
            | "atividades_complementares"
            | "avaliacao"
            | "avaliacao_curso"
            | "carga_horaria"
            | "certificados_diplomas"
            | "concepcao_pedagogica"
            | "contexto_institucional"
            | "corpo_docente"
            | "ementas"
            | "ensino_pesquisa_extensao"
            | "estagio_praticas"
            | "formato_oferta"
            | "gestao_curso"
            | "identificacao"
            | "infraestrutura"
            | "itinerario_formativo"
            | "justificativa"
            | "legislacao"
            | "matriz_curricular"
            | "mundo_trabalho"
            | "objetivos"
            | "organizacao_curricular"
            | "outros"
            | "perfil_egresso"
            | "prazo_integralizacao"
            | "pretextual"
            | "referencias"
            | "requisitos_acesso"
            | "trabalho_conclusao";
          rotulo: string;
          indexado: boolean;
          /**
           * @minItems 1
           */
          art28?: string[];
        }[];
      };
    };
  };
  /**
   * @minItems 1
   */
  items: {
    /**
     * Chave permanente do PPC: <campus_id>/<curso_slug>/<versao>; a versão é o ano do documento, com sufixo -2, -3… no mesmo ano.
     */
    id: string;
    versao: string;
    /**
     * Se é o PPC que o registro do curso aponta (ppc.markdown_path). Os demais são versões substituídas, que ficam na base.
     */
    vigente: boolean;
    /**
     * Chave da versão seguinte do PPC do mesmo curso (só nas substituídas).
     */
    substituido_por?: string;
    campus_id: string;
    campus_nome: string;
    curso_slug: string;
    curso_nome: string;
    nivel: string;
    taxonomia: "tecnico" | "geral";
    tipo_oferta: string;
    modalidade?: string;
    situacao?: string;
    ano_documento?: number;
    vagas?: number;
    curso_url: string;
    fonte_pdf: string;
    path: string;
    /**
     * Proveniência do Markdown convertido, lida do front matter do PPC.
     */
    proveniencia: {
      situacao: "registrada" | "reconstruida";
      fonte_url: string;
      /**
       * SHA-256 dos bytes de fonte_url, ou desconhecido.
       */
      fonte_sha256: string;
      /**
       * Arquivo que de fato foi convertido, quando não é o de fonte_url (o DOCX enviado pela coordenação do curso), com o SHA-256 dos bytes.
       */
      arquivo_convertido?: {
        tipo: "docx";
        sha256: string;
      };
      convertido_em: string;
      conversor: string;
    };
  }[];
}

/**
 * Seção de PPC do IFPR (linha de secoes/<tipo>.jsonl) (schemas/ppcs_secao.schema.json).
 */
export interface SecaoPpcJson {
  id: string;
  ppc_id: string;
  campus_id: string;
  curso_slug: string;
  curso_nome: string;
  nivel: string;
  taxonomia: "tecnico" | "geral";
  section_kind:
    | "acessibilidade_inclusao"
    | "acompanhamento_egresso"
    | "anexos"
    | "aproveitamento_estudos"
    | "atendimento_estudante"
    | "atividades_complementares"
    | "avaliacao"
    | "avaliacao_curso"
    | "carga_horaria"
    | "certificados_diplomas"
    | "concepcao_pedagogica"
    | "contexto_institucional"
    | "corpo_docente"
    | "ementas"
    | "ensino_pesquisa_extensao"
    | "estagio_praticas"
    | "formato_oferta"
    | "gestao_curso"
    | "identificacao"
    | "infraestrutura"
    | "itinerario_formativo"
    | "justificativa"
    | "legislacao"
    | "matriz_curricular"
    | "mundo_trabalho"
    | "objetivos"
    | "organizacao_curricular"
    | "perfil_egresso"
    | "prazo_integralizacao"
    | "referencias"
    | "requisitos_acesso"
    | "trabalho_conclusao";
  /**
   * Como o tipo foi decidido: pelo próprio título, herdado do título numerado ancestral (numeracao) ou da seção anterior (contexto).
   */
  origem_tipo: "titulo" | "numeracao" | "contexto";
  heading: string;
  numeracao?: string;
  path: string;
  /**
   * Linha do título no arquivo .md, contada desde 1 com o front matter.
   */
  linha_inicio: number;
  /**
   * Última linha não vazia do corpo da seção.
   */
  linha_fim: number;
  /**
   * Primeiros 500 caracteres do texto limpo; o texto integral são as linhas linha_inicio–linha_fim do Markdown em path.
   */
  preview: string;
}
