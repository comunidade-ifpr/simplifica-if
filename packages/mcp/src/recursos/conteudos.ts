/**
 * Conteúdos dos recursos `ifpr://` que não têm ferramenta própria (M1.5): o PPC sem seção, o curso do
 * CNCT, o campus e a ficha da revisão de PPC. Cada um tem a entrada, os dados (Effect Schema) e o texto
 * Markdown para a IA, como as ferramentas (`ferramentas/ferramenta.ts`); a leitura fica no serviço
 * `Leitura` (`leitura/recursos.ts`). Norma, dispositivo, curso e seção de PPC usam o texto das
 * ferramentas `ficha_norma`, `ler_dispositivos`, `ficha_curso` e `ler_secao` (ver `recursos.ts`).
 */
import * as Schema from "effect/Schema";
import { EsquemaLink, FatosPpc, Fonte, Resposta } from "../contratos.ts";
import { textoFatosPpc } from "../ferramentas/comum-ppcs.ts";
import { type Curso, Curso as EsquemaCurso, linhaCurso } from "../ferramentas/listar-cursos.ts";
import { corpoNoTeto, limitarTexto, tetoDoCorpo } from "../ferramentas/normas-comum.ts";
import { linhasNoOrcamento } from "../orcamento.ts";
import { blocoItem, comLink, linhaFonte } from "../texto.ts";

/** Um campo de texto com a fonte, como bloco de `corpoNoTeto`: cortado por igual se o corpo passar do teto. */
function blocoDoCampo(campo: { readonly rotulo: string; readonly texto: string; readonly fonte: Fonte }) {
  return {
    cabecalho: `**${campo.rotulo}**`,
    literal: campo.texto,
    rodape: linhaFonte(campo.fonte),
    seCortado: "Campo cortado para caber na resposta; o texto inteiro está no arquivo da fonte.",
  };
}

/** Os cursos do IFPR numa lista Markdown, no orçamento dado. */
function listaDeCursos(cursos: readonly Curso[], orcamento: number): string {
  return linhasNoOrcamento(cursos.map(linhaCurso), orcamento, "cursos (lista completa em `listar_cursos`)").join("\n");
}

/* ================================================================== PPC */

const TETO_RECURSO_PPC = 12_000;

export const EntradaPpc = Schema.Struct({ ppc: Schema.String });

export const DadosPpc = Schema.Struct({
  ppc: Schema.Struct({
    id: Schema.String,
    nome: Schema.String,
    campus: Schema.String,
    nivel: Schema.String,
    forma: Schema.String,
    link: EsquemaLink,
    /** Curso de `institucional/ifpr/cursos/` ligado ao PPC, quando há. */
    curso: Schema.NullOr(EsquemaLink),
    /** O arquivo do PPC convertido, da primeira à última linha das seções. */
    fonte: Fonte,
  }),
  /** Seções na ordem do documento; o link `ifpr://ppc/…#secao` lê cada uma. */
  secoes: Schema.Array(
    Schema.Struct({ id: Schema.String, tipo: Schema.String, titulo: Schema.String, fonte: Fonte, link: EsquemaLink }),
  ),
  fatos: FatosPpc,
});

/** A resposta inteira (envelope + dados), como a `saida` das ferramentas: o contrato do RPC `lerPpc`. */
export const SaidaPpc = Resposta(DadosPpc);

export function textoPpc(resposta: Resposta<typeof DadosPpc.Type>): string {
  const { dados: d } = resposta;
  const p = d.ppc;
  const partes = [
    blocoItem({
      titulo: `PPC ${p.nome} — ${p.campus}`,
      link: p.link,
      detalhe: `\`${p.id}\`; ${p.nivel}, ${p.forma} (PPC: exemplo institucional, não norma)`,
      fonte: p.fonte,
    }),
  ];
  if (p.curso) partes.push(`Curso: ${comLink(p.nome, p.curso)} (ofertas, CNCT e normas que o PPC cita).`);
  partes.push(textoFatosPpc(d.fatos, { cabecalho: false }));
  partes.push(
    [
      `Seções do PPC (o texto de cada uma: o link \`${p.link}#<seção>\`, ou \`ler_secao\`):`,
      ...linhasNoOrcamento(
        d.secoes.map(
          (s) => `- ${comLink(s.titulo, s.link)} [${s.tipo}], linhas ${s.fonte.linha_inicio}-${s.fonte.linha_fim}`,
        ),
        4000,
        "seções (lista completa no índice de `ficha_curso`, ou use `buscar_secoes` com `ppc`)",
      ),
    ].join("\n"),
  );
  return limitarTexto(
    partes.join("\n\n"),
    tetoDoCorpo(resposta, TETO_RECURSO_PPC),
    "Índice cortado para caber na resposta: as seções estão em `ficha_curso` e `buscar_secoes`.",
  );
}

/* ================================================================== CNCT */

const TETO_RECURSO_CNCT = 12_000;

export const EntradaCnct = Schema.Struct({ cnct: Schema.String });

export const DadosCnct = Schema.Struct({
  cnct: Schema.Struct({
    id: Schema.String,
    denominacao: Schema.String,
    eixo: Schema.NullOr(Schema.String),
    area: Schema.NullOr(Schema.String),
    carga_horaria_minima: Schema.NullOr(Schema.Finite),
    link: EsquemaLink,
  }),
  /** Os campos de texto do catálogo, na ordem do arquivo, cada um com a linha no JSON do curso. */
  campos: Schema.Array(
    Schema.Struct({ campo: Schema.String, rotulo: Schema.String, texto: Schema.String, fonte: Fonte }),
  ),
  /** Cursos do IFPR com esta habilitação. */
  cursos_ifpr: Schema.Array(EsquemaCurso),
});

/** Os campos de texto do curso no CNCT, na ordem do catálogo, com o rótulo do texto para a IA. */
export const CAMPOS_CNCT = [
  ["descricao_carga_horaria_minima", "Carga horária"],
  ["perfil_profissional", "Perfil profissional"],
  ["pre_requisitos_ingresso", "Pré-requisitos para ingresso"],
  ["itinerarios_formativos", "Itinerários formativos"],
  ["campo_atuacao", "Campo de atuação"],
  ["ocupacoes_cbo", "Ocupações da CBO"],
  ["infraestrutura_minima", "Infraestrutura mínima"],
  ["legislacao_profissional", "Legislação profissional"],
] as const;

/** A resposta inteira do recurso: o contrato do RPC `lerCnct`. */
export const SaidaCnct = Resposta(DadosCnct);

export function textoCnct(resposta: Resposta<typeof DadosCnct.Type>): string {
  const { dados: d } = resposta;
  const c = d.cnct;
  const cabecalho = [
    blocoItem({
      titulo: `${c.denominacao} (CNCT)`,
      link: c.link,
      detalhe: [
        c.eixo ? `eixo ${c.eixo}` : null,
        c.area ? `área ${c.area}` : null,
        c.carga_horaria_minima ? `carga horária mínima ${c.carga_horaria_minima} h` : null,
      ]
        .filter(Boolean)
        .join("; "),
    }),
  ];
  const cursos = d.cursos_ifpr.length
    ? [`Cursos do IFPR com esta habilitação (${d.cursos_ifpr.length}):`, listaDeCursos(d.cursos_ifpr, 3000)].join("\n")
    : "Cursos do IFPR com esta habilitação: nenhum na base.";
  const teto = tetoDoCorpo(resposta, TETO_RECURSO_CNCT) - cabecalho.join("").length - cursos.length - 8;
  return [...cabecalho, corpoNoTeto(d.campos.map(blocoDoCampo), teto), cursos].filter(Boolean).join("\n\n");
}

/* ================================================================== campus */

const TETO_RECURSO_CAMPUS = 8_000;

export const EntradaCampus = Schema.Struct({ campus: Schema.String });

export const DadosCampus = Schema.Struct({
  campus: Schema.Struct({
    id: Schema.String,
    nome: Schema.String,
    site: Schema.NullOr(Schema.String),
    /** O arquivo do campus em `base-conhecimento/institucional/ifpr/campi/`. */
    path: Schema.String,
    link: EsquemaLink,
  }),
  cursos: Schema.Array(EsquemaCurso),
});

/** A resposta inteira do recurso: o contrato do RPC `lerCampus`. */
export const SaidaCampus = Resposta(DadosCampus);

export function textoCampus(resposta: Resposta<typeof DadosCampus.Type>): string {
  const { dados: d } = resposta;
  const c = d.campus;
  const corpo = [
    blocoItem({ titulo: `Campus ${c.nome}`, link: c.link, detalhe: `\`${c.id}\`${c.site ? `; ${c.site}` : ""}` }),
    `fonte: \`${c.path}\``,
    d.cursos.length
      ? [
          `Cursos do campus na base (${d.cursos.length}; detalhes no link de cada um):`,
          listaDeCursos(d.cursos, TETO_RECURSO_CAMPUS - 2000),
        ].join("\n")
      : "Cursos do campus na base: nenhum.",
  ].join("\n\n");
  return limitarTexto(
    corpo,
    tetoDoCorpo(resposta, TETO_RECURSO_CAMPUS),
    "Lista cortada: use `listar_cursos` com `campus`.",
  );
}
