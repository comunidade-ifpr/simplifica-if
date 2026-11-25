/**
 * A busca no painel de leitura (Ctrl/⌘+F): as ocorrências de um termo nos nós de texto, sem acento nem
 * caixa, com os espaços (e as quebras entre blocos) contados como um só, pintadas com a CSS Custom
 * Highlight API (`::highlight(busca)` e `::highlight(busca-atual)`), sem mexer no DOM do React.
 *
 * O `Documento` monta os blocos aos poucos; antes de buscar, o painel pede todos (`MONTAR_TUDO`), como na
 * impressão, para a busca ver o texto inteiro. O texto se indexa uma vez (`indexarBusca`) e cada tecla só
 * procura nele (`ocorrencias`); o painel refaz o índice quando o DOM muda.
 */
import { indexarTexto, type Origem } from "./realce.ts";

export const MONTAR_TUDO = "simplifica:leitor-montar-tudo";
export const NOME_BUSCA = "busca";
export const NOME_BUSCA_ATUAL = "busca-atual";

/** Menos que isto acharia quase tudo. */
export const MINIMO_BUSCA = 2;

const ESPACO = /\s/;
const dobrados = new Map<string, string>();

/** Um caractere como a busca compara: sem acento, minúsculo, aspas retas, qualquer espaço como " ". */
function dobrar(c: string): string {
  const codigo = c.charCodeAt(0);
  // ASCII, a maior parte do texto: sem `normalize` nem regex por caractere.
  if (codigo < 128) {
    if (codigo === 32 || (codigo >= 9 && codigo <= 13)) return " ";
    return codigo >= 65 && codigo <= 90 ? String.fromCharCode(codigo + 32) : c;
  }
  let dobrado = dobrados.get(c);
  if (dobrado === undefined) {
    dobrado = ESPACO.test(c)
      ? " "
      : c
          .replace(/[“”]/g, '"')
          .replace(/[‘’]/g, "'")
          .normalize("NFD")
          .replace(/\p{M}/gu, "")
          .toLowerCase();
    dobrados.set(c, dobrado);
  }
  return dobrado;
}

/** O termo na forma da comparação (espaços juntos), ou `null` se curto demais. */
export function termoDaBusca(termo: string): string | null {
  const dobrado = [...termo.trim()].map(dobrar).join("").replace(/ {2,}/g, " ");
  return dobrado.length >= MINIMO_BUSCA ? dobrado : null;
}

export interface IndiceBusca {
  readonly texto: string;
  readonly origem: ReadonlyArray<Origem>;
}

/** O texto dos nós, na forma da busca: indexe uma vez, enquanto o DOM não muda. */
export const indexarBusca = (nos: ReadonlyArray<Text>): IndiceBusca =>
  indexarTexto(nos, dobrar, { juntarEspacos: true });

/** As faixas de cada ocorrência do termo, na ordem do documento (sem sobreposição). */
export function ocorrencias(indice: IndiceBusca, termo: string): Range[] {
  const alvo = termoDaBusca(termo);
  if (alvo === null) return [];
  const { texto, origem } = indice;
  const faixas: Range[] = [];
  for (let onde = texto.indexOf(alvo); onde >= 0; onde = texto.indexOf(alvo, onde + alvo.length)) {
    const inicio = origem[onde]!;
    const fim = origem[onde + alvo.length - 1]!;
    const faixa = new Range();
    faixa.setStart(inicio.no, inicio.posicao);
    faixa.setEnd(fim.no, fim.posicao + 1);
    faixas.push(faixa);
  }
  return faixas;
}

/** O nó está à vista: fora de um `<details>` fechado (salvo no `<summary>` dele). */
export function visivel(no: Text): boolean {
  const fechado = no.parentElement?.closest("details:not([open])");
  return fechado == null || no.parentElement?.closest("summary")?.parentElement === fechado;
}
