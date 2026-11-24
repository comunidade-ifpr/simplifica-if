// @effect-diagnostics nodeBuiltinImport:off -- campos gerados do front matter, lidos dos arquivos pelos scripts (gerar_base, validar_base)
/**
 * Campos GERADOS do front matter das normas (fase 5), escritos por `scripts/gerar_base.ts` e
 * conferidos por `gerar_base.ts --check` e `validar_base.ts`:
 *
 * - relações (`revoga`, `revogada_por`, `altera`, `alterada_por`, `regulamenta`,
 *   `regulamentada_por`, `fundamenta_se_em`, `fundamenta`), de `base-conhecimento/relacoes.yaml`;
 * - `status_vigencia`, calculado na `data_referencia` de `base-conhecimento/config/vigencia.yaml`,
 *   e, quando o cálculo depende de data "a confirmar", `vigencia_a_confirmar` (a explicação). Nenhum
 *   dos dois traz a data: avançar a referência só muda o arquivo cujo status mudou.
 */
import * as NodeFS from "node:fs";
import { listarNormas } from "./estrutura.ts";
import { carregarRegistro } from "./registro.ts";
import { CAMPOS_RELACAO_FRONT_MATTER, camposRelacoesFrontMatter, carregarRelacoes } from "./relacoes.ts";
import { carregarConsolidado, carregarDatas, dataReferencia, statusEm } from "./vigencia.ts";

/** Campos que o gerador controla (removidos e reescritos a cada geração). */
const CAMPOS_GERADOS = ["status_vigencia", "vigencia_a_confirmar", ...CAMPOS_RELACAO_FRONT_MATTER] as const;

export type ValorGerado = string | string[];

/** Campos gerados da norma `id` (arquivo), na ordem em que vão para o front matter. */
export function camposGerados(id: string, raiz: string): Map<string, ValorGerado> {
  const campos = new Map<string, ValorGerado>();
  const referencia = dataReferencia(raiz);
  const fonte = {
    registro: carregarRegistro(raiz),
    datas: carregarDatas(raiz),
    relacoes: carregarRelacoes(raiz),
    consolidado: carregarConsolidado(raiz),
  };
  const resultado = statusEm(id, referencia, fonte);
  campos.set("status_vigencia", resultado.status);
  if (!resultado.certo) campos.set("vigencia_a_confirmar", resultado.pendencias.join("; "));
  const relacoes = camposRelacoesFrontMatter(id, raiz, carregarRegistro(raiz));
  for (const campo of CAMPOS_RELACAO_FRONT_MATTER) {
    const valor = relacoes[campo];
    if (valor?.length) campos.set(campo, valor);
  }
  return campos;
}

function yamlTexto(valor: string): string {
  return JSON.stringify(valor);
}

/** Linhas YAML de um campo gerado. */
function linhasCampo(campo: string, valor: ValorGerado): string[] {
  if (typeof valor === "string") return [`${campo}: ${yamlTexto(valor)}`];
  return [`${campo}:`, ...valor.map((item) => `  - ${yamlTexto(item)}`)];
}

/**
 * Reescreve os campos gerados no front matter: remove os blocos existentes desses campos e insere
 * os novos. `status_vigencia` fica onde estava (ausente, entra logo antes dos demais); os demais vão logo depois de
 * `fonte_url` ou `fonte_referencia` (ou no fim do front matter). O restante do arquivo não muda.
 */
export function reescreverFrontMatter(texto: string, campos: Map<string, ValorGerado>): string {
  if (campos.size === 0) return texto;
  const fim = texto.indexOf("\n---", 4);
  const linhas = texto.slice(4, fim + 1).split("\n");
  if (linhas.at(-1) === "") linhas.pop();
  const controlados = new Set<string>(CAMPOS_GERADOS);
  const saida: string[] = [];
  let pulando = false;
  let posStatus = -1;
  let posFonte = -1;
  for (const linha of linhas) {
    const chave = /^([A-Za-z_][\w-]*):/.exec(linha)?.[1];
    if (chave !== undefined) {
      pulando = controlados.has(chave);
      if (chave === "status_vigencia") posStatus = saida.length;
      if (pulando) continue;
      saida.push(linha);
      if (chave === "fonte_url" || chave === "fonte_referencia") posFonte = saida.length;
      continue;
    }
    if (pulando && (linha.startsWith(" ") || linha.startsWith("-") || linha === "")) continue;
    pulando = false;
    saida.push(linha);
  }
  const status = campos.get("status_vigencia");
  const demais = [...campos].filter(([campo]) => campo !== "status_vigencia").flatMap(([c, v]) => linhasCampo(c, v));
  const inserirDemais = posFonte === -1 ? saida.length : posFonte;
  saida.splice(inserirDemais, 0, ...demais);
  if (status !== undefined) {
    // sem status (norma nova), ele entra antes dos demais: é onde a reescrita seguinte o deixa
    const pos = posStatus === -1 ? inserirDemais : posStatus <= inserirDemais ? posStatus : posStatus + demais.length;
    saida.splice(pos, 0, ...linhasCampo("status_vigencia", status));
  }
  return `---\n${saida.join("\n")}\n${texto.slice(fim + 1)}`;
}

export interface NormaGerada {
  id: string;
  path: string;
  arquivo: string;
  atual: string;
  esperado: string;
}

/** Texto esperado de cada norma da base, com os campos gerados atualizados. */
export function normasComCamposGerados(raiz: string): NormaGerada[] {
  return listarNormas(raiz).map((norma) => {
    const atual = NodeFS.readFileSync(norma.arquivo, "utf-8");
    return { ...norma, atual, esperado: reescreverFrontMatter(atual, camposGerados(norma.id, raiz)) };
  });
}
