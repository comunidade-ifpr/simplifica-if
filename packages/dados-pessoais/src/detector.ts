/**
 * O detector local de dados pessoais (M1.13): procura num texto CPF, RG, telefone e e-mail fora do
 * domínio institucional, sem rede e sem IA. Serve ao aviso ao anexar (o servidor lê o arquivo num
 * `Worker` e passa o texto para cá) e ao relato de "Isto está errado" (M1.12), que a interface confere
 * antes de enviar. Não depende do Node: a interface o importa.
 *
 * O detector avisa; não bloqueia. PPCs e normas trazem nomes, cargos e contatos de atos oficiais, e a
 * decisão de enviar é da pessoa. Por isso as regras preferem deixar passar a avisar em excesso, e cada
 * uma foi medida contra os PPCs da base (`scripts/medir-ppcs.ts`, números no README):
 *
 * - **CPF:** o formato completo `000.000.000-00` com os dois dígitos verificadores válidos (e não
 *   todos iguais). Outras grafias (`00000000000`, `000000000-00`) só contam com "CPF" logo antes,
 *   porque onze dígitos soltos com DV válido aparecem por acaso em 1 de cada 100 números.
 * - **RG:** não tem formato nacional nem dígito conferível; só conta com "RG", "R.G.", "Registro
 *   Geral" ou "Carteira/Cédula de Identidade" logo antes, e de 5 a 13 dígitos.
 * - **Telefone:** só celular (nove dígitos começando por 9), com DDD válido entre parênteses
 *   (`(41) 99999-1234`), com `+55`, com DDD sem parênteses (`41 99999-1234`) ou sem DDD logo depois de
 *   "telefone", "fone", "celular", "WhatsApp" ou "contato". **Telefone fixo não conta:** nos PPCs ele
 *   é o do campus, da secretaria ou de órgão parceiro (200 dos 244 telefones achados; com os fixos, 61%
 *   dos PPCs dariam aviso, e um aviso que aparece sempre deixa de ser lido). Os 0800 também ficam de fora.
 * - **E-mail:** todo endereço fora de `ifpr.edu.br` e dos subdomínios dele.
 *
 * Os números ao lado de outros dígitos, barras ou pontos (processo SEI `23411.012345/2024-12`, CNPJ
 * `10.652.179/0001-15`, datas, códigos de curso, SIAPE de 7 dígitos) não entram: as regras exigem
 * fronteira de número dos dois lados.
 */

export type TipoDado = "cpf" | "rg" | "telefone" | "email";

export const TIPOS_DADO: ReadonlyArray<TipoDado> = ["cpf", "rg", "telefone", "email"];

/** O nome de cada tipo para a pessoa, no singular e no plural. */
export const NOMES_TIPO: Readonly<Record<TipoDado, { readonly um: string; readonly varios: string }>> = {
  cpf: { um: "CPF", varios: "CPFs" },
  rg: { um: "RG", varios: "RGs" },
  telefone: { um: "celular", varios: "celulares" },
  email: { um: "e-mail pessoal", varios: "e-mails pessoais" },
};

/** Um dado encontrado: onde está no texto (`inicio` e `fim`, como `slice`) e a forma mascarada. */
export interface Achado {
  readonly tipo: TipoDado;
  readonly inicio: number;
  readonly fim: number;
  readonly mascarado: string;
}

/* ================================================================== regras */

/** Os dois dígitos verificadores do CPF conferem (e os onze não são todos iguais). */
export function cpfValido(digitos: string): boolean {
  if (!/^\d{11}$/.test(digitos) || /^(\d)\1{10}$/.test(digitos)) return false;
  const dv = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(digitos[i]) * (n + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return dv(9) === Number(digitos[9]) && dv(10) === Number(digitos[10]);
}

/** Os DDDs que existem no Brasil (Anatel). */
const DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48,
  49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/** Um e-mail do IFPR: `ifpr.edu.br` ou um subdomínio dele. */
export function emailInstitucional(endereco: string): boolean {
  const dominio = endereco.slice(endereco.lastIndexOf("@") + 1).toLowerCase();
  return dominio === "ifpr.edu.br" || dominio.endsWith(".ifpr.edu.br");
}

const RE_EMAIL =
  /(?<![\w.%+-])[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}(?![\w-])/g;

/** CPF em qualquer das grafias; a fronteira impede o pedaço de um número maior (CNPJ, processo). */
const RE_CPF = /(?<![\w.,/-])\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2}(?![\w]|[.,/-]\d)/g;
const CPF_FORMATADO = /^\d{3}\.\d{3}\.\d{3}-\d{2}$/;
/** "CPF" (ou "C.P.F.") até 25 caracteres antes do número. */
const ANTES_CPF = /\bC\.?P\.?F\.?\b[^\n]{0,25}$/i;

const RE_RG =
  /\b(?:RG|R\.\s?G\.|Registro\s+Geral|(?:Carteira|C[ée]dula)\s+de\s+Identidade)(?:\s*(?:n[º°o]\.?|n[uú]mero|:|-))?\s*(\d[\d.\s-]{3,16}[\dXx])(?![\w]|[.,/-]\d)/gi;

/** Celular com DDD entre parênteses ou com +55. */
const RE_TELEFONE_DDD =
  /(?<![\w])(?:\+\s?55\s?)?\((\d{2})\)\s?(9\s?\d{4})[-.\s]?(\d{4})(?![\w]|[.,/-]\d)|(?<![\w+])\+\s?55[\s.-]?(\d{2})[\s.-]?(9\s?\d{4})[-.\s]?(\d{4})(?![\w]|[.,/-]\d)/g;
/** Celular com DDD sem parênteses: `41 99999-1234`, `41-99999-1234`. */
const RE_CELULAR = /(?<![\w.,/-])(\d{2})[\s.-]?(9\d{4})-(\d{4})(?![\w]|[.,/-]\d)/g;
/** Celular sem DDD logo depois da palavra que o anuncia. */
const RE_TELEFONE_CONTEXTO =
  /\b(?:tel(?:efone)?s?|fones?|celular(?:es)?|cel|whats\s?app|contato)\b\.?\s*(?:n[º°o]\.?\s*)?:?\s*(9\d{4})-(\d{4})(?![\w]|[.,/-]\d)/gi;

/* ================================================================== máscaras */

/** Troca cada dígito por `*`, menos os `primeiros` e os `ultimos` dígitos; a pontuação fica. */
function mascararDigitos(valor: string, primeiros: number, ultimos: number): string {
  const total = valor.replace(/\D/g, "").length;
  let visto = 0;
  return valor.replace(/\d/g, (digito) => {
    visto++;
    return visto <= primeiros || visto > total - ultimos ? digito : "*";
  });
}

/** `joao.silva@gmail.com` → `j***@g***.com`. */
function mascararEmail(endereco: string): string {
  const arroba = endereco.lastIndexOf("@");
  const [primeiro = "", ...resto] = endereco.slice(arroba + 1).split(".");
  return `${endereco[0]}***@${primeiro[0] ?? ""}***.${resto.join(".")}`;
}

/** A forma mascarada de um dado, para mostrar sem expor. */
export function mascarar(tipo: TipoDado, valor: string): string {
  const limpo = valor.replace(/\s+/g, " ").trim();
  switch (tipo) {
    case "cpf":
      return mascararDigitos(limpo, 3, 0);
    case "rg":
      return mascararDigitos(limpo, 2, 0);
    case "telefone": {
      // O DDD fica (e o 55 do país, se houver): diz de onde é, não de quem é.
      const digitos = limpo.replace(/\D/g, "");
      const visiveis = digitos.startsWith("55") && digitos.length >= 12 ? 4 : digitos.length >= 10 ? 2 : 0;
      return mascararDigitos(limpo, visiveis, 2);
    }
    case "email":
      return mascararEmail(limpo);
  }
}

/* ================================================================== detecção */

const PRIORIDADE: Readonly<Record<TipoDado, number>> = { email: 0, cpf: 1, rg: 2, telefone: 3 };

/** Os dados pessoais do texto, na ordem em que aparecem, sem sobreposição. */
export function detectarDadosPessoais(texto: string): ReadonlyArray<Achado> {
  const candidatos: Array<Omit<Achado, "mascarado">> = [];
  const adicionar = (tipo: TipoDado, inicio: number, fim: number) => candidatos.push({ tipo, inicio, fim });

  for (const achado of texto.matchAll(RE_EMAIL)) {
    if (!emailInstitucional(achado[0])) adicionar("email", achado.index, achado.index + achado[0].length);
  }
  for (const achado of texto.matchAll(RE_CPF)) {
    const valor = achado[0];
    if (!cpfValido(valor.replace(/\D/g, ""))) continue;
    const formatado = CPF_FORMATADO.test(valor);
    if (formatado || ANTES_CPF.test(texto.slice(Math.max(0, achado.index - 40), achado.index))) {
      adicionar("cpf", achado.index, achado.index + valor.length);
    }
  }
  for (const achado of texto.matchAll(RE_RG)) {
    const numero = achado[1]!;
    const digitos = numero.replace(/[^\dXx]/g, "");
    if (digitos.length < 5 || digitos.length > 13) continue;
    const inicio = achado.index + achado[0].lastIndexOf(numero);
    adicionar("rg", inicio, inicio + numero.length);
  }
  for (const achado of texto.matchAll(RE_TELEFONE_DDD)) {
    const ddd = Number(achado[1] ?? achado[4]);
    if (DDDS.has(ddd)) adicionar("telefone", achado.index, achado.index + achado[0].length);
  }
  for (const achado of texto.matchAll(RE_CELULAR)) {
    if (DDDS.has(Number(achado[1]))) adicionar("telefone", achado.index, achado.index + achado[0].length);
  }
  for (const achado of texto.matchAll(RE_TELEFONE_CONTEXTO)) {
    const numero = `${achado[1]}-${achado[2]}`;
    const inicio = achado.index + achado[0].lastIndexOf(achado[1]!);
    adicionar("telefone", inicio, inicio + numero.length);
  }

  // Sem sobreposição: na disputa, o que começa antes; no empate, o tipo de maior prioridade.
  candidatos.sort((a, b) => a.inicio - b.inicio || PRIORIDADE[a.tipo] - PRIORIDADE[b.tipo] || b.fim - a.fim);
  const achados: Array<Achado> = [];
  for (const candidato of candidatos) {
    const anterior = achados.at(-1);
    if (anterior !== undefined && candidato.inicio < anterior.fim) continue;
    achados.push({ ...candidato, mascarado: mascarar(candidato.tipo, texto.slice(candidato.inicio, candidato.fim)) });
  }
  return achados;
}

/**
 * O trecho em volta de um achado, com `raio` caracteres de cada lado, os espaços juntados e todos os
 * achados dentro dele mascarados: é o que se mostra à pessoa.
 */
export function trechoMascarado(
  texto: string,
  achado: Achado,
  achados: ReadonlyArray<Achado> = [achado],
  raio = 40,
): string {
  let inicio = Math.max(0, achado.inicio - raio);
  let fim = Math.min(texto.length, achado.fim + raio);
  // A janela não corta um achado vizinho ao meio (a metade apareceria sem máscara).
  for (const outro of achados) {
    if (outro.inicio < inicio && outro.fim > inicio) inicio = outro.inicio;
    if (outro.inicio < fim && outro.fim > fim) fim = outro.fim;
  }
  let saida = "";
  let posicao = inicio;
  for (const outro of achados) {
    if (outro.fim <= inicio || outro.inicio >= fim) continue;
    saida += texto.slice(posicao, outro.inicio) + outro.mascarado;
    posicao = outro.fim;
  }
  saida += texto.slice(posicao, fim);
  saida = saida.replace(/\s+/g, " ").trim();
  return `${inicio > 0 ? "…" : ""}${saida}${fim < texto.length ? "…" : ""}`;
}

/* ================================================================== resumo */

/** Um pedaço de um documento com o lugar dele, para a pessoa achar (`linha 12`, `parágrafo 40`). */
export interface Segmento {
  readonly onde: string;
  readonly texto: string;
}

export interface ExemploAchado {
  readonly tipo: TipoDado;
  readonly onde: string;
  /** O trecho em volta, com os dados mascarados. */
  readonly trecho: string;
}

export interface ResumoAchados {
  readonly total: number;
  readonly porTipo: Readonly<Record<TipoDado, number>>;
  /** Os primeiros achados, com o lugar e o trecho mascarado (no máximo `maximoExemplos`). */
  readonly exemplos: ReadonlyArray<ExemploAchado>;
}

export const MAXIMO_EXEMPLOS = 20;

/** Os achados de um documento inteiro: quantos de cada tipo e os primeiros, com lugar e trecho. */
export function resumirAchados(segmentos: Iterable<Segmento>, maximoExemplos: number = MAXIMO_EXEMPLOS): ResumoAchados {
  const porTipo: Record<TipoDado, number> = { cpf: 0, rg: 0, telefone: 0, email: 0 };
  const exemplos: Array<ExemploAchado> = [];
  let total = 0;
  for (const segmento of segmentos) {
    const achados = detectarDadosPessoais(segmento.texto);
    for (const achado of achados) {
      total++;
      porTipo[achado.tipo]++;
      if (exemplos.length < maximoExemplos) {
        exemplos.push({
          tipo: achado.tipo,
          onde: segmento.onde,
          trecho: trechoMascarado(segmento.texto, achado, achados),
        });
      }
    }
  }
  return { total, porTipo, exemplos };
}

/** "2 CPFs e 1 e-mail pessoal". */
export function descreverContagem(porTipo: Readonly<Record<TipoDado, number>>): string {
  const partes = TIPOS_DADO.filter((tipo) => porTipo[tipo] > 0).map(
    (tipo) => `${porTipo[tipo]} ${porTipo[tipo] === 1 ? NOMES_TIPO[tipo].um : NOMES_TIPO[tipo].varios}`,
  );
  if (partes.length <= 1) return partes.join("");
  return `${partes.slice(0, -1).join(", ")} e ${partes.at(-1)}`;
}
