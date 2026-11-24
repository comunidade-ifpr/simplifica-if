import { partesDoCaminhoPpc } from "@simplifica-if/kb/ppcs/ids";

export const PREFIXO_PPCS = "institucional/ifpr/ppcs/";

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
  vagas: string;
  trechoVagas: string;
  periodicidadeVagas: string;
  /** Curadoria das vagas (`ppc.curadoria_vagas`); o ano do documento fica no front matter do PPC, com a evidência. */
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

/** Se `caminho` é um PPC do curso: `ppcs/<campus>/<curso>/<versao>.md` (`@simplifica-if/kb/ppcs/ids`). */
export function ehCaminhoPpcDoCurso(caminho: string, campusId: string, cursoSlug: string): boolean {
  const partes = partesDoCaminhoPpc(caminho);
  return partes !== null && partes.campusId === campusId && partes.cursoSlug === cursoSlug;
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
