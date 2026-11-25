/**
 * O Explorar do app: a navegação pela base inteira, sem IA, offline e instantânea. Dois RPCs do
 * `GrupoLeitura`, sem ferramenta MCP (a IA já tem `buscar_norma`, `listar_cursos`, `buscar_secoes` e
 * as fichas, com o texto no orçamento dela; o índice inteiro e a paleta de busca são para a tela):
 *
 * - `explorarIndice`: as coleções inteiras (normas, cursos, PPCs, campi, CNCT, processos seletivos e
 *   as reuniões do Consepe com os itens de pauta), com os campos dos filtros. As fichas da revisão de
 *   PPC não são coleção: são critério interno da revisão. É pequeno (algumas centenas de KB) e não muda com o servidor no ar: a interface lê uma
 *   vez e filtra na memória;
 * - `explorarBuscar`: a busca da paleta (Ctrl/Cmd+K), com os resultados agrupados por tipo. Uma
 *   citação ("Res. CNE/CP 1/2021, art. 20") ou um ID vai direto ao dispositivo, pela mesma regra do
 *   `buscar_norma`; o texto das seções dos PPCs vem do FTS do banco.
 *
 * As páginas de curso, campus, CNCT e ficha usam os RPCs que já existiam (`fichaCurso`, `lerCampus`,
 * `lerCnct`, `lerFicha`) e completam com o índice (horários do campus, itens do Consepe).
 *
 * Só schemas: este módulo entra no grafo do `grupo-leitura.ts`, que a interface importa, e não pode
 * importar o `kb` nem módulos do Node. A leitura fica em `leitura/explorar.ts`.
 */
import * as Schema from "effect/Schema";
import { EsquemaLink, Resposta } from "./contratos.ts";

const Texto = Schema.NullOr(Schema.String);
const Inteiro = Schema.NullOr(Schema.Int);

/* ================================================================== índice */

export const NormaDoIndice = Schema.Struct({
  id: Schema.String,
  titulo: Schema.String,
  /** `lei`, `resolucao`, `portaria`… como no manifesto. */
  tipo: Texto,
  numero: Texto,
  ano: Inteiro,
  orgao: Texto,
  /** `base` (com texto), `stub` (só a identificação) ou `externo`. */
  situacao: Schema.Literals(["base", "stub", "externo"]),
  /** O status publicado na data de referência da base (`vigente`, `revogada`…). */
  status_vigencia: Texto,
  ementa: Texto,
  apelidos: Schema.Array(Schema.String),
  link: EsquemaLink,
});
export type NormaDoIndice = typeof NormaDoIndice.Type;

export const CursoDoIndice = Schema.Struct({
  /** `campus/curso`, sem prefixo. */
  id: Schema.String,
  nome: Schema.String,
  campus: Schema.String,
  campus_nome: Schema.String,
  nivel: Texto,
  forma_oferta: Texto,
  modalidade: Texto,
  situacao: Texto,
  cnct: Schema.NullOr(Schema.Struct({ slug: Schema.String, nome: Schema.String, eixo: Texto })),
  /** A chave do PPC vigente (`campus/curso/versao`) e o ano do documento; `null` sem PPC na base. */
  ppc: Schema.NullOr(Schema.Struct({ chave: Schema.String, ano: Inteiro })),
  /** Vínculo do curso com o SUAP (código, matrizes ativas e divergências com o PPC vigente); `null` sem SUAP. */
  suap: Schema.NullOr(
    Schema.Struct({
      id: Schema.Int,
      codigo: Texto,
      matrizes: Schema.Int,
      divergencias: Schema.Int,
    }),
  ),
  /** Turnos das ofertas registradas, sem repetição. */
  turnos: Schema.Array(Schema.String),
  /** Processos seletivos das ofertas (`processo-seletivo-2026`). */
  processos: Schema.Array(Schema.String),
  pagina_oficial: Texto,
  link: EsquemaLink,
});
export type CursoDoIndice = typeof CursoDoIndice.Type;

export const PpcDoIndice = Schema.Struct({
  /** `campus/curso/versao`: o ID permanente do PPC. */
  chave: Schema.String,
  /** A versão: o ano do documento, com sufixo (`2023-2`) se o curso tem dois PPCs do mesmo ano. */
  versao: Schema.String,
  /** O PPC que o curso aponta; os demais são substituídos e ficam na base. */
  vigente: Schema.Boolean,
  /** Link da versão seguinte, nos substituídos. */
  substituido_por: Schema.NullOr(EsquemaLink),
  nome: Schema.String,
  campus: Schema.String,
  campus_nome: Schema.String,
  nivel: Schema.String,
  /** A forma de oferta do índice dos PPCs (`integrado`, `subsequente`, `bacharelado`…). */
  forma: Schema.String,
  ano: Inteiro,
  /** O PDF publicado de onde veio o texto do PPC (todo PPC da base tem; o banco de teste, nem sempre). */
  fonte_url: Schema.NullOr(Schema.String),
  /** O curso ligado ao PPC, quando há. */
  curso: Schema.NullOr(EsquemaLink),
  link: EsquemaLink,
});
export type PpcDoIndice = typeof PpcDoIndice.Type;

export const CampusDoIndice = Schema.Struct({
  id: Schema.String,
  nome: Schema.String,
  site: Texto,
  calendario_academico: Texto,
  /** A página pública dos horários de aula, quando a curadoria a registrou. */
  horarios_url: Texto,
  horarios_coletado_em: Texto,
  link: EsquemaLink,
});
export type CampusDoIndice = typeof CampusDoIndice.Type;

export const CnctDoIndice = Schema.Struct({
  slug: Schema.String,
  denominacao: Schema.String,
  eixo: Schema.String,
  area: Texto,
  carga_horaria_minima: Inteiro,
  link: EsquemaLink,
});
export type CnctDoIndice = typeof CnctDoIndice.Type;

export const ProcessoDoIndice = Schema.Struct({ id: Schema.String, nome: Schema.String, ano_ingresso: Inteiro });
export type ProcessoDoIndice = typeof ProcessoDoIndice.Type;

export const DocumentoConselho = Schema.Struct({
  id: Schema.String,
  /** `pauta`, `parecer`… */
  tipo: Schema.String,
  titulo: Schema.String,
  numero: Texto,
  data: Texto,
  resumo: Texto,
  /** A publicação oficial (site do IFPR ou publicação do SEI). */
  url: Texto,
});
export type DocumentoConselho = typeof DocumentoConselho.Type;

export const ItemDePauta = Schema.Struct({
  id: Schema.String,
  ordem: Schema.Int,
  titulo: Schema.String,
  resumo: Texto,
  /** `Abertura de curso`, `Ajuste curricular`, `Suspensão de curso`… */
  tipo_demanda: Texto,
  resultado: Texto,
  documento: Texto,
  processo_sei: Texto,
  campus_texto: Texto,
  campus: Texto,
  curso_texto: Texto,
  /** O curso do registro (`campus/curso`), quando a curadoria ligou o item a ele. */
  curso: Texto,
});
export type ItemDePauta = typeof ItemDePauta.Type;

export const ReuniaoDoIndice = Schema.Struct({
  /** `consepe:reuniao:2026-03-20`. */
  id: Schema.String,
  conselho: Schema.String,
  conselho_nome: Schema.String,
  data: Schema.String,
  titulo: Schema.String,
  tipo: Texto,
  situacao: Texto,
  /** A página oficial da pauta. */
  fonte: Texto,
  documentos: Schema.Array(DocumentoConselho),
  itens: Schema.Array(ItemDePauta),
});
export type ReuniaoDoIndice = typeof ReuniaoDoIndice.Type;

export const EntradaIndice = Schema.Struct({});

export const DadosIndice = Schema.Struct({
  normas: Schema.Array(NormaDoIndice),
  cursos: Schema.Array(CursoDoIndice),
  ppcs: Schema.Array(PpcDoIndice),
  campi: Schema.Array(CampusDoIndice),
  cnct: Schema.Array(CnctDoIndice),
  processos: Schema.Array(ProcessoDoIndice),
  /** Mais recente primeiro. */
  reunioes: Schema.Array(ReuniaoDoIndice),
});
export type DadosIndice = typeof DadosIndice.Type;

export const SaidaIndice = Resposta(DadosIndice);

/* ================================================================== busca */

const TIPOS_RESULTADO = ["dispositivo", "norma", "curso", "ppc", "secao", "campus", "cnct", "consepe"] as const;
export type TipoResultado = (typeof TIPOS_RESULTADO)[number];

export const EntradaBusca = Schema.Struct({
  consulta: Schema.String.check(Schema.isMaxLength(300)),
  /** Resultados por grupo (1 a 20). */
  limite: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 })),
});

export const ResultadoBusca = Schema.Struct({
  tipo: Schema.Literals(TIPOS_RESULTADO),
  titulo: Schema.String,
  /** Uma linha de contexto: campus e nível, situação da norma, nome do PPC da seção… */
  detalhe: Texto,
  /** O trecho do texto em que a consulta aparece (dispositivo, seção, ementa). */
  trecho: Texto,
  /** O link `ifpr://` que a página abre; `null` no Consepe, que não tem link (abre por `reuniao`). */
  link: Schema.NullOr(EsquemaLink),
  /** A reunião do Consepe (`consepe:reuniao:…`) no tipo `consepe`. */
  reuniao: Texto,
});
export type ResultadoBusca = typeof ResultadoBusca.Type;

export const GrupoBusca = Schema.Struct({
  tipo: Schema.Literals(TIPOS_RESULTADO),
  resultados: Schema.Array(ResultadoBusca),
});
export type GrupoBusca = typeof GrupoBusca.Type;

export const DadosBusca = Schema.Struct({
  /** Os grupos com resultado, na ordem de exibição (a citação resolvida primeiro). */
  grupos: Schema.Array(GrupoBusca),
});
export type DadosBusca = typeof DadosBusca.Type;

export const SaidaBusca = Resposta(DadosBusca);
