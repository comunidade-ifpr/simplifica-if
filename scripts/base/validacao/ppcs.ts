// @effect-diagnostics nodeBuiltinImport:off -- validação síncrona da base (validar_base), lê os PPCs com node:fs
/**
 * Validação dos PPCs da base contra as fontes: o caminho e o front matter de cada Markdown, e a ligação
 * com os registros dos cursos (todo PPC entra no índice, e o vigente é a versão mais recente, com a
 * fonte que o curso aponta). O índice em si (`index.json`, `secoes/*.jsonl`) é gerado: o
 * `validar_base` confere que ele está em dia com o `gerar_base`, e não refaz as regras do gerador.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { ehDiretorio, listarDiretorio, naBase } from "../caminhos.ts";
import { coletarItensPpc } from "../indice-ppcs.ts";
import { ehErroFrontMatter } from "@simplifica-if/kb/normas/front-matter";
import { analisarPpc, conferirEvidenciaAno, type ProvenienciaPpc } from "@simplifica-if/kb/ppcs/front-matter";
import { compararVersoesPpc, idPpc, partesDoCaminhoPpc } from "@simplifica-if/kb/ppcs/ids";
import { lerTexto, ordenarCaminhos, ordenarTextos } from "@simplifica-if/kb/texto";
import type { Contexto } from "./contexto.ts";

/** PPC vigente de cada curso: `campus/curso` → caminho do Markdown existente (`ppc.markdown_path`). */
function ppcsVigentesDosCursos(ctx: Contexto): Map<string, { readonly path: string; readonly url: string }> {
  const ppcs = new Map<string, { readonly path: string; readonly url: string }>();
  // Registro inválido fica de fora; a validação dos registros institucionais o acusa.
  const { dados } = ctx.dadosInstitucionais();
  for (const curso of dados.cursos) {
    const caminhoMarkdown = curso.ppc?.markdown_path;
    if (curso.ppc?.url && caminhoMarkdown && NodeFS.existsSync(naBase(ctx.c, caminhoMarkdown))) {
      ppcs.set(`${curso.campus_id}/${curso.curso_slug}`, { path: caminhoMarkdown, url: curso.ppc.url });
    }
  }
  return ppcs;
}

/** Os Markdown de `ppcs/` (fora de `secoes/`), relativos a `base-conhecimento/`. */
function ppcsNoDisco(ctx: Contexto): string[] {
  return ordenarCaminhos(
    listarDiretorio(ctx.c.ppcs)
      .flatMap((pasta) =>
        ehDiretorio(pasta) && NodePath.basename(pasta) !== "secoes"
          ? [
              ...listarDiretorio(pasta, ".md"),
              ...listarDiretorio(pasta).flatMap((sub) => (ehDiretorio(sub) ? listarDiretorio(sub, ".md") : [])),
            ]
          : [],
      )
      .map((caminho) => ctx.rel(caminho)),
  );
}

/**
 * Cada PPC em `ppcs/<campus>/<curso>/<versao>.md`, com o front matter no contrato, o `id` igual a
 * `ppc:<campus>/<curso>/<versao>` e o ano com a evidência literal. Devolve também a proveniência dos
 * válidos, pelo caminho.
 */
function validarArquivosPpc(ctx: Contexto, caminhos: readonly string[]) {
  const erros: string[] = [];
  const proveniencias = new Map<string, ProvenienciaPpc>();
  for (const caminho of caminhos) {
    const partes = partesDoCaminhoPpc(caminho);
    if (!partes) {
      erros.push(`${caminho}: PPC fora do caminho ppcs/<campus>/<curso>/<versao>.md`);
      continue;
    }
    let lido;
    try {
      lido = analisarPpc(lerTexto(naBase(ctx.c, caminho), { ignorarErros: true }), caminho);
    } catch (erro) {
      if (ehErroFrontMatter(erro)) {
        erros.push(erro.message);
        continue;
      }
      throw erro;
    }
    const { proveniencia, corpo } = lido;
    const esperado = idPpc(partes.campusId, partes.cursoSlug, partes.versao);
    if (proveniencia.id !== esperado) erros.push(`${caminho}: id do front matter deve ser ${esperado}`);
    const problemaEvidencia = conferirEvidenciaAno(proveniencia, corpo);
    if (problemaEvidencia) erros.push(`${caminho}: ${problemaEvidencia}`);
    proveniencias.set(caminho, proveniencia);
  }
  return { erros, proveniencias };
}

/**
 * Todo PPC da base fica no índice, e cada curso tem um PPC vigente, a versão mais recente, com a fonte
 * que o curso aponta: os Markdown de `ppcs/` são exatamente os itens que o gerador monta (um PPC sem
 * registro de curso, ou com registro incompleto, ficaria de fora), cada curso com `ppc.markdown_path`
 * tem esse PPC como a última versão, e o `fonte_url` dele é o `ppc.url` do curso. PPC não sai da
 * base, mas também não fica solto.
 */
export function validarPpcs(ctx: Contexto): string[] {
  const noDisco = ppcsNoDisco(ctx);
  const { erros, proveniencias } = validarArquivosPpc(ctx, noDisco);
  if (erros.length) return erros;

  const itens = coletarItensPpc(ctx.c);
  const noIndice = new Set(itens.map((item) => item.path));
  for (const caminho of noDisco) {
    if (!noIndice.has(caminho)) erros.push(`${caminho}: PPC sem item no índice (curso sem registro ou incompleto?)`);
  }

  const ultimaVersao = new Map<string, string>();
  for (const item of itens) {
    const curso = `${item.campus_id}/${item.curso_slug}`;
    const ultima = ultimaVersao.get(curso);
    if (ultima === undefined || compararVersoesPpc(item.versao, ultima) > 0) ultimaVersao.set(curso, item.versao);
  }
  const vigentes = ppcsVigentesDosCursos(ctx);
  for (const curso of ordenarTextos([...vigentes.keys()])) {
    const vigente = vigentes.get(curso)!;
    const partes = partesDoCaminhoPpc(vigente.path);
    if (!partes || !noIndice.has(vigente.path)) {
      erros.push(`índice de PPCs: curso ${curso} sem PPC vigente no índice (${vigente.path})`);
      continue;
    }
    if (partes.versao !== ultimaVersao.get(curso)) {
      erros.push(
        `índice de PPCs: o PPC vigente de ${curso} (${partes.versao}) não é a versão mais recente (${ultimaVersao.get(curso)})`,
      );
    }
    const fonte = proveniencias.get(vigente.path)?.fonte_url;
    if (fonte !== vigente.url) {
      erros.push(
        `${vigente.path}: fonte_url do front matter difere do ppc.url vigente (${vigente.url}); o PPC mudou e a versão nova entra pelo node scripts/importar_ppc_docx.ts, ou ppc.url está errado`,
      );
    }
  }
  return erros;
}
