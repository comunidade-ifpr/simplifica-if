/**
 * Moeda, números e datas como a interface os escreve (M1.14): sempre pelo `Intl` com `pt-BR`, num
 * lugar só, para que nenhuma tela monte um valor à mão (`toFixed` com vírgula trocada, `toLocaleString`
 * sem língua, data ISO na tela).
 *
 * As datas sem hora (`2026-11-12`, a data da base, de um ato) se leem em UTC, para não voltar um dia
 * no fuso de Brasília; as com hora (quando um arquivo mudou, a última procura de atualização) no fuso
 * do computador.
 */

const LINGUA = "pt-BR";

/** Até 2 casas, ou 3 abaixo de 10 centavos, para que um custo pequeno não vire "US$ 0,00". */
const DOLAR = new Intl.NumberFormat(LINGUA, { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const DOLAR_CENTAVOS = new Intl.NumberFormat(LINGUA, {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});

/** `0.0254` → "US$ 0,025"; `1.5` → "US$ 1,50". O espaço depois de "US$" é o rígido do `Intl`. */
export function dolares(valor: number): string {
  return (Math.abs(valor) < 0.1 ? DOLAR_CENTAVOS : DOLAR).format(valor);
}

const DECIMAL_1 = new Intl.NumberFormat(LINGUA, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const INTEIRO = new Intl.NumberFormat(LINGUA, { maximumFractionDigits: 0 });

/** `12345` → "12.345". */
export function inteiro(valor: number): string {
  return INTEIRO.format(valor);
}

/** `1_310_720` bytes → "1,3 MB" (em MiB, como o sistema mostra). */
export function megabytes(bytes: number): string {
  return `${DECIMAL_1.format(bytes / 1_048_576)} MB`;
}

/** Só o número de MB, para "12,3 de 45,6 MB". */
export function numeroMegabytes(bytes: number): string {
  return DECIMAL_1.format(bytes / 1_048_576);
}

const DATA = new Intl.DateTimeFormat(LINGUA, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const DATA_EXTENSO = new Intl.DateTimeFormat(LINGUA, {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const DATA_HORA = new Intl.DateTimeFormat(LINGUA, { dateStyle: "short", timeStyle: "short" });
const DATA_LOCAL = new Intl.DateTimeFormat(LINGUA, { day: "2-digit", month: "2-digit", year: "numeric" });

/** A data no começo de um texto ISO (`2026-11-12`, `2026-11-12T03:00:00Z`), em UTC; `null` se não é data. */
function dataIso(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const data = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(data.getTime()) ? null : data;
}

/** `2026-11-12` → "12/11/2026"; o que não é data fica como veio. */
export function dataCurta(iso: string): string {
  const data = dataIso(iso);
  return data === null ? iso : DATA.format(data);
}

/** `2026-11-11` → "11 de novembro de 2026"; o que não é data fica como veio. */
export function dataPorExtenso(iso: string): string {
  const data = dataIso(iso);
  return data === null ? iso : DATA_EXTENSO.format(data);
}

function instante(quando: string | number | Date): Date | null {
  const data = quando instanceof Date ? quando : new Date(quando);
  return Number.isNaN(data.getTime()) ? null : data;
}

/** Um instante (ISO com hora, milissegundos) no fuso do computador: "12/11/2026, 14:05". */
export function dataHora(quando: string | number | Date): string {
  const data = instante(quando);
  return data === null ? String(quando) : DATA_HORA.format(data);
}

/** Só o dia de um instante, no fuso do computador: "12/11/2026". */
export function diaDe(quando: string | number | Date): string {
  const data = instante(quando);
  return data === null ? String(quando) : DATA_LOCAL.format(data);
}
