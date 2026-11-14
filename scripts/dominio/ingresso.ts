import { semAcento } from "@simplifica-if/kb/normas/ids";

/**
 * Turno padronizado de uma oferta de ingresso (`turno_padronizado`). A grafia da fonte fica em `turno`,
 * com as marcas de nota de rodapé, e o que não cabe no enum (o texto da nota) fica em `turno_nota`.
 *
 * - `matutino`, `vespertino`, `noturno`: um só período;
 * - `integral`: o edital diz "Integral" ou "Diurno (Integral)";
 * - `diurno`: manhã e tarde sem dizer em quais dias ("Diurno", "Diurno (manhã e tarde)",
 *   "Matutino/Vespertino");
 * - `matutino-com-contraturno`: manhãs e algumas tardes ("Diurno (Manhã + 2 tardes por semana)",
 *   "Matutino com contraturno a tarde");
 * - `vespertino-com-contraturno`: tardes e algumas manhãs ("Diurno (Vespertino + 2 manhãs por semana)",
 *   "Vespertino com contraturno pela manhã").
 */
export const TURNOS = [
  "matutino",
  "vespertino",
  "noturno",
  "integral",
  "diurno",
  "matutino-com-contraturno",
  "vespertino-com-contraturno",
] as const;
export type Turno = (typeof TURNOS)[number];

/** Marcas de nota de rodapé usadas na coluna de turno dos quadros de vagas. */
export const RE_MARCA_RODAPE = /[¹²³]/u;

const QUANTIDADE = String.raw`(?:\d|uma|duas|tres)`;
const REGRAS_TURNO: Array<[RegExp, Turno]> = [
  [/^(?:matutino|manha)$/u, "matutino"],
  [/^(?:vespertino|tarde)$/u, "vespertino"],
  [/^noturno$/u, "noturno"],
  [/^(?:diurno \()?integral\)?$/u, "integral"],
  [/^diurno(?: \((?:manha e tarde|tarde e manha|matutino e vespertino)\))?$/u, "diurno"],
  [/^matutino ?(?:\/|e) ?vespertino$/u, "diurno"],
  [
    new RegExp(String.raw`^(?:diurno \()?(?:manha|matutino) ?\+ ?${QUANTIDADE} tardes?\b`, "u"),
    "matutino-com-contraturno",
  ],
  [
    new RegExp(String.raw`^matutino \(?(?:manha ?\+ ?${QUANTIDADE} tardes?\b|com contraturno a tarde\)?$)`, "u"),
    "matutino-com-contraturno",
  ],
  [new RegExp(String.raw`^(?:diurno \()?vespertino ?\+ ?${QUANTIDADE} manhas?\b`, "u"), "vespertino-com-contraturno"],
  [/^vespertino \(?com contraturno pela manha\)?$/u, "vespertino-com-contraturno"],
];

/**
 * Turno padronizado a partir da grafia do edital, ignorando caixa, acentos, espaços e marcas de
 * rodapé. Devolve `undefined` quando a grafia não se encaixa: a curadoria decide à mão.
 */
export function padronizarTurno(original: string): Turno | undefined {
  const texto = semAcento(original.replace(new RegExp(RE_MARCA_RODAPE.source, "gu"), ""))
    .replace(/\s+/gu, " ")
    .trim();
  return REGRAS_TURNO.find(([regra]) => regra.test(texto))?.[1];
}

export function ehTurno(valor: string): valor is Turno {
  return (TURNOS as readonly string[]).includes(valor);
}

export const STATUS_CURADORIA_OFERTAS = ["dados_pendentes", "dados_parciais", "dados_curados"] as const;
export type StatusCuradoriaOfertas = (typeof STATUS_CURADORIA_OFERTAS)[number];

export interface ProcessoSeletivo {
  id: string;
  titulo: string;
  processoSeletivoId: string;
  nome: string;
  anoIngresso?: number | undefined;
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
  ano?: number | undefined;
  tipo: string;
  processoIds: string[];
}

export interface OfertaIngresso {
  id: string;
  titulo: string;
  ofertaId: string;
  cursoNome: string;
  tipoOferta: string;
  vagas?: number | undefined;
  urlFonte: string;
  paginaFonte?: number | undefined;
  trechoFonte: string;
  formaOferta: string;
  statusCuradoria: string;
  revisadoEm: string;
  modalidade: string;
  /** Grafia do turno na fonte (`trechoFonte`), com as marcas de rodapé. */
  turno: string;
  /** Turno padronizado (`TURNOS`), ou vazio. */
  turnoPadronizado: string;
  /** O que o enum não diz: o texto da nota de rodapé do edital, divergências entre fontes. */
  turnoNota: string;
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
