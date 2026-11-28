/**
 * Ferramenta `criterios_revisao_ppc` (depois do `pacote_revisao_ppc`): os critérios da tarefa "Revisar um PPC" (as fichas da
 * revisão), por ID, por tópico ou pelos que uma norma atinge, montados pelo serviço
 * `PacoteRevisaoPpc` do kb; por norma, também os outros arquivos da tarefa que a citam (os marcos
 * normativos e a taxonomia dos tópicos). Não são fonte normativa: são o que a revisão confere, com as normas em
 * que se apoiam (link `ifpr://norma` e status de vigência) para citar.
 */
import { partesDispositivo, textoDispositivos } from "@simplifica-if/kb/normas/texto-dispositivos";
import { DESCRICAO_MODO_EXECUCAO } from "@simplifica-if/kb/revisao-ppc/constantes";
import * as Schema from "effect/Schema";
import { EsquemaLink, Fonte } from "../contratos.ts";
import { opcional, textoAparado } from "../esquema.ts";
import { blocoItem, comLink, linhaFonte } from "../texto.ts";
import { idNorma } from "./comum-ppcs.ts";
import { definirFerramenta } from "./ferramenta.ts";
import { limitarTexto, tetoDoCorpo } from "./normas-comum.ts";

export const TETO_CRITERIOS = 30_000;

export const Entrada = Schema.Struct({
  id: opcional(
    textoAparado(
      { minimo: 1, maximo: 40 },
      'ID do critério (a ficha), como "CT-CURR-12"; não use junto com topico ou norma',
    ),
  ),
  topico: opcional(
    textoAparado(
      { minimo: 1, maximo: 80 },
      'tópico da revisão de PPC, como "estagio" ou "corpo_docente_gestao": os critérios dele; não use junto com id ou norma',
    ),
  ),
  norma: opcional(
    idNorma(
      'ID canônico da norma, com dispositivo opcional ("br/cne-cp/res/2021/1"): os critérios que ela atinge; não use junto com id ou topico',
    ),
  ),
});

/** Os campos de texto de um critério, na ordem em que o texto os mostra. */
export const CAMPOS_CRITERIO = [
  ["pergunta", "O que confere"],
  ["rubrica", "Como avaliar"],
  ["boa_evidencia", "Conta como atendido"],
  ["ma_evidencia", "Conta como não atendido"],
  ["escalonar_quando", "Fica a conferir quando"],
] as const;

/** Como o app confere o critério (`execucao.modo`), em linguagem de quem revisa. */
export const MODOS_EXECUCAO: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(DESCRICAO_MODO_EXECUCAO).map(([modo, info]) => [
    modo,
    `${info.rotulo} — ${info.descricao.replace(/\.$/, "")}`,
  ]),
);

const Referencia = Schema.Struct({
  ref: Schema.String,
  dispositivo: Schema.NullOr(Schema.String),
  papel: Schema.String,
  nota: Schema.NullOr(Schema.String),
  /** `null`: a norma não está na base. */
  titulo: Schema.NullOr(Schema.String),
  status_vigencia: Schema.NullOr(Schema.String),
  /** `null` na referência ao CNCT. */
  link: Schema.NullOr(EsquemaLink),
});

const Criterio = Schema.Struct({
  id: Schema.String,
  titulo: Schema.String,
  dominio: Schema.NullOr(Schema.String),
  criticidade: Schema.NullOr(Schema.String),
  /** O arquivo da ficha em `base-conhecimento/revisao-ppc/fichas/`. */
  path: Schema.String,
  topicos: Schema.Array(Schema.String),
  execucao: Schema.Struct({ modo: Schema.NullOr(Schema.String), justificativa: Schema.NullOr(Schema.String) }),
  /** Os campos de texto (pergunta, rubrica, evidências, escalonamento), cada um com a linha no arquivo. */
  campos: Schema.Array(
    Schema.Struct({ campo: Schema.String, rotulo: Schema.String, texto: Schema.String, fonte: Fonte }),
  ),
  referencias: Schema.Array(Referencia),
  /** Só na busca por norma: por que ela atinge o critério (referencia, referencia-correspondente, citacao, citacao-sucessora, tema). */
  atingido: Schema.optionalKey(
    Schema.Struct({
      motivos: Schema.Array(Schema.String),
      dispositivos: Schema.Array(Schema.String),
      topicos: Schema.optionalKey(Schema.Array(Schema.String)),
    }),
  ),
  /** A ficha inteira, como o arquivo a grava. */
  ficha: Schema.Unknown,
});

export const Dados = Schema.Struct({
  filtro: Schema.Struct({ campo: Schema.Literals(["id", "topico", "norma"]), valor: Schema.String }),
  /** O título do tópico ou da norma do filtro. */
  titulo: Schema.NullOr(Schema.String),
  criterios: Schema.Array(Criterio),
  /** Só na busca por norma: os tópicos cujos termos aparecem em dispositivos com mudança material. */
  topicos_atingidos: Schema.optionalKey(Schema.Array(Schema.String)),
  /**
   * Só na busca por norma: os outros arquivos da tarefa que a citam (os marcos normativos e a taxonomia
   * dos tópicos, em `base-conhecimento/revisao-ppc/`), por que (referencia, referencia-correspondente,
   * citacao, citacao-sucessora) e os dispositivos.
   */
  arquivos_da_tarefa: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        /** Caminho relativo à raiz do repositório. */
        arquivo: Schema.String,
        motivos: Schema.Array(Schema.String),
        dispositivos: Schema.Array(Schema.String),
      }),
    ),
  ),
});

type DadosCriterio = (typeof Criterio)["Type"];

/** `#art28-xviii` → "art. 28, XVIII"; fora do formato, como veio, sem o `#`. */
const dispositivoPorExtenso = (dispositivo: string): string => {
  const fragmento = `#${dispositivo.replace(/^#/, "")}`;
  return partesDispositivo(fragmento) === null ? fragmento.slice(1) : textoDispositivos([fragmento]);
};

function blocoCriterio(c: DadosCriterio): string {
  const detalhe = [
    c.criticidade ? `criticidade ${c.criticidade}` : null,
    c.dominio ? `domínio ${c.dominio}` : null,
    c.topicos.length ? `tópicos ${c.topicos.map((t) => `\`${t}\``).join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("; ");
  const linhas = [`### ${c.id} — ${c.titulo}`];
  if (detalhe) linhas.push(detalhe);
  if (c.atingido) {
    linhas.push(
      `Atingido por: ${c.atingido.motivos.join(", ")}${c.atingido.dispositivos.length ? ` (${c.atingido.dispositivos.join(", ")})` : ""}.`,
    );
  }
  for (const campo of c.campos) linhas.push(`**${campo.rotulo}:** ${campo.texto}\n${linhaFonte(campo.fonte)}`);
  if (c.execucao.modo) {
    const modo = MODOS_EXECUCAO[c.execucao.modo] ?? `modo ${c.execucao.modo}`;
    const justificativa = c.execucao.justificativa?.replace(/\.$/, "");
    linhas.push(`**Como o app confere:** ${modo}${justificativa ? ` (${justificativa})` : ""}.`);
  }
  if (c.referencias.length) {
    linhas.push(
      [
        "**Por que (as normas em que se apoia):**",
        ...c.referencias.map((r) => {
          const nome = `${r.titulo ?? r.ref}${r.dispositivo ? `, ${dispositivoPorExtenso(r.dispositivo)}` : ""}`;
          const situacao = [r.papel, r.status_vigencia].filter(Boolean).join("; ");
          return `- ${r.link ? comLink(nome, r.link) : nome}${situacao ? ` (${situacao})` : ""}${r.nota ? `: ${r.nota}` : ""}`;
        }),
      ].join("\n"),
    );
  }
  return linhas.join("\n\n");
}

/** O critério atingido por uma norma, numa linha: o motivo e os dispositivos. */
function linhaAtingido(c: DadosCriterio): string {
  const a = c.atingido;
  const motivo = a ? ` — ${a.motivos.join(", ")}${a.dispositivos.length ? ` (${a.dispositivos.join(", ")})` : ""}` : "";
  return `- **${c.id}** ${c.titulo}${motivo}`;
}

export const criteriosRevisaoPpc = definirFerramenta({
  nome: "criterios_revisao_ppc",
  titulo: "Critérios da revisão de PPC",
  descricao:
    'Os critérios da tarefa "Revisar um PPC" do app (as fichas da revisão): o que cada um confere, o que conta como atendido e como não atendido, quando fica a conferir e as normas em que se apoia. Informe exatamente um: id (um critério), topico (os de um tema) ou norma (os que ela atinge). Use para elaborar ou revisar um PPC; os critérios não são fonte normativa: cite as normas.',
  entrada: Entrada,
  dados: Dados,
  texto(resposta) {
    const d = resposta.dados;
    const filtro =
      d.filtro.campo === "id"
        ? `o critério ${d.filtro.valor}`
        : d.filtro.campo === "topico"
          ? `o tópico ${d.titulo ? `"${d.titulo}" ` : ""}(\`${d.filtro.valor}\`)`
          : `a norma ${d.titulo ?? d.filtro.valor}`;
    const cabecalho = [
      `Critérios da tarefa "Revisar um PPC" para ${filtro}: ${d.criterios.length}. São o que a revisão do app confere, não fonte normativa: o fundamento são as normas citadas em cada um.`,
      ...(d.topicos_atingidos?.length
        ? [`Tópicos atingidos: ${d.topicos_atingidos.map((t) => `\`${t}\``).join(", ")}.`]
        : []),
    ];
    // por norma, a lista curta (podem ser dezenas): o texto inteiro de cada um vem pelo `id`
    const corpo =
      d.criterios.length === 0
        ? [blocoItem({ titulo: "Nenhum critério cita a norma nem é atingido por ela." })]
        : d.filtro.campo === "norma"
          ? [
              "O texto de cada critério vem de `criterios_revisao_ppc` com o `id`.",
              d.criterios.map(linhaAtingido).join("\n"),
            ]
          : d.criterios.map(blocoCriterio);
    const arquivos = d.arquivos_da_tarefa?.length
      ? [
          [
            'Outros arquivos da tarefa "Revisar um PPC" que citam a norma (não são critérios nem fonte normativa):',
            ...d.arquivos_da_tarefa.map(
              (a) =>
                `- \`${a.arquivo}\` — ${a.motivos.join(", ")}${a.dispositivos.length ? ` (${a.dispositivos.join(", ")})` : ""}`,
            ),
          ].join("\n"),
        ]
      : [];
    return limitarTexto(
      [...cabecalho, ...corpo, ...arquivos].join("\n\n"),
      tetoDoCorpo(resposta, TETO_CRITERIOS),
      "Texto cortado no teto: o JSON da resposta traz todos os critérios; peça um por id.",
    );
  },
});
