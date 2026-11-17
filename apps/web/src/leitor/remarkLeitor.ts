/**
 * Plugins `remark` do leitor (M1.6), sobre a árvore mdast, antes de virar HTML. O leitor usa
 * `skipHtml`, e o HTML cru do arquivo some; dois casos de HTML na base têm sentido e não podem sumir:
 *
 * - `remarkMarcadores`: os marcadores `<!-- redacao-nao-vigente -->` e `<!-- fora-do-ato -->` do
 *   padrão das normas (`packages/kb/src/normas/estrutura.ts`), que o `kb` já tira dos dispositivos.
 *   O trecho entre a abertura e o fechamento vira um bloco esmaecido com o rótulo ("Redação anterior,
 *   não vigente", "Fora do texto publicado"), para a redação revogada não se ler como a vigente;
 * - `remarkQuebras`: o `<br>` dos PPCs convertidos (131 mil, 73 mil entre letras), que sem isso colaria
 *   palavras ("Logísticae Produção"), vira quebra de linha do Markdown.
 *
 * Os nós novos são do próprio mdast (com `data.hName`), sem HTML cru.
 */

/** O pedaço da árvore mdast que os plugins usam. */
interface NoMd {
  type: string;
  value?: string;
  children?: Array<NoMd>;
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

export const MARCADORES = {
  "redacao-nao-vigente": "Redação anterior, não vigente",
  "fora-do-ato": "Fora do texto publicado",
} as const;
type Marcador = keyof typeof MARCADORES;

const RE_ABRE = /^<!--\s*(redacao-nao-vigente|fora-do-ato)\b[^>]*-->$/;
const RE_FECHA = /^<!--\s*\/(redacao-nao-vigente|fora-do-ato)\s*-->$/;

const marcadorQueAbre = (no: NoMd): Marcador | undefined =>
  no.type === "html" ? (RE_ABRE.exec((no.value ?? "").trim())?.[1] as Marcador | undefined) : undefined;
const fecha = (no: NoMd, marcador: Marcador): boolean =>
  no.type === "html" && RE_FECHA.exec((no.value ?? "").trim())?.[1] === marcador;

function regiao(marcador: Marcador, conteudo: Array<NoMd>): NoMd {
  return {
    type: "regiaoMarcada",
    data: {
      hName: "div",
      hProperties: { className: ["regiao-marcada", `regiao-${marcador}`], dataMarcador: marcador },
    },
    children: [
      {
        type: "paragraph",
        data: { hProperties: { className: ["rotulo-regiao"] } },
        children: [{ type: "text", value: MARCADORES[marcador] }],
      },
      ...conteudo,
    ],
  };
}

/** Agrupa, em cada nível da árvore, o que fica entre a abertura e o fechamento de um marcador. */
export function agruparMarcadores(no: NoMd): void {
  if (no.children === undefined) return;
  const filhos: Array<NoMd> = [];
  for (let i = 0; i < no.children.length; i += 1) {
    const filho = no.children[i]!;
    const marcador = marcadorQueAbre(filho);
    if (marcador !== undefined) {
      const fim = no.children.findIndex((outro, j) => j > i && fecha(outro, marcador));
      if (fim !== -1) {
        const conteudo = no.children.slice(i + 1, fim);
        for (const parte of conteudo) agruparMarcadores(parte);
        filhos.push(regiao(marcador, conteudo));
        i = fim;
        continue;
      }
    }
    agruparMarcadores(filho);
    filhos.push(filho);
  }
  no.children = filhos;
}

export function remarkMarcadores() {
  return (arvore: object): void => agruparMarcadores(arvore as NoMd);
}

const RE_BR = /^<br\s*\/?>$/i;

/** Troca cada nó HTML que é só `<br>`, `<br/>` ou `<br />` por uma quebra de linha. */
export function trocarQuebras(no: NoMd): void {
  if (no.children === undefined) return;
  no.children = no.children.map((filho) => {
    if (filho.type === "html" && RE_BR.test((filho.value ?? "").trim())) return { type: "break" };
    trocarQuebras(filho);
    return filho;
  });
}

export function remarkQuebras() {
  return (arvore: object): void => trocarQuebras(arvore as NoMd);
}
