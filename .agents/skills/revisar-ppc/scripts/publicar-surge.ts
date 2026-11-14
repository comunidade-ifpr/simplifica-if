// @effect-diagnostics nodeBuiltinImport:off extendsNativeError:off -- publicação síncrona pela CLI do Surge; o erro é lançado com a saída da CLI montada no ponto da falha
/**
 * Publicação do relatório no Surge (porte de `publicar_surge.py`).
 *
 * Só chama a CLI `surge` (por padrão `npx --yes surge`; `REVISAR_PPC_SURGE_CMD`
 * troca o comando, dividido como `shlex.split`) com a pasta do site e o
 * domínio, e confere a saída. `REVISAR_PPC_SURGE_DOMAIN` fixa o domínio padrão.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { search } from "@simplifica-if/kb/python/re";
import { dividirComandoShell } from "@simplifica-if/kb/python/shlex";
import { asciiNfkd, casefold } from "@simplifica-if/kb/python/texto";
import { aparar, apararCaracteres } from "@simplifica-if/kb/texto";
import { resolverCaminho } from "./rodada.ts";

export class ErroPublicacaoSurge extends Error {
  override name = "ErroPublicacaoSurge";
}

function slug(valor: string, limite = 48): string {
  const ascii = asciiNfkd(valor).toLowerCase();
  const completo = apararCaracteres(ascii.replace(/[^a-z0-9]+/g, "-"), "-");
  let resultado = apararCaracteres((completo || "relatorio").slice(0, limite), "-");
  if (completo.length > limite && resultado.includes("-")) {
    const corte = resultado.lastIndexOf("-");
    if (resultado.length - corte - 1 < 3) resultado = resultado.slice(0, corte);
  }
  return resultado || "relatorio";
}

/** Domínio padrão: `REVISAR_PPC_SURGE_DOMAIN` ou `revisar-ppc-<slug da rodada>.surge.sh`. */
export function dominioSurgePadrao(rodadaDir: string): string {
  const configurado = process.env.REVISAR_PPC_SURGE_DOMAIN;
  if (configurado) return configurado;
  return `revisar-ppc-${slug(NodePath.basename(rodadaDir))}.surge.sh`;
}

/** Monta a pasta publicada: `index.html` (cópia do relatório) e `assets/`, recriada do zero. */
export function prepararSiteSurge(relatorioHtml: string, destinoDir: string): string {
  if (NodeFS.existsSync(destinoDir)) NodeFS.rmSync(destinoDir, { recursive: true });
  NodeFS.mkdirSync(destinoDir, { recursive: true });
  NodeFS.copyFileSync(relatorioHtml, NodePath.join(destinoDir, "index.html"));
  const assetsOrigem = NodePath.join(NodePath.dirname(relatorioHtml), "assets");
  if (NodeFS.existsSync(assetsOrigem))
    NodeFS.cpSync(assetsOrigem, NodePath.join(destinoDir, "assets"), { recursive: true });
  return destinoDir;
}

function comandoBase(comando?: string[]): string[] {
  if (comando?.length) return comando;
  const configurado = process.env.REVISAR_PPC_SURGE_CMD;
  if (configurado) return dividirComandoShell(configurado);
  return ["npx", "--yes", "surge"];
}

function normalizarUrl(dominio: string): string {
  let valor = aparar(dominio);
  while (valor.endsWith("/")) valor = valor.slice(0, -1);
  return /^https?:\/\//i.test(valor) ? valor : `https://${valor}`;
}

/** Saída de processo como `text=True` do `subprocess`: UTF-8 com quebras de linha universais. */
function textoDoProcesso(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/\r\n?/g, "\n");
}

export type PublicacaoSurge = {
  servico: string;
  site_dir: string;
  domain: string;
  public_url: string;
  stdout: string;
  stderr: string;
  relatorio_html_original?: string;
};

/** Publica `siteDir` no Surge em `dominio`; lança `ErroPublicacaoSurge` se a CLI falhar ou não confirmar. */
export function publicarSiteSurge(siteDir: string, dominio: string, comando?: string[]): PublicacaoSurge {
  const site = resolverCaminho(siteDir);
  const [executavel, ...argumentos] = comandoBase(comando);
  const processo = NodeChildProcess.spawnSync(executavel!, [...argumentos, site, dominio], {
    input: "",
    stdio: "pipe",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (processo.error) throw processo.error;
  const stdout = aparar(textoDoProcesso(processo.stdout));
  const stderr = aparar(textoDoProcesso(processo.stderr));
  const saida = [stdout, stderr].filter(Boolean).join("\n");
  const detalhes = saida ? `\n${saida}` : "";

  if (processo.status !== 0) throw new ErroPublicacaoSurge(`Falha ao publicar relatório no Surge.${detalhes}`);
  if (search("\\bLogin or create surge account\\b|\\bemail:\\s*$", saida, { ignoreCase: true })) {
    throw new ErroPublicacaoSurge(
      "Falha ao publicar relatório no Surge: a CLI solicitou autenticação interativa. " +
        "Execute `npx surge login` ou configure credenciais de automação do Surge no ambiente.",
    );
  }
  if (!casefold(saida).includes("success")) {
    throw new ErroPublicacaoSurge(`Surge não retornou confirmação de publicação reconhecível.${detalhes}`);
  }
  return {
    servico: "surge",
    site_dir: site,
    domain: dominio,
    public_url: normalizarUrl(dominio),
    stdout,
    stderr,
  };
}
