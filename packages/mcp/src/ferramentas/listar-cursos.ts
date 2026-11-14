/**
 * Ferramenta 11, `listar_cursos`: cursos do IFPR com CNCT, eixo, ofertas e turno (`Cursos.listar`, a
 * regra de `kb cursos`). Cada curso numa linha compacta, sem o detalhe das ofertas, que fica na
 * `ficha_curso`.
 */
import * as Schema from "effect/Schema";
import { EsquemaLink } from "../contratos.ts";
import { comPadrao, inteiro, opcional, texto } from "../esquema.ts";
import { comLink } from "../texto.ts";
import { filtroTexto } from "./comum-ppcs.ts";
import { definirFerramenta } from "./ferramenta.ts";

export const TETO_LISTAR_CURSOS = 8000;

export const Entrada = Schema.Struct({
  eixo: opcional(filtroTexto('eixo tecnológico do CNCT ("Informação e Comunicação")')),
  turno: opcional(filtroTexto('turno de alguma oferta ("matutino", "noturno", "integral"…)')),
  campus: opcional(filtroTexto('campus, pelo ID ("curitiba")')),
  nivel: opcional(filtroTexto('nível ("médio", "superior", "pós-graduação")')),
  forma: opcional(filtroTexto('forma de oferta ("integrado", "subsequente", "bacharelado"…)')),
  situacao: opcional(filtroTexto('situação do curso ("ativo", "suspenso"…)')),
  cnct: opcional(filtroTexto('curso do CNCT ("tecnico-em-enfermagem")')),
  processo: opcional(filtroTexto('processo seletivo de alguma oferta ("processo-seletivo-2026")')),
  limite: comPadrao(inteiro({ minimo: 1, maximo: 100 }), 50, "cursos por página (1 a 100); padrão 50"),
  cursor: opcional(texto({ minimo: 1 }, "cursor da página seguinte, devolvido pela chamada anterior")),
});

export const Curso = Schema.Struct({
  /** `curso:campus/curso`, para a `ficha_curso`. */
  id: Schema.String,
  nome: Schema.String,
  /** ID do campus (o valor do filtro `campus`). */
  campus: Schema.String,
  nivel: Schema.NullOr(Schema.String),
  forma_oferta: Schema.NullOr(Schema.String),
  modalidade: Schema.NullOr(Schema.String),
  situacao: Schema.NullOr(Schema.String),
  cnct: Schema.NullOr(Schema.Struct({ id: Schema.String, nome: Schema.String, eixo: Schema.NullOr(Schema.String) })),
  ppc: Schema.NullOr(Schema.Struct({ id: Schema.String, ano: Schema.NullOr(Schema.Int) })),
  /** Turnos das ofertas (no recorte dos filtros `turno` e `processo`). */
  turnos: Schema.Array(Schema.String),
  link: EsquemaLink,
});
export type Curso = typeof Curso.Type;

export const Dados = Schema.Struct({ cursos: Schema.Array(Curso) });

/** A linha de um curso no texto (também mede o item na paginação pelo teto). */
export function linhaCurso(c: Curso): string {
  const partes = [c.nivel, c.forma_oferta, c.modalidade, c.situacao].filter((p): p is string => Boolean(p));
  const cnct = c.cnct ? `; CNCT ${c.cnct.nome}${c.cnct.eixo ? ` (${c.cnct.eixo})` : ""}` : "";
  const ppc = c.ppc ? `; PPC ${c.ppc.ano ?? "sem ano"}` : "; sem PPC na base";
  const turnos = c.turnos.length ? `; turnos: ${c.turnos.join(", ")}` : "";
  return `- ${comLink(c.nome, c.link)} \`${c.id.replace(/^curso:/, "")}\` — ${partes.join(", ")}${cnct}${ppc}${turnos}`;
}

export const listarCursos = definirFerramenta({
  nome: "listar_cursos",
  titulo: "Listar cursos",
  descricao:
    "Cursos do IFPR na base, com CNCT, eixo, ofertas e turno. Use filtros: a lista sem filtro é longa. Para os detalhes de um curso, use `ficha_curso`.",
  entrada: Entrada,
  dados: Dados,
  texto({ dados: d, pagina }) {
    if (d.cursos.length === 0) return "";
    return [
      `${pagina?.total ?? d.cursos.length} cursos. Detalhes de um curso: \`ficha_curso\` com o ID.`,
      ...d.cursos.map(linhaCurso),
    ].join("\n");
  },
});
