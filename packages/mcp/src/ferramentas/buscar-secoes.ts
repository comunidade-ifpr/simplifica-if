/**
 * Ferramenta 9, `buscar_secoes`: busca nas seções dos PPCs (`Ppcs.buscarSecoes`, a regra de
 * `kb buscar-secoes`, com o léxico de sinônimos do banco). Devolve as linhas literais mais próximas da
 * consulta; com `integral`, o texto inteiro de até 5 seções.
 */
import * as Schema from "effect/Schema";
import { EsquemaLink, Fonte } from "../contratos.ts";
import { comPadrao, inteiro, opcional, textoAparado } from "../esquema.ts";
import { cortar, RESERVA_TEXTO } from "../orcamento.ts";
import { blocoItem } from "../texto.ts";
import { filtroTexto } from "./comum-ppcs.ts";
import { definirFerramenta } from "./ferramenta.ts";

/** Teto do texto sem `integral` e com `integral`, em caracteres. */
export const TETO_BUSCAR_SECOES = 8000;
export const TETO_BUSCAR_SECOES_INTEGRAL = 30000;
/** Máximo de seções com `integral`. */
export const MAX_INTEGRAL = 5;
const MAX_LINHA_TRECHO = 400;

export const Entrada = Schema.Struct({
  consulta: textoAparado({ minimo: 1, maximo: 300 }, 'termos da busca ("acompanhamento de egressos")'),
  tipo: opcional(
    Schema.Array(textoAparado({ minimo: 1, maximo: 100 }))
      .check(Schema.isMinLength(1), Schema.isMaxLength(10))
      .annotate({ description: 'tipos de seção ("estagio_praticas", "avaliacao"); a lista está em sobre_a_base' }),
  ),
  nivel: opcional(filtroTexto('nível do PPC ("médio", "superior", "pós-graduação")')),
  campus: opcional(filtroTexto('campus, pelo ID ("curitiba")')),
  cnct: opcional(filtroTexto('curso do CNCT ("tecnico-em-enfermagem")')),
  forma: opcional(filtroTexto('forma de oferta ("integrado", "subsequente", "bacharelado"…)')),
  ppc: opcional(filtroTexto('um PPC ("campus/curso")')),
  limite: comPadrao(inteiro({ minimo: 1, maximo: 20 }), 8, "seções (1 a 20); padrão 8; com integral, até 5"),
  integral: comPadrao(Schema.Boolean, false, "texto inteiro de cada seção; no máximo 5 seções"),
});

export const Resultado = Schema.Struct({
  /** ID da seção, para `ler_secao`. */
  id: Schema.String,
  ppc: Schema.String,
  curso: Schema.String,
  campus: Schema.String,
  nivel: Schema.String,
  forma: Schema.String,
  cnct_id: Schema.NullOr(Schema.String),
  tipo: Schema.String,
  titulo: Schema.String,
  /** Linhas literais com mais termos da consulta, com o número da linha no arquivo. */
  trecho: Schema.Array(Schema.Struct({ linha: Schema.Int, texto: Schema.String })),
  texto: Schema.optionalKey(Schema.String),
  fonte: Fonte,
  link: EsquemaLink,
  /** BM25: quanto menor, melhor. */
  pontuacao: Schema.Finite,
});
export type Resultado = typeof Resultado.Type;

export const Dados = Schema.Struct({ resultados: Schema.Array(Resultado) });

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
  entrada: Entrada,
  dados: Dados,
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
