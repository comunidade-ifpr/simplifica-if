/**
 * O realce da frase exata no leitor: dentro das linhas destacadas (o bloco inteiro, `mark.trecho-citado`),
 * acha o trecho da pendência e o pinta com a CSS Custom Highlight API (`::highlight(trecho-exato)`), sem
 * mexer no DOM que o React montou.
 *
 * A comparação usa só letras e dígitos, sem acento nem caixa: o trecho guardado pode trazer marcação do
 * Markdown que a tela não mostra (`**`, `_`, `#`, `|`, o número de um item de lista) e espaços onde ela
 * havia; a pontuação e o espaço não decidem onde a frase está. Com reticências, cada pedaço se realça à
 * parte, na ordem.
 */

export const NOME_REALCE = "trecho-exato";

const RETICENCIAS = /\s*(?:\.\.\.|…|\[\.\.\.\]|\[…\])\s*/;

/** Um texto como se compara: só letras e dígitos, sem acento, minúsculos. */
const dobrar = (texto: string) =>
  texto
    .normalize("NFD")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();

/** O número de um item de lista numerada (`1.`, `2)`), que a tela desenha por CSS e não está no texto. */
const NUMERO_DE_ITEM = /^\s*\d+[.)]\s+/;

/** Os pedaços do trecho, entre reticências, já na forma da comparação. */
export const pedacosDoRealce = (trecho: string): string[] =>
  trecho
    .split(RETICENCIAS)
    .map((p, i) => dobrar(i === 0 ? p.replace(NUMERO_DE_ITEM, "") : p))
    .filter((p) => p.length > 0);

/** Os elementos de bloco: na troca de um a outro, a busca conta um espaço. */
const BLOCOS = "p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, pre, dt, dd, caption, div";

/** Um caractere de origem de cada caractere do texto comparável. */
export interface Origem {
  readonly no: Text;
  readonly posicao: number;
}

/**
 * O texto comparável dos nós (cada caractere passado por `dobrar`, que pode apagá-lo) e, para cada
 * caractere dele, o nó e a posição de origem. Com `juntarEspacos`, um espaço seguido de outro (no mesmo
 * nó ou no seguinte) não entra.
 */
export function indexarTexto(
  nos: ReadonlyArray<Text>,
  dobrar: (c: string) => string,
  opcoes: { readonly juntarEspacos?: boolean } = {},
): { readonly texto: string; readonly origem: ReadonlyArray<Origem> } {
  const partes: string[] = [];
  const origem: Origem[] = [];
  let ultimo = "";
  let blocoAnterior: Element | null = null;
  for (const no of nos) {
    const dados = no.data;
    // Na troca de bloco (parágrafo, item, célula), um espaço: a busca não junta palavras de blocos vizinhos.
    const bloco = no.parentElement?.closest(BLOCOS) ?? null;
    if (opcoes.juntarEspacos && bloco !== blocoAnterior && ultimo !== "" && ultimo !== " ") {
      partes.push(" ");
      origem.push(origem.at(-1)!);
      ultimo = " ";
    }
    blocoAnterior = bloco;
    for (let i = 0; i < dados.length; i += 1) {
      const dobrado = dobrar(dados[i]!);
      // Por unidade UTF-16, como os índices do texto: a origem fica alinhada com o `indexOf`.
      for (let k = 0; k < dobrado.length; k += 1) {
        const d = dobrado[k]!;
        if (opcoes.juntarEspacos && d === " " && (ultimo === "" || ultimo === " ")) continue;
        partes.push(d);
        origem.push({ no, posicao: i });
        ultimo = d;
      }
    }
  }
  return { texto: partes.join(""), origem };
}

/**
 * As faixas do trecho nos nós de texto dados (na ordem do documento), uma por pedaço, ou nenhuma se
 * algum pedaço não se acha depois do anterior.
 */
export function faixasDoRealce(nos: ReadonlyArray<Text>, trecho: string): Range[] {
  const pedacos = pedacosDoRealce(trecho);
  if (pedacos.length === 0) return [];
  const { texto, origem } = indexarTexto(nos, dobrar);
  const faixas: Range[] = [];
  let desde = 0;
  for (const p of pedacos) {
    const onde = texto.indexOf(p, desde);
    if (onde < 0) return [];
    const inicio = origem[onde]!;
    const fim = origem[onde + p.length - 1]!;
    const faixa = new Range();
    faixa.setStart(inicio.no, inicio.posicao);
    faixa.setEnd(fim.no, fim.posicao + 1);
    faixas.push(faixa);
    desde = onde + p.length;
  }
  return faixas;
}

/** Os nós de texto dos elementos, na ordem, sem o anúncio oculto do destaque ("Trecho citado: "). */
export function textosDe(elementos: ReadonlyArray<Element>): Text[] {
  const nos: Text[] = [];
  for (const elemento of elementos) {
    const andar = document.createTreeWalker(elemento, NodeFilter.SHOW_TEXT);
    for (let no = andar.nextNode(); no !== null; no = andar.nextNode())
      if (!no.parentElement?.closest(".sr-only")) nos.push(no as Text);
  }
  return nos;
}

/** Rola a área de rolagem mais próxima até a faixa, se ela não está à vista (a um terço da altura). */
export function rolarAte(faixa: Range): void {
  let area = faixa.startContainer.parentElement;
  while (area !== null && !/(auto|scroll)/.test(getComputedStyle(area).overflowY)) area = area.parentElement;
  if (area === null) return;
  const caixa = faixa.getBoundingClientRect();
  const vista = area.getBoundingClientRect();
  if (caixa.top >= vista.top && caixa.bottom <= vista.bottom) return;
  area.scrollTop += caixa.top - vista.top - vista.height / 3;
}
