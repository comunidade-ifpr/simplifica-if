/**
 * Consultas do serviço `Ppcs` aos fatos extraídos dos PPCs e ao cruzamento com o SUAP no `kb.sqlite`
 * (`kb fatos-ppc`, ferramenta `fatos_ppc`). Pedem o `SqlClient` do ambiente.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { RESULTADOS_DIVERGENTES } from "../fatos/divergencias.ts";
import { compararTexto } from "../texto.ts";
import { idPpc } from "./chaves.ts";
import * as Sql from "./sql.ts";

const Texto = Schema.String;
const TextoNulo = Schema.NullOr(Schema.String);
const Inteiro = Schema.Int;
const InteiroNulo = Schema.NullOr(Schema.Int);

const LinhaFato = Schema.Struct({
  ppc_id: Texto,
  fato: Texto,
  valor: Texto,
  valor_num: InteiroNulo,
  unidade: TextoNulo,
  status_curadoria: Texto,
  regra: Texto,
  trecho_fonte: Texto,
  path: Texto,
  linha: Inteiro,
  alternativas_json: Schema.fromJsonString(Schema.Unknown),
});
const linhasFato = Sql.todas(LinhaFato);

const LinhaCruzamento = Schema.Struct({
  ppc_id: Texto,
  aspecto: Texto,
  resultado: Texto,
  valor_ppc: TextoNulo,
  valor_suap: TextoNulo,
  explicacao: Texto,
});
const linhasCruzamento = Sql.todas(LinhaCruzamento);

const LinhaMatriz = Schema.Struct({
  curso_id: Texto,
  matriz_id: Inteiro,
  ano: InteiroNulo,
  ch_exibida_h: Inteiro,
  estagio_exigido: Inteiro,
  ch_estagio_h: InteiroNulo,
  trecho: Texto,
  path: Texto,
  linha: Inteiro,
});
const linhasMatriz = Sql.todas(LinhaMatriz);

const LinhaPpcCurso = Schema.Struct({
  id: Texto,
  curso_nome: Texto,
  campus_nome: Texto,
  nivel: Texto,
  tipo_oferta: Texto,
  path: Texto,
  curso_id: TextoNulo,
  suap_matrizes_situacao: TextoNulo,
  suap_ch_comum_h: InteiroNulo,
});
const linhasPpcCurso = Sql.todas(LinhaPpcCurso);

export interface FatosDoPpc {
  ppc: string;
  curso: string | null;
  nome: string;
  campus: string;
  nivel: string;
  forma: string;
  path: string;
  fatos: (Omit<typeof LinhaFato.Type, "ppc_id" | "alternativas_json"> & { alternativas: unknown })[];
  suap: {
    situacao: string | null;
    carga_horaria_comum_h: number | null;
    matrizes: (Omit<typeof LinhaMatriz.Type, "curso_id" | "estagio_exigido"> & { estagio_exigido: boolean })[];
  };
  cruzamento: Omit<typeof LinhaCruzamento.Type, "ppc_id">[];
}

/** Filtros dos fatos de PPC: um PPC (`campus/curso` ou `ppc:campus/curso`), nível e campus (`campus_id`). */
export interface FiltrosFatos {
  ppc?: string | undefined;
  nivel?: string | undefined;
  campus?: string | undefined;
}

function agrupar<T, K>(lista: readonly T[], chave: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of lista) m.set(chave(x), [...(m.get(chave(x)) ?? []), x]);
  return m;
}

/** Fatos e cruzamento com o SUAP de um PPC, ou de todos (filtros opcionais por nível e campus). */
export const fatosDosPpcs = Effect.fn("consultasFatos.fatosDosPpcs")(function* (filtros: FiltrosFatos = {}) {
  const condicoes: string[] = [];
  const parametros: Sql.Parametro[] = [];
  if (filtros.ppc) {
    condicoes.push("p.id = ?");
    parametros.push(idPpc(filtros.ppc));
  }
  if (filtros.nivel) {
    condicoes.push("p.nivel = ?");
    parametros.push(filtros.nivel);
  }
  if (filtros.campus) {
    condicoes.push("p.campus_id = ?");
    parametros.push(filtros.campus);
  }
  const ppcs = yield* linhasPpcCurso(
    `SELECT p.id, p.curso_nome, p.campus_nome, p.nivel, p.tipo_oferta, p.path, p.curso_id,
                c.suap_matrizes_situacao, c.suap_ch_comum_h
         FROM ppcs p LEFT JOIN cursos c ON c.id = p.curso_id
         ${condicoes.length ? `WHERE ${condicoes.join(" AND ")}` : ""} ORDER BY p.id`,
    parametros,
  );
  const fatos = yield* linhasFato("SELECT * FROM ppc_fatos ORDER BY ppc_id, fato");
  const cruz = yield* linhasCruzamento("SELECT * FROM ppc_suap ORDER BY ppc_id, aspecto");
  const matrizes = yield* linhasMatriz(
    "SELECT curso_id, matriz_id, ano, ch_exibida_h, estagio_exigido, ch_estagio_h, trecho, path, linha FROM suap_matrizes ORDER BY curso_id, ordem",
  );
  const fatosPor = agrupar(fatos, (f) => f.ppc_id);
  const cruzPor = agrupar(cruz, (c) => c.ppc_id);
  const matrizesPor = agrupar(matrizes, (m) => m.curso_id);
  return ppcs.map((p): FatosDoPpc => ({
    ppc: p.id,
    curso: p.curso_id,
    nome: p.curso_nome,
    campus: p.campus_nome,
    nivel: p.nivel,
    forma: p.tipo_oferta,
    path: p.path,
    fatos: (fatosPor.get(p.id) ?? []).map(({ ppc_id: _p, alternativas_json, ...f }) => ({
      ...f,
      alternativas: alternativas_json,
    })),
    suap: {
      situacao: p.suap_matrizes_situacao,
      carga_horaria_comum_h: p.suap_ch_comum_h,
      matrizes: (p.curso_id ? (matrizesPor.get(p.curso_id) ?? []) : []).map(
        ({ curso_id: _c, estagio_exigido, ...m }) => ({
          ...m,
          estagio_exigido: estagio_exigido === 1,
        }),
      ),
    },
    cruzamento: (cruzPor.get(p.id) ?? []).map(({ ppc_id: _p, ...c }) => c),
  }));
});

/** Totais por aspecto e resultado e os PPCs com divergência (`divergenciasPpcSuap`). */
export interface DivergenciasPpcSuap {
  totais: Record<string, Record<string, number>>;
  ppcs: FatosDoPpc[];
}

/** Só os PPCs com alguma divergência PPC × SUAP, e só as linhas divergentes do cruzamento. */
export const divergenciasPpcSuap = Effect.fn("consultasFatos.divergenciasPpcSuap")(function* (
  filtros: FiltrosFatos = {},
) {
  const todos = yield* fatosDosPpcs(filtros);
  const totais: Record<string, Record<string, number>> = {};
  for (const p of todos) {
    for (const c of p.cruzamento) {
      totais[c.aspecto] ??= {};
      totais[c.aspecto]![c.resultado] = (totais[c.aspecto]![c.resultado] ?? 0) + 1;
    }
  }
  const ordenado: Record<string, Record<string, number>> = {};
  for (const aspecto of Object.keys(totais).sort(compararTexto)) {
    ordenado[aspecto] = Object.fromEntries(Object.entries(totais[aspecto]!).sort(([a], [b]) => compararTexto(a, b)));
  }
  const ppcs = todos
    .map((p) => ({ ...p, cruzamento: p.cruzamento.filter((c) => RESULTADOS_DIVERGENTES.has(c.resultado)) }))
    .filter((p) => p.cruzamento.length > 0);
  const resultado: DivergenciasPpcSuap = { totais: ordenado, ppcs };
  return resultado;
});
