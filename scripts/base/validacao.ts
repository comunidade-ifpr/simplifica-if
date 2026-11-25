/**
 * Validação da base pública de conhecimento. Cada domínio fica em
 * `validacao/`; aqui só se define a ordem das verificações, que é também a
 * ordem das mensagens de erro na saída.
 */
import type { CaminhosBase } from "./caminhos.ts";
import { arquivosNormas } from "./front-matter.ts";
import { validarCatalogos } from "./validacao/catalogos.ts";
import { type CarregamentoInstitucional, Contexto } from "./validacao/contexto.ts";
import {
  validarMarkdown,
  validarNormasNaRaiz,
  validarPadroesLocais,
  validarReadme,
  validarEstruturaNorma,
  validarRelacoesEVigencia,
  validarStubs,
  validarUnicidadeIds,
} from "./validacao/normas.ts";
import { validarPendenciasPpcs } from "./validacao/pendencias.ts";
import { validarPpcs } from "./validacao/ppcs.ts";

export type ResultadoValidacao = {
  erros: string[];
  totalNormas: number;
  dadosInstitucionais: CarregamentoInstitucional;
};

export function validarBase(caminhos: CaminhosBase): ResultadoValidacao {
  const ctx = new Contexto(caminhos);
  const erros = validarPadroesLocais(ctx);

  erros.push(...validarNormasNaRaiz(ctx));
  erros.push(...validarReadme(ctx));
  erros.push(...validarPpcs(ctx));
  erros.push(...validarPendenciasPpcs(ctx));
  erros.push(...validarCatalogos(ctx));

  const normas = arquivosNormas(caminhos);
  for (const caminho of normas) {
    erros.push(...validarMarkdown(ctx, caminho));
    erros.push(...validarEstruturaNorma(ctx, caminho));
  }
  const stubs = validarStubs(ctx);
  erros.push(...stubs.erros);
  erros.push(...validarUnicidadeIds(ctx, normas, stubs.ids));
  if (stubs.erros.length === 0) erros.push(...validarRelacoesEVigencia(ctx));

  return { erros, totalNormas: normas.length, dadosInstitucionais: ctx.dadosInstitucionais() };
}
