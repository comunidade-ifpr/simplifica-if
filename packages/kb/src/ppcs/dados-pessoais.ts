/**
 * Dados pessoais no texto dos PPCs convertidos e dos derivados da base. Declarações, termos de
 * convênio, quadros de pessoal e currículos anexos aos PPCs trazem números de pessoas; a base os
 * publica com um marcador neutro e mantém o rótulo, o nome e o resto da frase.
 *
 * O que é omitido (política da base, descrita também no AGENTS.md):
 *
 * - CPF → `[CPF omitido]`: o número depois do rótulo `CPF` (com `nº`, dois-pontos, negrito, `|` ou
 *   `<br>` no meio, como numa célula de tabela) e o número formatado `000.000.000-00` sem rótulo
 *   quando o dígito verificador confere. Onze dígitos soltos não contam (IDs do Lattes e ISBN
 *   quebrados pela conversão casariam por acaso).
 * - RG → `[RG omitido]`: o número (com UF opcional, como `MG-12.345.678`, e grupos separados por
 *   ponto ou espaço) depois de `RG`, `R.G.`, `R.G`, `Registro Geral`, `cédula`/`carteira`/`doc. de
 *   identidade` ou `Identidade:`. Número com menos de 5 dígitos (um ano) não é RG, e `R.G.` depois de
 *   iniciais de autor (`JORDÃO, R.G. 2010`) é referência bibliográfica.
 * - `RG/CPF:` seguido de dois números → os dois marcadores, sem sobrar dígito.
 * - Celular → `[telefone omitido]`: 9 dígitos começando por 9, com DDD (`(41) 99999-9999`,
 *   `41 9 9999 9999`, `+55 41 …`) ou, sem DDD, com separador (`99999-9999`). Telefone fixo fica.
 * - Matrícula de estudante → `[matrícula omitida]`: 11 dígitos começando pelo ano (`20xx…`), fora de
 *   link do Lattes quebrado por `<br>`.
 * - SIAPE → `[SIAPE omitido]`: o número depois do rótulo `SIAPE` e os números da coluna `SIAPE` de
 *   uma tabela Markdown. O nome do servidor fica.
 *
 * Fica: nome de pessoa em ato oficial ou quadro docente, e-mail institucional, telefone fixo,
 * endereço e contato de campus e de parceiros.
 *
 * `dados-pessoais.casos.json` é o conjunto de casos que o teste aplica.
 * O `validar_base` recusa o que esta regra acharia (`contarDadosPessoais`).
 */

export const MARCADORES = {
  cpf: "[CPF omitido]",
  rg: "[RG omitido]",
  telefone: "[telefone omitido]",
  matricula: "[matrícula omitida]",
  siape: "[SIAPE omitido]",
} as const;
export type Categoria = keyof typeof MARCADORES;
export type Contagem = Record<Categoria, number>;

/** Fronteira de palavra que conhece letras acentuadas (`\b` acharia "rg" em "órgão"). */
const INICIO = String.raw`(?<![\p{L}\d])`;
const FIM = String.raw`(?![\p{L}])`;
/** Entre o rótulo e o número: espaços, negrito, dois-pontos, `|`, `<br>`, `nº`/`n°`/`n.º`/`número`. */
const SEPARADOR = String.raw`(?:[\s*_:|]|<br\s*/?>|n\.?\s?[º°o]\.?(?![\p{L}])|n[º°]|número)*`;
const NUMERO_CPF = String.raw`\d{3}[.\s]?\d{3}[.\s]?\d{3}\s?[-–.]?\s?\d{2}(?!\d)`;
const NUMERO_RG = String.raw`(?:[A-Z]{2}[-\s]?)?(?:\d{1,3}(?:[.\s]\d{3}){1,3}|\d{4,13})(?:\s?[-–]\s?[\dXx])?(?![\d])`;
const ROTULO_RG = String.raw`(?:RG|R\.G\.?|Registro\s+Geral|(?:c[ée]dula|carteira|doc(?:umento)?\.?)\s+de\s+identidade|identidade(?=\s*:))`;

const RE_RG_CPF = new RegExp(
  String.raw`(${INICIO}(RG|CPF)\s*(?:/|e)\s*(?:RG|CPF)${FIM}${SEPARADOR})(${NUMERO_RG}|${NUMERO_CPF})(\s*(?:/|,|e)\s*)(${NUMERO_CPF}|${NUMERO_RG})`,
  "giu",
);
const RE_CPF_ROTULADO = new RegExp(String.raw`(${INICIO}CPF${FIM}${SEPARADOR})(${NUMERO_CPF})`, "giu");
const RE_RG_ROTULADO = new RegExp(String.raw`(${INICIO}${ROTULO_RG}${FIM}${SEPARADOR})(${NUMERO_RG})`, "giu");
const RE_CPF_FORMATADO = /(?<![\d.])(\d{3})\.(\d{3})\.(\d{3})-(\d{2})(?!\d)/g;
const RE_CELULAR = new RegExp(
  String.raw`(?<![\d/.,])(?:(?:\+55\s?)?(?:\(0?\d{2}\)\s?|0?\d{2}[\s.-])9\s?\d{4}[\s.-]?\d{4}|9\d{4}[\s-]\d{4}|9\s\d{4}[\s-]\d{4})(?![\d])`,
  "gu",
);
const RE_MATRICULA = /(?<![\d/])(?<!\d<br>)20[0-2]\d{8}(?!\d)/g;
const RE_SIAPE_ROTULADO = new RegExp(
  String.raw`(${INICIO}SIAPE${FIM}(?:[\s*_:|.\-–]|<br\s*/?>|n\.?\s?[º°o]\.?(?![\p{L}])|n[º°])*)(\d{4,8})(?!\d)`,
  "giu",
);
/** Iniciais de autor antes do rótulo (`SOBRENOME, R.G.`): referência bibliográfica, não RG. */
const RE_AUTOR_ANTES = /[A-ZÀ-Ý]{2,},\s*(?:[A-Z]\.\s?)*$/u;

const digitos = (texto: string) => texto.replace(/\D/g, "").length;

/** Dígitos verificadores do CPF (módulo 11); sequências repetidas não valem. */
export function cpfValido(numero: string): boolean {
  if (!/^\d{11}$/.test(numero) || /^(\d)\1{10}$/.test(numero)) return false;
  const numeros = [...numero].map(Number);
  for (const tamanho of [9, 10]) {
    const soma = numeros.slice(0, tamanho).reduce((total, digito, i) => total + digito * (tamanho + 1 - i), 0);
    if (((soma * 10) % 11) % 10 !== numeros[tamanho]) return false;
  }
  return true;
}

const marcadorDoRotulo = (rotulo: string) => (rotulo.toUpperCase() === "CPF" ? MARCADORES.cpf : MARCADORES.rg);
const rgValido = (numero: string, texto: string, inicio: number) =>
  digitos(numero) >= 5 && !RE_AUTOR_ANTES.test(texto.slice(Math.max(0, inicio - 60), inicio));

/** Linha de tabela Markdown (`| a | b |`) → células, sem as bordas. */
function celulas(linha: string): string[] | null {
  const aparada = linha.trim();
  if (!aparada.startsWith("|")) return null;
  return aparada.replace(/^\|/, "").replace(/\|$/, "").split("|");
}

/** Números das colunas `SIAPE` de tabelas Markdown, linha a linha; conta e, se `trocar`, omite. */
function colunasSiape(texto: string, contagem: { n: number }): string {
  const linhas = texto.split("\n");
  let colunas: number[] = [];
  for (let i = 0; i < linhas.length; i += 1) {
    const partes = celulas(linhas[i]!);
    if (partes === null) {
      colunas = [];
      continue;
    }
    const comSiape = partes.flatMap((celula, indice) => (/SIAPE/i.test(celula) ? [indice] : []));
    if (comSiape.length) {
      colunas = comSiape;
      continue;
    }
    if (!colunas.length) continue;
    let mudou = false;
    const novas = partes.map((celula, indice) => {
      if (
        !colunas.includes(indice) ||
        !/^[\s*_]*\d{4,8}(?:[\s*_]*(?:<br\s*\/?>|,|\/)[\s*_]*\d{4,8})*[\s*_]*$/.test(celula)
      ) {
        return celula;
      }
      mudou = true;
      return celula.replace(/\d{4,8}/g, () => {
        contagem.n += 1;
        return MARCADORES.siape;
      });
    });
    if (mudou) linhas[i] = linhas[i]!.replace(partes.join("|"), novas.join("|"));
  }
  return linhas.join("\n");
}

/** Aplica as regras em ordem; devolve o texto omitido e quantos de cada categoria trocou. */
export function aplicarOmissao(texto: string): { texto: string; contagem: Contagem } {
  const contagem: Contagem = { cpf: 0, rg: 0, telefone: 0, matricula: 0, siape: 0 };
  let saida = texto.replace(
    RE_RG_CPF,
    (
      casado: string,
      rotulo: string,
      primeiro: string,
      a: string,
      meio: string,
      b: string,
      inicio: number,
      todo: string,
    ) => {
      if (digitos(a) < 5 || digitos(b) < 5 || !rgValido(a, todo, inicio)) return casado;
      const segundo = primeiro.toUpperCase() === "CPF" ? "RG" : "CPF";
      contagem[primeiro.toUpperCase() === "CPF" ? "cpf" : "rg"] += 1;
      contagem[segundo === "CPF" ? "cpf" : "rg"] += 1;
      return `${rotulo}${marcadorDoRotulo(primeiro)}${meio}${marcadorDoRotulo(segundo)}`;
    },
  );
  saida = saida.replace(RE_CPF_ROTULADO, (_: string, rotulo: string) => {
    contagem.cpf += 1;
    return `${rotulo}${MARCADORES.cpf}`;
  });
  saida = saida.replace(
    RE_RG_ROTULADO,
    (casado: string, rotulo: string, numero: string, inicio: number, todo: string) => {
      if (!rgValido(numero, todo, inicio)) return casado;
      contagem.rg += 1;
      return `${rotulo}${MARCADORES.rg}`;
    },
  );
  saida = saida.replace(RE_CPF_FORMATADO, (casado: string, a: string, b: string, c: string, d: string) => {
    if (!cpfValido(`${a}${b}${c}${d}`)) return casado;
    contagem.cpf += 1;
    return MARCADORES.cpf;
  });
  saida = saida.replace(RE_SIAPE_ROTULADO, (_: string, rotulo: string) => {
    contagem.siape += 1;
    return `${rotulo}${MARCADORES.siape}`;
  });
  const siapeTabela = { n: 0 };
  saida = colunasSiape(saida, siapeTabela);
  contagem.siape += siapeTabela.n;
  saida = saida.replace(RE_MATRICULA, () => {
    contagem.matricula += 1;
    return MARCADORES.matricula;
  });
  saida = saida.replace(RE_CELULAR, () => {
    contagem.telefone += 1;
    return MARCADORES.telefone;
  });
  return { texto: saida, contagem };
}

/** Texto com os dados pessoais trocados pelos marcadores. */
export function omitirDadosPessoais(texto: string): string {
  return aplicarOmissao(texto).texto;
}

/** Quantos dados pessoais de cada categoria a omissão trocaria; só contagens, para não repetir o número. */
export function contarDadosPessoais(texto: string): Contagem {
  return aplicarOmissao(texto).contagem;
}

export function totalDadosPessoais(contagem: Contagem): number {
  return Object.values(contagem).reduce((total, n) => total + n, 0);
}
