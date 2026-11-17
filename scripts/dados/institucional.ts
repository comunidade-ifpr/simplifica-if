// @effect-diagnostics nodeBuiltinImport:off -- leitura e gravação síncronas dos registros institucionais, usadas pelo pipeline da base, pela exportação e pela coleta do SUAP
/**
 * Fonte de verdade dos dados institucionais: campi, cursos, processos seletivos, editais e ofertas
 * de ingresso. Cada registro é um arquivo JSON em `base-conhecimento/institucional/ifpr/<coleção>/`,
 * versionado no git e publicado como está. As relações usam chaves canônicas (`campus_id`,
 * `campus_id/curso_slug`, `processo_seletivo_id`, `edital_id`), nunca IDs de página do Notion;
 * `notion_page_id` fica só como referência histórica. O `index.json` de cada coleção é gerado
 * (`indices.ts`) e não é registro.
 *
 * Este módulo lê, valida e grava esses arquivos e os converte nas entidades do domínio que a
 * auditoria usa.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { caminhoTexto, problemas } from "@simplifica-if/kb/esquema/mensagens";
import { RAIZ_PROJETO } from "../config.ts";
import { ESTRITO } from "../esquema.ts";
import { limparUrlsAssinadas } from "./urls.ts";
import { compararTexto } from "../dominio/comum.ts";
import { ehIdCnct } from "@simplifica-if/kb/normas/ids";
import { chaveCurso, type Campus, type Curso } from "../dominio/curso.ts";
import {
  ehTurno,
  TURNOS,
  type EditalIngresso,
  type OfertaIngresso,
  type ProcessoSeletivo,
} from "../dominio/ingresso.ts";

export const RAIZ_DADOS_INSTITUCIONAIS = NodePath.join(RAIZ_PROJETO, "base-conhecimento", "institucional", "ifpr");
/** Prefixo dos caminhos nas mensagens: relativo a `base-conhecimento/`, como os `path` dos manifestos. */
const PREFIXO = "institucional/ifpr";
/** O índice gerado de cada coleção, que não é registro. */
export const ARQUIVO_INDICE = "index.json";

// Todos os objetos são estritos (chave a mais é erro): os registros decodificam com `ESTRITO`.
const texto = Schema.optional(Schema.String);
const inteiro = Schema.optional(Schema.Int);
const listaTexto = Schema.optional(Schema.Array(Schema.String));

export const esquemaCampusLocal = Schema.Struct({
  campus_id: Schema.String,
  nome: Schema.String,
  site: texto,
  calendario_academico: texto,
  horarios_url: texto,
  horarios_coletado_em: texto,
  notion_page_id: texto,
});
export type CampusLocal = typeof esquemaCampusLocal.Type;

/** `cnct:<slug>` de um curso do CNCT; `cnct:catalogo` cita o catálogo inteiro e não serve aqui. */
const cnctId = Schema.optional(
  Schema.String.check(
    Schema.makeFilter((valor: string) => ehIdCnct(valor) && valor !== "cnct:catalogo", {
      message: "deve ser cnct:<slug do curso no CNCT>",
    }),
  ),
);

export const esquemaCursoLocal = Schema.Struct({
  campus_id: Schema.String,
  curso_slug: Schema.String,
  nome: Schema.String,
  nivel: texto,
  forma_oferta: texto,
  modalidade: texto,
  situacao: texto,
  pagina_oficial: texto,
  /** Habilitação do CNCT do curso técnico. */
  cnct_id: cnctId,
  /** Motivo de um curso técnico não ter habilitação no CNCT; exclui `cnct_id`. */
  cnct_ausencia: texto,
  suap: Schema.optional(
    Schema.Struct({
      id: inteiro,
      codigo: texto,
      vagas: inteiro,
      coletado_em: texto,
      atualizado_em: texto,
      matrizes: Schema.optional(
        Schema.Struct({
          resumo: texto,
          urls: listaTexto,
          carga_horaria_comum_h: inteiro,
          situacao: texto,
          coletado_em: texto,
        }),
      ),
    }),
  ),
  ppc: Schema.optional(
    Schema.Struct({
      url: texto,
      markdown_path: texto,
      ano_documento: inteiro,
      vagas: texto,
      trecho_vagas: texto,
      periodicidade_vagas: texto,
      /** Status e data da curadoria de `ano_documento`. */
      curadoria_ano: texto,
      data_curadoria_ano: texto,
      /** Status e data da curadoria de `vagas`, `trecho_vagas` e `periodicidade_vagas`. */
      curadoria_vagas: texto,
      data_curadoria_vagas: texto,
      observacoes: texto,
    }),
  ),
  notion_page_id: texto,
});
export type CursoLocal = typeof esquemaCursoLocal.Type;

export const esquemaProcessoLocal = Schema.Struct({
  processo_seletivo_id: Schema.String,
  nome: Schema.String,
  ano_ingresso: inteiro,
  instituicao: texto,
  fontes: Schema.Array(Schema.String),
  status_curadoria: texto,
  verificado_em: texto,
  observacoes: texto,
  notion_page_id: texto,
});
export type ProcessoLocal = typeof esquemaProcessoLocal.Type;

export const esquemaEditalLocal = Schema.Struct({
  edital_id: Schema.String,
  titulo: Schema.String,
  url: Schema.String,
  numero: texto,
  ano: inteiro,
  tipo: texto,
  processos: Schema.Array(Schema.String),
  notion_page_id: texto,
});
export type EditalLocal = typeof esquemaEditalLocal.Type;

export const esquemaOfertaLocal = Schema.Struct({
  oferta_id: Schema.String,
  processos: Schema.Array(Schema.String),
  curso_nome: Schema.String,
  tipo_oferta: Schema.String,
  vagas: inteiro,
  url_fonte: Schema.String,
  pagina_fonte: inteiro,
  trecho_fonte: texto,
  forma_oferta: texto,
  status_curadoria: texto,
  revisado_em: texto,
  modalidade: texto,
  /** Grafia do turno na fonte (`trecho_fonte`), com as marcas de nota de rodapé. */
  turno: texto,
  /** Turno padronizado (enum); o texto da nota de rodapé e as divergências ficam em `turno_nota`. */
  turno_padronizado: Schema.optional(Schema.Literals(TURNOS)),
  turno_nota: texto,
  /** Relações resolvidas; prevalecem sobre os campos `_original`, que guardam o texto do edital. */
  campi: listaTexto,
  cursos: listaTexto,
  editais: listaTexto,
  campus_id_original: texto,
  curso_slug_original: texto,
  notion_page_id: texto,
});
export type OfertaLocal = typeof esquemaOfertaLocal.Type;

/** Decodificadores de cada coleção, com todos os problemas e chave a mais como erro. */
const decodificar = {
  campus: Schema.decodeUnknownResult(esquemaCampusLocal, ESTRITO),
  curso: Schema.decodeUnknownResult(esquemaCursoLocal, ESTRITO),
  processo: Schema.decodeUnknownResult(esquemaProcessoLocal, ESTRITO),
  edital: Schema.decodeUnknownResult(esquemaEditalLocal, ESTRITO),
  oferta: Schema.decodeUnknownResult(esquemaOfertaLocal, ESTRITO),
};

export interface DadosInstitucionais {
  campi: CampusLocal[];
  cursos: CursoLocal[];
  processos: ProcessoLocal[];
  editais: EditalLocal[];
  ofertas: OfertaLocal[];
}

/** Caminho de cada registro, relativo a `institucional/ifpr/`; o nome do arquivo é a chave canônica. */
export const caminhosRegistro = {
  campus: (c: CampusLocal) => NodePath.join("campi", `${c.campus_id}.json`),
  curso: (c: CursoLocal) => NodePath.join("cursos", c.campus_id, `${c.curso_slug}.json`),
  processo: (p: ProcessoLocal) => NodePath.join("processos-seletivos", `${p.processo_seletivo_id}.json`),
  edital: (e: EditalLocal) => NodePath.join("editais", `${e.edital_id}.json`),
  oferta: (o: OfertaLocal) => NodePath.join("ofertas", o.processos[0] ?? "sem-processo", `${o.oferta_id}.json`),
};

/* ------------------------------------------------------------------ leitura */

function arquivosJson(dir: string): string[] {
  if (!NodeFS.existsSync(dir)) return [];
  return NodeFS.readdirSync(dir, { withFileTypes: true })
    .flatMap((entrada) => {
      const caminho = NodePath.join(dir, entrada.name);
      if (entrada.isDirectory()) return arquivosJson(caminho);
      return entrada.name.endsWith(".json") && entrada.name !== ARQUIVO_INDICE ? [caminho] : [];
    })
    .sort(compararTexto);
}

function lerColecao<T>(
  raiz: string,
  subdir: string,
  decodificarRegistro: (valor: unknown) => Result.Result<T, Schema.SchemaError>,
  caminhoEsperado: (item: T) => string,
  erros: string[],
): T[] {
  const itens: T[] = [];
  for (const arquivo of arquivosJson(NodePath.join(raiz, subdir))) {
    const relativo = NodePath.relative(raiz, arquivo);
    let bruto: unknown;
    try {
      bruto = JSON.parse(NodeFS.readFileSync(arquivo, "utf-8"));
    } catch (erro) {
      erros.push(`${PREFIXO}/${relativo}: JSON inválido: ${(erro as Error).message}`);
      continue;
    }
    const resultado = decodificarRegistro(bruto);
    if (Result.isFailure(resultado)) {
      for (const problema of problemas(resultado.failure.issue)) {
        erros.push(`${PREFIXO}/${relativo}: ${caminhoTexto(problema.caminho) || "(raiz)"}: ${problema.mensagem}`);
      }
      continue;
    }
    const esperado = caminhoEsperado(resultado.success);
    if (esperado !== relativo) {
      erros.push(`${PREFIXO}/${relativo}: arquivo deveria estar em ${PREFIXO}/${esperado}`);
    }
    itens.push(resultado.success);
  }
  return itens;
}

/** Lê e valida todos os registros. A lista de erros cobre JSON, schema e caminho do arquivo. */
export function carregarDadosInstitucionais(raiz: string = RAIZ_DADOS_INSTITUCIONAIS): {
  dados: DadosInstitucionais;
  erros: string[];
} {
  const erros: string[] = [];
  if (!NodeFS.existsSync(raiz)) return { dados: vazio(), erros: [`${PREFIXO}/ não encontrado em ${raiz}`] };
  const dados: DadosInstitucionais = {
    campi: lerColecao(raiz, "campi", decodificar.campus, caminhosRegistro.campus, erros),
    cursos: lerColecao(raiz, "cursos", decodificar.curso, caminhosRegistro.curso, erros),
    processos: lerColecao(raiz, "processos-seletivos", decodificar.processo, caminhosRegistro.processo, erros),
    editais: lerColecao(raiz, "editais", decodificar.edital, caminhosRegistro.edital, erros),
    ofertas: lerColecao(raiz, "ofertas", decodificar.oferta, caminhosRegistro.oferta, erros),
  };
  return { dados, erros };
}

function vazio(): DadosInstitucionais {
  return { campi: [], cursos: [], processos: [], editais: [], ofertas: [] };
}

/* ------------------------------------------------------------------ gravação */

/** Remove campos vazios, para que dado ausente seja chave ausente também nos arquivos de origem. */
function semVazios<T>(valor: T): T {
  if (Array.isArray(valor)) return valor.map(semVazios) as T;
  if (valor && typeof valor === "object") {
    const entradas = Object.entries(valor as Record<string, unknown>)
      .map(([chave, item]) => [chave, semVazios(item)] as const)
      .filter(([, item]) => {
        if (item === undefined || item === null || item === "") return false;
        if (typeof item === "object" && !Array.isArray(item) && !Object.keys(item).length) return false;
        return true;
      });
    return Object.fromEntries(entradas) as T;
  }
  return valor;
}

/** Texto do arquivo de um registro: sem campos vazios e sem a query de URL pré-assinada (veja `urls.ts`). */
export function textoRegistro(registro: unknown): string {
  return `${JSON.stringify(limparUrlsAssinadas(semVazios(registro)), null, 2)}\n`;
}

export function gravarRegistro(relativo: string, registro: unknown, raiz: string = RAIZ_DADOS_INSTITUCIONAIS): void {
  const destino = NodePath.join(raiz, relativo);
  NodeFS.mkdirSync(NodePath.dirname(destino), { recursive: true });
  NodeFS.writeFileSync(destino, textoRegistro(registro), "utf-8");
}

export function gravarDadosInstitucionais(
  dados: DadosInstitucionais,
  raiz: string = RAIZ_DADOS_INSTITUCIONAIS,
): number {
  const registros: Array<[string, unknown]> = [
    ...dados.campi.map((item): [string, unknown] => [caminhosRegistro.campus(item), item]),
    ...dados.cursos.map((item): [string, unknown] => [caminhosRegistro.curso(item), item]),
    ...dados.processos.map((item): [string, unknown] => [caminhosRegistro.processo(item), item]),
    ...dados.editais.map((item): [string, unknown] => [caminhosRegistro.edital(item), item]),
    ...dados.ofertas.map((item): [string, unknown] => [caminhosRegistro.oferta(item), item]),
  ];
  for (const [relativo, registro] of registros) gravarRegistro(relativo, registro, raiz);
  return registros.length;
}

/* ------------------------------------------------------------------ domínio */

/** Converte os registros locais nas entidades do domínio, com as chaves canônicas como `id`. */
export function paraDominio(dados: DadosInstitucionais): {
  campi: Campus[];
  cursos: Curso[];
  processos: ProcessoSeletivo[];
  editais: EditalIngresso[];
  ofertas: OfertaIngresso[];
} {
  return {
    campi: dados.campi.map((c): Campus => ({
      id: c.campus_id,
      titulo: c.nome,
      campusId: c.campus_id,
      nome: c.nome,
      site: c.site ?? "",
      calendarioAcademico: c.calendario_academico ?? "",
      horariosColetadoEm: c.horarios_coletado_em ?? "",
      horariosUrl: c.horarios_url ?? "",
    })),
    cursos: dados.cursos.map((c): Curso => ({
      id: chaveCurso(c.campus_id, c.curso_slug),
      notionPageId: c.notion_page_id ?? "",
      titulo: c.nome,
      slug: c.curso_slug,
      nome: c.nome,
      nivel: c.nivel ?? "",
      tipoOferta: c.forma_oferta ?? "",
      paginaOficial: c.pagina_oficial ?? "",
      modalidade: c.modalidade ?? "",
      situacao: c.situacao ?? "",
      cnctId: c.cnct_id ?? "",
      cnctAusencia: c.cnct_ausencia ?? "",
      campusIds: [c.campus_id],
      suap: {
        id: c.suap?.id,
        codigo: c.suap?.codigo ?? "",
        vagas: c.suap?.vagas,
        coletadoEm: c.suap?.coletado_em ?? "",
        atualizadoEm: c.suap?.atualizado_em ?? "",
        matrizes: {
          resumo: c.suap?.matrizes?.resumo ?? "",
          urls: (c.suap?.matrizes?.urls ?? []).join("\n"),
          cargaHorariaComumH: c.suap?.matrizes?.carga_horaria_comum_h,
          situacao: c.suap?.matrizes?.situacao ?? "",
          coletadoEm: c.suap?.matrizes?.coletado_em ?? "",
        },
      },
      ppc: {
        url: c.ppc?.url ?? "",
        markdownPath: c.ppc?.markdown_path ?? "",
        anoDocumento: c.ppc?.ano_documento,
        vagas: c.ppc?.vagas ?? "",
        trechoVagas: c.ppc?.trecho_vagas ?? "",
        periodicidadeVagas: c.ppc?.periodicidade_vagas ?? "",
        curadoriaAno: c.ppc?.curadoria_ano ?? "",
        dataCuradoriaAno: c.ppc?.data_curadoria_ano ?? "",
        curadoriaVagas: c.ppc?.curadoria_vagas ?? "",
        dataCuradoriaVagas: c.ppc?.data_curadoria_vagas ?? "",
      },
    })),
    processos: dados.processos.map((p): ProcessoSeletivo => ({
      id: p.processo_seletivo_id,
      titulo: p.nome,
      processoSeletivoId: p.processo_seletivo_id,
      nome: p.nome,
      anoIngresso: p.ano_ingresso,
      instituicao: p.instituicao ?? "",
      fontes: [...p.fontes],
      statusCuradoria: p.status_curadoria ?? "",
      verificadoEm: p.verificado_em ?? "",
      observacoes: p.observacoes ?? "",
    })),
    editais: dados.editais.map((e): EditalIngresso => ({
      id: e.edital_id,
      titulo: e.titulo,
      editalId: e.edital_id,
      url: e.url,
      numero: e.numero ?? "",
      ano: e.ano,
      tipo: e.tipo ?? "",
      processoIds: [...e.processos],
    })),
    ofertas: dados.ofertas.map((o): OfertaIngresso => ({
      id: `${o.processos[0] ?? ""}/${o.oferta_id}`,
      titulo: o.oferta_id,
      ofertaId: o.oferta_id,
      cursoNome: o.curso_nome,
      tipoOferta: o.tipo_oferta,
      vagas: o.vagas,
      urlFonte: o.url_fonte,
      paginaFonte: o.pagina_fonte,
      trechoFonte: o.trecho_fonte ?? "",
      formaOferta: o.forma_oferta ?? "",
      statusCuradoria: o.status_curadoria ?? "",
      revisadoEm: o.revisado_em ?? "",
      modalidade: o.modalidade ?? "",
      turno: o.turno ?? "",
      turnoPadronizado: o.turno_padronizado ?? "",
      turnoNota: o.turno_nota ?? "",
      campusIdOriginal: o.campus_id_original ?? "",
      cursoSlugOriginal: o.curso_slug_original ?? "",
      processoIds: [...o.processos],
      campusIds: [...(o.campi ?? [])],
      cursoIds: [...(o.cursos ?? [])],
      editalIds: [...(o.editais ?? [])],
    })),
  };
}

/**
 * Converte entidades do domínio com relações por ID de página do Notion em registros locais, trocando
 * os IDs por chaves canônicas. Foi o núcleo da migração de 13/11/2026 e hoje serve aos testes; falha se
 * alguma relação não puder ser resolvida.
 */
export function deDominio(base: {
  campi: Campus[];
  cursos: Curso[];
  processos: ProcessoSeletivo[];
  editais: EditalIngresso[];
  ofertas: OfertaIngresso[];
}): DadosInstitucionais {
  const erros: string[] = [];
  const campusPorPagina = new Map(base.campi.map((c) => [c.id, c.campusId]));
  const processoPorPagina = new Map(base.processos.map((p) => [p.id, p.processoSeletivoId]));
  const editalPorPagina = new Map(base.editais.map((e) => [e.id, e.editalId]));
  const cursoPorPagina = new Map<string, string>();
  const resolver = (mapa: Map<string, string>, ids: string[], contexto: string) =>
    ids.map((id) => {
      const chave = mapa.get(id);
      if (!chave) erros.push(`${contexto}: relação para página desconhecida ${id}`);
      return chave ?? "";
    });

  const cursos = base.cursos.map((c): CursoLocal => {
    const [campusId = ""] = resolver(campusPorPagina, c.campusIds, `Curso ${c.nome} (${c.id})`);
    cursoPorPagina.set(c.id, chaveCurso(campusId, c.slug));
    return {
      campus_id: campusId,
      curso_slug: c.slug,
      nome: c.nome,
      nivel: c.nivel,
      forma_oferta: c.tipoOferta,
      modalidade: c.modalidade,
      situacao: c.situacao,
      pagina_oficial: c.paginaOficial,
      cnct_id: c.cnctId,
      cnct_ausencia: c.cnctAusencia,
      suap: {
        id: c.suap.id,
        codigo: c.suap.codigo,
        vagas: c.suap.vagas,
        coletado_em: c.suap.coletadoEm,
        atualizado_em: c.suap.atualizadoEm,
        matrizes: {
          resumo: c.suap.matrizes.resumo,
          urls: c.suap.matrizes.urls.split("\n").filter((linha) => linha.trim()),
          carga_horaria_comum_h: c.suap.matrizes.cargaHorariaComumH,
          situacao: c.suap.matrizes.situacao,
          coletado_em: c.suap.matrizes.coletadoEm,
        },
      },
      ppc: {
        url: c.ppc.url,
        markdown_path: c.ppc.markdownPath,
        ano_documento: c.ppc.anoDocumento,
        vagas: c.ppc.vagas,
        trecho_vagas: c.ppc.trechoVagas,
        periodicidade_vagas: c.ppc.periodicidadeVagas,
        curadoria_ano: c.ppc.curadoriaAno,
        data_curadoria_ano: c.ppc.dataCuradoriaAno,
        curadoria_vagas: c.ppc.curadoriaVagas,
        data_curadoria_vagas: c.ppc.dataCuradoriaVagas,
      },
      notion_page_id: c.notionPageId,
    };
  });

  const dados: DadosInstitucionais = {
    campi: base.campi.map((c): CampusLocal => ({
      campus_id: c.campusId,
      nome: c.nome,
      site: c.site,
      calendario_academico: c.calendarioAcademico,
      horarios_url: c.horariosUrl,
      horarios_coletado_em: c.horariosColetadoEm,
      notion_page_id: c.id,
    })),
    cursos,
    processos: base.processos.map((p): ProcessoLocal => ({
      processo_seletivo_id: p.processoSeletivoId,
      nome: p.nome,
      ano_ingresso: p.anoIngresso,
      instituicao: p.instituicao,
      fontes: [...p.fontes],
      status_curadoria: p.statusCuradoria,
      verificado_em: p.verificadoEm,
      observacoes: p.observacoes,
      notion_page_id: p.id,
    })),
    editais: base.editais.map((e): EditalLocal => ({
      edital_id: e.editalId,
      titulo: e.titulo,
      url: e.url,
      numero: e.numero,
      ano: e.ano,
      tipo: e.tipo,
      processos: resolver(processoPorPagina, e.processoIds, `Edital ${e.editalId}`),
      notion_page_id: e.id,
    })),
    ofertas: base.ofertas.map((o): OfertaLocal => ({
      oferta_id: o.ofertaId,
      processos: resolver(processoPorPagina, o.processoIds, `Oferta ${o.ofertaId}`),
      curso_nome: o.cursoNome,
      tipo_oferta: o.tipoOferta,
      vagas: o.vagas,
      url_fonte: o.urlFonte,
      pagina_fonte: o.paginaFonte,
      trecho_fonte: o.trechoFonte,
      forma_oferta: o.formaOferta,
      status_curadoria: o.statusCuradoria,
      revisado_em: o.revisadoEm,
      modalidade: o.modalidade,
      turno: o.turno,
      turno_padronizado: ehTurno(o.turnoPadronizado) ? o.turnoPadronizado : undefined,
      turno_nota: o.turnoNota,
      campi: resolver(campusPorPagina, o.campusIds, `Oferta ${o.ofertaId}`),
      cursos: resolver(cursoPorPagina, o.cursoIds, `Oferta ${o.ofertaId}`),
      editais: resolver(editalPorPagina, o.editalIds, `Oferta ${o.ofertaId}`),
      campus_id_original: o.campusIdOriginal,
      curso_slug_original: o.cursoSlugOriginal,
      notion_page_id: o.id,
    })),
  };
  if (erros.length) throw new Error(`Relações não resolvidas na migração:\n- ${erros.join("\n- ")}`);
  return dados;
}
