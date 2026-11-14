/** Leitura e validação dos arquivos de `avaliacao/` (YAML com o pacote `yaml`, JSON e zod). */
import { parse as interpretarYaml } from "yaml";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
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

export const RAIZ_REPOSITORIO = NodePath.resolve(import.meta.dirname, "..", "..");
export const DIR_AVALIACAO = NodePath.join(RAIZ_REPOSITORIO, "avaliacao");

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
  return interpretarYaml(NodeFS.readFileSync(caminho, "utf-8"));
}

export function interpretarPerguntas(texto: string, origem = "perguntas.yaml"): ArquivoPerguntas {
  return validar(esquemaArquivoPerguntas, interpretarYaml(texto), origem);
}

export function carregarPerguntas(caminho = NodePath.join(DIR_AVALIACAO, "perguntas.yaml")): ArquivoPerguntas {
  return interpretarPerguntas(NodeFS.readFileSync(caminho, "utf-8"), NodePath.relative(RAIZ_REPOSITORIO, caminho));
}

export function carregarConfig(caminho = NodePath.join(DIR_AVALIACAO, "config.yaml")): ConfigAvaliacao {
  return validar(esquemaConfig, lerYaml(caminho), NodePath.relative(RAIZ_REPOSITORIO, caminho));
}

export function carregarGabaritoConjunto(arquivo: string): GabaritoConjunto {
  const caminho = NodePath.resolve(RAIZ_REPOSITORIO, arquivo);
  return validar(esquemaGabaritoConjunto, JSON.parse(NodeFS.readFileSync(caminho, "utf-8")), arquivo);
}

export function carregarUniversos(caminho = NodePath.join(DIR_AVALIACAO, "gabaritos", "universos.json")): Universos {
  return validar(
    esquemaUniversos,
    JSON.parse(NodeFS.readFileSync(caminho, "utf-8")),
    NodePath.relative(RAIZ_REPOSITORIO, caminho),
  );
}

export function carregarPpcOuro(caminho: string): PpcOuro {
  return validar(esquemaPpcOuro, lerYaml(caminho), NodePath.relative(RAIZ_REPOSITORIO, caminho));
}
