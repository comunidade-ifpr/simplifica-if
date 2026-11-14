/**
 * Ferramenta 11, `listar_cursos`: cursos do IFPR com CNCT, eixo, ofertas e turno (`Cursos.listar`, a
 * regra de `kb cursos`). Cada curso numa linha compacta, sem o detalhe das ofertas, que fica na
 * `ficha_curso`.
 */
import * as Cursos from "@simplifica-if/kb/Cursos";
import { z } from "zod";
import { type Aviso, esquemaLink, responder } from "../envelope.ts";
import { linkCurso } from "../links.ts";
import { paginarNoTeto, RESERVA_TEXTO } from "../orcamento.ts";
import { comLink } from "../texto.ts";
import { filtroTexto } from "./comum-ppcs.ts";
import { definirFerramenta } from "./ferramenta.ts";

export const TETO_LISTAR_CURSOS = 8000;

const entrada = z.strictObject({
  eixo: filtroTexto('eixo tecnológico do CNCT ("Informação e Comunicação")').optional(),
  turno: filtroTexto('turno de alguma oferta ("matutino", "noturno", "integral"…)').optional(),
  campus: filtroTexto('campus, pelo ID ("curitiba")').optional(),
  nivel: filtroTexto('nível ("médio", "superior", "pós-graduação")').optional(),
  forma: filtroTexto('forma de oferta ("integrado", "subsequente", "bacharelado"…)').optional(),
  situacao: filtroTexto('situação do curso ("ativo", "suspenso"…)').optional(),
  cnct: filtroTexto('curso do CNCT ("tecnico-em-enfermagem")').optional(),
  processo: filtroTexto('processo seletivo de alguma oferta ("processo-seletivo-2026")').optional(),
  limite: z.number().int().min(1).max(100).default(50).describe("cursos por página (1 a 100); padrão 50"),
  cursor: z.string().min(1).optional().describe("cursor da página seguinte, devolvido pela chamada anterior"),
});

const dados = z.strictObject({
  cursos: z.array(
    z.strictObject({
      /** `curso:campus/curso`, para a `ficha_curso`. */
      id: z.string(),
      nome: z.string(),
      /** ID do campus (o valor do filtro `campus`). */
      campus: z.string(),
      nivel: z.string().nullable(),
      forma_oferta: z.string().nullable(),
      modalidade: z.string().nullable(),
      situacao: z.string().nullable(),
      cnct: z.strictObject({ id: z.string(), nome: z.string(), eixo: z.string().nullable() }).nullable(),
      ppc: z.strictObject({ id: z.string(), ano: z.number().int().nullable() }).nullable(),
      /** Turnos das ofertas (no recorte dos filtros `turno` e `processo`). */
      turnos: z.array(z.string()),
      link: esquemaLink,
    }),
  ),
});
type Curso = z.infer<typeof dados>["cursos"][number];

function linhaCurso(c: Curso): string {
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
  entrada,
  dados,
  executar(e, { kb, base }) {
    const filtros = {
      eixo: e.eixo,
      turno: e.turno,
      campus: e.campus,
      nivel: e.nivel,
      forma: e.forma,
      situacao: e.situacao,
      cnct: e.cnct?.replace(/^cnct:/, ""),
      processo: e.processo,
    };
    const cursos: Curso[] = kb(Cursos.Cursos.use((c) => c.listar(filtros))).map((c) => ({
      id: c.id,
      nome: c.nome,
      campus: c.campus.id,
      nivel: c.nivel,
      forma_oferta: c.forma_oferta,
      modalidade: c.modalidade,
      situacao: c.situacao,
      cnct: c.cnct ? { id: c.cnct.id, nome: c.cnct.denominacao ?? c.cnct.id, eixo: c.cnct.eixo_tecnologico } : null,
      ppc: c.ppc ? { id: c.ppc.id, ano: c.ppc.ano_documento } : null,
      turnos: [...new Set(c.ofertas.map((o) => o.turno).filter((t): t is string => t !== null))],
      link: linkCurso(c.id),
    }));
    const { itens, pagina } = paginarNoTeto(cursos, {
      limite: e.limite,
      cursor: e.cursor,
      consulta: { ferramenta: "listar_cursos", base: base.versao, ...filtros },
      orcamento: TETO_LISTAR_CURSOS - RESERVA_TEXTO,
      medir: (c) => linhaCurso(c).length + 1,
    });
    const avisos: Aviso[] = [];
    if (cursos.length === 0) avisos.push({ tipo: "nao-encontrado", mensagem: "nenhum curso com esses filtros" });
    return responder(base, { cursos: itens }, { avisos, pagina });
  },
  texto({ dados: d, pagina }) {
    if (d.cursos.length === 0) return "";
    return [
      `${pagina?.total ?? d.cursos.length} cursos. Detalhes de um curso: \`ficha_curso\` com o ID.`,
      ...d.cursos.map(linhaCurso),
    ].join("\n");
  },
});
