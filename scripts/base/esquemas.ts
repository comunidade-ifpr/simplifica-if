/**
 * Contratos dos manifestos e índices da base em Effect Schema: o catálogo do CNCT (manifesto, índice
 * e curso) e os índices de PPCs (`ppcs/index.json` e cada linha de `secoes/<tipo>.jsonl`).
 *
 * O Effect Schema é a fonte única do formato e dos tipos. Todos os objetos são estritos: a
 * conferência decodifica com `ESTRITO`, e chave a mais é erro. As regras que cruzam arquivos (id
 * duplicado, item divergente do registro, caminho inexistente) ficam em `validacao/`.
 */
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { caminhoTexto, problemas } from "@simplifica-if/kb/esquema/mensagens";
import { PASTA_PPCS, RE_SLUG_PPC, RE_VERSAO_PPC } from "@simplifica-if/kb/ppcs/ids";
import { RE_TEM_ESPACO } from "@simplifica-if/kb/texto";
import { ESTRITO } from "../esquema.ts";

/** URL com esquema, autoridade (o trecho após `//`) não vazia e sem espaços; `esquema` em minúsculas. */
export function ehUrlAbsoluta(url: string, esquema?: string): boolean {
  if (RE_TEM_ESPACO.test(url)) return false;
  const partes = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)/.exec(url);
  const autoridade = partes?.[2];
  if (!partes || !autoridade) return false;
  if (autoridade.includes("[") !== autoridade.includes("]")) return false;
  return esquema === undefined || partes[1]!.toLowerCase() === esquema;
}

const padrao = (regex: RegExp, message: string) => Schema.String.check(Schema.isPattern(regex, { message }));

const texto = Schema.String.check(Schema.isMinLength(1));
const listaDeTextos = Schema.Array(texto).check(Schema.isMinLength(1));
const inteiroDesde = (minimo: number) => Schema.Int.check(Schema.isGreaterThanOrEqualTo(minimo));
const data = padrao(/^\d{4}-\d{2}-\d{2}$/, "deve estar em AAAA-MM-DD");
const uri = Schema.String.check(
  Schema.makeFilter((valor: string) => ehUrlAbsoluta(valor) || "deve ser URI absoluta válida"),
);
const urlHttps = uri.check(Schema.isPattern(/^https:\/\//, { message: "deve começar por https://" }));
const sha256 = padrao(/^[0-9a-f]{64}$/, "deve ser SHA-256 em hexadecimal minúsculo");

const slug = padrao(new RegExp(`^${RE_SLUG_PPC}$`), "deve ser slug ASCII minúsculo");
const denominacaoNormalizada = padrao(/^[a-z0-9]+(?: [a-z0-9]+)*$/, "deve ser texto ASCII minúsculo sem pontuação");
const codigosCbo = Schema.Array(padrao(/^\d{4}(?:-\d{2})?$/, "deve ser código CBO (0000 ou 0000-00)"));

// --- CNCT ---

export const esquemaCursoCnct = Schema.Struct({
  id: slug,
  indice: inteiroDesde(1),
  denominacao: texto,
  denominacao_normalizada: denominacaoNormalizada,
  eixo_tecnologico: texto,
  area_tecnologica: texto,
  carga_horaria_minima_horas: inteiroDesde(1),
  descricao_carga_horaria_minima: texto,
  perfil_profissional: texto,
  pre_requisitos_ingresso: texto,
  itinerarios_formativos: texto,
  campo_atuacao: texto,
  ocupacoes_cbo: texto,
  codigos_cbo: codigosCbo,
  infraestrutura_minima: texto,
  legislacao_profissional: texto,
});
export type CursoCnctJson = typeof esquemaCursoCnct.Type;

export const esquemaIndiceCnct = Schema.Struct({
  id: Schema.Literal("cnct-cursos"),
  title: texto,
  descricao: texto,
  tipo_item: Schema.Literal("curso_tecnico_cnct"),
  schema_version: inteiroDesde(1),
  atualizado_em: data,
  total_cursos: inteiroDesde(1),
  items: Schema.Array(
    Schema.Struct({
      id: slug,
      denominacao: texto,
      denominacao_normalizada: denominacaoNormalizada,
      eixo_tecnologico: texto,
      area_tecnologica: texto,
      carga_horaria_minima_horas: inteiroDesde(1),
      codigos_cbo: codigosCbo,
      path: padrao(
        new RegExp(`^catalogos/cnct/cursos/${RE_SLUG_PPC}\\.json$`),
        "deve ser catalogos/cnct/cursos/<id>.json",
      ),
    }),
  ).check(Schema.isMinLength(1)),
});
export type IndiceCnctJson = typeof esquemaIndiceCnct.Type;

export const esquemaManifestCnct = Schema.Struct({
  id: Schema.Literal("cnct"),
  title: texto,
  sigla: Schema.Literal("CNCT"),
  tipo: Schema.Literal("catalogo_nacional_cursos_tecnicos"),
  tipo_item: Schema.Literal("curso_tecnico_cnct"),
  schema_version: inteiroDesde(1),
  edicao: texto,
  atualizacao_referencia: texto,
  atualizado_em: data,
  fonte: texto,
  fonte_url: uri,
  atos_normativos_url: uri,
  catalogo_pdf_url: uri,
  csv_origem_sha256: sha256,
  total_cursos: inteiroDesde(1),
  index_path: Schema.Literal("catalogos/cnct/index.json"),
  campos_curso: listaDeTextos,
  uso_recomendado: listaDeTextos,
});
export type ManifestCnctJson = typeof esquemaManifestCnct.Type;

// --- PPCs ---

/** Tipos de seção com arquivo em `secoes/` (todos os das taxonomias, menos `outros` e `pretextual`). */
export const TIPOS_SECAO_COM_ARQUIVO = [
  "acessibilidade_inclusao",
  "acompanhamento_egresso",
  "anexos",
  "aproveitamento_estudos",
  "atendimento_estudante",
  "atividades_complementares",
  "avaliacao",
  "avaliacao_curso",
  "carga_horaria",
  "certificados_diplomas",
  "concepcao_pedagogica",
  "contexto_institucional",
  "corpo_docente",
  "ementas",
  "ensino_pesquisa_extensao",
  "estagio_praticas",
  "formato_oferta",
  "gestao_curso",
  "identificacao",
  "infraestrutura",
  "itinerario_formativo",
  "justificativa",
  "legislacao",
  "matriz_curricular",
  "mundo_trabalho",
  "objetivos",
  "organizacao_curricular",
  "perfil_egresso",
  "prazo_integralizacao",
  "referencias",
  "requisitos_acesso",
  "trabalho_conclusao",
] as const;
type TipoSecaoComArquivo = (typeof TIPOS_SECAO_COM_ARQUIVO)[number];

const tipoSecaoPublicado = Schema.Literals([...TIPOS_SECAO_COM_ARQUIVO, "outros", "pretextual"]);
const taxonomia = Schema.Literals(["tecnico", "geral"]);

const RE_CHAVE_PPC = `${RE_SLUG_PPC}/${RE_SLUG_PPC}/${RE_VERSAO_PPC}`;
const chavePpc = padrao(new RegExp(`^${RE_CHAVE_PPC}$`), "deve ser <campus>/<curso>/<versão>");
const caminhoMarkdownPpc = padrao(
  new RegExp(`^${PASTA_PPCS}/${RE_CHAVE_PPC}\\.md$`),
  `deve ser ${PASTA_PPCS}/<campus>/<curso>/<versão>.md`,
);

/** Um caminho fixo por tipo de seção: `secoes.paths` do índice. */
const caminhosSecoes = Schema.Struct(
  Object.fromEntries(
    TIPOS_SECAO_COM_ARQUIVO.map((tipo) => [tipo, Schema.Literal(`${PASTA_PPCS}/secoes/${tipo}.jsonl`)]),
  ) as { readonly [T in TipoSecaoComArquivo]: Schema.Literal<`${typeof PASTA_PPCS}/secoes/${T}.jsonl`> },
);

const taxonomiaPublicada = Schema.Struct({
  descricao: texto,
  niveis: listaDeTextos,
  tipos: Schema.Array(
    Schema.Struct({
      tipo: tipoSecaoPublicado,
      rotulo: texto,
      indexado: Schema.Boolean,
      art28: Schema.optionalKey(listaDeTextos),
    }),
  ).check(Schema.isMinLength(1)),
});

const itemPpc = Schema.Struct({
  id: chavePpc.annotate({
    description:
      "Chave permanente do PPC: <campus_id>/<curso_slug>/<versao>; a versão é o ano do documento, com sufixo -2, -3… no mesmo ano.",
  }),
  campus_id: slug,
  campus_nome: texto,
  curso_slug: slug,
  curso_nome: texto,
  versao: padrao(new RegExp(`^${RE_VERSAO_PPC}$`), "deve ser o ano, com sufixo -2, -3… no mesmo ano"),
  vigente: Schema.Boolean.annotate({
    description:
      "Se é o PPC que o registro do curso aponta (ppc.markdown_path). Os demais são versões substituídas, que ficam na base.",
  }),
  substituido_por: Schema.optionalKey(
    chavePpc.annotate({ description: "Chave da versão seguinte do PPC do mesmo curso (só nas substituídas)." }),
  ),
  nivel: texto,
  taxonomia,
  tipo_oferta: texto,
  modalidade: Schema.optionalKey(texto),
  situacao: Schema.optionalKey(texto),
  vagas: Schema.optionalKey(inteiroDesde(0)),
  curso_url: urlHttps,
  fonte_pdf: urlHttps,
  ano_documento: inteiroDesde(1900).annotate({
    description: "Ano do documento, do front matter do PPC; a versão do id começa por ele.",
  }),
  ano_evidencia: Schema.String.check(Schema.isMinLength(4)).annotate({
    description: "Trecho literal que traz o ano do documento.",
  }),
  ano_fonte: padrao(/^(?:texto|https:\/\/.+)$/, "deve ser texto ou uma URL https://").annotate({
    description: "texto quando a evidência está no corpo do PPC; senão, a URL da fonte.",
  }),
  path: caminhoMarkdownPpc,
  proveniencia: Schema.Struct({
    situacao: Schema.Literals(["registrada", "reconstruida"]),
    fonte_url: urlHttps,
    fonte_sha256: padrao(/^(?:[0-9a-f]{64}|desconhecido)$/, "deve ser SHA-256 em hexadecimal ou desconhecido"),
    arquivo_convertido: Schema.optionalKey(
      Schema.Struct({ tipo: Schema.Literal("docx"), sha256 }).annotate({
        description:
          "Arquivo que de fato foi convertido, quando não é o de fonte_url (o DOCX enviado pela coordenação do curso).",
      }),
    ),
    convertido_em: data,
    conversor: texto,
  }).annotate({ description: "Proveniência do Markdown convertido, lida do front matter do PPC." }),
});

export const esquemaIndicePpcs = Schema.Struct({
  title: texto,
  tipo: Schema.Literal("indice_ppcs"),
  versao: Schema.Literal(2),
  atualizado_em: data,
  total_itens: inteiroDesde(1),
  secoes: Schema.Struct({
    preview_limite: Schema.Literal(500),
    minimo_caracteres: Schema.Literal(40),
    paths: caminhosSecoes,
    taxonomias: Schema.Struct({ tecnico: taxonomiaPublicada, geral: taxonomiaPublicada }),
  }),
  items: Schema.Array(itemPpc).check(Schema.isMinLength(1)),
});
export type IndicePpcsJson = typeof esquemaIndicePpcs.Type;

export const esquemaSecaoPpc = Schema.Struct({
  id: padrao(new RegExp(`^${RE_CHAVE_PPC}#[a-z_]+-[1-9][0-9]*$`), "deve ser <ppc_id>#<tipo>-<n>"),
  ppc_id: chavePpc,
  campus_id: slug,
  curso_slug: slug,
  curso_nome: texto,
  nivel: texto,
  taxonomia,
  section_kind: Schema.Literals(TIPOS_SECAO_COM_ARQUIVO),
  origem_tipo: Schema.Literals(["titulo", "numeracao", "contexto"]).annotate({
    description:
      "Como o tipo foi decidido: pelo próprio título, herdado do título numerado ancestral (numeracao) ou da seção anterior (contexto).",
  }),
  heading: texto,
  numeracao: Schema.optionalKey(padrao(/^[0-9]+(?:\.[0-9]+)*$/, "deve ser numeração como 5.6.1")),
  path: caminhoMarkdownPpc,
  linha_inicio: inteiroDesde(1).annotate({
    description: "Linha do título no arquivo .md, contada desde 1 com o front matter.",
  }),
  linha_fim: inteiroDesde(1).annotate({ description: "Última linha não vazia do corpo da seção." }),
  preview: texto.check(Schema.isMaxLength(500)).annotate({
    description:
      "Primeiros 500 caracteres do texto limpo; o texto integral são as linhas linha_inicio–linha_fim do Markdown em path.",
  }),
});
export type SecaoPpcJson = typeof esquemaSecaoPpc.Type;

// --- Conferência ---

const decodificar = {
  manifestCnct: Schema.decodeUnknownResult(esquemaManifestCnct, ESTRITO),
  indiceCnct: Schema.decodeUnknownResult(esquemaIndiceCnct, ESTRITO),
  cursoCnct: Schema.decodeUnknownResult(esquemaCursoCnct, ESTRITO),
  indicePpcs: Schema.decodeUnknownResult(esquemaIndicePpcs, ESTRITO),
  secaoPpc: Schema.decodeUnknownResult(esquemaSecaoPpc, ESTRITO),
};

/** Formato de cada contrato, pelo nome. */
export type FormatosContratos = {
  manifestCnct: ManifestCnctJson;
  indiceCnct: IndiceCnctJson;
  cursoCnct: CursoCnctJson;
  indicePpcs: IndicePpcsJson;
  secaoPpc: SecaoPpcJson;
};
export type NomeContrato = keyof FormatosContratos;

/** Mensagens da conferência com o contrato e, se não houver nenhuma, os dados decodificados. */
export type Conferencia<T> = { erros: string[]; validos: T | null };

/** Confere `dados` com o contrato `nome`; cada problema vira `<rotulo>: <caminho>: <mensagem>`. */
export function conferirContrato<N extends NomeContrato>(
  nome: N,
  dados: unknown,
  rotulo: string,
): Conferencia<FormatosContratos[N]> {
  const resultado = (decodificar[nome] as (valor: unknown) => Result.Result<FormatosContratos[N], Schema.SchemaError>)(
    dados,
  );
  if (Result.isSuccess(resultado)) return { erros: [], validos: resultado.success };
  const erros = problemas(resultado.failure.issue).map(
    (problema) => `${rotulo}: ${caminhoTexto(problema.caminho) || "(raiz)"}: ${problema.mensagem}`,
  );
  return { erros, validos: null };
}
