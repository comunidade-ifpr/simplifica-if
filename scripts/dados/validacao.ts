// @effect-diagnostics nodeBuiltinImport:off -- validação síncrona dos registros institucionais (validar_base), lê o índice do CNCT com node:fs
/**
 * Validação dos registros de `institucional/ifpr/` (campi, cursos, processos seletivos, editais e
 * ofertas): schema, caminho de cada arquivo, as regras da auditoria institucional, o Markdown dos
 * PPCs, os índices gerados de cada coleção, os processos SEI exportados do Notion e as reuniões dos
 * conselhos (`conselhos.ts`).
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { RAIZ_BASE } from "../config.ts";
import { chaveCurso } from "../dominio/curso.ts";
import { auditarBase } from "../dominio/auditoria.ts";
import { auditarConselhos, carregarConselhos, verificarIndiceConselhos } from "./conselhos.ts";
import { verificarIndices } from "./indices.ts";
import {
  carregarDadosInstitucionais,
  paraDominio,
  RAIZ_DADOS_INSTITUCIONAIS,
  type CursoLocal,
} from "./institucional.ts";
import { validarProcessosSei } from "./processos-sei.ts";
import { verificarSchemasRegistros } from "./schemas-publicos.ts";

/** IDs `cnct:<slug>` dos cursos de `catalogos/cnct/index.json`. */
export function idsCnct(raizBase: string = RAIZ_BASE): Set<string> {
  const arquivo = NodePath.join(raizBase, "catalogos", "cnct", "index.json");
  if (!NodeFS.existsSync(arquivo)) return new Set();
  const indice = JSON.parse(NodeFS.readFileSync(arquivo, "utf-8")) as { items?: Array<{ id?: unknown }> };
  return new Set((indice.items ?? []).flatMap((item) => (typeof item.id === "string" ? [`cnct:${item.id}`] : [])));
}

/** `cnct_id` que não existe no CNCT da base. */
function cnctInexistentes(cursos: CursoLocal[], conhecidos: Set<string>): string[] {
  return cursos.flatMap((curso) =>
    curso.cnct_id && !conhecidos.has(curso.cnct_id)
      ? [`Curso ${chaveCurso(curso.campus_id, curso.curso_slug)}: cnct_id não existe no CNCT: ${curso.cnct_id}`]
      : [],
  );
}

/** `ppc.markdown_path` que não aponta para um arquivo da base. */
function markdownsInexistentes(cursos: CursoLocal[], raizBase: string): string[] {
  return cursos.flatMap((curso) => {
    const caminho = curso.ppc?.markdown_path;
    if (!caminho || NodeFS.existsSync(NodePath.join(raizBase, caminho))) return [];
    return [`Curso ${chaveCurso(curso.campus_id, curso.curso_slug)}: markdown convertido inexistente: ${caminho}`];
  });
}

export interface OpcoesValidacao {
  /**
   * Confere também o que liga os registros ao resto da base: o Markdown dos PPCs, os `index.json`
   * gerados e os processos SEI (padrão: sim). Os testes com raiz temporária desligam.
   */
  arquivosDaBase?: boolean;
}

export function validarDadosInstitucionais(
  raiz: string = RAIZ_DADOS_INSTITUCIONAIS,
  raizBase: string = RAIZ_BASE,
  opcoes: OpcoesValidacao = {},
): {
  erros: string[];
  total: number;
} {
  const carregados = carregarDadosInstitucionais(raiz);
  if (carregados.erros.length) return { erros: carregados.erros, total: 0 };
  const { dados } = carregados;
  // As movimentações ainda vivem no Notion; aqui valem as regras dos registros locais e de suas relações.
  const auditoria = [
    ...auditarBase({ ...paraDominio(dados), movimentacoes: [] }),
    ...cnctInexistentes(dados.cursos, idsCnct(raizBase)),
  ];
  const daBase = opcoes.arquivosDaBase ?? true;
  if (daBase) auditoria.push(...markdownsInexistentes(dados.cursos, raizBase));
  const erros = auditoria.map((erro) => `institucional/ifpr: ${erro}`);
  let reunioes = 0;
  if (daBase) {
    erros.push(...verificarIndices(dados, raiz));
    const cursos = new Set(dados.cursos.map((curso) => chaveCurso(curso.campus_id, curso.curso_slug)));
    erros.push(...validarProcessosSei(cursos).erros);
    const conselhos = carregarConselhos(raiz);
    erros.push(...conselhos.erros);
    erros.push(...auditarConselhos(conselhos.dados, new Set(dados.campi.map((campus) => campus.campus_id)), cursos));
    erros.push(...verificarIndiceConselhos(conselhos.dados, raiz));
    erros.push(...verificarSchemasRegistros());
    reunioes = conselhos.dados.reunioes.length;
  }
  const total =
    dados.campi.length +
    dados.cursos.length +
    dados.processos.length +
    dados.editais.length +
    dados.ofertas.length +
    reunioes;
  return { erros, total };
}
