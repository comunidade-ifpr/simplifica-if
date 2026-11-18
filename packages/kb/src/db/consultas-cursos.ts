/**
 * Consulta do serviço `Cursos` aos cursos do `kb.sqlite`, com o CNCT, o campus, o PPC e as ofertas de
 * cada um (`kb cursos`, ferramenta `listar_cursos`).
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { idCnct } from "./chaves.ts";
import * as Sql from "./sql.ts";

const Texto = Schema.String;
const TextoNulo = Schema.NullOr(Schema.String);
const Inteiro = Schema.Int;
const InteiroNulo = Schema.NullOr(Schema.Int);

export interface FiltrosCursos {
  eixo?: string | undefined;
  turno?: string | undefined;
  campus?: string | undefined;
  nivel?: string | undefined;
  forma?: string | undefined;
  situacao?: string | undefined;
  cnct?: string | undefined;
  processo?: string | undefined;
}

const LinhaCurso = Schema.Struct({
  id: Texto,
  nome: Texto,
  campus_id: Texto,
  campus_nome: TextoNulo,
  nivel: TextoNulo,
  forma_oferta: TextoNulo,
  modalidade: TextoNulo,
  situacao: TextoNulo,
  cnct_id: TextoNulo,
  cnct_denominacao: TextoNulo,
  eixo_tecnologico: TextoNulo,
  carga_horaria_minima_h: InteiroNulo,
  ppc_id: TextoNulo,
  ppc_markdown_path: TextoNulo,
  ppc_ano_documento: InteiroNulo,
  path: Texto,
});
const linhasCurso = Sql.todas(LinhaCurso);

const LinhaOferta = Schema.Struct({
  curso_id: Texto,
  id: Texto,
  tipo_oferta: Texto,
  vagas: InteiroNulo,
  turno: TextoNulo,
  turno_original: TextoNulo,
  turno_nota: TextoNulo,
  status_curadoria: TextoNulo,
  trecho_fonte: TextoNulo,
  url_fonte: Texto,
  path: Texto,
  linha_turno: Inteiro,
  processos: Texto,
});
const linhasOferta = Sql.todas(LinhaOferta);

export interface ResultadoCurso {
  id: string;
  nome: string;
  campus: { id: string; nome: string | null };
  nivel: string | null;
  forma_oferta: string | null;
  modalidade: string | null;
  situacao: string | null;
  cnct: {
    id: string;
    denominacao: string | null;
    eixo_tecnologico: string | null;
    carga_horaria_minima_h: number | null;
  } | null;
  ppc: { id: string; path: string | null; ano_documento: number | null } | null;
  ofertas: {
    id: string;
    processos: string[];
    tipo_oferta: string;
    vagas: number | null;
    turno: string | null;
    turno_original: string | null;
    turno_nota: string | null;
    status_curadoria: string | null;
    trecho_fonte: string | null;
    url_fonte: string;
    path: string;
    linha: number;
  }[];
  path: string;
}

export const listarCursos = Effect.fn("consultasCursos.listarCursos")(function* (filtros: FiltrosCursos = {}) {
  const condicoes: string[] = [];
  const parametros: Sql.Parametro[] = [];
  const add = (sql: string, valor: string | undefined) => {
    if (valor === undefined) return;
    condicoes.push(sql);
    parametros.push(valor);
  };
  add("k.eixo_tecnologico = ?", filtros.eixo);
  add("c.campus_id = ?", filtros.campus);
  add("c.nivel = ?", filtros.nivel);
  add("c.forma_oferta = ?", filtros.forma);
  add("c.situacao = ?", filtros.situacao);
  add("c.cnct_id = ?", filtros.cnct ? idCnct(filtros.cnct) : undefined);
  const cursos = yield* linhasCurso(
    `SELECT c.id, c.nome, c.campus_id, ca.nome AS campus_nome, c.nivel, c.forma_oferta, c.modalidade, c.situacao,
                c.cnct_id, k.denominacao AS cnct_denominacao, k.eixo_tecnologico, k.carga_horaria_minima_h,
                c.ppc_id, c.ppc_markdown_path, c.ppc_ano_documento, c.path
         FROM cursos c LEFT JOIN cnct k ON k.id = c.cnct_id LEFT JOIN campi ca ON ca.campus_id = c.campus_id
         ${condicoes.length ? `WHERE ${condicoes.join(" AND ")}` : ""}
         ORDER BY c.id`,
    parametros,
  );
  const ofertas = yield* linhasOferta(
    `SELECT oc.curso_id, o.id, o.tipo_oferta, o.vagas, o.turno, o.turno_original, o.turno_nota, o.status_curadoria,
                o.trecho_fonte, o.url_fonte, o.path, o.linha_turno,
                (SELECT group_concat(processo_id, ',') FROM (SELECT processo_id FROM ofertas_processos op WHERE op.oferta_id = o.id ORDER BY processo_id)) AS processos
         FROM ofertas_cursos oc JOIN ofertas o ON o.id = oc.oferta_id ORDER BY oc.curso_id, o.id`,
  );
  const porCurso = new Map<string, (typeof LinhaOferta.Type)[]>();
  for (const o of ofertas) porCurso.set(o.curso_id, [...(porCurso.get(o.curso_id) ?? []), o]);
  const saida: ResultadoCurso[] = [];
  for (const c of cursos) {
    const lista = (porCurso.get(c.id) ?? []).filter(
      (o) =>
        (!filtros.turno || o.turno === filtros.turno) &&
        (!filtros.processo || o.processos.split(",").includes(filtros.processo)),
    );
    if ((filtros.turno || filtros.processo) && !lista.length) continue;
    saida.push({
      id: c.id,
      nome: c.nome,
      campus: { id: c.campus_id, nome: c.campus_nome },
      nivel: c.nivel,
      forma_oferta: c.forma_oferta,
      modalidade: c.modalidade,
      situacao: c.situacao,
      cnct: c.cnct_id
        ? {
            id: c.cnct_id,
            denominacao: c.cnct_denominacao,
            eixo_tecnologico: c.eixo_tecnologico,
            carga_horaria_minima_h: c.carga_horaria_minima_h,
          }
        : null,
      ppc: c.ppc_id
        ? {
            id: c.ppc_id,
            path: c.ppc_markdown_path ? `base-conhecimento/${c.ppc_markdown_path}` : null,
            ano_documento: c.ppc_ano_documento,
          }
        : null,
      ofertas: lista.map((o) => ({
        id: o.id,
        processos: o.processos ? o.processos.split(",") : [],
        tipo_oferta: o.tipo_oferta,
        vagas: o.vagas,
        turno: o.turno,
        turno_original: o.turno_original,
        turno_nota: o.turno_nota,
        status_curadoria: o.status_curadoria,
        trecho_fonte: o.trecho_fonte,
        url_fonte: o.url_fonte,
        path: o.path,
        linha: o.linha_turno,
      })),
      path: c.path,
    });
  }
  return saida;
});
