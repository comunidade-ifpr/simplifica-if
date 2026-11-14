/**
 * Stemmer de português: porte do algoritmo Snowball (snowballstem.org/algorithms/portuguese), em
 * TypeScript e sem dependência.
 *
 * Escolha (fase 6): o FTS5 não tem stemmer de português, e a busca precisa de uma coluna auxiliar com
 * os radicais. Foram avaliados:
 * - `snowball-stemmers` (npm): é o mesmo algoritmo, gerado em JavaScript, sem tipos e parado desde
 *   2022; serviu de referência para o teste diferencial (vocabulário dos PPCs e das normas, idêntico);
 * - RSLP (Orengo e Huyck, 2001): mais agressivo, com cerca de 200 regras e exceções num arquivo de
 *   dados, sem implementação de referência em JavaScript para conferir um porte.
 * O Snowball é um algoritmo publicado e estável, curto o bastante para portar e conferir por
 * diferencial, e reduz bem as flexões que importam aqui (egresso/egressos, estágio/estágios,
 * aproveitamento/aproveitar).
 *
 * `radical` é o algoritmo publicado: a palavra entra em minúsculas e com acentos (as regras dependem
 * deles). `radicalSemAcento` é o mesmo algoritmo sobre a palavra sem acentos, com os sufixos também sem
 * acentos ("ação" vira "acao", "ância" vira "ancia", "ã" e "õ" deixam de virar "a~" e "o~"): a busca usa
 * esta variante, para que "avaliação" e "avaliacao" deem o mesmo radical.
 */

const VOGAIS = new Set("aeiouáéíóúâêô");

function ehVogal(c: string | undefined): boolean {
  return c !== undefined && VOGAIS.has(c);
}

/** Posições de RV, R1 e R2 (índices em `w`; `w.length` quando a região é vazia). */
function regioes(w: string): { rv: number; r1: number; r2: number } {
  const n = w.length;
  let rv = n;
  if (n >= 2) {
    if (!ehVogal(w[1])) {
      // segunda letra consoante: RV começa depois da próxima vogal
      for (let i = 2; i < n; i += 1) {
        if (ehVogal(w[i])) {
          rv = i + 1;
          break;
        }
      }
    } else if (ehVogal(w[0])) {
      // duas vogais no início: RV começa depois da próxima consoante
      for (let i = 2; i < n; i += 1) {
        if (!ehVogal(w[i])) {
          rv = i + 1;
          break;
        }
      }
    } else {
      // consoante seguida de vogal: RV começa depois da terceira letra
      rv = Math.min(3, n);
    }
  }
  const depoisDeVogalConsoante = (inicio: number): number => {
    for (let i = inicio; i < n - 1; i += 1) {
      if (ehVogal(w[i]) && !ehVogal(w[i + 1])) return i + 2;
    }
    return n;
  };
  const r1 = depoisDeVogalConsoante(0);
  const r2 = r1 < n ? depoisDeVogalConsoante(r1) : n;
  return { rv, r1, r2 };
}

/** Sufixo mais longo de `lista` em que `w` termina (opcionalmente só dentro de `limite`). */
function maisLongo(w: string, lista: readonly string[], limite = 0): string | null {
  let melhor: string | null = null;
  for (const sufixo of lista) {
    if (w.length - sufixo.length < limite) continue;
    if (w.endsWith(sufixo) && (melhor === null || sufixo.length > melhor.length)) melhor = sufixo;
  }
  return melhor;
}

const PASSO1: ReadonlyArray<readonly [string[], string]> = [
  [
    [
      "eza",
      "ezas",
      "ico",
      "ica",
      "icos",
      "icas",
      "ismo",
      "ismos",
      "ável",
      "ível",
      "ista",
      "istas",
      "oso",
      "osa",
      "osos",
      "osas",
      "amento",
      "amentos",
      "imento",
      "imentos",
      "adora",
      "ador",
      "aça~o",
      "adoras",
      "adores",
      "aço~es",
      "ante",
      "antes",
      "ância",
    ],
    "apagar",
  ],
  [["logia", "logias"], "log"],
  [["uça~o", "uço~es"], "u"],
  [["ência", "ências"], "ente"],
  [["amente"], "amente"],
  [["mente"], "mente"],
  [["idade", "idades"], "idade"],
  [["iva", "ivo", "ivas", "ivos"], "iva"],
  [["ira", "iras"], "ira"],
];

const PASSO2 = [
  "ada",
  "ida",
  "ia",
  "aria",
  "eria",
  "iria",
  "ará",
  "ara",
  "erá",
  "era",
  "irá",
  "ava",
  "asse",
  "esse",
  "isse",
  "aste",
  "este",
  "iste",
  "ei",
  "arei",
  "erei",
  "irei",
  "am",
  "iam",
  "ariam",
  "eriam",
  "iriam",
  "aram",
  "eram",
  "iram",
  "avam",
  "em",
  "arem",
  "erem",
  "irem",
  "assem",
  "essem",
  "issem",
  "ado",
  "ido",
  "ando",
  "endo",
  "indo",
  "ara~o",
  "era~o",
  "ira~o",
  "ar",
  "er",
  "ir",
  "as",
  "adas",
  "idas",
  "ias",
  "arias",
  "erias",
  "irias",
  "arás",
  "aras",
  "erás",
  "eras",
  "irás",
  "avas",
  "es",
  "ardes",
  "erdes",
  "irdes",
  "ares",
  "eres",
  "ires",
  "asses",
  "esses",
  "isses",
  "astes",
  "estes",
  "istes",
  "is",
  "ais",
  "eis",
  "íeis",
  "aríeis",
  "eríeis",
  "iríeis",
  "áreis",
  "areis",
  "éreis",
  "ereis",
  "íreis",
  "ireis",
  "ásseis",
  "ésseis",
  "ísseis",
  "áveis",
  "ados",
  "idos",
  "ámos",
  "amos",
  "íamos",
  "aríamos",
  "eríamos",
  "iríamos",
  "áramos",
  "éramos",
  "íramos",
  "ávamos",
  "emos",
  "aremos",
  "eremos",
  "iremos",
  "ássemos",
  "êssemos",
  "íssemos",
  "imos",
  "armos",
  "ermos",
  "irmos",
  "eu",
  "iu",
  "ou",
  "ira",
  "iras",
];

const RESIDUAL = ["os", "a", "i", "o", "á", "í", "ó"];

/** Sufixos de cada passo, com ou sem acentos. */
interface Tabelas {
  todosPasso1: string[];
  acaoPasso1: Map<string, string>;
  passo2: string[];
  residual: string[];
  amente: string[];
  mente: string[];
  idade: string[];
  final: string[];
}

function tabelas(tirar: (s: string) => string): Tabelas {
  const unicos = (lista: readonly string[]) => [...new Set(lista.map(tirar))];
  return {
    todosPasso1: unicos(PASSO1.flatMap(([lista]) => lista)),
    acaoPasso1: new Map(PASSO1.flatMap(([lista, acao]) => lista.map((s) => [tirar(s), acao] as const))),
    passo2: unicos(PASSO2),
    residual: unicos(RESIDUAL),
    amente: unicos(["iv", "os", "ic", "ad"]),
    mente: unicos(["ante", "avel", "ível"]),
    idade: unicos(["abil", "ic", "iv"]),
    final: unicos(["e", "é", "ê", "ç"]),
  };
}

const COM_ACENTO = tabelas((s) => s);
const SEM_ACENTO = tabelas((s) => s.normalize("NFKD").replace(/\p{M}/gu, "").replaceAll("~", ""));

/** Passo 1 (sufixos padrão). Devolve a palavra alterada ou `null`. */
function passo1(w: string, r: { rv: number; r1: number; r2: number }, t: Tabelas): string | null {
  const sufixo = maisLongo(w, t.todosPasso1);
  if (sufixo === null) return null;
  const inicio = w.length - sufixo.length;
  const emR2 = inicio >= r.r2;
  const acao = t.acaoPasso1.get(sufixo)!;
  switch (acao) {
    case "apagar":
      return emR2 ? w.slice(0, inicio) : null;
    case "log":
    case "u":
    case "ente":
      return emR2 ? w.slice(0, inicio) + acao : null;
    case "amente": {
      if (inicio < r.r1) return null;
      let x = w.slice(0, inicio);
      const antes = maisLongo(x, t.amente);
      if (antes && x.length - antes.length >= r.r2) {
        x = x.slice(0, x.length - antes.length);
        if (antes === "iv" && x.endsWith("at") && x.length - 2 >= r.r2) x = x.slice(0, -2);
      }
      return x;
    }
    case "mente": {
      if (!emR2) return null;
      let x = w.slice(0, inicio);
      const antes = maisLongo(x, t.mente);
      if (antes && x.length - antes.length >= r.r2) x = x.slice(0, x.length - antes.length);
      return x;
    }
    case "idade": {
      if (!emR2) return null;
      let x = w.slice(0, inicio);
      const antes = maisLongo(x, t.idade);
      if (antes && x.length - antes.length >= r.r2) x = x.slice(0, x.length - antes.length);
      return x;
    }
    case "iva": {
      if (!emR2) return null;
      let x = w.slice(0, inicio);
      if (x.endsWith("at") && x.length - 2 >= r.r2) x = x.slice(0, -2);
      return x;
    }
    case "ira":
      return inicio >= r.rv && w[inicio - 1] === "e" ? `${w.slice(0, inicio)}ir` : null;
    default:
      return null;
  }
}

const cacheComAcento = new Map<string, string>();
const cacheSemAcento = new Map<string, string>();

/** Radical Snowball de uma palavra em minúsculas (com acentos). */
export function radical(palavra: string): string {
  return comCache(cacheComAcento, palavra, (p) =>
    snowball(p.replaceAll("ã", "a~").replaceAll("õ", "o~"), COM_ACENTO).replaceAll("a~", "ã").replaceAll("o~", "õ"),
  );
}

/**
 * Radical de uma palavra em minúsculas e sem acentos, pelo mesmo algoritmo com os sufixos sem acentos.
 * Não é igual a `semDiacriticos(radical(palavra))` ("avaliação" dá "avali" lá e "avaliaca" aqui antes
 * do passo 1 sem acentos): é a função que a busca aplica à palavra já sem acentos, acentuada ou não.
 */
export function radicalSemAcento(palavra: string): string {
  return comCache(cacheSemAcento, palavra, (p) => snowball(p, SEM_ACENTO));
}

function comCache(cache: Map<string, string>, palavra: string, calcular: (p: string) => string): string {
  const guardado = cache.get(palavra);
  if (guardado !== undefined) return guardado;
  const saida = calcular(palavra);
  if (cache.size < 500_000) cache.set(palavra, saida);
  return saida;
}

function snowball(palavra: string, t: Tabelas): string {
  let w = palavra;
  let r = regioes(w);
  let alterou = false;
  const p1 = passo1(w, r, t);
  if (p1 !== null) {
    w = p1;
    alterou = true;
  } else {
    const sufixo = maisLongo(w, t.passo2, r.rv);
    if (sufixo !== null) {
      w = w.slice(0, w.length - sufixo.length);
      alterou = true;
    }
  }
  r = { ...r, rv: Math.min(r.rv, w.length) };
  if (alterou) {
    // passo 3: "i" final precedido de "c", com o "i" em RV
    if (w.endsWith("ci") && w.length - 1 >= r.rv) w = w.slice(0, -1);
  } else {
    // passo 4: sufixo residual em RV
    const sufixo = maisLongo(w, t.residual, r.rv);
    if (sufixo !== null) w = w.slice(0, w.length - sufixo.length);
  }
  // passo 5: forma residual
  const fim = maisLongo(w, t.final);
  if (fim === "ç") {
    w = `${w.slice(0, -1)}c`;
  } else if (fim !== null && fim !== "c" && w.length - 1 >= r.rv) {
    w = w.slice(0, -1);
    if ((w.endsWith("gu") || w.endsWith("ci")) && w.length - 1 >= r.rv) w = w.slice(0, -1);
  }
  return w;
}
