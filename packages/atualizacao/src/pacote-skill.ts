/**
 * O pacote de uma skill do app: JSON com os arquivos (o `SKILL.md` e os de `simplifica.arquivos`),
 * comprimido com zstd. Um formato próprio e mínimo, para o app não precisar de leitor de tar ou zip:
 * cada caminho é conferido (relativo, sem `..`, sem `\`), e o tamanho total tem limite.
 */
import { comprimir, descomprimir } from "./zstd.ts";

export const FORMATO_PACOTE_SKILL = 1;
/** Limite do pacote descomprimido: 20 MB. */
export const LIMITE_PACOTE_SKILL = 20 * 1024 * 1024;

export interface ArquivoSkill {
  /** Relativo à pasta da skill, com `/`. */
  readonly caminho: string;
  readonly conteudo: Uint8Array;
}

export interface PacoteSkill {
  readonly nome: string;
  readonly versao: string;
  readonly arquivos: ReadonlyArray<ArquivoSkill>;
}

const NOME = /^[a-z0-9][a-z0-9-]*$/;

/** Um caminho de arquivo aceitável dentro da pasta da skill. */
export function caminhoSeguro(caminho: string): boolean {
  if (caminho === "" || caminho.includes("\\") || caminho.startsWith("/") || caminho.includes("\0")) return false;
  return caminho.split("/").every((parte) => parte !== "" && parte !== "." && parte !== "..");
}

export function empacotarSkill(pacote: PacoteSkill): Buffer {
  if (!NOME.test(pacote.nome)) throw new Error(`nome de skill inválido: ${pacote.nome}`);
  const ordenados = [...pacote.arquivos].sort((a, b) => (a.caminho < b.caminho ? -1 : a.caminho > b.caminho ? 1 : 0));
  for (const arquivo of ordenados) {
    if (!caminhoSeguro(arquivo.caminho))
      throw new Error(`caminho inválido na skill ${pacote.nome}: ${arquivo.caminho}`);
  }
  const json = JSON.stringify({
    formato: FORMATO_PACOTE_SKILL,
    nome: pacote.nome,
    versao: pacote.versao,
    arquivos: ordenados.map((arquivo) => ({
      caminho: arquivo.caminho,
      conteudo: Buffer.from(arquivo.conteudo).toString("base64"),
    })),
  });
  return comprimir(Buffer.from(json, "utf8"));
}

export function desempacotarSkill(dados: Uint8Array): PacoteSkill {
  const json: unknown = JSON.parse(descomprimir(dados, LIMITE_PACOTE_SKILL).toString("utf8"));
  if (typeof json !== "object" || json === null) throw new Error("pacote de skill inválido");
  const { formato, nome, versao, arquivos } = json as Record<string, unknown>;
  if (formato !== FORMATO_PACOTE_SKILL) throw new Error(`formato de pacote de skill desconhecido: ${String(formato)}`);
  if (typeof nome !== "string" || !NOME.test(nome)) throw new Error("pacote de skill sem nome válido");
  if (typeof versao !== "string") throw new Error("pacote de skill sem versão");
  if (!Array.isArray(arquivos)) throw new Error("pacote de skill sem arquivos");
  const lidos = arquivos.map((item: unknown): ArquivoSkill => {
    const { caminho, conteudo } = (item ?? {}) as Record<string, unknown>;
    if (typeof caminho !== "string" || !caminhoSeguro(caminho) || typeof conteudo !== "string") {
      throw new Error(`arquivo inválido no pacote da skill ${nome}`);
    }
    return { caminho, conteudo: new Uint8Array(Buffer.from(conteudo, "base64")) };
  });
  if (!lidos.some((arquivo) => arquivo.caminho === "SKILL.md")) throw new Error(`pacote da skill ${nome} sem SKILL.md`);
  return { nome, versao, arquivos: lidos };
}
