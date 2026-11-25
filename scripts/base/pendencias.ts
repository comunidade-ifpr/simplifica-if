// @effect-diagnostics nodeBuiltinImport:off -- leitura síncrona das pendências e dos registros (node:fs), como o resto do pipeline da base
/**
 * O que está fora da base e precisa ser completado para entrar. Cada tipo de pendência tem seu
 * coletor; hoje, PPCs:
 *
 * - `ppc-pendente`: PPC convertido em `curadoria/pendencias/ppcs/`, com as pendências do front matter;
 * - `ppc-sem-texto`: curso com `ppc.url` sem nenhum PPC na base nem pendente (falta o DOCX);
 * - `ppc-versao-sem-texto`: versão de PPC conhecida (o PDF anexo a uma matriz do SUAP, por exemplo)
 *   que não está na base, registrada em `curadoria/pendencias/versoes-ppc/` (falta o DOCX).
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Schema from "effect/Schema";
import { analisarPpcPendente } from "@simplifica-if/kb/ppcs/front-matter";
import { RE_SLUG_PPC } from "@simplifica-if/kb/ppcs/ids";
import { compararTexto } from "@simplifica-if/kb/texto";
import { carregarDadosInstitucionais } from "../dados/institucional.ts";
import { validarJson } from "../esquema.ts";
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
    }
  | {
      readonly tipo: "ppc-versao-sem-texto";
      readonly curso: string;
      /** Relativo à raiz do repositório. */
      readonly arquivo: string;
      readonly pendencias: readonly string[];
      readonly fonte_url: string | null;
    };

export const TIPOS_PENDENCIA = ["ppc-pendente", "ppc-versao-sem-texto", "ppc-sem-texto"] as const;

/** Pasta das versões de PPC conhecidas sem texto, relativa à raiz do repositório. */
export const PASTA_VERSOES_PPC = "curadoria/pendencias/versoes-ppc";

const RE_CAMINHO_VERSAO = new RegExp(
  `^${PASTA_VERSOES_PPC}/(${RE_SLUG_PPC})/(${RE_SLUG_PPC})/suap-matriz-(\\d+)\\.json$`,
);

/** Campus, curso e matriz do SUAP de um caminho de versão sem texto; `null` se não for um. */
export function partesDoCaminhoVersao(
  caminho: string,
): { campusId: string; cursoSlug: string; matrizId: number } | null {
  const m = RE_CAMINHO_VERSAO.exec(caminho);
  return m ? { campusId: m[1]!, cursoSlug: m[2]!, matrizId: Number(m[3]) } : null;
}

const textoNaoVazio = Schema.String.check(Schema.isMinLength(1));

/**
 * Versão de PPC conhecida sem texto na base: a matriz do SUAP que a anexa, o trecho literal que mostra a
 * versão (a capa do PDF) e, quando achado, o PDF público. O ano não entra: sem o DOCX, a versão fica fora
 * da base, e o ano com a evidência é dado na importação.
 */
export const esquemaVersaoSemTexto = Schema.Struct({
  matriz_suap: Schema.Struct({
    id: Schema.Int,
    descricao: textoNaoVazio,
    /** "Ano de Criação" da matriz no SUAP: o da matriz, não o do PPC. */
    ano_criacao: Schema.optional(Schema.Int),
    data_inicio: Schema.optional(
      Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/, { message: "deve estar em AAAA-MM-DD" })),
    ),
  }),
  /** Trecho literal do documento que mostra a versão (capa, ato de ajuste), com onde foi lido. */
  evidencia: textoNaoVazio,
  fonte_url: Schema.optional(
    Schema.String.check(Schema.isPattern(/^https:\/\/\S+$/, { message: "deve ser URL https" })),
  ),
  /** Uma por grupo do que falta, `<campo>: <o que falta e o que já se tentou>`. */
  pendencias: Schema.Array(
    Schema.String.check(Schema.isPattern(/^[a-z_]+: \S/, { message: 'deve ser "<campo>: <motivo>"' })),
  ).check(Schema.isMinLength(1)),
});
export type VersaoSemTexto = typeof esquemaVersaoSemTexto.Type;

/** Arquivos `.json` em `curadoria/pendencias/versoes-ppc/`, relativos à raiz do repositório. */
export function arquivosVersoesSemTexto(caminhos: CaminhosBase): string[] {
  if (!NodeFS.existsSync(caminhos.pendenciasVersoesPpc)) return [];
  // Todo arquivo, não só `.json`: a validação acusa o que estiver fora do caminho.
  return listarRecursivo(caminhos.pendenciasVersoesPpc)
    .filter((caminho) => NodeFS.statSync(caminho).isFile())
    .map((caminho) => NodePath.relative(caminhos.raizProjeto, caminho).split(NodePath.sep).join("/"));
}

/** Lê e valida uma versão sem texto; lança `Error` com os problemas. */
export function lerVersaoSemTexto(caminhos: CaminhosBase, arquivo: string): VersaoSemTexto {
  const texto = NodeFS.readFileSync(NodePath.join(caminhos.raizProjeto, arquivo), "utf-8");
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    throw new Error(`${arquivo}: JSON inválido`);
  }
  return validarJson(esquemaVersaoSemTexto, bruto, arquivo);
}

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

function versoesSemTexto(caminhos: CaminhosBase): Pendencia[] {
  return arquivosVersoesSemTexto(caminhos).map((arquivo) => {
    const partes = partesDoCaminhoVersao(arquivo);
    const curso = partes ? `${partes.campusId}/${partes.cursoSlug}` : arquivo;
    try {
      const versao = lerVersaoSemTexto(caminhos, arquivo);
      return {
        tipo: "ppc-versao-sem-texto",
        curso,
        arquivo,
        pendencias: versao.pendencias,
        fonte_url: versao.fonte_url ?? null,
      };
    } catch (erro) {
      // Fora do contrato também é pendência: o validar_base diz o que corrigir.
      return { tipo: "ppc-versao-sem-texto", curso, arquivo, pendencias: [(erro as Error).message], fonte_url: null };
    }
  });
}

/** Tudo o que está fora da base e precisa ser completado, por tipo e por curso. */
export function listarPendencias(caminhos: CaminhosBase): Pendencia[] {
  const pendentes = ppcsPendentes(caminhos);
  const comPendente = new Set(pendentes.map((p) => p.curso));
  return [...pendentes, ...versoesSemTexto(caminhos), ...ppcsSemTexto(caminhos, comPendente)].sort(
    (a, b) => compararTexto(a.tipo, b.tipo) || compararTexto(a.curso, b.curso),
  );
}
