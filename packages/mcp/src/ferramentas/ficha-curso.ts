/**
 * Ferramenta 12, `ficha_curso`: tudo sobre um curso, composto das consultas do kb que as outras
 * ferramentas usam. Dados do curso, CNCT e ofertas vêm de `Cursos.listar` (`listar_cursos`); os fatos,
 * de `Ppcs.fatos` (`fatos_ppc`); as normas citadas, de `Ppcs.normasCitadas`, cujas contagens
 * são as de `citacoes_da_norma` para o PPC; a adequação, da própria `adequacao_art71`; as transições,
 * das normas citadas. É também o conteúdo do link `ifpr://curso/…` no app.
 */
import * as Schema from "effect/Schema";
import { type Indicador, ROTULOS_INDICADOR } from "@simplifica-if/kb/adequacao/art71";
import { EsquemaLink, FatosPpc, TransicaoResumo } from "../contratos.ts";
import { inteiro, textoAparado } from "../esquema.ts";
import { linkNorma } from "../links.ts";
import { linhasNoOrcamento } from "../orcamento.ts";
import { comLink } from "../texto.ts";
import { linhaTransicao, textoFatosPpc } from "./comum-ppcs.ts";
import { definirFerramenta } from "./ferramenta.ts";

export const TETO_FICHA_CURSO = 12000;

export const Entrada = Schema.Struct({
  curso: textoAparado(
    { minimo: 3, maximo: 300 },
    'o curso: "campus/curso" ou "curso:campus/curso" ("curitiba/tecnico-em-enfermagem"), vindo de listar_cursos',
  ),
});

export const Dados = Schema.Struct({
  curso: Schema.Struct({
    id: Schema.String,
    nome: Schema.String,
    nivel: Schema.NullOr(Schema.String),
    forma_oferta: Schema.NullOr(Schema.String),
    modalidade: Schema.NullOr(Schema.String),
    situacao: Schema.NullOr(Schema.String),
    link: EsquemaLink,
  }),
  campus: Schema.Struct({ id: Schema.String, nome: Schema.String, link: EsquemaLink }),
  cnct: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      nome: Schema.String,
      eixo: Schema.NullOr(Schema.String),
      carga_horaria_minima: Schema.NullOr(Schema.Finite),
      link: EsquemaLink,
    }),
  ),
  ppc: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      ano: Schema.NullOr(Schema.Int),
      link: EsquemaLink,
      /** Seções do PPC na ordem do documento; o ID vai para `ler_secao`. */
      secoes: Schema.Array(Schema.Struct({ id: Schema.String, tipo: Schema.String, titulo: Schema.String })),
    }),
  ),
  ofertas: Schema.Array(
    Schema.Struct({
      processo: Schema.String,
      turno: Schema.NullOr(Schema.String),
      vagas: Schema.NullOr(Schema.Finite),
    }),
  ),
  fatos: Schema.NullOr(FatosPpc),
  normas_citadas: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      titulo: Schema.String,
      status_vigencia: Schema.NullOr(Schema.String),
      ocorrencias: inteiro({ minimo: 1 }),
      link: EsquemaLink,
    }),
  ),
  /** `null` quando o curso não é alcançado pelo art. 71 (não é técnico em oferta). */
  adequacao_art71: Schema.NullOr(Schema.Struct({ indicador: Schema.String })),
  /** Regras de transição das normas que o PPC cita (ou que preservam efeitos delas). */
  transicoes_aplicaveis: Schema.Array(TransicaoResumo),
});

export const fichaCurso = definirFerramenta({
  nome: "ficha_curso",
  titulo: "Ficha do curso",
  descricao:
    "Tudo sobre um curso do IFPR: dados institucionais, PPC vigente, CNCT, ofertas, fatos do PPC cruzados com o SUAP (divergências), normas que o PPC cita e prazos de adequação. Use quando a pergunta for sobre um curso específico.",
  entrada: Entrada,
  dados: Dados,
  texto({ dados: d }) {
    const c = d.curso;
    const partes = [
      `## ${comLink(c.nome, c.link)} — ${comLink(d.campus.nome, d.campus.link)}`,
      [c.nivel, c.forma_oferta, c.modalidade, c.situacao].filter(Boolean).join(", "),
    ];
    partes.push(
      d.cnct
        ? `CNCT: ${comLink(d.cnct.nome, d.cnct.link)}${d.cnct.eixo ? `, eixo ${d.cnct.eixo}` : ""}${d.cnct.carga_horaria_minima ? `, carga horária mínima ${d.cnct.carga_horaria_minima} h` : ""}.`
        : "CNCT: sem habilitação do CNCT registrada.",
    );
    partes.push(
      d.ofertas.length
        ? [
            "Ofertas:",
            ...d.ofertas.map((o) => `- ${o.processo}: ${o.turno ?? "turno não informado"}, ${o.vagas ?? "?"} vagas`),
          ].join("\n")
        : "Ofertas: nenhuma registrada.",
    );
    if (d.adequacao_art71) {
      partes.push(
        `Adequação ao ${comLink("art. 71 da Res. CNE/CP nº 2/2026", linkNorma("br/cne-cp/res/2026/2", "art71"))} (prazo de adequação): **${ROTULOS_INDICADOR[d.adequacao_art71.indicador as Indicador] ?? d.adequacao_art71.indicador}**.`,
      );
    }
    if (d.transicoes_aplicaveis.length) {
      partes.push(
        [
          "Regras de transição das normas citadas:",
          ...linhasNoOrcamento(d.transicoes_aplicaveis.map(linhaTransicao), 1500, "regras"),
        ].join("\n"),
      );
    }
    if (d.ppc) {
      partes.push(`PPC: ${comLink(d.ppc.id, d.ppc.link)} (${d.ppc.ano ?? "ano não informado"}).`);
      if (d.fatos) partes.push(textoFatosPpc(d.fatos, { cabecalho: false }));
      partes.push(
        d.normas_citadas.length
          ? [
              "Normas que o PPC cita (ocorrências; detalhes em `citacoes_da_norma` com `ppc`):",
              ...linhasNoOrcamento(
                d.normas_citadas.map(
                  (n) =>
                    `- ${comLink(n.titulo, n.link)}${n.titulo === n.id ? "" : ` \`${n.id}\``} (${n.status_vigencia ?? "sem status"}): ${n.ocorrencias}`,
                ),
                2500,
                "normas (lista completa no JSON)",
              ),
            ].join("\n")
          : "Normas que o PPC cita: nenhuma citação identificada.",
      );
      partes.push(
        [
          `Seções do PPC (para \`ler_secao\`, o ID é \`${d.ppc.id.replace(/^ppc:/, "")}#<seção>\`):`,
          ...linhasNoOrcamento(
            d.ppc.secoes.map((s) => `- \`#${s.id.split("#")[1]}\` ${s.titulo} [${s.tipo}]`),
            3000,
            "seções (lista completa no JSON; ou use `buscar_secoes` com `ppc`)",
          ),
        ].join("\n"),
      );
    } else {
      partes.push("PPC: sem PPC convertido na base.");
    }
    return partes.join("\n\n");
  },
});
