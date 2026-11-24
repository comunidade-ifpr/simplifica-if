// @effect-diagnostics nodeBuiltinImport:off -- leitura síncrona das pendências e dos registros (node:fs), como o resto do pipeline da base
/**
 * O que está fora da base e precisa ser completado para entrar. Cada tipo de pendência tem seu
 * coletor; hoje, PPCs:
 *
 * - `ppc-pendente`: PPC convertido em `curadoria/pendencias/ppcs/`, com as pendências do front matter;
 * - `ppc-sem-texto`: curso com `ppc.url` sem nenhum PPC na base nem pendente (falta o DOCX).
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { analisarPpcPendente } from "@simplifica-if/kb/ppcs/front-matter";
import { compararTexto } from "@simplifica-if/kb/texto";
import { carregarDadosInstitucionais } from "../dados/institucional.ts";
import { type CaminhosBase, listarRecursivo } from "./caminhos.ts";
import { partesDoCaminhoPendente } from "./versoes-ppc.ts";

export type Pendencia =
  | {
      readonly tipo: "ppc-pendente";
      /** `campus/curso`. */
      readonly curso: string;
      /** Relativo à raiz do repositório. */
      readonly arquivo: string;
      readonly pendencias: readonly string[];
      readonly fonte_url: string | null;
    }
  | {
      readonly tipo: "ppc-sem-texto";
      readonly curso: string;
      /** `ppc.url` do registro do curso. */
      readonly url: string;
      readonly pendencias: readonly string[];
    };

export const TIPOS_PENDENCIA = ["ppc-pendente", "ppc-sem-texto"] as const;

/** Arquivos `.md` em `curadoria/pendencias/ppcs/`, relativos à raiz do repositório. */
export function arquivosPpcsPendentes(caminhos: CaminhosBase): string[] {
  if (!NodeFS.existsSync(caminhos.pendenciasPpcs)) return [];
  return listarRecursivo(caminhos.pendenciasPpcs, ".md").map((caminho) =>
    NodePath.relative(caminhos.raizProjeto, caminho).split(NodePath.sep).join("/"),
  );
}

function ppcsPendentes(caminhos: CaminhosBase): Pendencia[] {
  const saida: Pendencia[] = [];
  for (const arquivo of arquivosPpcsPendentes(caminhos)) {
    const partes = partesDoCaminhoPendente(arquivo);
    let pendencias: readonly string[];
    let fonteUrl: string | null = null;
    try {
      const { pendente } = analisarPpcPendente(
        NodeFS.readFileSync(NodePath.join(caminhos.raizProjeto, arquivo), "utf-8"),
        arquivo,
      );
      pendencias = pendente.pendencias;
      fonteUrl = pendente.fonte_url;
    } catch (erro) {
      // O arquivo fora do contrato também é pendência: o validar_base diz o que corrigir.
      pendencias = [`front matter: ${(erro as Error).message}`];
    }
    saida.push({
      tipo: "ppc-pendente",
      curso: partes ? `${partes.campusId}/${partes.cursoSlug}` : arquivo,
      arquivo,
      pendencias,
      fonte_url: fonteUrl,
    });
  }
  return saida;
}

function ppcsSemTexto(caminhos: CaminhosBase, comPendente: ReadonlySet<string>): Pendencia[] {
  const { dados } = carregarDadosInstitucionais(NodePath.join(caminhos.institucional, "ifpr"));
  const saida: Pendencia[] = [];
  for (const curso of dados.cursos) {
    const chave = `${curso.campus_id}/${curso.curso_slug}`;
    const url = curso.ppc?.url;
    if (!url || curso.ppc?.markdown_path || comPendente.has(chave)) continue;
    saida.push({
      tipo: "ppc-sem-texto",
      curso: chave,
      url,
      pendencias: ["texto: o PPC está publicado, mas não há texto na base nem pendente; importe o DOCX da coordenação"],
    });
  }
  return saida;
}

/** Tudo o que está fora da base e precisa ser completado, por tipo e por curso. */
export function listarPendencias(caminhos: CaminhosBase): Pendencia[] {
  const pendentes = ppcsPendentes(caminhos);
  const comPendente = new Set(pendentes.map((p) => p.curso));
  return [...pendentes, ...ppcsSemTexto(caminhos, comPendente)].sort(
    (a, b) => compararTexto(a.tipo, b.tipo) || compararTexto(a.curso, b.curso),
  );
}
