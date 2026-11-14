/**
 * Ferramenta 8, `adequacao_art71`: cursos técnicos em oferta alcançados pelo art. 71 da Res. CNE/CP
 * nº 2/2026, com a DCN mais recente que cada PPC cita (`adequacaoArt71Banco`, a regra de
 * `kb adequacao-art71`). Sem filtros, só os totais por indicador; com filtro, a lista paginada.
 */
import {
  adequacaoArt71Banco,
  DCN_EPT,
  INDICADORES,
  type Indicador,
  ROTULOS_INDICADOR,
} from "@simplifica-if/kb/db/modo-banco";
import { z } from "zod";
import { type Aviso, esquemaLink, responder } from "../envelope.ts";
import { linkCurso, linkNorma } from "../links.ts";
import { paginarNoTeto, RESERVA_TEXTO } from "../orcamento.ts";
import { comLink } from "../texto.ts";
import { avisoBaixaConfianca, chaveCurso, filtroTexto } from "./comum-ppcs.ts";
import { definirFerramenta } from "./ferramenta.ts";

export const TETO_ADEQUACAO = 8000;

const entrada = z.strictObject({
  campus: filtroTexto('campus, pelo ID ("curitiba")').optional(),
  curso: filtroTexto(
    'um curso ("campus/curso") ou o slug do curso em todos os campi ("tecnico-em-agropecuaria")',
  ).optional(),
  indicador: z
    .enum(INDICADORES)
    .optional()
    .describe("DCN da EPT mais recente que o PPC cita, ou ausência de PPC ou de citação"),
  incluir_tecnologia: z
    .boolean()
    .default(false)
    .describe("inclui os cursos superiores de tecnologia (graduação tecnológica); padrão false"),
  limite: z.number().int().min(1).max(100).default(50).describe("cursos por página (1 a 100); padrão 50"),
  cursor: z.string().min(1).optional().describe("cursor da página seguinte, devolvido pela chamada anterior"),
});

const dados = z.strictObject({
  criterio: z.string(),
  /** Cursos por indicador, no recorte dos filtros (sem filtros, todos os alcançados). */
  totais: z.record(z.string(), z.number().int().min(0)),
  /** Vazia sem filtros: use `campus`, `curso` ou `indicador` para ver a lista. */
  cursos: z.array(
    z.strictObject({
      curso: z.string(),
      nome: z.string(),
      /** ID do campus (o valor do filtro `campus`). */
      campus: z.string(),
      forma_oferta: z.string().nullable(),
      ppc_ano: z.number().int().nullable(),
      indicador: z.string(),
      /** DCN citadas no PPC, com as linhas e as regras do resolvedor. */
      dcn_citadas: z.array(
        z.strictObject({ id: z.string(), linhas: z.array(z.number().int()), regras: z.array(z.string()) }),
      ),
      link: esquemaLink,
    }),
  ),
});
type Curso = z.infer<typeof dados>["cursos"][number];

const DCN_POR_ID = new Map<string, string>(DCN_EPT.map((d) => [d.id, d.rotulo.replace(/^cita (só )?a /, "")]));

function linhaCurso(c: Curso): string {
  const dcn = c.dcn_citadas.map(
    (d) => `${comLink(DCN_POR_ID.get(d.id) ?? d.id, linkNorma(d.id))} (linhas ${d.linhas.join(", ")})`,
  );
  return `- ${comLink(c.nome, c.link)} \`${c.curso}\`, ${c.forma_oferta ?? "forma não informada"}, PPC ${c.ppc_ano ?? "sem ano"}: **${ROTULOS_INDICADOR[c.indicador as Indicador] ?? c.indicador}**${dcn.length ? ` — ${dcn.join("; ")}` : ""}`;
}

export const adequacaoArt71 = definirFerramenta({
  nome: "adequacao_art71",
  titulo: "Adequação ao art. 71",
  descricao:
    "Cursos técnicos em oferta alcançados pelo art. 71 da Res. CNE/CP nº 2/2026, que dá prazo de adequação, com a DCN que cada PPC cita. Use quando perguntarem quais PPCs ainda precisam ser atualizados para a nova DCN da EPT. Sem filtros, devolve os totais por indicador; filtre por campus, curso ou indicador para ver a lista.",
  entrada,
  dados,
  executar(e, { db, base }) {
    const relatorio = adequacaoArt71Banco(db, { incluirTecnologia: e.incluir_tecnologia });
    const curso =
      e.curso === undefined
        ? undefined
        : e.curso.includes("/") || e.curso.includes(":")
          ? chaveCurso(e.curso)
          : e.curso;
    const filtrado = e.campus !== undefined || curso !== undefined || e.indicador !== undefined;
    const cursos: Curso[] = relatorio.cursos
      .map((c) => {
        const [campus, slug] = c.curso.replace(/^curso:/, "").split("/") as [string, string];
        return { c, campus, slug };
      })
      .filter(
        ({ c, campus, slug }) =>
          (e.campus === undefined || campus === e.campus) &&
          (curso === undefined || (curso.includes("/") ? `${campus}/${slug}` === curso : slug === curso)) &&
          (e.indicador === undefined || c.indicador === e.indicador),
      )
      .map(({ c, campus }) => ({
        curso: c.curso,
        nome: c.nome,
        campus,
        forma_oferta: c.forma_oferta,
        ppc_ano: c.ppc_ano,
        indicador: c.indicador,
        dcn_citadas: c.dcn_citadas.map((d) => ({ id: d.id, linhas: d.linhas, regras: d.regras })),
        link: linkCurso(c.curso),
      }));
    const totais = Object.fromEntries(INDICADORES.map((i) => [i, 0])) as Record<string, number>;
    for (const c of cursos) totais[c.indicador] = (totais[c.indicador] ?? 0) + 1;
    const avisos: Aviso[] = [];
    if (!filtrado) {
      return responder(base, { criterio: relatorio.criterio, totais, cursos: [] }, { avisos });
    }
    const consulta = {
      ferramenta: "adequacao_art71",
      base: base.versao,
      campus: e.campus,
      curso,
      indicador: e.indicador,
      incluir_tecnologia: e.incluir_tecnologia,
    };
    const { itens, pagina } = paginarNoTeto(cursos, {
      limite: e.limite,
      cursor: e.cursor,
      consulta,
      orcamento: TETO_ADEQUACAO - RESERVA_TEXTO - 1200,
      medir: (c) => linhaCurso(c).length + 1,
    });
    avisos.push(...avisoBaixaConfianca(itens.flatMap((c) => c.dcn_citadas.flatMap((d) => d.regras))));
    if (cursos.length === 0) {
      avisos.push({ tipo: "nao-encontrado", mensagem: "nenhum curso alcançado pelo art. 71 com esses filtros" });
    }
    return responder(base, { criterio: relatorio.criterio, totais, cursos: itens }, { avisos, pagina });
  },
  texto({ dados: d }) {
    const total = Object.values(d.totais).reduce((a, b) => a + b, 0);
    const totais = Object.entries(d.totais)
      .filter(([, n]) => n > 0)
      .map(([i, n]) => `- ${ROTULOS_INDICADOR[i as Indicador] ?? i} (\`${i}\`): ${n}`);
    const partes = [
      `Adequação ao ${comLink("art. 71 da Res. CNE/CP nº 2/2026", linkNorma("br/cne-cp/res/2026/2", "art71"))}: ${total} cursos alcançados${d.cursos.length ? " no recorte" : ""}.`,
      `Critério: ${d.criterio}`,
      ["Por indicador:", ...totais].join("\n"),
    ];
    if (d.cursos.length) partes.push(d.cursos.map(linhaCurso).join("\n"));
    else if (total > 0) partes.push("Para ver a lista, filtre por `campus`, `curso` ou `indicador`.");
    return partes.join("\n\n");
  },
});
