import type { BaseInstitucional } from "../dominio/auditoria.ts";
import { compararTexto, dividirLinhas, statusCuradoria } from "../dominio/comum.ts";
import { interpretarVagasPpc, type Campus, type Curso } from "../dominio/curso.ts";
import {
  statusCuradoriaOfertas,
  type EditalIngresso,
  type OfertaIngresso,
  type ProcessoSeletivo,
} from "../dominio/ingresso.ts";
import type { Movimentacao } from "../dominio/movimentacao.ts";
import type {
  CampusJson,
  IndiceCampiJson,
  IndiceProcessosSeletivosJson,
  ProcessoSeletivoJson,
} from "../base/tipos-schemas.ts";

/* Formatos publicados, derivados dos JSON Schemas (scripts/base/tipos-schemas.ts). */
type CursoJson = CampusJson["cursos"][number];
type SuapJson = NonNullable<CursoJson["suap"]>;
type PpcJson = NonNullable<CursoJson["ppc"]>;
type MetadadosPpcJson = NonNullable<PpcJson["metadados"]>;
type ProcessoSeiJson = NonNullable<CursoJson["sei"]>["processos"][number];
type EditalJson = ProcessoSeletivoJson["editais"][number];
type OfertaJson = ProcessoSeletivoJson["ofertas"][number];

/** `T` com os campos opcionais aceitando `undefined` explícito, que `preenchidos` remove. */
type CamposMontados<T> = {
  [K in keyof T as {} extends Pick<T, K> ? K : never]?: T[K] | undefined;
} & {
  [K in keyof T as {} extends Pick<T, K> ? never : K]: T[K];
};

/**
 * Copia só os campos preenchidos: nos JSONs públicos, dado ausente é chave
 * ausente. O tipo `T` é o do formato publicado, que confere os nomes e os
 * tipos dos campos montados.
 */
function preenchidos<T extends object>(campos: CamposMontados<T>): T {
  return Object.fromEntries(
    Object.entries(campos).filter(([, valor]) => valor !== "" && valor !== undefined && valor !== null),
  ) as T;
}

/**
 * Texto livre do Notion num campo que o schema restringe (`enum`/`const`).
 * A exportação publica o valor como está; o validador da base o confere
 * contra o schema.
 */
function doNotion<T extends string>(valor: string): T {
  return valor as T;
}

function porId<T extends { id: string }>(a: T, b: T): number {
  return compararTexto(a.id, b.id);
}

function agrupar<T>(itens: T[], chaves: (item: T) => string[]): Map<string, T[]> {
  const grupos = new Map<string, T[]>();
  for (const item of itens) {
    for (const chave of chaves(item)) {
      grupos.set(chave, [...(grupos.get(chave) ?? []), item]);
    }
  }
  return grupos;
}

export function dataJson(valor: string): string {
  return valor.slice(0, 10);
}

/** As datas do Notion podem vir sem hora ou sem fuso; o JSON público sempre traz os dois. */
export function dataHoraJson(valor: string): string {
  if (!valor) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) return `${valor}T00:00:00-03:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(valor)) return `${valor}:00-03:00`;
  return valor.replace(/(\d{2}:\d{2}:\d{2})\.\d+/, "$1");
}

function suapJson(curso: Curso): SuapJson | undefined {
  const { suap } = curso;
  const urls = dividirLinhas(suap.matrizes.urls);
  const matrizes = preenchidos<NonNullable<SuapJson["matrizes"]>>({
    resumo: suap.matrizes.resumo,
    urls: urls.length ? urls : undefined,
    carga_horaria_comum_h: suap.matrizes.cargaHorariaComumH,
    situacao: doNotion(suap.matrizes.situacao),
    coletado_em: dataHoraJson(suap.matrizes.coletadoEm),
  });
  const json = preenchidos<SuapJson>({
    id: suap.id,
    codigo: suap.codigo,
    vagas: suap.vagas,
    coletado_em: dataHoraJson(suap.coletadoEm),
    atualizado_em: dataHoraJson(suap.atualizadoEm),
    matrizes: Object.keys(matrizes).length ? matrizes : undefined,
  });
  return Object.keys(json).length ? json : undefined;
}

function ppcJson(curso: Curso): PpcJson | undefined {
  const { ppc } = curso;
  if (!ppc.url) return undefined;
  // Ano e vagas têm curadoria própria (`ppc.curadoria_ano`, `ppc.curadoria_vagas`).
  const anoRevisadoEm = dataJson(ppc.dataCuradoriaAno);
  const vagasRevisadoEm = dataJson(ppc.dataCuradoriaVagas);

  const anoDocumento =
    ppc.anoDocumento === undefined
      ? undefined
      : preenchidos<NonNullable<MetadadosPpcJson["ano_documento"]>>({
          ano: ppc.anoDocumento,
          trecho_fonte: `Ano do documento registrado no Notion: ${ppc.anoDocumento}`,
          status_curadoria: statusCuradoria(ppc.curadoriaAno, anoRevisadoEm),
          revisado_em: anoRevisadoEm,
        });
  const interpretadas = interpretarVagasPpc(ppc.vagas);
  const vagas =
    interpretadas && ppc.trechoVagas
      ? preenchidos<NonNullable<MetadadosPpcJson["vagas"]>>({
          quantidade: interpretadas.quantidade,
          trecho_fonte: ppc.trechoVagas,
          status_curadoria: statusCuradoria(ppc.curadoriaVagas, vagasRevisadoEm),
          minimo: interpretadas.minimo,
          maximo: interpretadas.maximo,
          periodicidade: ppc.periodicidadeVagas,
          revisado_em: vagasRevisadoEm,
        })
      : undefined;
  const metadados = preenchidos<MetadadosPpcJson>({ ano_documento: anoDocumento, vagas });

  return preenchidos<PpcJson>({
    url: ppc.url,
    conversao: { status: ppc.markdownPath ? "convertido" : "pendente" },
    markdown_path: ppc.markdownPath,
    metadados: Object.keys(metadados).length ? metadados : undefined,
  });
}

function processosSeiJson(movimentacoes: Movimentacao[]): ProcessoSeiJson[] {
  const vistos = new Set<string>();
  const processos: ProcessoSeiJson[] = [];
  const ordenadas = [...movimentacoes].sort((a, b) => compararTexto(a.tipo, b.tipo) || compararTexto(a.id, b.id));
  for (const movimentacao of ordenadas) {
    const tipo = movimentacao.tipo || "outro";
    const chave = `${movimentacao.numeroSei}\u001f${tipo}`;
    if (!movimentacao.numeroSei || vistos.has(chave)) continue;
    vistos.add(chave);
    processos.push(
      preenchidos<ProcessoSeiJson>({
        numero: movimentacao.numeroSei,
        tipo: doNotion(tipo),
        trecho_fonte: movimentacao.anotacoes,
      }),
    );
  }
  return processos;
}

function cursoJson(curso: Curso, movimentacoes: Movimentacao[]): CursoJson {
  const processos = processosSeiJson(movimentacoes);
  return preenchidos<CursoJson>({
    curso_slug: curso.slug,
    notion_page_id: curso.notionPageId,
    nome: curso.nome,
    nivel: doNotion(curso.nivel),
    tipo_oferta: doNotion(curso.tipoOferta),
    url: curso.paginaOficial,
    modalidade: doNotion(curso.modalidade),
    situacao: doNotion(curso.situacao),
    cnct_id: curso.cnctId,
    cnct_ausencia: curso.cnctAusencia,
    suap: suapJson(curso),
    ppc: ppcJson(curso),
    sei: processos.length ? { processos } : undefined,
  });
}

function campusJson(campus: Campus, cursos: CursoJson[]): CampusJson {
  const coletadoEm = dataHoraJson(campus.horariosColetadoEm);
  return preenchidos<CampusJson>({
    id: campus.campusId,
    nome: campus.nome,
    links: { site: campus.site, calendario_academico: campus.calendarioAcademico },
    horario_aulas: coletadoEm
      ? preenchidos<NonNullable<CampusJson["horario_aulas"]>>({ coletado_em: coletadoEm, url: campus.horariosUrl })
      : undefined,
    cursos,
  });
}

export function montarCampi(base: BaseInstitucional): CampusJson[] {
  const cursosPorCampus = agrupar(base.cursos, (curso) => curso.campusIds);
  const movimentacoesPorCurso = agrupar(base.movimentacoes, (item) => item.cursoIds);
  return base.campi
    .map((campus) => {
      const cursos = (cursosPorCampus.get(campus.id) ?? [])
        .map((curso) => cursoJson(curso, movimentacoesPorCurso.get(curso.id) ?? []))
        .sort((a, b) => compararTexto(a.curso_slug, b.curso_slug));
      return campusJson(campus, cursos);
    })
    .sort(porId);
}

export function montarIndiceCampi(campi: CampusJson[], hoje: string): IndiceCampiJson {
  return {
    id: "campi-ifpr",
    title: "Campi do IFPR",
    descricao: "Índice de campi e campi avançados do Instituto Federal do Paraná.",
    tipo_item: "campus",
    atualizado_em: hoje,
    items: campi.map((campus) => ({
      id: campus.id,
      nome: campus.nome,
      path: `institucional/ifpr/campi/${campus.id}.json`,
    })),
  };
}

function editalJson(edital: EditalIngresso): EditalJson {
  return preenchidos<EditalJson>({
    id: edital.editalId,
    titulo: edital.titulo,
    url: edital.url,
    numero: edital.numero,
    ano: edital.ano,
    tipo: doNotion(edital.tipo),
  });
}

function ofertaJson(
  oferta: OfertaIngresso,
  campi: Map<string, Campus>,
  cursos: Map<string, Curso>,
  editais: Map<string, EditalIngresso>,
): OfertaJson {
  // A relação prevalece; os campos "original" guardam o valor do edital quando não há página.
  let campusId = oferta.campusIdOriginal;
  for (const id of oferta.campusIds) campusId = campi.get(id)?.campusId || campusId;
  let cursoSlug = oferta.cursoSlugOriginal;
  for (const id of oferta.cursoIds) cursoSlug = cursos.get(id)?.slug || cursoSlug;

  const revisadoEm = dataJson(oferta.revisadoEm);
  const editalId = oferta.editalIds.map((id) => editais.get(id)?.editalId).find(Boolean);
  return preenchidos<OfertaJson>({
    id: oferta.ofertaId,
    campus_id: campusId,
    curso_nome: oferta.cursoNome,
    tipo_oferta: doNotion(oferta.tipoOferta),
    vagas: preenchidos<OfertaJson["vagas"]>({
      quantidade: oferta.vagas ?? 0,
      trecho_fonte: oferta.trechoFonte || "Informação migrada do cadastro operacional.",
      status_curadoria: statusCuradoria(oferta.statusCuradoria, revisadoEm),
      forma_oferta: oferta.formaOferta,
      pagina: oferta.paginaFonte,
      revisado_em: revisadoEm,
    }),
    fonte: {
      url: oferta.urlFonte,
      ...preenchidos<Omit<OfertaJson["fonte"], "url">>({ edital_id: editalId, pagina: oferta.paginaFonte }),
    },
    curso_slug: cursoSlug,
    modalidade: doNotion(oferta.modalidade),
    turno: oferta.turno,
    turno_padronizado: doNotion(oferta.turnoPadronizado),
    turno_nota: oferta.turnoNota,
  });
}

export function montarProcessos(base: BaseInstitucional, hoje: string): ProcessoSeletivoJson[] {
  const campi = new Map(base.campi.map((item) => [item.id, item]));
  const cursos = new Map(base.cursos.map((item) => [item.id, item]));
  const editais = new Map(base.editais.map((item) => [item.id, item]));
  const editaisPorProcesso = agrupar(base.editais, (item) => item.processoIds);
  const ofertasPorProcesso = agrupar(base.ofertas, (item) => item.processoIds);
  return [...base.processos]
    .sort((a, b) => (a.anoIngresso ?? 0) - (b.anoIngresso ?? 0))
    .map((processo: ProcessoSeletivo): ProcessoSeletivoJson => ({
      id: processo.processoSeletivoId,
      nome: processo.nome,
      // A auditoria do Notion barra a exportação de processo sem ano de ingresso.
      ano_ingresso: processo.anoIngresso!,
      instituicao: doNotion(processo.instituicao || "IFPR"),
      fontes: processo.fontes,
      editais: (editaisPorProcesso.get(processo.id) ?? []).map(editalJson).sort(porId),
      ofertas: (ofertasPorProcesso.get(processo.id) ?? [])
        .map((oferta) => ofertaJson(oferta, campi, cursos, editais))
        .sort(porId),
      curadoria: preenchidos<ProcessoSeletivoJson["curadoria"]>({
        status_ofertas: statusCuradoriaOfertas(processo.statusCuradoria),
        verificado_em: dataJson(processo.verificadoEm) || hoje,
        observacoes: processo.observacoes,
      }),
    }));
}

export function montarIndiceProcessos(processos: ProcessoSeletivoJson[]): IndiceProcessosSeletivosJson {
  return {
    title: "Processos seletivos do IFPR",
    total_itens: processos.length,
    items: processos.map((processo) => ({
      id: processo.id,
      ano_ingresso: processo.ano_ingresso,
      nome: processo.nome,
      path: `institucional/ifpr/processos-seletivos/${processo.id}.json`,
    })),
  };
}
