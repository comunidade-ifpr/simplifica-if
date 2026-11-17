/**
 * Números de documento pessoal (CPF e RG) no texto dos PPCs convertidos. Declarações, termos de
 * convênio e currículos anexos aos PPCs trazem CPF e RG de servidores e de representantes de
 * parceiros; a base os publica como `[CPF omitido]` e `[RG omitido]`, mantendo o rótulo e o resto
 * da frase.
 *
 * - CPF: o número depois do rótulo `CPF` (com ou sem `nº`, dois-pontos ou negrito), em qualquer
 *   grafia (pontos, espaços, hífen), e o número formatado `000.000.000-00` sem rótulo quando o
 *   dígito verificador confere. Onze dígitos soltos não contam: IDs do Lattes e ISBN quebrados
 *   pela conversão casariam por acaso.
 * - RG: o número depois de `RG`, `R.G.`, `Registro Geral` ou `cédula`/`carteira de identidade`.
 *
 * A mesma regra está em `scripts/converter_ppcs_markdown.py` (`omitir_documentos_pessoais`), que é
 * por onde os PPCs entram na base; `dados-pessoais.test.ts` confere as duas sobre os mesmos casos.
 * O `validar_base` recusa o que esta regra acharia (`contarDocumentosPessoais`).
 */

export const MARCADOR_CPF = "[CPF omitido]";
export const MARCADOR_RG = "[RG omitido]";

/** Entre o rótulo e o número: espaços, negrito, dois-pontos, `nº`/`n°`/`n.º`/`número`. */
const SEPARADOR = String.raw`(?:[\s*_:]|n\.?\s?[º°o]\.?|n[º°]|número)*`;
const NUMERO_CPF = String.raw`\d{3}[.\s]?\d{3}[.\s]?\d{3}\s?[-–.]?\s?\d{2}(?!\d)`;
const NUMERO_RG = String.raw`\d(?:[\d.]{2,12}\d|\d{2,12})(?:\s?[-–]\s?[\dXx])?(?![\d])`;

/** Fronteira de palavra que conhece letras acentuadas (`\b` acharia "rg" em "órgão"). */
const INICIO = String.raw`(?<![\p{L}\d])`;
const FIM = String.raw`(?![\p{L}])`;
const RE_CPF_ROTULADO = new RegExp(String.raw`(${INICIO}CPF${FIM}${SEPARADOR})(${NUMERO_CPF})`, "giu");
const RE_RG_ROTULADO = new RegExp(
  String.raw`(${INICIO}(?:RG|R\.G\.|Registro\s+Geral|(?:c[ée]dula|carteira)\s+de\s+identidade)${FIM}${SEPARADOR})(${NUMERO_RG})`,
  "giu",
);
const RE_CPF_FORMATADO = /(?<![\d.])(\d{3})\.(\d{3})\.(\d{3})-(\d{2})(?!\d)/g;

/** Dígitos verificadores do CPF (módulo 11); sequências repetidas não valem. */
export function cpfValido(digitos: string): boolean {
  if (!/^\d{11}$/.test(digitos) || /^(\d)\1{10}$/.test(digitos)) return false;
  const numeros = [...digitos].map(Number);
  for (const tamanho of [9, 10]) {
    const soma = numeros.slice(0, tamanho).reduce((total, digito, i) => total + digito * (tamanho + 1 - i), 0);
    if (((soma * 10) % 11) % 10 !== numeros[tamanho]) return false;
  }
  return true;
}

/** Texto com os números de CPF e RG trocados pelos marcadores. */
export function omitirDocumentosPessoais(texto: string): string {
  return texto
    .replace(RE_CPF_ROTULADO, (_, rotulo: string) => `${rotulo}${MARCADOR_CPF}`)
    .replace(RE_RG_ROTULADO, (_, rotulo: string) => `${rotulo}${MARCADOR_RG}`)
    .replace(RE_CPF_FORMATADO, (casado: string, a: string, b: string, c: string, d: string) =>
      cpfValido(`${a}${b}${c}${d}`) ? MARCADOR_CPF : casado,
    );
}

/** Quantos CPF e RG a omissão trocaria; só contagens, para não repetir o número em mensagens. */
export function contarDocumentosPessoais(texto: string): { cpf: number; rg: number } {
  const rotulados = [...texto.matchAll(RE_CPF_ROTULADO)].length;
  const semRotulo = texto.replace(RE_CPF_ROTULADO, "");
  const formatados = [...semRotulo.matchAll(RE_CPF_FORMATADO)].filter((m) =>
    cpfValido(`${m[1]}${m[2]}${m[3]}${m[4]}`),
  ).length;
  return { cpf: rotulados + formatados, rg: [...texto.matchAll(RE_RG_ROTULADO)].length };
}
