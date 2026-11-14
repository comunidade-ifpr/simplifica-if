/**
 * Texto legível de IDs de dispositivo: o caminho inverso de `dispositivos.ts`.
 *
 * `["#art29", "#art30", "#art37-par3"]` → "arts. 29, 30 e 37, § 3º", na redação usada nas fichas da
 * `revisar-ppc` e nas normas: ordinal até 9 ("art. 9º", "§ 1º"), inciso em romano maiúsculo, faixa
 * para três ou mais artigos ou incisos consecutivos ("arts. 48 a 53", "II a V") e ", e" antes do
 * último item quando o penúltimo já tem vírgula ("arts. 28, X, e 42").
 */
import { numeroParaRomano, romanoParaNumero } from "./dispositivos.ts";

/** Partes de um ID de dispositivo (`#art28-par1-iv` → art. 28, § 1º, inciso IV). */
export type PartesDispositivo =
  | {
      tipo: "artigo";
      art: number;
      letraArt: string;
      /** `null` = caput; `"unico"` = parágrafo único. */
      par: { numero: number; letra: string } | "unico" | null;
      inc: string | null;
      ali: string | null;
    }
  | { tipo: "anexo"; anexo: number; item: number | null };

type ItemArtigo = Extract<PartesDispositivo, { tipo: "artigo" }>;
type Paragrafo = Exclude<ItemArtigo["par"], null>;

const RE_PARTES_ARTIGO =
  /^#art([1-9]\d*)([A-Z]*)(?:-par(?:([1-9]\d*)([A-Z]*)|(unico)))?(?:-([ivxlc]+))?(?:-al-([a-z]))?$/;
const RE_PARTES_ANEXO = /^#anexo(\d+)(?:-item(\d+))?$/;

/** Decompõe um ID de dispositivo; `null` se o formato for inválido. */
export function partesDispositivo(id: string): PartesDispositivo | null {
  const artigo = RE_PARTES_ARTIGO.exec(id);
  if (artigo) {
    const [, art, letraArt, par, letraPar, unico, inc, ali] = artigo;
    return {
      tipo: "artigo",
      art: Number(art),
      letraArt: letraArt ?? "",
      par: unico ? "unico" : par ? { numero: Number(par), letra: letraPar ?? "" } : null,
      inc: inc ?? null,
      ali: ali ?? null,
    };
  }
  const anexo = RE_PARTES_ANEXO.exec(id);
  if (anexo) return { tipo: "anexo", anexo: Number(anexo[1]), item: anexo[2] ? Number(anexo[2]) : null };
  return null;
}

/** "9º", "10", "36-A", "9º-B": ordinal até 9, cardinal depois, letra com hífen. */
function numeral(numero: number, letra = ""): string {
  return `${numero}${numero <= 9 ? "º" : ""}${letra ? `-${letra}` : ""}`;
}

/**
 * Lista em português: "a", "a e b", "a, b e c". Quando o penúltimo item já tem vírgula, o último
 * entra com ", e" ("arts. 28, X, e 42").
 */
export function listaPortugues(itens: readonly string[]): string {
  if (itens.length <= 1) return itens[0] ?? "";
  const penultimo = itens.at(-2)!;
  return `${itens.slice(0, -1).join(", ")}${penultimo.includes(",") ? ", e " : " e "}${itens.at(-1)!}`;
}

/** Comprime sequências de três ou mais números consecutivos em "x a y". */
function comFaixas(numeros: readonly number[], rotulo: (numero: number) => string): string[] {
  const saida: string[] = [];
  for (let i = 0; i < numeros.length;) {
    let fim = i;
    while (fim + 1 < numeros.length && numeros[fim + 1] === numeros[fim]! + 1) fim += 1;
    if (fim - i >= 2) {
      saida.push(`${rotulo(numeros[i]!)} a ${rotulo(numeros[fim]!)}`);
      i = fim + 1;
    } else {
      saida.push(rotulo(numeros[i]!));
      i += 1;
    }
  }
  return saida;
}

/** Incisos (com alínea, quando houver) de um mesmo parágrafo ou do caput. */
function textoIncisos(itens: readonly ItemArtigo[]): string[] {
  const saida: string[] = [];
  let simples: number[] = [];
  const descarregar = () => {
    saida.push(...comFaixas(simples, (numero) => numeroParaRomano(numero).toUpperCase()));
    simples = [];
  };
  for (const item of itens) {
    if (item.ali === null) {
      simples.push(romanoParaNumero(item.inc!));
      continue;
    }
    descarregar();
    saida.push(`${item.inc!.toUpperCase()}, alínea "${item.ali}"`);
  }
  descarregar();
  return saida;
}

function rotuloParagrafo(par: Paragrafo): string {
  return par === "unico" ? "parágrafo único" : `§ ${numeral(par.numero, par.letra)}`;
}

/** Vários parágrafos sem inciso: "§§ 2º e 3º", "§§ 1º e 9º-B". */
function rotuloParagrafos(pars: readonly Paragrafo[]): string {
  if (pars.length === 1) return rotuloParagrafo(pars[0]!);
  const numerados = pars.filter((par): par is { numero: number; letra: string } => par !== "unico");
  const rotulos = numerados.some((par) => par.letra)
    ? numerados.map((par) => numeral(par.numero, par.letra))
    : comFaixas(
        numerados.map((par) => par.numero),
        (numero) => numeral(numero),
      );
  const unico = numerados.length < pars.length ? ["parágrafo único"] : [];
  if (numerados.length === 1) return listaPortugues([`§ ${rotulos[0]!}`, ...unico]);
  return listaPortugues([`§§ ${listaPortugues(rotulos)}`, ...unico]);
}

/** Partes de um artigo, sem o número: "XIII e § 1º, III", "§§ 2º e 3º", "parágrafo único". */
function textoPartesArtigo(itens: readonly ItemArtigo[]): string {
  // Unidades: incisos do caput, parágrafo com incisos, ou parágrafos sem inciso (juntos em "§§").
  const unidades: Array<string | Paragrafo[]> = [];
  for (let i = 0; i < itens.length;) {
    const par = itens[i]!.par;
    const chave = JSON.stringify(par);
    let fim = i;
    while (fim + 1 < itens.length && JSON.stringify(itens[fim + 1]!.par) === chave) fim += 1;
    const bloco = itens.slice(i, fim + 1);
    i = fim + 1;
    const comInciso = bloco.filter((item) => item.inc !== null);
    if (par === null) {
      unidades.push(listaPortugues(textoIncisos(comInciso)));
      continue;
    }
    if (comInciso.length < bloco.length) {
      const anterior = unidades.at(-1);
      if (Array.isArray(anterior)) anterior.push(par);
      else unidades.push([par]);
    }
    if (comInciso.length) unidades.push(`${rotuloParagrafo(par)}, ${listaPortugues(textoIncisos(comInciso))}`);
  }
  return listaPortugues(unidades.map((unidade) => (Array.isArray(unidade) ? rotuloParagrafos(unidade) : unidade)));
}

/**
 * Texto legível de dispositivos de uma mesma norma, na ordem dada. Dispositivos de um mesmo artigo
 * ficam juntos, na posição em que o artigo aparece primeiro. Lança erro para ID malformado.
 */
export function textoDispositivos(ids: readonly string[]): string {
  const artigos = new Map<string, { art: number; letra: string; puro: boolean; itens: ItemArtigo[] }>();
  const anexos: string[] = [];
  for (const id of ids) {
    const partes = partesDispositivo(id);
    if (partes === null) throw new Error(`dispositivo malformado: ${id}`);
    if (partes.tipo === "anexo") {
      anexos.push(`Anexo ${partes.anexo}${partes.item === null ? "" : `, item ${partes.item}`}`);
      continue;
    }
    // O artigo inteiro e partes dele ficam em entradas separadas, para não se confundirem.
    const puro = partes.par === null && partes.inc === null;
    const chave = `${partes.art}${partes.letraArt}${puro ? "" : "+"}`;
    const artigo = artigos.get(chave) ?? { art: partes.art, letra: partes.letraArt, puro, itens: [] };
    if (!puro) artigo.itens.push(partes);
    artigos.set(chave, artigo);
  }

  const textos: string[] = [];
  let faixa = false;
  const lista = [...artigos.values()];
  const simples = (indice: number) => lista[indice]!.puro && !lista[indice]!.letra;
  for (let i = 0; i < lista.length;) {
    const artigo = lista[i]!;
    let fim = i;
    while (fim + 1 < lista.length && simples(fim) && simples(fim + 1) && lista[fim + 1]!.art === lista[fim]!.art + 1) {
      fim += 1;
    }
    if (fim - i >= 2) {
      textos.push(`${numeral(artigo.art)} a ${numeral(lista[fim]!.art)}`);
      faixa = true;
      i = fim + 1;
      continue;
    }
    const numero = numeral(artigo.art, artigo.letra);
    textos.push(artigo.puro ? numero : `${numero}, ${textoPartesArtigo(artigo.itens)}`);
    i += 1;
  }
  const partes: string[] = [];
  if (textos.length) partes.push(`${textos.length > 1 || faixa ? "arts." : "art."} ${listaPortugues(textos)}`);
  partes.push(...anexos);
  return listaPortugues(partes);
}
