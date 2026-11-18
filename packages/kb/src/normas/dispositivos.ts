/**
 * Dispositivos citados ("art. 28, inciso XVI", "§ 1º do art. 17", "arts. 61 a 63") → IDs no formato
 * do plano: `#art28-xvi`, `#art17-par1`, `#art61`. A letra de artigo vem colada e em maiúscula
 * (`#art36A`), como a de inciso (`#art9-ivA`); parágrafo é `-par<n>` ou `-parunico`; inciso é o
 * romano em minúsculas; alínea é sempre `-al-<letra>`, para que art. 36-A e alínea a do art. 36 não
 * se confundam; item é `-item<n>` (`#art4-i-al-a-item1`).
 *
 * Trabalha sobre texto já normalizado por `normalizarComMapa` (ASCII minúsculo, `§` → `$`).
 */

interface Dispositivo {
  art: string;
  par?: string;
  inc?: string;
  ali?: string;
  item?: string;
}

const RE_ROMANO = /^(?=[ivxlc])(?:c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/;

/** Tokens que formam uma cadeia de dispositivos (usados para recortar a janela antes/depois da citação). */
const TOKENS_DISPOSITIVO = [
  String.raw`arts?\b\.?`,
  String.raw`artigos?\b`,
  String.raw`\$\$?`,
  String.raw`paragrafos?\b`,
  String.raw`unico\b`,
  String.raw`par\.`,
  String.raw`incisos?\b`,
  String.raw`inc\.`,
  String.raw`alineas?\b`,
  String.raw`al\.`,
  String.raw`(?:item|itens)\b`,
  String.raw`caput\b`,
  String.raw`\d+\s*o?(?:\s*-\s*[a-z](?![a-z]))?`,
  String.raw`[ivxlc]+(?:-[a-z](?![a-z]))?(?![a-z])`,
  String.raw`["']?[a-z]["']?(?![a-z])`,
  String.raw`d[oa]s?\b`,
  String.raw`aos?\b`,
  String.raw`[,.;-]`,
  String.raw`\s+`,
];
/** Um token de dispositivo (alternância de `TOKENS_DISPOSITIVO`). */
const TOKEN_DISPOSITIVO = `(?:${TOKENS_DISPOSITIVO.join("|")})`;
const RE_INICIO_DISPOSITIVO = /\b(?:arts?\b|artigos?\b|incisos?\b|alineas?\b|item\b|itens\b|paragrafos?\b|caput\b)|\$/g;
/** Um regex fixo (sticky) por token, para a varredura linear de `soTokensDesde`. */
const RES_TOKEN = TOKENS_DISPOSITIVO.map((token) => new RegExp(token, "y"));
/**
 * Janela examinada antes de uma citação. As cadeias reais têm poucas dezenas de caracteres
 * ("alínea a do inciso II do § 1º do art. 5º"); a janela limita o custo em textos longos.
 */
const JANELA_DISPOSITIVO_ANTES = 160;

/**
 * `ok[p]`: o trecho `texto.slice(p)` é formado só por tokens de dispositivo. Programação dinâmica da
 * direita para a esquerda, com o casamento guloso de cada token em cada posição: O(n × tokens), sem o
 * retrocesso exponencial de `^(?:token)*$` quando tokens se sobrepõem (espaços, `<br>` normalizado).
 */
function soTokensDesde(texto: string): boolean[] {
  const ok = new Array<boolean>(texto.length + 1).fill(false);
  ok[texto.length] = true;
  for (let p = texto.length - 1; p >= 0; p -= 1) {
    for (const re of RES_TOKEN) {
      re.lastIndex = p;
      const m = re.exec(texto);
      if (m && m[0].length > 0 && ok[p + m[0].length]) {
        ok[p] = true;
        break;
      }
    }
  }
  return ok;
}

export function romanoParaNumero(romano: string): number {
  const valores: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };
  let total = 0;
  for (let i = 0; i < romano.length; i += 1) {
    const atual = valores[romano[i]!]!;
    const proximo = valores[romano[i + 1] ?? ""] ?? 0;
    total += atual < proximo ? -atual : atual;
  }
  return total;
}

export function numeroParaRomano(numero: number): string {
  const tabela: [number, string][] = [
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let resto = numero;
  let saida = "";
  for (const [valor, simbolo] of tabela) {
    while (resto >= valor) {
      saida += simbolo;
      resto -= valor;
    }
  }
  return saida;
}

export function idDispositivo(d: Dispositivo): string {
  let id = `#art${d.art}`;
  if (d.par !== undefined) id += `-par${d.par}`;
  if (d.inc !== undefined) id += `-${d.inc}`;
  if (d.ali !== undefined) id += `-al-${d.ali}`;
  if (d.item !== undefined) id += `-item${d.item}`;
  return id;
}

type Token =
  | { tipo: "art" | "par" | "inc" | "ali" | "item" | "parunico"; plural?: boolean }
  | { tipo: "num"; valor: string; letra?: string | undefined }
  | { tipo: "romano"; valor: string; letra?: string | undefined }
  | { tipo: "letra"; valor: string }
  | { tipo: "faixa" }
  | { tipo: "de" }
  | { tipo: "conj" };

const RE_TOKEN =
  /(arts?\b\.?|artigos?\b)|(\$\$?|paragrafos?\b(?=\s*\d))|(paragrafo\s+unico\b|par\.?\s*unico\b|\$\s*unico\b)|(incisos?\b|inc\.)|(alineas?\b|al\.)|(\d+)\s*o?(?:\s*-\s*([a-z])(?![a-z]))?|(?<![a-z])([ivxlc]+)(?:-([a-z])(?![a-z]))?(?![a-z])|(?<![a-z])["']?([a-z])["']?(?![a-z])|(\bd[oa]s?\b|\baos?\b)|\b(item|itens)\b/g;

function tokenizar(texto: string): Token[] {
  const tokens: Token[] = [];
  for (const m of texto.matchAll(RE_TOKEN)) {
    if (m[1]) tokens.push({ tipo: "art", plural: /^arts|^artigos/.test(m[1]) });
    else if (m[2]) tokens.push({ tipo: "par", plural: m[2] === "$$" || m[2].startsWith("paragrafos") });
    else if (m[3]) tokens.push({ tipo: "parunico" });
    else if (m[4]) tokens.push({ tipo: "inc" });
    else if (m[5]) tokens.push({ tipo: "ali" });
    else if (m[6]) tokens.push({ tipo: "num", valor: m[6].replace(/^0+(?=\d)/, ""), letra: m[7] });
    else if (m[8] && RE_ROMANO.test(m[8])) tokens.push({ tipo: "romano", valor: m[8], letra: m[9] });
    else if (m[10] && /["']/.test(m[0])) tokens.push({ tipo: "letra", valor: m[10] });
    else if (m[10] === "a") tokens.push({ tipo: "faixa" });
    else if (m[10] === "e") tokens.push({ tipo: "conj" });
    else if (m[10] === "o") continue;
    else if (m[10]) tokens.push({ tipo: "letra", valor: m[10] });
    else if (m[11]) tokens.push({ tipo: "de" });
    else if (m[12]) tokens.push({ tipo: "item", plural: m[12] === "itens" });
  }
  return tokens;
}

/** Reordena "inciso III do art. 28" para "art. 28 inciso III" (cadeias com "do"/"da"). */
function emOrdemDireta(tokens: Token[]): Token[] {
  const primeiroArt = tokens.findIndex((token) => token.tipo === "art");
  const temDe = tokens.some((token) => token.tipo === "de");
  if (primeiroArt <= 0 || !temDe) return tokens.filter((token) => token.tipo !== "de");
  const grupos: Token[][] = [[]];
  for (const token of tokens) {
    if (token.tipo === "de") grupos.push([]);
    else grupos.at(-1)!.push(token);
  }
  return grupos.reverse().flat();
}

/** Romano sem a letra colada (`ivA` → `iv`). */
function semLetra(inciso: string): string {
  return inciso.replace(/[A-Z]+$/, "");
}

/**
 * IDs dos dispositivos citados num fragmento normalizado, na ordem em que aparecem. "art. 28" sozinho
 * vira `#art28`; "art. 28, I e II" vira `#art28-i` e `#art28-ii` (o artigo serve de contêiner e
 * não é repetido); "art. 82 e parágrafo único" cita os dois (`#art82` e `#art82-parunico`).
 */
export function analisarDispositivos(fragmento: string): string[] {
  const tokens = emOrdemDireta(tokenizar(fragmento));
  const saida: string[] = [];
  let atual: Dispositivo | null = null;
  let emitido = true;
  let modo: "art" | "par" | "inc" | "ali" | "item" | null = null;
  let modoPlural = false;
  let faixa = false;
  /** O marcador corrente veio depois de "e": o dispositivo anterior também é citado. */
  let aposConjuncao = false;

  const emitir = () => {
    if (atual && !emitido) saida.push(idDispositivo(atual));
    emitido = true;
  };
  const definirArt = (valor: string) => {
    emitir();
    atual = { art: valor };
    emitido = false;
  };
  const definirPar = (valor: string) => {
    if (!atual) return;
    if (atual.par !== undefined || atual.inc !== undefined || aposConjuncao) emitir();
    atual = { art: atual.art, par: valor };
    emitido = false;
    aposConjuncao = false;
  };
  const definirInc = (valor: string) => {
    if (!atual) return;
    if (atual.inc !== undefined || aposConjuncao) emitir();
    atual = { art: atual.art, ...(atual.par !== undefined ? { par: atual.par } : {}), inc: valor };
    emitido = false;
    aposConjuncao = false;
  };
  const definirAli = (valor: string) => {
    if (!atual) return;
    if (atual.ali !== undefined) emitir();
    const { item: _item, ...semItem } = atual;
    atual = { ...semItem, ali: valor };
    emitido = false;
  };
  const definirItem = (valor: string) => {
    if (!atual) return;
    if (atual.item !== undefined) emitir();
    atual = { ...atual, item: valor };
    emitido = false;
  };

  /** Alínea, com a faixa "alíneas a a c" expandida. */
  const letraDeAlinea = (letra: string) => {
    const anterior = (atual as Dispositivo | null)?.ali;
    if (faixa && anterior) {
      for (let c = anterior.charCodeAt(0) + 1; c < letra.charCodeAt(0); c += 1) definirAli(String.fromCharCode(c));
    }
    definirAli(letra);
    faixa = false;
  };

  let anterior: Token["tipo"] | null = null;
  for (const token of tokens) {
    const tipoAnterior = anterior;
    anterior = token.tipo;
    switch (token.tipo) {
      case "art":
      case "par":
      case "inc":
      case "ali":
      case "item":
        modo = token.tipo;
        modoPlural = token.plural ?? false;
        faixa = false;
        aposConjuncao = tipoAnterior === "conj" && (token.tipo === "par" || token.tipo === "inc");
        break;
      case "parunico":
        aposConjuncao = tipoAnterior === "conj";
        definirPar("unico");
        modo = null;
        break;
      case "faixa":
        if (modo === "ali" && tipoAnterior === "ali") definirAli("a");
        else faixa = true;
        break;
      case "num": {
        const valor = `${token.valor}${token.letra ? token.letra.toUpperCase() : ""}`;
        const corrente = atual as Dispositivo | null;
        if (modo === "par") {
          const anterior = corrente?.par;
          if (faixa && anterior && /^\d+$/.test(anterior) && !token.letra) {
            for (let n = Number(anterior) + 1; n < Number(token.valor); n += 1) definirPar(String(n));
          }
          definirPar(valor);
          // Depois de "§ 1º" (singular), um número solto volta a ser artigo: "arts. 28, § 2º, 38".
          if (!modoPlural || tipoAnterior === "conj") modo = "art";
        } else if (modo === "inc") {
          definirInc(numeroParaRomano(Number(token.valor)));
        } else if (modo === "item") {
          const anterior = corrente?.item;
          if (faixa && anterior) {
            for (let n = Number(anterior) + 1; n < Number(token.valor); n += 1) definirItem(String(n));
          }
          definirItem(token.valor);
        } else if (modo === "art") {
          const anterior = corrente?.art;
          if (faixa && anterior && /^\d+$/.test(anterior) && !token.letra) {
            for (let n = Number(anterior) + 1; n < Number(token.valor); n += 1) definirArt(String(n));
          }
          definirArt(valor);
        }
        faixa = false;
        break;
      }
      case "romano": {
        if (modo === "ali" && token.valor.length === 1 && !token.letra) {
          letraDeAlinea(token.valor);
          break;
        }
        const anterior = (atual as Dispositivo | null)?.inc;
        if (faixa && anterior && !token.letra) {
          for (let n = romanoParaNumero(semLetra(anterior)) + 1; n < romanoParaNumero(token.valor); n += 1) {
            definirInc(numeroParaRomano(n));
          }
        }
        definirInc(`${token.valor}${token.letra ? token.letra.toUpperCase() : ""}`);
        faixa = false;
        break;
      }
      case "letra":
        if (modo === "ali") letraDeAlinea(token.valor);
        break;
    }
  }
  emitir();
  return [...new Set(saida)];
}

/**
 * Recorta, do fim de uma janela de texto, a cadeia de dispositivos que precede uma citação
 * ("... nos termos do inciso III do art. 28 da"), ou `null` se não houver. Só examina os últimos
 * `JANELA_DISPOSITIVO_ANTES` caracteres, em tempo linear.
 */
export function dispositivoAntes(janela: string): string | null {
  const recorte = janela.slice(-JANELA_DISPOSITIVO_ANTES);
  const conector = /\s*,?\s*(?:d[aoe]s?|na|no|nas|nos|pela|pelo)\s*$/.exec(recorte);
  if (!conector) return null;
  const corpo = recorte.slice(0, conector.index);
  const ok = soTokensDesde(corpo);
  for (const m of corpo.matchAll(RE_INICIO_DISPOSITIVO)) {
    if (!ok[m.index]) continue;
    const candidato = corpo.slice(m.index);
    if (/\bart/.test(candidato)) return candidato;
  }
  return null;
}

const RE_DISPOSITIVO_DEPOIS = new RegExp(
  String.raw`^[\s,()-]*(?:em\s+seus?\s+|n[oa]s?\s+seus?\s+|n[oa]s?\s+|conforme\s+(?:o\s+)?|em\s+especial\s+(?:o|a|os|as)\s+|(?:o|a)\s+)?` +
    String.raw`((?:arts?\b\.?\s*\d|artigos?\b\s*\d|\$\$?\s*\d|\$\s*unico|paragrafo\s+unico|incisos?\b\s*[ivxlc]|alineas?\b)(?:${TOKEN_DISPOSITIVO})*)`,
);

/**
 * Recorta a cadeia de dispositivos logo depois de uma citação (", art. 36, § 1º", ", em especial o
 * §1 do art. 17", "no seu artigo 27"), ou `null`. Sem artigo (", o inciso V, alínea e"), o
 * fragmento só serve para completar o artigo citado antes.
 */
export function dispositivoDepois(janela: string): string | null {
  const m = RE_DISPOSITIVO_DEPOIS.exec(janela);
  if (!m) return null;
  return m[1]!.replace(/(?:\s|[,.;-]|\b(?:e|a|aos?|d[oa]s?)\b)+$/, "");
}
