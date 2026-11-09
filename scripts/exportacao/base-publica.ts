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

type Json = Record<string, unknown>;

/** Copia só os campos preenchidos: nos JSONs públicos, dado ausente é chave ausente. */
function preenchidos(campos: Json): Json {
  return Object.fromEntries(
    Object.entries(campos).filter(([, valor]) => valor !== "" && valor !== undefined && valor !== null),
  );
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

function suapJson(curso: Curso): Json | undefined {
  const { suap } = curso;
  const urls = dividirLinhas(suap.matrizes.urls);
  const matrizes = preenchidos({
    resumo: suap.matrizes.resumo,
    urls: urls.length ? urls : undefined,
    carga_horaria_comum_h: suap.matrizes.cargaHorariaComumH,
    situacao: suap.matrizes.situacao,
    coletado_em: dataHoraJson(suap.matrizes.coletadoEm),
  });
  const json = preenchidos({
    id: suap.id,
    codigo: suap.codigo,
    vagas: suap.vagas,
    coletado_em: dataHoraJson(suap.coletadoEm),
    atualizado_em: dataHoraJson(suap.atualizadoEm),
    matrizes: Object.keys(matrizes).length ? matrizes : undefined,
  });
  return Object.keys(json).length ? json : undefined;
}

function ppcJson(curso: Curso): Json | undefined {
  const { ppc } = curso;
  if (!ppc.url) return undefined;
  const revisadoEm = dataJson(ppc.dataCuradoria);
  const status = statusCuradoria(ppc.curadoria, revisadoEm);

  const anoDocumento =
    ppc.anoDocumento === undefined
      ? undefined
      : preenchidos({
          ano: ppc.anoDocumento,
          trecho_fonte: `Ano do documento registrado no Notion: ${ppc.anoDocumento}`,
          status_curadoria: status,
          revisado_em: revisadoEm,
        });
  const interpretadas = interpretarVagasPpc(ppc.vagas);
  const vagas =
    interpretadas && ppc.trechoVagas
      ? preenchidos({
          quantidade: interpretadas.quantidade,
          trecho_fonte: ppc.trechoVagas,
          status_curadoria: status,
          minimo: interpretadas.minimo,
          maximo: interpretadas.maximo,
          periodicidade: ppc.periodicidadeVagas,
          revisado_em: revisadoEm,
        })
      : undefined;
  const metadados = preenchidos({ ano_documento: anoDocumento, vagas });

  return preenchidos({
    url: ppc.url,
    conversao: { status: ppc.markdownPath ? "convertido" : "pendente" },
    markdown_path: ppc.markdownPath,
    metadados: Object.keys(metadados).length ? metadados : undefined,
  });
}

function processosSeiJson(movimentacoes: Movimentacao[]): Json[] {
  const vistos = new Set<string>();
  const processos: Json[] = [];
  const ordenadas = [...movimentacoes].sort(
    (a, b) => compararTexto(a.tipo, b.tipo) || compararTexto(a.id, b.id),
  );
  for (const movimentacao of ordenadas) {
    const tipo = movimentacao.tipo || "outro";
    const chave = `${movimentacao.numeroSei}\u001f${tipo}`;
    if (!movimentacao.numeroSei || vistos.has(chave)) continue;
    vistos.add(chave);
    processos.push(
      preenchidos({ numero: movimentacao.numeroSei, tipo, trecho_fonte: movimentacao.anotacoes }),
    );
  }
  return processos;
}

function cursoJson(curso: Curso, movimentacoes: Movimentacao[]): Json {
  const processos = processosSeiJson(movimentacoes);
  return preenchidos({
    curso_slug: curso.slug,
    notion_page_id: curso.id,
    nome: curso.nome,
    nivel: curso.nivel,
    tipo_oferta: curso.tipoOferta,
    url: curso.paginaOficial,
    modalidade: curso.modalidade,
    situacao: curso.situacao,
    suap: suapJson(curso),
    ppc: ppcJson(curso),
    sei: processos.length ? { processos } : undefined,
  });
}

function campusJson(campus: Campus, cursos: Json[]): Json {
  const coletadoEm = dataHoraJson(campus.horariosColetadoEm);
  return preenchidos({
    id: campus.campusId,
    nome: campus.nome,
    links: { site: campus.site, calendario_academico: campus.calendarioAcademico },
    horario_aulas: coletadoEm ? preenchidos({ coletado_em: coletadoEm, url: campus.horariosUrl }) : undefined,
    cursos,
  });
}

export function montarCampi(base: BaseInstitucional): Json[] {
  const cursosPorCampus = agrupar(base.cursos, (curso) => curso.campusIds);
  const movimentacoesPorCurso = agrupar(base.movimentacoes, (item) => item.cursoIds);
  return base.campi
    .map((campus) => {
      const cursos = (cursosPorCampus.get(campus.id) ?? [])
        .map((curso) => cursoJson(curso, movimentacoesPorCurso.get(curso.id) ?? []))
        .sort((a, b) => compararTexto(String(a.curso_slug), String(b.curso_slug)));
      return campusJson(campus, cursos);
    })
    .sort((a, b) => compararTexto(String(a.id), String(b.id)));
}

export function montarIndiceCampi(campi: Json[], hoje: string): Json {
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

function editalJson(edital: EditalIngresso): Json {
  return preenchidos({
    id: edital.editalId,
    titulo: edital.titulo,
    url: edital.url,
    numero: edital.numero,
    ano: edital.ano,
    tipo: edital.tipo,
  });
}

function ofertaJson(
  oferta: OfertaIngresso,
  campi: Map<string, Campus>,
  cursos: Map<string, Curso>,
  editais: Map<string, EditalIngresso>,
): Json {
  // A relação prevalece; os campos "original" guardam o valor do edital quando não há página.
  let campusId = oferta.campusIdOriginal;
  for (const id of oferta.campusIds) campusId = campi.get(id)?.campusId || campusId;
  let cursoSlug = oferta.cursoSlugOriginal;
  for (const id of oferta.cursoIds) cursoSlug = cursos.get(id)?.slug || cursoSlug;

  const revisadoEm = dataJson(oferta.revisadoEm);
  const editalId = oferta.editalIds.map((id) => editais.get(id)?.editalId).find(Boolean);
  return preenchidos({
    id: oferta.ofertaId,
    campus_id: campusId,
    curso_nome: oferta.cursoNome,
    tipo_oferta: oferta.tipoOferta,
    vagas: preenchidos({
      quantidade: oferta.vagas ?? 0,
      trecho_fonte: oferta.trechoFonte || "Informação migrada do cadastro operacional.",
      status_curadoria: statusCuradoria(oferta.statusCuradoria, revisadoEm),
      forma_oferta: oferta.formaOferta,
      pagina: oferta.paginaFonte,
      revisado_em: revisadoEm,
    }),
    fonte: { url: oferta.urlFonte, ...preenchidos({ edital_id: editalId, pagina: oferta.paginaFonte }) },
    curso_slug: cursoSlug,
    modalidade: oferta.modalidade,
    turno: oferta.turno,
  });
}

export function montarProcessos(base: BaseInstitucional, hoje: string): Json[] {
  const campi = new Map(base.campi.map((item) => [item.id, item]));
  const cursos = new Map(base.cursos.map((item) => [item.id, item]));
  const editais = new Map(base.editais.map((item) => [item.id, item]));
  const editaisPorProcesso = agrupar(base.editais, (item) => item.processoIds);
  const ofertasPorProcesso = agrupar(base.ofertas, (item) => item.processoIds);

  const porId = (a: Json, b: Json) => compararTexto(String(a.id), String(b.id));
  return [...base.processos]
    .sort((a, b) => (a.anoIngresso ?? 0) - (b.anoIngresso ?? 0))
    .map((processo: ProcessoSeletivo) => ({
      id: processo.processoSeletivoId,
      nome: processo.nome,
      ano_ingresso: processo.anoIngresso,
      instituicao: processo.instituicao || "IFPR",
      fontes: processo.fontes,
      editais: (editaisPorProcesso.get(processo.id) ?? []).map(editalJson).sort(porId),
      ofertas: (ofertasPorProcesso.get(processo.id) ?? [])
        .map((oferta) => ofertaJson(oferta, campi, cursos, editais))
        .sort(porId),
      curadoria: preenchidos({
        status_ofertas: statusCuradoriaOfertas(processo.statusCuradoria),
        verificado_em: dataJson(processo.verificadoEm) || hoje,
        observacoes: processo.observacoes,
      }),
    }));
}

export function montarIndiceProcessos(processos: Json[]): Json {
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
