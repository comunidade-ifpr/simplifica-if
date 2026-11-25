/**
 * Conferência de uma correção do Markdown convertido (`conferirPalavras`): a revisão, com regra ou
 * com IA, pode mudar marcação, espaços e quebras, mas não as palavras do documento.
 *
 * As palavras (sequências de letras e dígitos) de antes e de depois são comparadas como multiconjunto,
 * sem olhar a ordem. A palavra que some e reaparece colada a outra ("estu" e "dante" → "estudante",
 * "C A M P U S" → "CAMPUS") é uma junção, e o contrário ("INSTITUTOFEDERAL" → "INSTITUTO" e
 * "FEDERAL"), uma separação; as duas são aceitas e listadas. O resto é palavra acrescentada ou
 * removida. A acrescentada que não existia no texto de antes é `nova`, e a correção reprova; a que já
 * existia e ficou mais vezes é `repetida` (o cabeçalho de tabela que repete "Carga horária" em cada
 * coluna), aceita e listada. A removida é aceita só com justificativa: cabeçalho, rodapé, número de
 * página, sumário, o que quem revisa confere na lista.
 */

export interface Juncao {
  readonly partes: ReadonlyArray<string>;
  readonly palavra: string;
}

export interface Conferencia {
  /** Palavras que não existiam no texto de antes, com quantas vezes cada uma. Vazio na correção aceita. */
  readonly novas: ReadonlyArray<readonly [string, number]>;
  /** Palavras que já existiam e aparecem mais vezes, com quantas vezes a mais. */
  readonly repetidas: ReadonlyArray<readonly [string, number]>;
  /** Palavras que saíram, com quantas vezes cada uma. */
  readonly removidas: ReadonlyArray<readonly [string, number]>;
  /** Palavras partidas que voltaram a ser uma. */
  readonly juncoes: ReadonlyArray<Juncao>;
  /** Palavras coladas que foram separadas. */
  readonly separacoes: ReadonlyArray<Juncao>;
  readonly palavrasAntes: number;
  readonly palavrasDepois: number;
}

const RE_PALAVRA = /[\p{L}\p{N}]+/gu;

/** As palavras do texto, sem a marcação HTML que o Markdown das tabelas usa (`<br>`). */
export function palavras(texto: string): string[] {
  return (
    texto
      .normalize("NFC")
      .replace(/<\/?(?:br|b|i|strong|em|sup|sub)\s*\/?>/giu, " ")
      .match(RE_PALAVRA) ?? []
  );
}

function contar(lista: ReadonlyArray<string>): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const p of lista) mapa.set(p, (mapa.get(p) ?? 0) + 1);
  return mapa;
}

/** Diferença de multiconjuntos `a - b` (só o que sobra positivo). */
function menos(a: Map<string, number>, b: Map<string, number>): Map<string, number> {
  const resto = new Map<string, number>();
  for (const [p, n] of a) {
    const sobra = n - (b.get(p) ?? 0);
    if (sobra > 0) resto.set(p, sobra);
  }
  return resto;
}

/**
 * `palavra` partida em pedaços disponíveis em `pedacos` (2 a 40 pedaços), ou `null`. Os pedaços
 * usados saem de `pedacos`.
 */
function partir(palavra: string, pedacos: Map<string, number>): string[] | null {
  const n = palavra.length;
  // melhor[i]: a partição de palavra[0, i) com menos pedaços.
  const melhor: (string[] | null)[] = Array.from({ length: n + 1 }, () => null);
  melhor[0] = [];
  for (let i = 0; i < n; i += 1) {
    const ate = melhor[i];
    if (!ate || ate.length >= 40) continue;
    for (let j = i + 1; j <= n; j += 1) {
      const pedaco = palavra.slice(i, j);
      const disponiveis = (pedacos.get(pedaco) ?? 0) - ate.filter((p) => p === pedaco).length;
      if (disponiveis <= 0) continue;
      const candidato = [...ate, pedaco];
      if (!melhor[j] || melhor[j]!.length > candidato.length) melhor[j] = candidato;
    }
  }
  const particao = melhor[n];
  if (!particao || particao.length < 2) return null;
  for (const pedaco of particao) {
    const resto = (pedacos.get(pedaco) ?? 0) - 1;
    if (resto > 0) pedacos.set(pedaco, resto);
    else pedacos.delete(pedaco);
  }
  return particao;
}

function emPedacos(inteiras: Map<string, number>, pedacos: Map<string, number>): Juncao[] {
  const achadas: Juncao[] = [];
  for (const [palavra, vezes] of [...inteiras].sort((a, b) => b[0].length - a[0].length)) {
    for (let k = 0; k < vezes; k += 1) {
      const particao = partir(palavra, pedacos);
      if (!particao) break;
      achadas.push({ partes: particao, palavra });
      const resto = (inteiras.get(palavra) ?? 0) - 1;
      if (resto > 0) inteiras.set(palavra, resto);
      else inteiras.delete(palavra);
    }
  }
  return achadas;
}

const ordenar = (mapa: Map<string, number>) =>
  [...mapa].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) as Array<readonly [string, number]>;

export function conferirPalavras(antes: string, depois: string): Conferencia {
  const listaAntes = palavras(antes);
  const listaDepois = palavras(depois);
  const contagemAntes = contar(listaAntes);
  const contagemDepois = contar(listaDepois);
  const acrescentadas = menos(contagemDepois, contagemAntes);
  const removidas = menos(contagemAntes, contagemDepois);
  const juncoes = emPedacos(acrescentadas, removidas);
  const separacoes = emPedacos(removidas, acrescentadas);
  const novas = new Map([...acrescentadas].filter(([p]) => !contagemAntes.has(p)));
  const repetidas = new Map([...acrescentadas].filter(([p]) => contagemAntes.has(p)));
  return {
    novas: ordenar(novas),
    repetidas: ordenar(repetidas),
    removidas: ordenar(removidas),
    juncoes,
    separacoes,
    palavrasAntes: listaAntes.length,
    palavrasDepois: listaDepois.length,
  };
}
