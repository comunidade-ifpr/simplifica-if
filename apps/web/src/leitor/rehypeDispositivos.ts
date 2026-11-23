/**
 * O plugin `rehype` do leitor (M1.6, decisão de 16/11/2026): sobre a árvore HTML que o `react-markdown`
 * gera do Markdown da base, põe o `id` de cada dispositivo ou seção (`art28-xviii`, `avaliacao-1`) no
 * primeiro elemento de bloco que começa na linha da âncora e envolve o trecho citado em `<mark>`.
 *
 * O casamento é pela linha: a árvore do `remark` guarda a posição de cada nó, e o `kb` grava as linhas
 * de cada dispositivo (`packages/kb/src/normas/estrutura.ts`) e de cada seção do índice do PPC, sobre o
 * mesmo arquivo. O documento chega com o front matter em branco, então as linhas batem; quando ele é
 * renderizado em blocos (`blocos.ts`), o `deslocamento` leva a linha do bloco à do arquivo.
 *
 * Só mexe em propriedades e acrescenta elementos `mark` e `span`: nenhum HTML cru entra (o PPC é
 * entrada não confiável; o leitor não usa `rehype-raw` nem `innerHTML`).
 */

/** O pedaço da árvore hast que o plugin usa. */
interface NoHast {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: Array<NoHast>;
  value?: string;
  position?: { start: { line: number }; end: { line: number } };
}

export interface OpcoesDispositivos {
  /** Os IDs das âncoras pela linha do arquivo em que começam (`ancorasPorLinha`). */
  readonly ancoras: ReadonlyMap<number, ReadonlyArray<string>>;
  /** As linhas do trecho a destacar, inclusivas; `null` sem destaque. */
  readonly destaque: { readonly inicio: number; readonly fim: number } | null;
  /** O que somar às linhas da árvore para chegar às do arquivo: a linha inicial do bloco menos 1. */
  readonly deslocamento: number;
  /** A última linha do bloco no arquivo (padrão: a última da árvore). */
  readonly linhaFinal?: number;
  /** As linhas dos cabeçalhos de divisão (Título, Capítulo, Seção e o nome delas): ganham a classe `divisao`. */
  readonly divisoes?: ReadonlySet<number>;
}

/** As âncoras agrupadas pela linha de início. */
export function ancorasPorLinha(
  ancoras: ReadonlyArray<{ readonly id: string; readonly linha_inicio: number }>,
): ReadonlyMap<number, ReadonlyArray<string>> {
  const mapa = new Map<number, string[]>();
  for (const a of ancoras) {
    const lista = mapa.get(a.linha_inicio);
    if (lista) lista.push(a.id);
    else mapa.set(a.linha_inicio, [a.id]);
  }
  return mapa;
}

/** Elementos que recebem o `id` de uma âncora (o primeiro, em pré-ordem, que começa na linha). */
const RECEBEM_ID = new Set(["p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "tr", "pre"]);
/** Elementos cujo conteúdo inteiro se destaca. */
const FOLHAS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th"]);
/** Elementos de bloco: dentro de um item de lista, o que não é bloco se destaca junto. */
const BLOCOS = new Set([
  "p",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "table",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "div",
  "section",
]);

const ancoraVazia = (id: string): NoHast => ({ type: "element", tagName: "span", properties: { id }, children: [] });

/** O plugin (`rehypePlugins: [[rehypeDispositivos, opcoes]]`). */
export function rehypeDispositivos(opcoes: OpcoesDispositivos) {
  return (arvore: object): void => aplicar(arvore as NoHast, opcoes);
}

const temClasse = (no: NoHast, classe: string): boolean => {
  const classes = no.properties?.["className"];
  return Array.isArray(classes) && classes.includes(classe);
};

/** O texto oculto que anuncia, a quem usa leitor de tela, onde começa o trecho destacado. */
const anuncio = (): NoHast => ({
  type: "element",
  tagName: "span",
  properties: { className: ["sr-only"] },
  children: [{ type: "text", value: "Trecho citado: " }],
});

/** Aplica o plugin numa árvore hast (exportado para os testes). */
export function aplicar(arvore: NoHast, opcoes: OpcoesDispositivos): void {
  const usadas = new Set<number>();
  const linha = (no: NoHast) => (no.position ? no.position.start.line + opcoes.deslocamento : undefined);
  const destacada = (no: NoHast) => {
    const l = linha(no);
    return opcoes.destaque !== null && l !== undefined && l >= opcoes.destaque.inicio && l <= opcoes.destaque.fim;
  };
  /** Os elementos com linha, em pré-ordem: onde cair a âncora que não achou elemento na linha dela. */
  const candidatos: Array<{ readonly linha: number; readonly no: NoHast }> = [];
  // o anúncio vai no primeiro destaque do bloco em que o trecho começa
  const inicioDoBloco = opcoes.deslocamento + 1;
  const fimDoBloco =
    opcoes.linhaFinal ?? (arvore.position ? arvore.position.end.line + opcoes.deslocamento : inicioDoBloco);
  let anunciar =
    opcoes.destaque !== null && opcoes.destaque.inicio >= inicioDoBloco && opcoes.destaque.inicio <= fimDoBloco;
  const marca = (children: Array<NoHast>): NoHast => {
    const filhos = anunciar ? [anuncio(), ...children] : children;
    anunciar = false;
    return { type: "element", tagName: "mark", properties: { className: ["trecho-citado"] }, children: filhos };
  };

  const visitar = (no: NoHast, dentroDeMarca: boolean): void => {
    if (no.type !== "element" && no.type !== "root") return;
    const tag = no.tagName ?? "";
    const l = linha(no);
    if (no.type === "element" && l !== undefined) candidatos.push({ linha: l, no });
    if (no.type === "element" && l !== undefined && /^h[1-6]$/.test(tag) && opcoes.divisoes?.has(l)) {
      no.properties = { ...no.properties, className: ["divisao"] };
    }
    if (no.type === "element" && l !== undefined && RECEBEM_ID.has(tag) && !usadas.has(l)) {
      const ids = opcoes.ancoras.get(l);
      if (ids !== undefined && ids.length > 0) {
        usadas.add(l);
        no.properties = { ...no.properties, id: ids[0] };
        // várias âncoras na mesma linha: as outras como marcadores vazios no começo do elemento
        if (ids.length > 1) no.children = [...ids.slice(1).map(ancoraVazia), ...(no.children ?? [])];
      }
    }
    const filhos = no.children ?? [];
    // a redação não vigente e o que está fora do ato (`remarkLeitor.ts`) nunca se destacam como citados
    if (no.type === "element" && temClasse(no, "regiao-marcada")) {
      for (const filho of filhos) visitar(filho, true);
      return;
    }
    if (!dentroDeMarca && no.type === "element" && destacada(no)) {
      if (FOLHAS.has(tag)) {
        no.children = [marca(filhos)];
        return;
      }
      if (tag === "li") {
        // o texto do item (lista compacta) se destaca; as sublistas e parágrafos seguem a própria linha
        const novos: Array<NoHast> = [];
        let corrida: Array<NoHast> = [];
        const fechar = () => {
          if (corrida.some((n) => n.type !== "text" || (n.value ?? "").trim() !== "")) novos.push(marca(corrida));
          else novos.push(...corrida);
          corrida = [];
        };
        for (const filho of filhos) {
          if (filho.type === "element" && BLOCOS.has(filho.tagName ?? "")) {
            fechar();
            visitar(filho, false);
            novos.push(filho);
          } else corrida.push(filho);
        }
        fechar();
        no.children = novos;
        return;
      }
    }
    for (const filho of filhos) visitar(filho, dentroDeMarca);
  };
  visitar(arvore, false);

  // Âncora sem elemento de bloco na linha dela (seção que começa dentro de uma tabela malformada, por
  // exemplo): um marcador vazio no elemento anterior mais próximo, para o link ainda levar até lá.
  for (const [l, ids] of opcoes.ancoras) {
    if (usadas.has(l) || l < inicioDoBloco || l > fimDoBloco) continue;
    let alvo: NoHast | undefined;
    for (const c of candidatos) if (c.linha <= l && (alvo === undefined || c.linha >= linha(alvo)!)) alvo = c.no;
    const destino = alvo ?? arvore;
    destino.children = [...ids.map(ancoraVazia), ...(destino.children ?? [])];
  }
}

/**
 * As linhas a destacar para uma âncora: das linhas dela até a última de seus descendentes (o artigo
 * com os incisos e parágrafos; a seção inteira).
 */
export function linhasDoTrecho(
  ancoras: ReadonlyArray<{
    readonly id: string;
    readonly pai: string | null;
    readonly linha_inicio: number;
    readonly linha_fim: number;
  }>,
  id: string,
): { readonly inicio: number; readonly fim: number } | null {
  const alvo = ancoras.find((a) => a.id === id);
  if (alvo === undefined) return null;
  const filhos = new Map<string, string[]>();
  for (const a of ancoras) {
    if (a.pai === null) continue;
    const lista = filhos.get(a.pai);
    if (lista) lista.push(a.id);
    else filhos.set(a.pai, [a.id]);
  }
  const porId = new Map(ancoras.map((a) => [a.id, a]));
  let fim = alvo.linha_fim;
  const pendentes = [...(filhos.get(id) ?? [])];
  while (pendentes.length > 0) {
    const atual = porId.get(pendentes.pop()!);
    if (atual === undefined) continue;
    fim = Math.max(fim, atual.linha_fim);
    pendentes.push(...(filhos.get(atual.id) ?? []));
  }
  return { inicio: alvo.linha_inicio, fim };
}
