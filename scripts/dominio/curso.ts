const PREFIXO_PPCS = "institucional/ifpr/ppcs/";

export interface Campus {
  id: string;
  titulo: string;
  campusId: string;
  nome: string;
  site: string;
  calendarioAcademico: string;
  horariosColetadoEm: string;
  horariosUrl: string;
}

export interface MatrizesSuapCurso {
  resumo: string;
  urls: string;
  cargaHorariaComumH?: number | undefined;
  situacao: string;
  coletadoEm: string;
}

export interface SuapCurso {
  id?: number | undefined;
  codigo: string;
  vagas?: number | undefined;
  coletadoEm: string;
  atualizadoEm: string;
  matrizes: MatrizesSuapCurso;
}

export interface PpcCurso {
  url: string;
  /** Caminho do Markdown convertido, se o link apontar para a coleção de PPCs. */
  markdownPath: string;
  anoDocumento?: number | undefined;
  vagas: string;
  trechoVagas: string;
  periodicidadeVagas: string;
  /** Curadoria do ano do documento (`ppc.curadoria_ano`); rótulo como "Revisado" ou "Precisa de revisão". */
  curadoriaAno: string;
  dataCuradoriaAno: string;
  /** Curadoria das vagas (`ppc.curadoria_vagas`), independente da do ano. */
  curadoriaVagas: string;
  dataCuradoriaVagas: string;
}

export interface Curso {
  /** Chave canônica do curso na base local: `campus_id/curso_slug`. */
  id: string;
  titulo: string;
  slug: string;
  nome: string;
  nivel: string;
  tipoOferta: string;
  paginaOficial: string;
  modalidade: string;
  situacao: string;
  /** Habilitação do CNCT (`cnct:<slug>`), só em curso técnico. */
  cnctId: string;
  /** Motivo explícito de o curso técnico não ter habilitação no CNCT (ex.: oferta experimental). */
  cnctAusencia: string;
  campusIds: string[];
  suap: SuapCurso;
  ppc: PpcCurso;
}

export function chaveCurso(campusId: string, cursoSlug: string): string {
  return `${campusId}/${cursoSlug}`;
}

export function caminhoEsperadoPpc(campusId: string, cursoSlug: string): string {
  return `${PREFIXO_PPCS}${campusId}/${cursoSlug}.md`;
}

export interface VagasPpc {
  quantidade: number;
  minimo?: number;
  maximo?: number;
}

/** "40" é quantidade exata; "30-40" é intervalo, em qualquer ordem, e a quantidade é o máximo. */
export function interpretarVagasPpc(texto: string): VagasPpc | null {
  const valor = texto.trim();
  const intervalo = valor.match(/^(\d{1,4})\s*[-–]\s*(\d{1,4})$/);
  if (intervalo) {
    const a = Number(intervalo[1]);
    const b = Number(intervalo[2]);
    const [minimo, maximo] = a <= b ? [a, b] : [b, a];
    return { quantidade: maximo, minimo, maximo };
  }
  return /^\d{1,4}$/.test(valor) ? { quantidade: Number(valor) } : null;
}
