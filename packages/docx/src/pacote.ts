/**
 * Pacote OPC (o ZIP do DOCX): o ZIP de `zip.ts` (partes, XML e binários lidos sob limites) e as
 * relações entre as partes.
 */
import { ErroDocx } from "./erro.ts";
import { LIMITES_PADRAO, type LimitesDoPacote } from "./limites.ts";
import { atributo, filhos } from "./xml.ts";
import { PacoteZip } from "./zip.ts";

/** Bases dos tipos de relação: a do formato de transição (o comum) e a do Strict Open XML. */
const BASES_DE_RELACAO = [
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/officeDocument/relationships",
];
export const RELACAO_DOCUMENTO = BASES_DE_RELACAO.map((base) => `${base}/officeDocument`);
export const RELACAO_ESTILOS = BASES_DE_RELACAO.map((base) => `${base}/styles`);
export const RELACAO_NUMERACAO = BASES_DE_RELACAO.map((base) => `${base}/numbering`);
export const RELACAO_NOTAS_DE_RODAPE = BASES_DE_RELACAO.map((base) => `${base}/footnotes`);
export const RELACAO_NOTAS_DE_FIM = BASES_DE_RELACAO.map((base) => `${base}/endnotes`);
export const RELACAO_PROPRIEDADES = [
  "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
];

export type Relacao = {
  id: string;
  tipo: string;
  /** `Target` como está no arquivo (uma URL, quando externa). */
  alvo: string;
  externa: boolean;
  /** Nome da parte de destino no ZIP, sem barra inicial; `null` quando a relação é externa. */
  parte: string | null;
};

export { ErroDocx, LIMITES_PADRAO, type LimitesDoPacote };

/** Resolve `alvo` contra a pasta da parte de origem, como um caminho POSIX normalizado. */
function resolverParte(origem: string, alvo: string): string {
  const base = alvo.startsWith("/") ? [] : origem.split("/").slice(0, -1);
  const segmentos: string[] = [];
  for (const segmento of [...base, ...alvo.split("/")]) {
    if (!segmento || segmento === ".") continue;
    if (segmento === "..") segmentos.pop();
    else segmentos.push(segmento);
  }
  return segmentos.join("/");
}

/** Caminho da parte de relações de uma parte (`word/document.xml` → `word/_rels/document.xml.rels`). */
function parteDeRelacoes(parte: string): string {
  const corte = parte.lastIndexOf("/");
  return `${parte.slice(0, corte + 1)}_rels/${parte.slice(corte + 1)}.rels`;
}

export class PacoteOoxml extends PacoteZip {
  readonly #relacoes = new Map<string, Map<string, Relacao>>();

  /** Relações de uma parte, por id; `""` é o próprio pacote (`_rels/.rels`). */
  relacoes(parte: string): Map<string, Relacao> {
    let relacoes = this.#relacoes.get(parte);
    if (relacoes) return relacoes;
    relacoes = new Map();
    const raiz = this.xml(parte ? parteDeRelacoes(parte) : "_rels/.rels");
    for (const item of raiz ? filhos(raiz, "rel:Relationship") : []) {
      const id = atributo(item, "Id");
      const alvo = atributo(item, "Target");
      if (id === null || alvo === null) continue;
      const externa = atributo(item, "TargetMode") === "External";
      relacoes.set(id, {
        id,
        tipo: atributo(item, "Type") ?? "",
        alvo,
        externa,
        parte: externa ? null : resolverParte(parte, alvo),
      });
    }
    this.#relacoes.set(parte, relacoes);
    return relacoes;
  }

  /** Parte de destino da primeira relação de um dos tipos dados. */
  partePorTipo(origem: string, tipos: readonly string[]): string | null {
    for (const relacao of this.relacoes(origem).values()) if (tipos.includes(relacao.tipo)) return relacao.parte;
    return null;
  }
}
