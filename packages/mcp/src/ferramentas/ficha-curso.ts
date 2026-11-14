/**
 * Ferramenta 12, `ficha_curso`: tudo sobre um curso, composto das consultas do kb que as outras
 * ferramentas usam. Dados do curso, CNCT e ofertas vêm de `listarCursos` (`listar_cursos`); os fatos,
 * de `fatosDosPpcs` (`fatos_ppc`); as normas citadas, de `normasCitadasDoPpcBanco`, cujas contagens
 * são as de `citacoes_da_norma` para o PPC; a adequação, da própria `adequacao_art71`; as transições,
 * das normas citadas. É também o conteúdo do link `ifpr://curso/…` no app.
 */
import {
  fatosDosPpcs,
  indiceSecoesDoPpc,
  listarCursos,
  normasCitadasDoPpcBanco,
  ROTULOS_INDICADOR,
  type Indicador,
  vigenciaBanco,
} from "@simplifica-if/kb/db/modo-banco";
import { z } from "zod";
import { type Aviso, ErroEntrada, esquemaLink, responder } from "../envelope.ts";
import { linkCampus, linkCnct, linkCurso, linkNorma, linkPpc } from "../links.ts";
import { linhasNoOrcamento } from "../orcamento.ts";
import { comLink } from "../texto.ts";
import { adequacaoArt71 } from "./adequacao-art71.ts";
import {
  AVISO_FATO_EXTRAIDO,
  avisoBaixaConfianca,
  chaveCurso,
  esquemaFatosPpc,
  esquemaTransicaoResumo,
  linhaTransicao,
  paraFatosPpc,
  textoFatosPpc,
  type TransicaoResumo,
  transicaoResumo,
} from "./comum-ppcs.ts";
import { normaResumo } from "./tipos-comuns.ts";
import { definirFerramenta } from "./ferramenta.ts";

export const TETO_FICHA_CURSO = 12000;

const entrada = z.strictObject({
  curso: z
    .string()
    .trim()
    .min(3)
    .max(300)
    .describe(
      'o curso: "campus/curso" ou "curso:campus/curso" ("curitiba/tecnico-em-enfermagem"), vindo de listar_cursos',
    ),
});

const dados = z.strictObject({
  curso: z.strictObject({
    id: z.string(),
    nome: z.string(),
    nivel: z.string().nullable(),
    forma_oferta: z.string().nullable(),
    modalidade: z.string().nullable(),
    situacao: z.string().nullable(),
    link: esquemaLink,
  }),
  campus: z.strictObject({ id: z.string(), nome: z.string(), link: esquemaLink }),
  cnct: z
    .strictObject({
      id: z.string(),
      nome: z.string(),
      eixo: z.string().nullable(),
      carga_horaria_minima: z.number().nullable(),
      link: esquemaLink,
    })
    .nullable(),
  ppc: z
    .strictObject({
      id: z.string(),
      ano: z.number().int().nullable(),
      link: esquemaLink,
      /** Seções do PPC na ordem do documento; o ID vai para `ler_secao`. */
      secoes: z.array(z.strictObject({ id: z.string(), tipo: z.string(), titulo: z.string() })),
    })
    .nullable(),
  ofertas: z.array(
    z.strictObject({ processo: z.string(), turno: z.string().nullable(), vagas: z.number().nullable() }),
  ),
  fatos: esquemaFatosPpc.nullable(),
  normas_citadas: z.array(
    z.strictObject({
      id: z.string(),
      titulo: z.string(),
      status_vigencia: z.string().nullable(),
      ocorrencias: z.number().int().min(1),
      link: esquemaLink,
    }),
  ),
  /** `null` quando o curso não é alcançado pelo art. 71 (não é técnico em oferta). */
  adequacao_art71: z.strictObject({ indicador: z.string() }).nullable(),
  /** Regras de transição das normas que o PPC cita (ou que preservam efeitos delas). */
  transicoes_aplicaveis: z.array(esquemaTransicaoResumo),
});

export const fichaCurso = definirFerramenta({
  nome: "ficha_curso",
  titulo: "Ficha do curso",
  descricao:
    "Tudo sobre um curso do IFPR: dados institucionais, PPC vigente, CNCT, ofertas, fatos do PPC cruzados com o SUAP (divergências), normas que o PPC cita e prazos de adequação. Use quando a pergunta for sobre um curso específico.",
  entrada,
  dados,
  executar(e, ctx) {
    const { db, base } = ctx;
    const chave = chaveCurso(e.curso);
    const id = `curso:${chave}`;
    const curso = listarCursos(db, { campus: chave.split("/")[0] }).find((c) => c.id === id);
    if (!curso) {
      throw new ErroEntrada(`curso não encontrado na base: "${e.curso}". Use o ID de listar_cursos ("campus/curso")`);
    }
    const ppcId = curso.ppc?.id ?? null;
    const citadas = ppcId ? (normasCitadasDoPpcBanco(db, ppcId) ?? []) : [];
    const fatos = ppcId ? (fatosDosPpcs(db, { ppc: ppcId })[0] ?? null) : null;
    const adequacao = adequacaoArt71.executar(adequacaoArt71.entrada.parse({ curso: chave }), ctx).dados.cursos[0];
    const transicoes = new Map<string, TransicaoResumo>();
    for (const n of citadas) {
      for (const t of vigenciaBanco(db, n.id).transicoes) {
        if (!transicoes.has(t.id)) transicoes.set(t.id, transicaoResumo(t));
      }
    }
    const avisos: Aviso[] = [];
    if (fatos) avisos.push(AVISO_FATO_EXTRAIDO);
    avisos.push(...avisoBaixaConfianca(citadas.flatMap((n) => n.regras)));
    return responder(
      base,
      {
        curso: {
          id: curso.id,
          nome: curso.nome,
          nivel: curso.nivel,
          forma_oferta: curso.forma_oferta,
          modalidade: curso.modalidade,
          situacao: curso.situacao,
          link: linkCurso(curso.id),
        },
        campus: { id: curso.campus.id, nome: curso.campus.nome ?? curso.campus.id, link: linkCampus(curso.campus.id) },
        cnct: curso.cnct
          ? {
              id: curso.cnct.id,
              nome: curso.cnct.denominacao ?? curso.cnct.id,
              eixo: curso.cnct.eixo_tecnologico,
              carga_horaria_minima: curso.cnct.carga_horaria_minima_h,
              link: linkCnct(curso.cnct.id),
            }
          : null,
        ppc:
          curso.ppc && ppcId
            ? {
                id: ppcId,
                ano: curso.ppc.ano_documento,
                link: linkPpc(ppcId),
                secoes: indiceSecoesDoPpc(db, ppcId).map((s) => ({ id: s.id, tipo: s.tipo, titulo: s.titulo })),
              }
            : null,
        ofertas: curso.ofertas.flatMap((o) =>
          (o.processos.length ? o.processos : ["sem processo informado"]).map((processo) => ({
            processo,
            turno: o.turno,
            vagas: o.vagas,
          })),
        ),
        fatos: fatos ? paraFatosPpc(fatos) : null,
        normas_citadas: citadas.map((n) => {
          const norma = normaResumo(db, n.id);
          return {
            id: n.id,
            titulo: norma?.titulo ?? n.id,
            status_vigencia: norma?.status_vigencia ?? null,
            ocorrencias: n.ocorrencias,
            link: linkNorma(n.id),
          };
        }),
        adequacao_art71: adequacao ? { indicador: adequacao.indicador } : null,
        transicoes_aplicaveis: [...transicoes.values()],
      },
      { avisos },
    );
  },
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
