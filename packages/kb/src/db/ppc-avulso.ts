// @effect-diagnostics nodeBuiltinImport:off -- o banco em memória é um `DatabaseSync` do node:sqlite, gravado pelo mesmo código da compilação
/**
 * O banco em memória de um PPC fora da base (o PPC que a pessoa revisa no app, um `.md` da pasta de
 * trabalho): o esquema do `kb.sqlite` com uma linha em `ppcs`, as seções pela mesma
 * segmentação e taxonomia do índice (`secoesIndexadas`) e as citações pelo mesmo resolvedor,
 * gravadas por `gravarSecoesECitacoes`. As consultas de seções (`secoesDoPpc`, `buscarSecoes`) e de
 * citações rodam nele sem mudança, trocando só o `SqlClient` do ambiente.
 *
 * Só `abrirPpcAvulso` e a preparação do texto (`textoDoPpcAvulso`) saem daqui: o banco se abre e se fecha com o escopo de quem pede, e quem pede
 * recebe o `SqlClient`, não o `DatabaseSync`. Quem monta o pacote é o `PacoteRevisaoPpc`.
 */
import * as NodeSqlite from "node:sqlite";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { Sinonimos } from "../busca/sinonimos.ts";
import type { Registro } from "../normas/registro.ts";
import { type NomeTaxonomia, secoesComChave, secoesIndexadas } from "../ppcs/secoes.ts";
import { gravarSecoesECitacoes, Inseridor } from "./compilar.ts";
import * as Conexao from "./conexao.ts";
import { DDL } from "./esquema.ts";
import { emTransacao } from "./transacao.ts";

/** Opções do banco em memória de um PPC fora da base. */
export interface OpcoesPpcAvulso {
  /** ID do PPC no banco em memória (padrão `ppc:avulso`). */
  ppcId?: string;
  /** Caminho gravado em `path` (o `PPC.md` da rodada, por exemplo). */
  path?: string;
  taxonomia?: NomeTaxonomia;
  /** Palavras dos nomes de campi, para os cabeçalhos de página (`palavrasDeCampi`). */
  palavrasCampi?: ReadonlySet<string>;
  curso_nome?: string;
  campus_nome?: string;
  nivel?: string;
  tipo_oferta?: string;
  sinonimos: Sinonimos;
  registro: Registro;
  /**
   * Grava também as seções que o índice publicado deixa de fora (`pretextual`, `outros` e as de
   * texto curto, com chave `<tipo>-x<n>`): numa minuta, a capa e os campos curtos da identificação
   * ("Forma de oferta: Subsequente") importam. Padrão: só as do índice, como no `kb.sqlite`.
   */
  todasAsSecoes?: boolean;
  /**
   * Reconhece `# Título` como título de seção. No índice publicado só `##` a `######` contam (nos
   * PPCs convertidos de PDF, `#` aparece em linhas da capa); o normalizador e o conversor DOCX do
   * `packages/ppc` põem o primeiro nível numerado em `#`. A segmentação roda como se fosse `##`, com
   * as mesmas linhas.
   */
  titulosNivel1?: boolean;
}

/**
 * O texto de um PPC fora da base como o banco o recebe: `markdown`, com as quebras de linha em `\n`
 * (o que se grava e onde se acham as citações), e `paraSegmentar`, o mesmo com `# Título` como
 * `## Título` quando `titulosNivel1` (o que se segmenta). As linhas são as mesmas nos dois. A
 * `estrutura()` do `PpcAvulso` segmenta o mesmo texto, para dar as linhas do banco.
 */
export function textoDoPpcAvulso(
  markdownOriginal: string,
  opcoes: Pick<OpcoesPpcAvulso, "titulosNivel1">,
): { readonly markdown: string; readonly paraSegmentar: string } {
  const markdown = markdownOriginal.replace(/\r\n?/g, "\n");
  return { markdown, paraSegmentar: opcoes.titulosNivel1 ? markdown.replace(/^#(?=[ \t])/gm, "##") : markdown };
}

function bancoDoPpcAvulso(markdownOriginal: string, opcoes: OpcoesPpcAvulso): NodeSqlite.DatabaseSync {
  const { markdown, paraSegmentar } = textoDoPpcAvulso(markdownOriginal, opcoes);
  const ppcId = opcoes.ppcId ?? "ppc:avulso";
  const caminhoMd = opcoes.path ?? "PPC.md";
  const taxonomia = opcoes.taxonomia ?? "tecnico";
  const db = new NodeSqlite.DatabaseSync(":memory:");
  db.exec(DDL);
  const ins = new Inseridor(db);
  emTransacao(db, () => {
    ins.inserir("ppcs", {
      id: ppcId,
      chave: ppcId.replace(/^ppc:/, ""),
      // Fora da base não há curso nem versões: o PPC é o próprio "vigente", e a chave do curso é a dele.
      chave_curso: ppcId.replace(/^ppc:/, ""),
      versao: "avulso",
      vigente: 1,
      substituido_por: null,
      campus_id: "",
      campus_nome: opcoes.campus_nome ?? "",
      curso_slug: "",
      curso_nome: opcoes.curso_nome ?? "",
      curso_id: null,
      nivel: opcoes.nivel ?? "médio",
      taxonomia,
      tipo_oferta: opcoes.tipo_oferta ?? "",
      ano_documento: null,
      curso_url: null,
      fonte_pdf: null,
      path: caminhoMd,
      linhas: markdown.split("\n").length,
      caracteres: markdownOriginal.length,
      proveniencia_json: JSON.stringify(null),
    });
    gravarSecoesECitacoes(ins, {
      ppcId,
      caminhoMd,
      markdown,
      secoes: (opcoes.todasAsSecoes
        ? secoesComChave(paraSegmentar, taxonomia, opcoes.palavrasCampi)
        : secoesIndexadas(paraSegmentar, taxonomia, opcoes.palavrasCampi)
      ).map((secao) => ({
        id: `${ppcId}#${secao.chave}`,
        tipo: secao.tipo,
        origem_tipo: secao.origem,
        titulo: secao.titulo,
        numeracao: secao.numeracao,
        linha_inicio: secao.linhaInicio,
        linha_fim: secao.linhaFim,
        texto: secao.texto,
      })),
      registro: opcoes.registro,
      lexico: opcoes.sinonimos,
      expansoes: new Map(),
      insFts: db.prepare(
        "INSERT INTO secoes_fts (rowid, titulo, texto, titulo_radicais, radicais, expansao) VALUES (?, ?, ?, ?, ?, ?)",
      ),
    });
  });
  return db;
}

/**
 * O `SqlClient` do banco em memória de um PPC fora da base, aberto agora e fechado no fim do escopo.
 * Para várias consultas sobre o mesmo PPC (os grupos de uma rodada, os blocos de uma revisão com IA).
 */
export const abrirPpcAvulso = Effect.fn("ppcAvulso.abrir")(function* (markdown: string, opcoes: OpcoesPpcAvulso) {
  const db = yield* Effect.acquireRelease(
    Effect.sync(() => bancoDoPpcAvulso(markdown, opcoes)),
    (banco) => Effect.sync(() => banco.close()),
  );
  return yield* Layer.build(Conexao.layerDeConexao(db));
});
