/**
 * Peças comuns às ferramentas de PPCs e cursos (T3): os schemas de entrada do ID de norma e dos
 * filtros de texto, e o texto para a IA das regras de transição e dos fatos de PPC. A leitura dos IDs
 * de PPC e de curso escritos pela IA, os avisos e as conversões do kb ficam no serviço `Leitura`.
 */
import type { FatosPpc, TransicaoResumo } from "../contratos.ts";
import * as Schema from "effect/Schema";
import { comPadrao, textoAparado } from "../esquema.ts";
import { cortar } from "../orcamento.ts";
import { blocoItem, comLink } from "../texto.ts";

/* ------------------------------------------------------------------ schemas */

/** ID canônico de norma, com dispositivo opcional (`br/cne-cp/res/2021/1#art20`, `externo:abnt/nbr/6023`). */
export const idNorma = (descricao: string) =>
  textoAparado(
    {
      minimo: 1,
      maximo: 300,
      padrao: {
        regex: /^[A-Za-z0-9._~:-]+(?:\/[A-Za-z0-9._~:-]+)*(?:#[A-Za-z0-9._~-]+)?$/u,
        mensagem:
          'esperava um ID canônico de norma, como "br/cne-cp/res/2021/1" ou "br/cne-cp/res/2021/1#art20"; para uma citação em texto livre, use resolver_citacoes',
      },
    },
    descricao,
  );

/** Texto de filtro: sem espaços nas pontas, até 200 caracteres. */
export const filtroTexto = (descricao: string) => textoAparado({ minimo: 1, maximo: 200 }, descricao);

/** Descrição do filtro de PPC: a versão, ou o curso (o PPC vigente). */
export const DESCRICAO_PPC =
  'um PPC: a versão ("campus/curso/versao", como "curitiba/tecnico-em-enfermagem/2023") ou o curso ("campus/curso", o PPC vigente)';

/** Inclui os PPCs substituídos, que ficam na base; sem ela, só os vigentes. */
export const incluirSubstituidos = comPadrao(
  Schema.Boolean,
  false,
  "inclui os PPCs substituídos (versões anteriores, que ficam na base); sem ela, só os vigentes",
);

/* ------------------------------------------------------------------ texto */

export function linhaTransicao(t: TransicaoResumo): string {
  return `- ${comLink(t.id, t.link)} (${t.situacao_na_data}): ${t.regra}`;
}

/** Limite do trecho de origem de cada fato no texto. */
const MAX_TRECHO_FATO = 400;

/** Os fatos de um PPC em texto: cada fato com o status, o trecho literal e a fonte; SUAP e cruzamento. */
export function textoFatosPpc(f: FatosPpc, opcoes: { cabecalho?: boolean } = {}): string {
  const partes: string[] = [];
  if (opcoes.cabecalho ?? true) {
    const substituido = f.substituido_por ? ` (substituído por \`${f.substituido_por}\`)` : "";
    partes.push(`### ${comLink(`${f.nome} (${f.campus})`, f.link)} — \`${f.ppc}\`${substituido}`);
  }
  if (f.fatos.length === 0) partes.push("Nenhum fato extraído deste PPC.");
  for (const x of f.fatos) {
    partes.push(
      blocoItem({
        titulo: `${x.fato} = ${x.valor}${x.unidade ? ` ${x.unidade}` : ""}`,
        detalhe: `status \`${x.status_curadoria}\`, regra \`${x.regra}\``,
        literal: cortar(x.trecho_fonte, MAX_TRECHO_FATO),
        fonte: x.fonte,
      }),
    );
  }
  if (f.suap) {
    const linhas = [`SUAP (${f.suap.situacao ?? "sem situação"}):`];
    for (const m of f.suap.matrizes) linhas.push(`- ${m.trecho}`);
    if (f.suap.matrizes.length === 0) linhas.push("- nenhuma matriz publicada na base");
    partes.push(linhas.join("\n"));
  } else {
    partes.push("SUAP: o PPC não está ligado a um curso de institucional/ifpr/cursos/.");
  }
  if (f.cruzamento.length > 0) {
    partes.push(
      ["PPC × SUAP:", ...f.cruzamento.map((c) => `- ${c.aspecto}: **${c.resultado}** — ${c.explicacao}`)].join("\n"),
    );
  }
  return partes.join("\n\n");
}
