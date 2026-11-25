/**
 * O pacote de uma skill do app: JSON com os arquivos (o `SKILL.md` e os de `simplifica.arquivos`),
 * comprimido com zstd. Um formato próprio e mínimo, para o app não precisar de leitor de tar ou zip:
 * cada caminho é conferido (relativo, sem `..`, sem `\`), e o tamanho total tem limite.
 */
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { problemas } from "@simplifica-if/kb/esquema/mensagens";
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

const ArquivoSkillSerializado = Schema.Struct({
  caminho: Schema.String.check(
    Schema.makeFilter((valor: string) => caminhoSeguro(valor) || "arquivo inválido no pacote da skill"),
  ),
  conteudo: Schema.String,
});

const PacoteSkillSerializado = Schema.Struct({
  formato: Schema.Literal(FORMATO_PACOTE_SKILL),
  nome: Schema.String.check(Schema.isPattern(NOME, { message: "pacote de skill sem nome válido" })),
  versao: Schema.String,
  arquivos: Schema.Array(ArquivoSkillSerializado).check(
    Schema.makeFilter(
      (lista) => lista.some((arquivo) => arquivo.caminho === "SKILL.md") || "pacote da skill sem SKILL.md",
    ),
  ),
});

const decodificarPacoteJson = Schema.decodeUnknownResult(Schema.fromJsonString(PacoteSkillSerializado));

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
  const resultado = decodificarPacoteJson(descomprimir(dados, LIMITE_PACOTE_SKILL).toString("utf8"));
  if (Result.isFailure(resultado)) {
    const primeiro = problemas(resultado.failure.issue)[0]?.mensagem ?? "pacote de skill inválido";
    throw new Error(primeiro);
  }
  const { nome, versao, arquivos } = resultado.success;
  return {
    nome,
    versao,
    arquivos: arquivos.map((arquivo) => ({
      caminho: arquivo.caminho,
      conteudo: new Uint8Array(Buffer.from(arquivo.conteudo, "base64")),
    })),
  };
}
