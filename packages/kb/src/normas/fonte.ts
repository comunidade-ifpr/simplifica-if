/**
 * Fonte oficial de uma norma, em dois campos do front matter (e de `stubs.yaml`):
 *
 * - `fonte_url`: o endereço público do texto oficial (DOU, Planalto, portal do IFPR), só `https`;
 * - `fonte_referencia`: a referência sem link (número do SEI, Boletim de Serviço, PDF assinado).
 *
 * Toda norma e todo stub têm um dos dois (ou ambos): o esquema recusa a norma sem fonte. Sem
 * `fonte_url`, a referência é só a de `fonte_referencia` (por exemplo, o DOU sem página por ato).
 */
import * as Schema from "effect/Schema";

/** URL `https` sem espaços: a `fonte_url` das normas e a do front matter de proveniência dos PPCs. */
export const RE_URL_HTTPS = /^https:\/\/\S+$/;

/** URL `https` do texto oficial, sem espaços. A marca impede tomar por link um texto qualquer. */
export const UrlOficial = Schema.String.check(
  Schema.isPattern(RE_URL_HTTPS, { message: "fonte_url deve ser URL https, sem espaços" }),
).pipe(Schema.brand("UrlOficial"));
export type UrlOficial = typeof UrlOficial.Type;
