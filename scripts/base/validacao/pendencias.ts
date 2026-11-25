// @effect-diagnostics nodeBuiltinImport:off -- validação síncrona das pendências (validar_base), com node:fs
/**
 * PPCs pendentes (`curadoria/pendencias/ppcs/<campus>/<curso>/<rotulo>.md`): ficam fora da base, mas o
 * repositório é público, então valem as mesmas regras de dados pessoais, URLs internas e caminhos locais; o front matter segue o
 * contrato de pendente (uma pendência por grupo de campos obrigatórios que falta) e o curso existe.
 * Versões sem texto (`curadoria/pendencias/versoes-ppc/<campus>/<curso>/suap-matriz-<id>.json`): mesmas
 * regras de texto público, o contrato do JSON e o curso existente.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { ehErroFrontMatter } from "@simplifica-if/kb/normas/front-matter";
import { analisarPpcPendente, conferirEvidenciaAno } from "@simplifica-if/kb/ppcs/front-matter";
import {
  arquivosPpcsPendentes,
  arquivosVersoesSemTexto,
  lerVersaoSemTexto,
  PASTA_VERSOES_PPC,
  partesDoCaminhoVersao,
} from "../pendencias.ts";
import { PASTA_PENDENCIAS_PPCS, partesDoCaminhoPendente } from "../versoes-ppc.ts";
import type { Contexto } from "./contexto.ts";
import { validarTextoPublico } from "./normas.ts";

export function validarPendenciasPpcs(ctx: Contexto): string[] {
  const erros: string[] = [];
  for (const arquivo of arquivosPpcsPendentes(ctx.c)) {
    const partes = partesDoCaminhoPendente(arquivo);
    if (!partes) {
      erros.push(`${arquivo}: PPC pendente fora do caminho ${PASTA_PENDENCIAS_PPCS}/<campus>/<curso>/<rotulo>.md`);
      continue;
    }
    const texto = NodeFS.readFileSync(NodePath.join(ctx.c.raizProjeto, arquivo), "utf-8");
    erros.push(...validarTextoPublico(arquivo, texto));
    const registro = NodePath.join(ctx.c.institucional, "ifpr", "cursos", partes.campusId, `${partes.cursoSlug}.json`);
    if (!NodeFS.existsSync(registro))
      erros.push(`${arquivo}: curso ${partes.campusId}/${partes.cursoSlug} sem registro`);
    try {
      const { pendente, corpo } = analisarPpcPendente(texto, arquivo);
      const problema = conferirEvidenciaAno(pendente, corpo);
      if (problema) erros.push(`${arquivo}: ${problema}`);
    } catch (erro) {
      if (!ehErroFrontMatter(erro)) throw erro;
      erros.push(erro.message);
    }
  }
  return erros;
}

export function validarVersoesSemTexto(ctx: Contexto): string[] {
  const erros: string[] = [];
  for (const arquivo of arquivosVersoesSemTexto(ctx.c)) {
    const partes = partesDoCaminhoVersao(arquivo);
    if (!partes) {
      erros.push(
        `${arquivo}: versão sem texto fora do caminho ${PASTA_VERSOES_PPC}/<campus>/<curso>/suap-matriz-<id>.json`,
      );
      continue;
    }
    erros.push(
      ...validarTextoPublico(arquivo, NodeFS.readFileSync(NodePath.join(ctx.c.raizProjeto, arquivo), "utf-8")),
    );
    const registro = NodePath.join(ctx.c.institucional, "ifpr", "cursos", partes.campusId, `${partes.cursoSlug}.json`);
    if (!NodeFS.existsSync(registro))
      erros.push(`${arquivo}: curso ${partes.campusId}/${partes.cursoSlug} sem registro`);
    try {
      const versao = lerVersaoSemTexto(ctx.c, arquivo);
      if (versao.matriz_suap.id !== partes.matrizId)
        erros.push(`${arquivo}: matriz_suap.id ${versao.matriz_suap.id} diferente da do nome do arquivo`);
    } catch (erro) {
      erros.push((erro as Error).message);
    }
  }
  return erros;
}
