/** Leitura e validação dos arquivos de `avaliacao/` (YAML com `Bun.YAML.parse`, JSON e zod). */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { z } from "zod";
import {
  esquemaArquivoPerguntas,
  esquemaConfig,
  esquemaGabaritoConjunto,
  esquemaPpcOuro,
  esquemaUniversos,
  type ArquivoPerguntas,
  type ConfigAvaliacao,
  type GabaritoConjunto,
  type PpcOuro,
  type Universos,
} from "./esquema.ts";

export const RAIZ_REPOSITORIO = path.resolve(import.meta.dir, "..", "..");
export const DIR_AVALIACAO = path.join(RAIZ_REPOSITORIO, "avaliacao");

function formatarErros(origem: string, erro: z.ZodError): string {
  return erro.issues
    .map((problema) => `${origem}: ${problema.path.join(".") || "(raiz)"}: ${problema.message}`)
    .join("\n");
}

function validar<T>(esquema: z.ZodType<T>, dados: unknown, origem: string): T {
  const resultado = esquema.safeParse(dados);
  if (!resultado.success) throw new Error(formatarErros(origem, resultado.error));
  return resultado.data;
}

export function lerYaml(caminho: string): unknown {
  return Bun.YAML.parse(readFileSync(caminho, "utf-8"));
}

export function interpretarPerguntas(texto: string, origem = "perguntas.yaml"): ArquivoPerguntas {
  return validar(esquemaArquivoPerguntas, Bun.YAML.parse(texto), origem);
}

export function carregarPerguntas(caminho = path.join(DIR_AVALIACAO, "perguntas.yaml")): ArquivoPerguntas {
  return interpretarPerguntas(readFileSync(caminho, "utf-8"), path.relative(RAIZ_REPOSITORIO, caminho));
}

export function carregarConfig(caminho = path.join(DIR_AVALIACAO, "config.yaml")): ConfigAvaliacao {
  return validar(esquemaConfig, lerYaml(caminho), path.relative(RAIZ_REPOSITORIO, caminho));
}

export function carregarGabaritoConjunto(arquivo: string): GabaritoConjunto {
  const caminho = path.resolve(RAIZ_REPOSITORIO, arquivo);
  return validar(esquemaGabaritoConjunto, JSON.parse(readFileSync(caminho, "utf-8")), arquivo);
}

export function carregarUniversos(caminho = path.join(DIR_AVALIACAO, "gabaritos", "universos.json")): Universos {
  return validar(
    esquemaUniversos,
    JSON.parse(readFileSync(caminho, "utf-8")),
    path.relative(RAIZ_REPOSITORIO, caminho),
  );
}

export function carregarPpcOuro(caminho: string): PpcOuro {
  return validar(esquemaPpcOuro, lerYaml(caminho), path.relative(RAIZ_REPOSITORIO, caminho));
}
