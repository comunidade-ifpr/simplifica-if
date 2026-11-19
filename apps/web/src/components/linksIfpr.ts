/**
 * Links `ifpr://` soltos no texto, fora da sintaxe de link do Markdown: um plugin do remark que os
 * troca por nós `link`, para que o `Markdown` os mostre como os outros (um botão que abre o painel de
 * leitura). O remark-gfm só faz isso com `http`, `www` e e-mail.
 *
 * Os caracteres de um link são os de `packages/mcp/src/links.ts` (segmentos `[A-Za-z0-9._~:-]`,
 * separados por `/`, e o fragmento depois de `#`). A pontuação no fim (`.`, `,`, `:`…) fica de fora,
 * porque o link costuma fechar a frase. O texto dentro de um link ou de um bloco de código não muda.
 *
 * Código em linha (entre crases) também não muda, salvo quando é só o link: a IA costuma citar assim
 * (`` `ifpr://norma/br/lei/2008/11788#art2` ``), e a citação vira o mesmo botão. Um trecho de código
 * com o link no meio de outro texto (um comando, um exemplo) fica como código.
 */

/** O pedaço da árvore do mdast que o plugin usa. */
interface No {
  type: string;
  value?: string;
  url?: string;
  children?: Array<No>;
}

const RE_LINK = /ifpr:\/\/[A-Za-z0-9._~:/#-]+/gi;
const RE_SO_LINK = /^ifpr:\/\/[A-Za-z0-9._~:/#-]+$/i;
const PONTUACAO_FINAL = /[.,:;~-]+$/;

/** Os nós que substituem um texto: trechos de texto e links, na ordem. */
function dividir(texto: string): Array<No> | undefined {
  const nos: Array<No> = [];
  let inicio = 0;
  for (const achado of texto.matchAll(RE_LINK)) {
    const url = achado[0].replace(PONTUACAO_FINAL, "");
    if (url.length <= "ifpr://".length) continue;
    const posicao = achado.index;
    if (posicao > inicio) nos.push({ type: "text", value: texto.slice(inicio, posicao) });
    nos.push({ type: "link", url, children: [{ type: "text", value: url }] });
    inicio = posicao + url.length;
  }
  if (nos.length === 0) return undefined;
  if (inicio < texto.length) nos.push({ type: "text", value: texto.slice(inicio) });
  return nos;
}

/** Troca, na árvore, cada texto com links `ifpr://` soltos pelos trechos e links. */
export function ligarLinksIfpr(no: No): void {
  if (no.children === undefined || no.type === "link" || no.type === "linkReference") return;
  no.children = no.children.flatMap((filho) => {
    if (filho.type === "text" && filho.value !== undefined) return dividir(filho.value) ?? [filho];
    const codigo = filho.type === "inlineCode" ? filho.value?.trim() : undefined;
    if (codigo !== undefined && RE_SO_LINK.test(codigo) && codigo.length > "ifpr://".length)
      return [{ type: "link", url: codigo, children: [{ type: "text", value: codigo }] }];
    ligarLinksIfpr(filho);
    return [filho];
  });
}

/** O plugin do remark (`remarkPlugins`). */
export function remarkLinksIfpr() {
  return (arvore: object): void => ligarLinksIfpr(arvore as No);
}
