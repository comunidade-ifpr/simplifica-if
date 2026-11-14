/**
 * Ferramenta 9, `buscar_secoes`: busca nas seções dos PPCs (`buscarSecoesBanco`, a regra de
 * `kb buscar-secoes`, com o léxico de sinônimos do banco). Devolve as linhas literais mais próximas da
 * consulta; com `integral`, o texto inteiro de até 5 seções.
 */
import { buscarSecoesBanco } from "@simplifica-if/kb/db/modo-banco";
import { z } from "zod";
import { type Aviso, ErroEntrada, esquemaFonte, esquemaLink, responder } from "../envelope.ts";
import { linkPpc } from "../links.ts";
import { cortar, RESERVA_TEXTO } from "../orcamento.ts";
import { blocoItem } from "../texto.ts";
import { chavePpc, filtroTexto } from "./comum-ppcs.ts";
import { definirFerramenta } from "./ferramenta.ts";

/** Teto do texto sem `integral` e com `integral`, em caracteres. */
export const TETO_BUSCAR_SECOES = 8000;
export const TETO_BUSCAR_SECOES_INTEGRAL = 30000;
/** Máximo de seções com `integral`. */
export const MAX_INTEGRAL = 5;
const MAX_LINHA_TRECHO = 400;

const entrada = z.strictObject({
  consulta: z.string().trim().min(1).max(300).describe('termos da busca ("acompanhamento de egressos")'),
  tipo: z
    .array(z.string().trim().min(1).max(100))
    .min(1)
    .max(10)
    .optional()
    .describe('tipos de seção ("estagio_praticas", "avaliacao"); a lista está em sobre_a_base'),
  nivel: filtroTexto('nível do PPC ("médio", "superior", "pós-graduação")').optional(),
  campus: filtroTexto('campus, pelo ID ("curitiba")').optional(),
  cnct: filtroTexto('curso do CNCT ("tecnico-em-enfermagem")').optional(),
  forma: filtroTexto('forma de oferta ("integrado", "subsequente", "bacharelado"…)').optional(),
  ppc: filtroTexto('um PPC ("campus/curso")').optional(),
  limite: z.number().int().min(1).max(20).default(8).describe("seções (1 a 20); padrão 8; com integral, até 5"),
  integral: z.boolean().default(false).describe("texto inteiro de cada seção; no máximo 5 seções"),
});

const dados = z.strictObject({
  resultados: z.array(
    z.strictObject({
      /** ID da seção, para `ler_secao`. */
      id: z.string(),
      ppc: z.string(),
      curso: z.string(),
      campus: z.string(),
      nivel: z.string(),
      forma: z.string(),
      cnct_id: z.string().nullable(),
      tipo: z.string(),
      titulo: z.string(),
      /** Linhas literais com mais termos da consulta, com o número da linha no arquivo. */
      trecho: z.array(z.strictObject({ linha: z.number().int(), texto: z.string() })),
      texto: z.string().optional(),
      fonte: esquemaFonte,
      link: esquemaLink,
      /** BM25: quanto menor, melhor. */
      pontuacao: z.number(),
    }),
  ),
});
type Resultado = z.infer<typeof dados>["resultados"][number];

const linhasTipo = z.array(z.object({ tipo: z.string() }));

function bloco(r: Resultado, maxTexto: number): string {
  const cabecalho = blocoItem({
    titulo: `${r.titulo} — ${r.curso} (${r.campus})`,
    link: r.link,
    detalhe: `\`${r.tipo}\`, ${r.nivel}, ${r.forma}; ID \`${r.id}\``,
  });
  const corpo =
    r.texto !== undefined
      ? blocoItem({
          titulo: "texto da seção",
          literal:
            r.texto.length > maxTexto
              ? `${cortar(r.texto, maxTexto)}\n[seção cortada aqui; leia o resto com ler_secao]`
              : r.texto,
          fonte: r.fonte,
        })
      : [
          ...r.trecho.map((l) =>
            blocoItem({
              titulo: `linha ${l.linha}`,
              literal: cortar(l.texto, MAX_LINHA_TRECHO),
            }),
          ),
          `fonte: \`${r.fonte.path}:${r.fonte.linha_inicio}-${r.fonte.linha_fim}\``,
        ].join("\n");
  return `${cabecalho}\n${corpo}`;
}

export const buscarSecoes = definirFerramenta({
  nome: "buscar_secoes",
  titulo: "Buscar em PPCs",
  descricao:
    "Busca trechos dos PPCs da base (todos os campi e níveis), com radicais e sinônimos por tipo de seção. Use para ver como outros cursos escreveram uma seção (estágio, egressos, avaliação…). PPCs são exemplos institucionais, não norma.",
  entrada,
  dados,
  executar(e, { db, base }) {
    if (e.tipo) {
      const conhecidos = new Set(
        linhasTipo.parse(db.query("SELECT DISTINCT tipo FROM secoes ORDER BY tipo").all()).map((t) => t.tipo),
      );
      const desconhecidos = e.tipo.filter((t) => !conhecidos.has(t));
      if (desconhecidos.length) {
        throw new ErroEntrada(
          `tipo de seção desconhecido: ${desconhecidos.join(", ")}. Tipos válidos: ${[...conhecidos].join(", ")}`,
        );
      }
    }
    const avisos: Aviso[] = [];
    let limite = e.limite;
    if (e.integral && limite > MAX_INTEGRAL) {
      limite = MAX_INTEGRAL;
      avisos.push({
        tipo: "resultado-resumido",
        mensagem: `com integral, a busca devolve no máximo ${MAX_INTEGRAL} seções; peça sem integral para ver mais resultados`,
      });
    }
    const filtros = {
      tipo: e.tipo,
      nivel: e.nivel,
      campus: e.campus,
      cnct: e.cnct?.replace(/^cnct:/, ""),
      forma: e.forma,
      ppc: e.ppc === undefined ? undefined : chavePpc(e.ppc),
    };
    const achados = buscarSecoesBanco(db, e.consulta, filtros, { limite, integral: e.integral });
    if (achados.length === 0) {
      avisos.push({
        tipo: "nao-encontrado",
        mensagem: `nenhuma seção de PPC encontrada para "${e.consulta}"${Object.values(filtros).some((v) => v !== undefined) ? " com esses filtros" : ""}`,
      });
    }
    return responder(
      base,
      {
        resultados: achados.map((r) => ({
          id: r.id,
          ppc: r.ppc,
          curso: r.curso,
          campus: r.campus,
          nivel: r.nivel,
          forma: r.forma,
          cnct_id: r.cnct_id,
          tipo: r.tipo,
          titulo: r.titulo,
          trecho: r.trecho,
          ...(r.texto !== undefined ? { texto: r.texto } : {}),
          fonte: { path: r.path, linha_inicio: r.linha_inicio, linha_fim: r.linha_fim },
          link: linkPpc(r.id),
          pontuacao: r.pontuacao,
        })),
      },
      { avisos },
    );
  },
  texto({ dados: d }) {
    if (d.resultados.length === 0) return "";
    const integral = d.resultados.some((r) => r.texto !== undefined);
    const teto = (integral ? TETO_BUSCAR_SECOES_INTEGRAL : TETO_BUSCAR_SECOES) - RESERVA_TEXTO;
    // Cada seção recebe uma parte igual do teto; sem integral, os trechos já são curtos.
    const porSecao = Math.floor(teto / d.resultados.length);
    const blocos = d.resultados.map((r) => {
      // a citação Markdown acrescenta "> " a cada linha: o texto cortado fica abaixo de 85% da parte
      const b = bloco(r, Math.max(500, Math.floor((porSecao - 800) * 0.85)));
      return b.length > porSecao ? `${cortar(b, porSecao - 60)}\n[cortado; use ler_secao com o ID]` : b;
    });
    return [
      `${d.resultados.length} seções de PPC (exemplos institucionais, não norma). Para ler uma seção inteira, use \`ler_secao\` com o ID.`,
      ...blocos,
    ].join("\n\n");
  },
});
