/**
 * Valores JSON tipados, para os arquivos que precisam sair sempre iguais, byte a
 * byte (os artefatos da conversão).
 *
 * O JSON tipado distingue `1` (inteiro) de `1.0` (fracionário); o número do
 * JavaScript não. Por isso os fracionários lidos por `carregarJsonTipado` (e os
 * criados pelo código quando o valor é fracionário) são `Flutuante`, que
 * `serializarJsonTipado` escreve com `reprFloat`. `valueOf` permite comparar e
 * ordenar como número. Inteiros fora da faixa segura do JavaScript são lidos como
 * `bigint`.
 */
import { representar } from "../json.ts";
import { aparar } from "../texto.ts";

export class Flutuante {
  readonly valor: number;
  constructor(valor: number) {
    this.valor = valor;
  }
  valueOf(): number {
    return this.valor;
  }
  toString(): string {
    return reprFloat(this.valor);
  }
}

/** Ordem original das chaves de um objeto lido do JSON, quando ele tem chaves numéricas (que o JS reordena). */
export const ORDEM_CHAVES: unique symbol = Symbol("ordemChaves");

export type Dicionario = { [chave: string]: unknown; [ORDEM_CHAVES]?: string[] };

export function ehDicionario(valor: unknown): valor is Dicionario {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor) && !(valor instanceof Flutuante);
}

/** Inteiro (booleanos contam como inteiros). */
export function ehInteiroOuLogico(valor: unknown): valor is number | bigint | boolean {
  return (
    typeof valor === "boolean" || typeof valor === "bigint" || (typeof valor === "number" && Number.isInteger(valor))
  );
}

/** Fracionário: `Flutuante` ou número não inteiro criado em JS. */
export function ehFlutuante(valor: unknown): boolean {
  return valor instanceof Flutuante || (typeof valor === "number" && !Number.isInteger(valor));
}

/** Inteiro ou fracionário. */
export function ehNumerico(valor: unknown): boolean {
  return ehInteiroOuLogico(valor) || ehFlutuante(valor);
}

/** Valor numérico de um inteiro ou fracionário (booleano vira 0/1). */
export function valorNumerico(valor: unknown): number {
  if (valor instanceof Flutuante) return valor.valor;
  if (typeof valor === "boolean") return valor ? 1 : 0;
  if (typeof valor === "bigint") return Number(valor);
  if (typeof valor === "number") return valor;
  throw new TypeError(`não é número: ${representacaoDoValor(valor)}`);
}

/** Chaves de um objeto na ordem de inserção (a do documento, mesmo com chaves numéricas). */
export function chavesNaOrdem(objeto: Dicionario): string[] {
  const chaves = Object.keys(objeto);
  const ordem = objeto[ORDEM_CHAVES];
  if (!ordem) return chaves;
  const existentes = new Set(chaves);
  const ordenadas = ordem.filter((chave) => existentes.has(chave));
  const vistas = new Set(ordenadas);
  return [...ordenadas, ...chaves.filter((chave) => !vistas.has(chave))];
}

/** Pares `(chave, valor)` na ordem de inserção. */
export function itensNaOrdem(objeto: Dicionario): Array<[string, unknown]> {
  return chavesNaOrdem(objeto).map((chave) => [chave, objeto[chave]]);
}

/** Verdade de um valor: `null`, `false`, `0`, `0.0`, `""`, `[]` e `{}` são falsos. */
export function verdadeiro(valor: unknown): boolean {
  if (valor === null || valor === undefined || valor === false || valor === "") return false;
  if (typeof valor === "number") return valor !== 0;
  if (typeof valor === "bigint") return valor !== 0n;
  if (valor instanceof Flutuante) return valor.valor !== 0;
  if (Array.isArray(valor)) return valor.length > 0;
  if (typeof valor === "object") return Object.keys(valor).length > 0;
  return true;
}

/** O primeiro valor verdadeiro, ou o último. */
export function ou(...valores: unknown[]): unknown {
  for (const valor of valores) if (verdadeiro(valor)) return valor;
  return valores.at(-1);
}

/** Fracionário em texto: dígitos mais curtos, notação fixa para expoentes de -4 a 15 e `.0` em inteiros. */
export function reprFloat(valor: number): string {
  if (Number.isNaN(valor)) return "nan";
  if (valor === Infinity) return "inf";
  if (valor === -Infinity) return "-inf";
  if (valor === 0) return Object.is(valor, -0) ? "-0.0" : "0.0";
  const sinal = valor < 0 ? "-" : "";
  const [mantissa, expoenteTexto] = Math.abs(valor).toExponential().split("e") as [string, string];
  const digitos = mantissa.replace(".", "");
  const expoente = Number(expoenteTexto);
  const decpt = expoente + 1;
  if (decpt <= -4 || decpt > 16) {
    const corpo = digitos.length > 1 ? `${digitos[0]}.${digitos.slice(1)}` : digitos;
    const exp = Math.abs(expoente).toString().padStart(2, "0");
    return `${sinal}${corpo}e${expoente < 0 ? "-" : "+"}${exp}`;
  }
  if (decpt <= 0) return `${sinal}0.${"0".repeat(-decpt)}${digitos}`;
  if (decpt >= digitos.length) return `${sinal}${digitos}${"0".repeat(decpt - digitos.length)}.0`;
  return `${sinal}${digitos.slice(0, decpt)}.${digitos.slice(decpt)}`;
}

/** Representação exata de um double como `mantissa * 2 ** expoente`. */
function decomporDouble(valor: number): { mantissa: bigint; expoente: number } {
  const visao = new DataView(new ArrayBuffer(8));
  visao.setFloat64(0, valor);
  const bits = visao.getBigUint64(0);
  const expoenteBruto = Number((bits >> 52n) & 0x7ffn);
  const fracao = bits & ((1n << 52n) - 1n);
  const negativo = bits >> 63n === 1n;
  const mantissa = expoenteBruto === 0 ? fracao : fracao | (1n << 52n);
  const expoente = (expoenteBruto === 0 ? 1 : expoenteBruto) - 1075;
  return { mantissa: negativo ? -mantissa : mantissa, expoente };
}

/** Arredonda o valor binário exato a `casas` decimais, com empate para o par. */
export function arredondarParaPar(valor: number, casas: number): number {
  if (!Number.isFinite(valor) || valor === 0) return valor;
  const { mantissa, expoente } = decomporDouble(valor);
  const negativo = mantissa < 0n;
  const absoluta = negativo ? -mantissa : mantissa;
  const escala = 10n ** BigInt(casas);
  let inteiro: bigint;
  if (expoente >= 0) {
    inteiro = absoluta * escala * (1n << BigInt(expoente));
  } else {
    const numerador = absoluta * escala;
    const denominador = 1n << BigInt(-expoente);
    inteiro = numerador / denominador;
    const resto = numerador % denominador;
    const dobro = resto * 2n;
    if (dobro > denominador || (dobro === denominador && inteiro % 2n === 1n)) inteiro += 1n;
  }
  const resultado = Number(`${negativo ? "-" : ""}${inteiro}e-${casas}`);
  return resultado === 0 && negativo ? -0 : resultado;
}

/**
 * Número com `casas` decimais fixas: arredonda o valor binário exato com empate
 * para o par (o `toFixed` do JavaScript desempata para cima: `0.125` dá `0.13`;
 * aqui, `0.12`) e mantém o sinal de `-0.0`.
 */
export function formatoFixo(valor: number, casas: number): string {
  if (Number.isNaN(valor)) return "nan";
  if (!Number.isFinite(valor)) return valor > 0 ? "inf" : "-inf";
  const arredondado = arredondarParaPar(valor, casas);
  const texto = Math.abs(arredondado).toFixed(casas);
  const negativo = arredondado < 0 || Object.is(arredondado, -0);
  return negativo ? `-${texto}` : texto;
}

/** Representação de um valor JSON: texto entre aspas simples, `None`, `True`, `False`, listas e objetos com `, ` e `: `. */
export function representacaoDoValor(valor: unknown): string {
  if (valor === null || valor === undefined) return "None";
  if (typeof valor === "boolean") return valor ? "True" : "False";
  if (typeof valor === "bigint") return valor.toString();
  if (typeof valor === "number") return Number.isInteger(valor) ? String(valor) : reprFloat(valor);
  if (valor instanceof Flutuante) return reprFloat(valor.valor);
  if (typeof valor === "string") return representar(valor);
  if (Array.isArray(valor)) return `[${valor.map(representacaoDoValor).join(", ")}]`;
  if (ehDicionario(valor)) {
    return `{${itensNaOrdem(valor)
      .map(([chave, item]) => `${representar(chave)}: ${representacaoDoValor(item)}`)
      .join(", ")}}`;
  }
  return String(valor);
}

/** Texto de um valor JSON: texto como está, demais valores em `representacaoDoValor`. */
export function textoDoValor(valor: unknown): string {
  return typeof valor === "string" ? valor : representacaoDoValor(valor);
}

/** Itens percorridos num laço (lista, caracteres de texto, chaves de objeto); outros tipos lançam `TypeError`. */
export function itensIteraveis(valor: unknown): unknown[] {
  if (Array.isArray(valor)) return [...valor];
  if (typeof valor === "string") return Array.from(valor);
  if (ehDicionario(valor)) return chavesNaOrdem(valor);
  throw new TypeError(`'${tipoDoValor(valor)}' object is not iterable`);
}

/** Nome do tipo de um valor JSON (`str`, `int`, `float`, `bool`, `list`, `dict`, `NoneType`), usado nas mensagens de erro. */
export function tipoDoValor(valor: unknown): string {
  if (valor === null || valor === undefined) return "NoneType";
  if (typeof valor === "boolean") return "bool";
  if (ehInteiroOuLogico(valor)) return "int";
  if (ehFlutuante(valor)) return "float";
  if (typeof valor === "string") return "str";
  if (Array.isArray(valor)) return "list";
  return "dict";
}

/** Inteiro de um valor JSON (texto com dígitos decimais, número truncado, booleano 0/1). */
export function inteiroDoValor(valor: unknown): number {
  if (typeof valor === "boolean") return valor ? 1 : 0;
  if (typeof valor === "bigint") return Number(valor);
  if (typeof valor === "number" || valor instanceof Flutuante) {
    const numero = valorNumerico(valor);
    if (!Number.isFinite(numero)) throw new RangeError(`cannot convert float ${reprFloat(numero)} to integer`);
    return Math.trunc(numero);
  }
  if (typeof valor === "string") {
    const convertido = inteiroDeTexto(valor);
    if (convertido === null) throw new SyntaxError(`invalid literal for int() with base 10: ${representar(valor)}`);
    return convertido;
  }
  throw new TypeError(
    `int() argument must be a string, a bytes-like object or a real number, not '${tipoDoValor(valor)}'`,
  );
}

const RE_INTEIRO = /^[+-]?\p{Nd}+(?:_\p{Nd}+)*$/u;
const RE_DIGITO = /^\p{Nd}$/u;

/** Converte dígitos decimais Unicode (`\p{Nd}`) para ASCII. */
export function digitosAscii(texto: string): string {
  return texto.replace(/\p{Nd}/gu, (digito) => {
    const codigo = digito.codePointAt(0)!;
    if (codigo >= 0x30 && codigo <= 0x39) return digito;
    // Os dígitos decimais Unicode vêm em sequências contíguas de 0 a 9 (às vezes
    // várias seguidas): o valor é a distância ao início da sequência, módulo 10.
    let inicio = codigo;
    while (inicio > 0 && RE_DIGITO.test(String.fromCodePoint(inicio - 1))) inicio -= 1;
    return String((codigo - inicio) % 10);
  });
}

/** Inteiro de um texto em base 10, ou `null` quando o texto não é um inteiro. */
export function inteiroDeTexto(texto: string): number | null {
  const limpo = aparar(texto);
  if (!RE_INTEIRO.test(limpo)) return null;
  return Number(digitosAscii(limpo.replaceAll("_", "")));
}

/** Valor da chave, ou `padrao` (só chaves próprias, nunca do protótipo). */
export function obter(objeto: Dicionario, chave: string, padrao: unknown = null): unknown {
  return Object.hasOwn(objeto, chave) ? objeto[chave] : padrao;
}

/** Valor da chave; lança `KeyError` quando a chave falta. */
export function obrigatorio(objeto: Dicionario, chave: string): unknown {
  if (!Object.hasOwn(objeto, chave)) throw new Error(`KeyError: ${representar(chave)}`);
  return objeto[chave];
}

/** Valor da chave; quando ela falta, grava `valor` e o devolve. */
export function padraoSeAusente(objeto: Dicionario, chave: string, valor: unknown): unknown {
  if (!Object.hasOwn(objeto, chave)) objeto[chave] = valor;
  return objeto[chave];
}

/** Texto do valor, ou `""` quando ele é falso. */
export function textoOuVazioDoValor(valor: unknown): string {
  return verdadeiro(valor) ? textoDoValor(valor) : "";
}
