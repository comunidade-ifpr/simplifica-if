import { ehIdCnct } from "@simplifica-if/kb/normas/ids";
import { ehHttps, ehRotuloCuradoria, ehSlug } from "./comum.ts";
import { caminhoEsperadoPpc, type Campus, type Curso } from "./curso.ts";
import {
  ehTurno,
  RE_MARCA_RODAPE,
  type EditalIngresso,
  type OfertaIngresso,
  type ProcessoSeletivo,
} from "./ingresso.ts";

export interface BaseInstitucional {
  campi: Campus[];
  cursos: Curso[];
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

/** Situações em que o curso técnico precisa estar ligado ao CNCT. */
const SITUACOES_ATIVAS = new Set(["ativo", "em_oferta"]);

function auditarCnct(curso: Curso, nome: string): string[] {
  const erros: string[] = [];
  if (curso.cnctId && (!ehIdCnct(curso.cnctId) || curso.cnctId === "cnct:catalogo")) {
    erros.push(`${nome}: cnct_id inválido (esperado cnct:<slug do curso no CNCT>): ${curso.cnctId}`);
  }
  if (curso.cnctId && curso.cnctAusencia) erros.push(`${nome}: cnct_id e cnct_ausencia são excludentes`);
  if (curso.nivel === "médio" && SITUACOES_ATIVAS.has(curso.situacao) && !curso.cnctId && !curso.cnctAusencia) {
    erros.push(`${nome}: curso técnico ativo sem cnct_id (ou cnct_ausencia com o motivo)`);
  }
  return erros;
}

/** Cada campo do PPC (ano e vagas) tem status e data de curadoria próprios. */
function auditarCuradoriaPpc(curso: Curso, nome: string): string[] {
  const erros: string[] = [];
  const campos = [
    ["ano", curso.ppc.curadoriaAno, curso.ppc.dataCuradoriaAno],
    ["vagas", curso.ppc.curadoriaVagas, curso.ppc.dataCuradoriaVagas],
  ] as const;
  for (const [campo, status, data] of campos) {
    if (status && !ehRotuloCuradoria(status)) erros.push(`${nome}: ppc.curadoria_${campo} desconhecida: ${status}`);
    if (data && !status) erros.push(`${nome}: ppc.data_curadoria_${campo} sem ppc.curadoria_${campo}`);
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
    erros.push(...auditarCnct(curso, nome), ...auditarCuradoriaPpc(curso, nome));

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

function auditarProcessos(processos: ProcessoSeletivo[]): string[] {
  const erros: string[] = [];
  const ids = new Map<string, string>();
  const anos = new Map<number, string>();
  for (const processo of processos) {
    const nome = rotulo("Processo seletivo", processo);
    if (!ehSlug(processo.processoSeletivoId)) {
      erros.push(`${nome}: processo_seletivo_id ausente ou inválido`);
    } else if (ids.has(processo.processoSeletivoId)) {
      erros.push(
        `${nome}: processo_seletivo_id duplicado com ${ids.get(processo.processoSeletivoId)}: ${processo.processoSeletivoId}`,
      );
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
    if (oferta.turnoPadronizado && !ehTurno(oferta.turnoPadronizado)) {
      erros.push(`${nome}: turno_padronizado fora do enum: ${oferta.turnoPadronizado}`);
    }
    if (oferta.turno && !oferta.turnoPadronizado) erros.push(`${nome}: turno sem turno_padronizado`);
    if (oferta.turno && oferta.trechoFonte && !oferta.trechoFonte.includes(oferta.turno)) {
      erros.push(`${nome}: turno "${oferta.turno}" não aparece literalmente em trecho_fonte`);
    }
    if (RE_MARCA_RODAPE.test(oferta.turno) && !oferta.turnoNota) {
      erros.push(`${nome}: turno com marca de rodapé sem turno_nota`);
    }
    if (!oferta.processoIds.length) erros.push(`${nome}: relação Processo Seletivo ausente`);
    for (const processoPagina of oferta.processoIds) {
      const processoId = processoIdPorPagina.get(processoPagina);
      if (!processoId) {
        erros.push(`${nome}: relação Processo Seletivo aponta para página desconhecida: ${processoPagina}`);
      } else if (idValido) {
        const chave = `${processoId}\u001f${oferta.ofertaId}`;
        if (vistos.has(chave)) {
          erros.push(
            `${nome}: oferta_id duplicado no processo ${processoId} com ${vistos.get(chave)}: ${oferta.ofertaId}`,
          );
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

/** Problemas dos registros institucionais e de suas relações, conferidos pelo `validar_base`. */
export function auditarBase(base: BaseInstitucional): string[] {
  const campusIdPorPagina = new Map(base.campi.map((item) => [item.id, item.campusId]));
  const processoIdPorPagina = new Map(base.processos.map((item) => [item.id, item.processoSeletivoId]));
  return [
    ...auditarCampi(base.campi),
    ...auditarCursos(base.cursos, campusIdPorPagina),
    ...auditarProcessos(base.processos),
    ...auditarEditais(base.editais, processoIdPorPagina),
    ...auditarOfertas(base, processoIdPorPagina),
  ];
}
