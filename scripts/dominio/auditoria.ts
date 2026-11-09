import { ehHttps, ehSlug } from "./comum.ts";
import { caminhoEsperadoPpc, type Campus, type Curso } from "./curso.ts";
import type { EditalIngresso, OfertaIngresso, ProcessoSeletivo } from "./ingresso.ts";
import type { Movimentacao } from "./movimentacao.ts";

export interface BaseInstitucional {
  campi: Campus[];
  cursos: Curso[];
  movimentacoes: Movimentacao[];
  processos: ProcessoSeletivo[];
  editais: EditalIngresso[];
  ofertas: OfertaIngresso[];
}

function rotulo(tipo: string, item: { id: string; titulo: string }) {
  return `${tipo} '${item.titulo.trim() || item.id}' (${item.id})`;
}

function auditarCampi(campi: Campus[]): string[] {
  const erros: string[] = [];
  const vistos = new Map<string, string>();
  for (const campus of campi) {
    const nome = rotulo("Campus", campus);
    if (!ehSlug(campus.campusId)) {
      erros.push(`${nome}: campus_id ausente ou inválido`);
    } else if (vistos.has(campus.campusId)) {
      erros.push(`${nome}: campus_id duplicado com ${vistos.get(campus.campusId)}: ${campus.campusId}`);
    } else {
      vistos.set(campus.campusId, nome);
    }
    if (!campus.nome) erros.push(`${nome}: Nome ausente`);
    if (!ehHttps(campus.site)) erros.push(`${nome}: Site ausente ou não HTTPS`);
    if (!ehHttps(campus.calendarioAcademico)) erros.push(`${nome}: Calendário acadêmico ausente ou não HTTPS`);
  }
  return erros;
}

function auditarCursos(cursos: Curso[], campusIdPorPagina: Map<string, string>): string[] {
  const erros: string[] = [];
  const vistos = new Map<string, string>();
  for (const curso of cursos) {
    const nome = rotulo("Curso", curso);
    const slugValido = ehSlug(curso.slug);
    if (!slugValido) erros.push(`${nome}: curso_slug ausente ou inválido`);
    if (!curso.nome) erros.push(`${nome}: Nome ausente`);
    if (!curso.nivel) erros.push(`${nome}: Nível ausente`);
    if (!curso.tipoOferta) erros.push(`${nome}: Forma de oferta ausente`);

    const [campusPagina] = curso.campusIds;
    if (curso.campusIds.length !== 1 || !campusPagina) {
      erros.push(`${nome}: relação Campus deve conter exatamente 1 página`);
      continue;
    }
    const campusId = campusIdPorPagina.get(campusPagina);
    if (!campusId) {
      erros.push(`${nome}: relação Campus aponta para página desconhecida ou sem campus_id: ${campusPagina}`);
      continue;
    }
    if (slugValido) {
      const chave = `${campusId}\u001f${curso.slug}`;
      if (vistos.has(chave)) {
        erros.push(`${nome}: curso_slug duplicado no campus ${campusId} com ${vistos.get(chave)}: ${curso.slug}`);
      } else {
        vistos.set(chave, nome);
      }
    }
    if (curso.ppc.url && !ehHttps(curso.ppc.url)) erros.push(`${nome}: PPC URL oficial não HTTPS`);
    if (curso.ppc.markdownPath && slugValido) {
      const esperado = caminhoEsperadoPpc(campusId, curso.slug);
      if (curso.ppc.markdownPath !== esperado) {
        erros.push(`${nome}: PPC Markdown Link esperado ${esperado}, encontrado ${curso.ppc.markdownPath}`);
      }
    }
  }
  return erros;
}

function auditarMovimentacoes(movimentacoes: Movimentacao[], cursos: Set<string>): string[] {
  const erros: string[] = [];
  for (const movimentacao of movimentacoes) {
    const nome = rotulo("Movimentação de curso", movimentacao);
    if (movimentacao.cursoIds.length > 1) erros.push(`${nome}: relação Curso deve conter no máximo 1 página`);
    for (const cursoId of movimentacao.cursoIds) {
      if (!cursos.has(cursoId)) erros.push(`${nome}: relação Curso aponta para página desconhecida: ${cursoId}`);
    }
    if (movimentacao.numeroSei.trim() && !movimentacao.cursoIds.length) {
      erros.push(`${nome}: SEI Processo informado sem relação Curso`);
    }
  }
  return erros;
}

function auditarProcessos(processos: ProcessoSeletivo[]): string[] {
  const erros: string[] = [];
  const ids = new Map<string, string>();
  const anos = new Map<number, string>();
  for (const processo of processos) {
    const nome = rotulo("Processo seletivo", processo);
    if (!ehSlug(processo.processoSeletivoId)) {
      erros.push(`${nome}: processo_seletivo_id ausente ou inválido`);
    } else if (ids.has(processo.processoSeletivoId)) {
      erros.push(`${nome}: processo_seletivo_id duplicado com ${ids.get(processo.processoSeletivoId)}: ${processo.processoSeletivoId}`);
    } else {
      ids.set(processo.processoSeletivoId, nome);
    }
    if (!processo.nome) erros.push(`${nome}: Nome ausente`);
    const ano = processo.anoIngresso;
    if (ano === undefined || ano < 1900) {
      erros.push(`${nome}: Ano de ingresso ausente ou inválido`);
    } else if (anos.has(ano)) {
      erros.push(`${nome}: Ano de ingresso duplicado com ${anos.get(ano)}: ${ano}`);
    } else {
      anos.set(ano, nome);
    }
    if (!processo.fontes.length) erros.push(`${nome}: Fontes ausente`);
    for (const fonte of processo.fontes) {
      if (!ehHttps(fonte)) erros.push(`${nome}: Fontes contém URL não HTTPS: ${fonte}`);
    }
  }
  return erros;
}

function auditarEditais(editais: EditalIngresso[], processoIdPorPagina: Map<string, string>): string[] {
  const erros: string[] = [];
  const vistos = new Map<string, string>();
  for (const edital of editais) {
    const nome = rotulo("Edital de ingresso", edital);
    if (!ehSlug(edital.editalId)) {
      erros.push(`${nome}: edital_id ausente ou inválido`);
    } else if (vistos.has(edital.editalId)) {
      erros.push(`${nome}: edital_id duplicado com ${vistos.get(edital.editalId)}: ${edital.editalId}`);
    } else {
      vistos.set(edital.editalId, nome);
    }
    if (!edital.titulo) erros.push(`${nome}: Título ausente`);
    if (!ehHttps(edital.url)) erros.push(`${nome}: URL ausente ou não HTTPS`);
    if (!edital.processoIds.length) erros.push(`${nome}: relação Processo Seletivo ausente`);
    for (const processoId of edital.processoIds) {
      if (!processoIdPorPagina.has(processoId)) {
        erros.push(`${nome}: relação Processo Seletivo aponta para página desconhecida: ${processoId}`);
      }
    }
  }
  return erros;
}

function auditarOfertas(base: BaseInstitucional, processoIdPorPagina: Map<string, string>): string[] {
  const erros: string[] = [];
  const campi = new Set(base.campi.map((item) => item.id));
  const cursos = new Set(base.cursos.map((item) => item.id));
  const editais = new Set(base.editais.map((item) => item.id));
  const vistos = new Map<string, string>();
  for (const oferta of base.ofertas) {
    const nome = rotulo("Oferta de ingresso", oferta);
    const idValido = ehSlug(oferta.ofertaId);
    if (!idValido) erros.push(`${nome}: oferta_id ausente ou inválido`);
    if (!oferta.cursoNome) erros.push(`${nome}: Curso nome no edital ausente`);
    if (!oferta.tipoOferta) erros.push(`${nome}: Tipo de oferta ausente`);
    if (oferta.vagas === undefined) erros.push(`${nome}: Vagas ausente ou inválida`);
    if (!ehHttps(oferta.urlFonte)) erros.push(`${nome}: URL fonte ausente ou não HTTPS`);
    if (!oferta.processoIds.length) erros.push(`${nome}: relação Processo Seletivo ausente`);
    for (const processoPagina of oferta.processoIds) {
      const processoId = processoIdPorPagina.get(processoPagina);
      if (!processoId) {
        erros.push(`${nome}: relação Processo Seletivo aponta para página desconhecida: ${processoPagina}`);
      } else if (idValido) {
        const chave = `${processoId}\u001f${oferta.ofertaId}`;
        if (vistos.has(chave)) {
          erros.push(`${nome}: oferta_id duplicado no processo ${processoId} com ${vistos.get(chave)}: ${oferta.ofertaId}`);
        } else {
          vistos.set(chave, nome);
        }
      }
    }
    if (!oferta.campusIds.length && !ehSlug(oferta.campusIdOriginal)) {
      erros.push(`${nome}: informe relação Campus ou campus_id_original válido`);
    }
    for (const id of oferta.campusIds) {
      if (!campi.has(id)) erros.push(`${nome}: relação Campus aponta para página desconhecida: ${id}`);
    }
    for (const id of oferta.cursoIds) {
      if (!cursos.has(id)) erros.push(`${nome}: relação Curso aponta para página desconhecida: ${id}`);
    }
    for (const id of oferta.editalIds) {
      if (!editais.has(id)) erros.push(`${nome}: relação Edital aponta para página desconhecida: ${id}`);
    }
  }
  return erros;
}

/** Problemas que impedem uma exportação confiável; a exportação só segue com a lista vazia. */
export function auditarBase(base: BaseInstitucional): string[] {
  const campusIdPorPagina = new Map(base.campi.map((item) => [item.id, item.campusId]));
  const processoIdPorPagina = new Map(base.processos.map((item) => [item.id, item.processoSeletivoId]));
  return [
    ...auditarCampi(base.campi),
    ...auditarCursos(base.cursos, campusIdPorPagina),
    ...auditarMovimentacoes(base.movimentacoes, new Set(base.cursos.map((item) => item.id))),
    ...auditarProcessos(base.processos),
    ...auditarEditais(base.editais, processoIdPorPagina),
    ...auditarOfertas(base, processoIdPorPagina),
  ];
}
