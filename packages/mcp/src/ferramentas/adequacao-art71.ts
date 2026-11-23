/**
 * Ferramenta 8, `adequacao_art71`: cursos técnicos em oferta alcançados pelo art. 71 da Res. CNE/CP
 * nº 2/2026, com a DCN mais recente que cada PPC cita (`Cursos.adequacaoArt71`). Sem filtros, só os totais por indicador; com filtro, a lista paginada.
 */
import * as Schema from "effect/Schema";
import { DCN_EPT, INDICADORES, type Indicador, ROTULOS_INDICADOR } from "@simplifica-if/kb/adequacao/art71";
import { EsquemaLink } from "../contratos.ts";
import { comPadrao, inteiro, opcional, texto } from "../esquema.ts";
import { linkNorma } from "../links.ts";
import { comLink } from "../texto.ts";
import { filtroTexto } from "./comum-ppcs.ts";
import { definirFerramenta } from "./ferramenta.ts";

export const TETO_ADEQUACAO = 8000;

export const Entrada = Schema.Struct({
  campus: opcional(filtroTexto('campus, pelo ID ("curitiba")')),
  curso: opcional(
    filtroTexto('um curso ("campus/curso") ou o slug do curso em todos os campi ("tecnico-em-agropecuaria")'),
  ),
  indicador: opcional(
    Schema.Literals(INDICADORES),
    "DCN da EPT mais recente que o PPC cita, ou ausência de PPC ou de citação",
  ),
  incluir_tecnologia: comPadrao(
    Schema.Boolean,
    false,
    "inclui os cursos superiores de tecnologia (graduação tecnológica); padrão false",
  ),
  limite: comPadrao(inteiro({ minimo: 1, maximo: 100 }), 50, "cursos por página (1 a 100); padrão 50"),
  cursor: opcional(texto({ minimo: 1 }, "cursor da página seguinte, devolvido pela chamada anterior")),
});
export type Entrada = typeof Entrada.Type;

export const Curso = Schema.Struct({
  curso: Schema.String,
  nome: Schema.String,
  /** ID do campus (o valor do filtro `campus`). */
  campus: Schema.String,
  forma_oferta: Schema.NullOr(Schema.String),
  ppc_ano: Schema.NullOr(Schema.Int),
  indicador: Schema.String,
  /** DCN citadas no PPC, com as linhas e as regras do resolvedor. */
  dcn_citadas: Schema.Array(
    Schema.Struct({ id: Schema.String, linhas: Schema.Array(Schema.Int), regras: Schema.Array(Schema.String) }),
  ),
  link: EsquemaLink,
});
export type Curso = typeof Curso.Type;

export const Dados = Schema.Struct({
  criterio: Schema.String,
  /** Cursos por indicador, no recorte dos filtros (sem filtros, todos os alcançados). */
  totais: Schema.Record(Schema.String, inteiro({ minimo: 0 })),
  /** Vazia sem filtros: use `campus`, `curso` ou `indicador` para ver a lista. */
  cursos: Schema.Array(Curso),
});

const DCN_POR_ID = new Map<string, string>(DCN_EPT.map((d) => [d.id, d.rotulo.replace(/^cita (só )?a /, "")]));

/** A linha de um curso no texto (também mede o item na paginação pelo teto). */
export function linhaCurso(c: Curso): string {
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
  entrada: Entrada,
  dados: Dados,
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
