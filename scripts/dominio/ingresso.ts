export const STATUS_CURADORIA_OFERTAS = ["dados_pendentes", "dados_parciais", "dados_curados"] as const;
export type StatusCuradoriaOfertas = (typeof STATUS_CURADORIA_OFERTAS)[number];

export interface ProcessoSeletivo {
  id: string;
  titulo: string;
  processoSeletivoId: string;
  nome: string;
  anoIngresso?: number;
  instituicao: string;
  fontes: string[];
  statusCuradoria: string;
  verificadoEm: string;
  observacoes: string;
}

export interface EditalIngresso {
  id: string;
  titulo: string;
  editalId: string;
  url: string;
  numero: string;
  ano?: number;
  tipo: string;
  processoIds: string[];
}

export interface OfertaIngresso {
  id: string;
  titulo: string;
  ofertaId: string;
  cursoNome: string;
  tipoOferta: string;
  vagas?: number;
  urlFonte: string;
  paginaFonte?: number;
  trechoFonte: string;
  formaOferta: string;
  statusCuradoria: string;
  revisadoEm: string;
  modalidade: string;
  turno: string;
  campusIdOriginal: string;
  cursoSlugOriginal: string;
  processoIds: string[];
  campusIds: string[];
  cursoIds: string[];
  editalIds: string[];
}

export function statusCuradoriaOfertas(valor: string): StatusCuradoriaOfertas {
  return (STATUS_CURADORIA_OFERTAS as readonly string[]).includes(valor)
    ? (valor as StatusCuradoriaOfertas)
    : "dados_parciais";
}
