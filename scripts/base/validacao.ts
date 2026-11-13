/**
 * Validação da base pública de conhecimento. Cada domínio fica em
 * `validacao/`; aqui só se define a ordem das verificações, que é também a
 * ordem das mensagens de erro na saída.
 */
import type { CaminhosBase } from "./caminhos.ts";
import { arquivosNormas } from "./front-matter.ts";
import { ehObjeto } from "@simplifica-if/kb/json";
import { validarCatalogos } from "./validacao/catalogos.ts";
import { Contexto } from "./validacao/contexto.ts";
import { validarInstitucional } from "./validacao/institucional.ts";
import {
  carregarManifest,
  validarCoberturaManifest,
  validarItemManifest,
  validarMarkdown,
  validarPadroesLocais,
  validarReadme,
  validarEstruturaNorma,
  validarRelacoesEVigencia,
  validarStubs,
  validarUnicidadeIds,
} from "./validacao/normas.ts";
import { validarArtefatosConversaoPpc } from "./validacao/ppcs.ts";

export type ResultadoValidacao = { erros: string[]; totalNormas: number };

export function validarBase(caminhos: CaminhosBase, opcoes: { artefatosPpc?: boolean } = {}): ResultadoValidacao {
  const ctx = new Contexto(caminhos);
  const erros = validarPadroesLocais(ctx);

  const carregado = carregarManifest(ctx);
  const manifest = carregado.ok ? carregado.valor : [];
  if (!carregado.ok) erros.push(...carregado.erros);

  erros.push(...validarCoberturaManifest(ctx, manifest));
  erros.push(...validarReadme(ctx));
  erros.push(...validarInstitucional(ctx));
  erros.push(...validarCatalogos(ctx));
  if (opcoes.artefatosPpc) erros.push(...validarArtefatosConversaoPpc(ctx));

  for (const caminho of arquivosNormas(caminhos)) {
    erros.push(...validarMarkdown(ctx, caminho));
    erros.push(...validarEstruturaNorma(ctx, caminho));
  }
  const stubs = validarStubs(ctx);
  erros.push(...stubs.erros);
  erros.push(...validarUnicidadeIds(ctx, arquivosNormas(caminhos), stubs.ids));
  if (stubs.erros.length === 0) erros.push(...validarRelacoesEVigencia(ctx));

  for (const item of manifest) {
    if (ehObjeto(item)) erros.push(...validarItemManifest(ctx, item));
    else erros.push("manifest.json contém item que não é objeto");
  }

  return { erros, totalNormas: manifest.length };
}
