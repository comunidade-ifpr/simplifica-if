/** Validação de `dados/institucional/`: schema, caminho de cada arquivo e as regras da auditoria institucional. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { RAIZ_BASE } from "../config.ts";
import { chaveCurso } from "../dominio/curso.ts";
import { auditarBase } from "../dominio/auditoria.ts";
import {
  carregarDadosInstitucionais,
  paraDominio,
  RAIZ_DADOS_INSTITUCIONAIS,
  type CursoLocal,
} from "./institucional.ts";

/** IDs `cnct:<slug>` dos cursos de `catalogos/cnct/index.json`. */
export function idsCnct(raizBase: string = RAIZ_BASE): Set<string> {
  const arquivo = path.join(raizBase, "catalogos", "cnct", "index.json");
  if (!existsSync(arquivo)) return new Set();
  const indice = JSON.parse(readFileSync(arquivo, "utf-8")) as { items?: Array<{ id?: unknown }> };
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

export function validarDadosInstitucionais(
  raiz: string = RAIZ_DADOS_INSTITUCIONAIS,
  raizBase: string = RAIZ_BASE,
): {
  erros: string[];
  total: number;
} {
  const { dados, erros } = carregarDadosInstitucionais(raiz);
  if (erros.length) return { erros, total: 0 };
  // As movimentações ainda vivem no Notion; aqui valem as regras dos registros locais e de suas relações.
  const auditoria = [
    ...auditarBase({ ...paraDominio(dados), movimentacoes: [] }),
    ...cnctInexistentes(dados.cursos, idsCnct(raizBase)),
  ];
  const total =
    dados.campi.length + dados.cursos.length + dados.processos.length + dados.editais.length + dados.ofertas.length;
  return { erros: auditoria.map((erro) => `dados/institucional: ${erro}`), total };
}
