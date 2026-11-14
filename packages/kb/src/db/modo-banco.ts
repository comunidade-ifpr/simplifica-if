/**
 * Modo banco: as consultas do kb respondidas só com o `kb.sqlite`, sem o repositório (passo T0 do
 * servidor MCP). É o ponto de entrada do `packages/mcp` (`@simplifica-if/kb/db/modo-banco`).
 *
 * Nenhuma regra é reescrita aqui: cada função chama a mesma regra da CLI com a fonte de dados
 * trocada (o registro de normas montado da tabela `normas`, a vigência pelas tabelas, as citações da
 * tabela `citacoes`, o léxico e os tópicos das tabelas `sinonimos_*`, `topicos` e `topicos_secoes`).
 * Nada no caminho destas funções lê arquivo, procura a raiz do repositório ou consulta o relógio:
 * dentro de um binário `bun build --compile`, a leitura relativa ao código falharia.
 *
 * `db/base.test.ts` confere, no mesmo commit, que cada função dá a mesma saída que a CLI sobre os
 * arquivos, e roda todas a partir de uma cópia do banco num diretório vazio, com qualquer leitura de
 * arquivo fora dele falhando.
 *
 * Diferença inevitável: `impactoBanco` não traz os textos das skills que não estão no banco
 * (prompts, contratos, validações cruzadas); só as fichas da `revisar-ppc`.
 */
import type { Database } from "bun:sqlite";
import { z } from "zod";
import {
  adequacaoArt71Em,
  type CursoParaAdequacao,
  type FonteAdequacao,
  type RelatorioAdequacao,
} from "../adequacao/art71.ts";
import { correspondenciaEm, type ResultadoCorrespondencia } from "../normas/correspondencia.ts";
import { idDoAto } from "../normas/ids.ts";
import { type FonteImpacto, impactoEm, type ResultadoImpacto, type TopicoTaxonomia } from "../normas/impacto.ts";
import type { Relacao } from "../normas/relacoes.ts";
import { relacoesDeEm, sucessorasDe } from "../normas/relacoes.ts";
import { type ResolucaoComEntrada, resolucaoComEntrada } from "../normas/resolver.ts";
import { type ResultadoVigencia, type SituacaoTransicao, statusEm, transicoesAplicaveis } from "../normas/vigencia.ts";
import {
  cobreDispositivo,
  ocorrenciaGravada,
  type PpcCitante,
  type RelatorioCitacoes,
  relatorioCitacoes,
} from "../ppcs/citacoes.ts";
import { compararTexto } from "../texto.ts";
import { abrirBanco } from "./banco.ts";
import { buscarNorma, buscarSecoes, type FiltrosSecoes, type ModoBusca } from "./consultas.ts";
import { fonteCorrespondenciaBanco } from "./consultas-normas.ts";
import { dataReferenciaBanco, fonteVigenciaBanco, registroBanco, sinonimosBanco } from "./fontes-banco.ts";
import { type PacoteContexto, pacoteContexto, pacoteDoMarkdown } from "./pacote-contexto.ts";

export { VERSAO_ESQUEMA } from "./esquema.ts";
export {
  datasBanco,
  dataReferenciaBanco,
  fonteVigenciaBanco,
  metaBanco,
  registroBanco,
  sinonimosBanco,
  transicoesBanco,
} from "./fontes-banco.ts";
export { topicosFichasBanco, topicosSecoesBanco } from "./pacote-contexto.ts";
// Consultas que já liam só o banco (`dispositivo`, `correspondencia`, `cursos`, `ppc-fatos`).
export {
  descendentesBanco,
  fonteCorrespondenciaBanco,
  obterDispositivoBanco,
  relacoesBanco,
  trechoDoDispositivo,
  vigenciaNoBanco,
} from "./consultas-normas.ts";
export { divergenciasPpcSuap, fatosDosPpcs, listarCursos, obterNorma, secoesDoPpc } from "./consultas.ts";
export { idDoAto } from "../normas/ids.ts";
// Tipos das respostas, para o `packages/mcp` tipar os handlers sem importar outros módulos do kb.
export type { DispositivoDoBanco, TrechoDispositivo } from "./consultas-normas.ts";
export type { ResultadoNorma } from "./consultas.ts";
export type { ResultadoCorrespondencia, TabelaCorrespondencia } from "../normas/correspondencia.ts";
export type { Relacao } from "../normas/relacoes.ts";
export type { ResolucaoComEntrada } from "../normas/resolver.ts";
export type { EventoVigencia, ResultadoVigencia, SituacaoTransicao } from "../normas/vigencia.ts";

/** Abre o `kb.sqlite` em `caminho` só para leitura, sem recompilar e sem procurar o repositório. */
export function abrirBancoSomenteLeitura(caminho: string): Database {
  return abrirBanco({ caminho, somenteLeitura: true, recompilar: false });
}

const ato = (id: string) => idDoAto(id.split("#")[0]!);

/* ================================================================== normas */

/** `kb resolver <texto>`: a citação resolvida, com título e arquivo da norma. */
export function resolverBanco(db: Database, texto: string): ResolucaoComEntrada {
  return resolucaoComEntrada(texto, registroBanco(db));
}

/** `kb buscar-norma`: `buscarNorma` com o registro do banco para resolver citações. */
export function buscarNormaBanco(
  db: Database,
  consulta: string,
  opcoes: { limite?: number; situacao?: string; vigentes?: boolean; em?: string } = {},
): ReturnType<typeof buscarNorma> {
  return buscarNorma(db, consulta, { ...opcoes, registro: registroBanco(db) });
}

/** `kb correspondencia <id>`. */
export function correspondenciaBanco(db: Database, id: string): ResultadoCorrespondencia[] {
  return correspondenciaEm(id, fonteCorrespondenciaBanco(db));
}

/** `kb vigencia <id> [--em]`: status na data (padrão: `data_referencia`), eventos, pendências e transições. */
export function vigenciaBanco(
  db: Database,
  id: string,
  opcoes: { em?: string } = {},
): ResultadoVigencia & { transicoes: SituacaoTransicao[] } {
  const quando = opcoes.em ?? dataReferenciaBanco(db);
  const fonte = fonteVigenciaBanco(db);
  return { ...statusEm(ato(id), quando, fonte), transicoes: transicoesAplicaveis(ato(id), quando, fonte) };
}

/** `kb relacoes <id>`: relações em que a norma é origem (`saida`) ou alvo (`entrada`). */
export function relacoesDaNormaBanco(db: Database, id: string): { id: string; saida: Relacao[]; entrada: Relacao[] } {
  return { id: ato(id), ...relacoesDeEm(ato(id), fonteVigenciaBanco(db).relacoes()) };
}

/** Sucessoras da norma (as de `kb impacto`): atos que a revogam no todo, pela tabela `relacoes`. */
export function sucessorasBanco(db: Database, id: string): string[] {
  return sucessorasDe(ato(id), fonteVigenciaBanco(db).relacoes());
}

const esquemaNormaCompleta = z.strictObject({
  id: z.string(),
  situacao: z.enum(["base", "stub", "externo"]),
  titulo: z.string(),
  tipo_documento: z.string().nullable(),
  numero: z.string().nullable(),
  ano: z.number().int().nullable(),
  orgao: z.string().nullable(),
  jurisdicao: z.string().nullable(),
  data_publicacao: z.string().nullable(),
  status_vigencia: z.string().nullable(),
  ementa: z.string().nullable(),
  fonte: z.string().nullable(),
  path: z.string().nullable(),
  front_matter_json: z.string().nullable(),
});

/** Metadados de uma norma da base, stub ou referência externa, como o manifesto e o `stubs.yaml` os publicam. */
export interface NormaDoBanco {
  id: string;
  situacao: "base" | "stub" | "externo";
  titulo: string;
  tipo_documento: string | null;
  numero: string | null;
  ano: number | null;
  orgao: string | null;
  jurisdicao: string | null;
  data_publicacao: string | null;
  /** Status publicado, calculado na `data_referencia`. */
  status_vigencia: string | null;
  ementa: string | null;
  /** Fonte oficial (URL ou descrição) registrada no front matter ou no stub. */
  fonte: string | null;
  /** Markdown, relativo à raiz do repositório; `null` em stub e externo. */
  path: string | null;
  /** Explicação gerada (`vigencia_a_confirmar` do front matter) quando o status depende de data a confirmar. */
  pendencia_vigencia: string | null;
  /** O status publicado está "a confirmar": há pendência registrada ou o status é `a confirmar` (stubs). */
  vigencia_a_confirmar: boolean;
}

/**
 * Norma pelo ID (do ato, do arquivo com variante ou com `#dispositivo`), com os metadados que
 * `obterNorma` não traz (órgão, tipo, número, ano, fonte e a pendência de vigência). `null` se a
 * norma não está registrada.
 */
export function normaBanco(db: Database, id: string): NormaDoBanco | null {
  const consultar = (chave: string) =>
    db
      .query(
        `SELECT id, situacao, titulo, tipo_documento, numero, ano, orgao, jurisdicao, data_publicacao, status_vigencia,
                ementa, fonte, path, front_matter_json FROM normas WHERE id = ?`,
      )
      .get(chave);
  const norma = id.split("#")[0]!;
  const linha = consultar(norma) ?? (idDoAto(norma) !== norma ? consultar(idDoAto(norma)) : null);
  if (!linha) return null;
  const { front_matter_json, ...n } = esquemaNormaCompleta.parse(linha);
  const frontMatter =
    front_matter_json === null ? {} : z.record(z.string(), z.unknown()).parse(JSON.parse(front_matter_json));
  const pendencia = typeof frontMatter.vigencia_a_confirmar === "string" ? frontMatter.vigencia_a_confirmar : null;
  return {
    ...n,
    pendencia_vigencia: pendencia,
    vigencia_a_confirmar: pendencia !== null || n.status_vigencia === "a confirmar",
  };
}

/* ================================================================= citações */

const esquemaCitante = z.strictObject({
  chave: z.string(),
  campus_nome: z.string(),
  curso_nome: z.string(),
  nivel: z.string(),
  tipo_oferta: z.string(),
  path: z.string(),
  linha: z.number().int(),
  trecho: z.string(),
  regra: z.string(),
  confianca: z.number(),
  dispositivos_json: z.string(),
});

/** `ppcsQueCitam` pela tabela `citacoes` (mesma ordem: PPC por ID, citação por posição). */
export function ppcsQueCitamBanco(db: Database, id: string, opcoes: { confiancaMinima?: number } = {}): PpcCitante[] {
  const dispositivo = id.split("#")[1];
  const minimo = opcoes.confiancaMinima ?? 0;
  const linhas = z.array(esquemaCitante).parse(
    db
      .query(
        `SELECT p.chave, p.campus_nome, p.curso_nome, p.nivel, p.tipo_oferta, p.path,
                c.linha, c.trecho, c.regra, c.confianca, c.dispositivos_json
         FROM citacoes c JOIN ppcs p ON p.id = c.ppc_id
         WHERE c.ato_id = ? ORDER BY p.chave, c.ordem`,
      )
      .all(ato(id)),
  );
  const porPpc = new Map<string, PpcCitante>();
  for (const linha of linhas) {
    if (linha.confianca < minimo) continue;
    const dispositivos = z.array(z.string()).parse(JSON.parse(linha.dispositivos_json));
    if (dispositivo && !cobreDispositivo(dispositivos, dispositivo)) continue;
    let ppc = porPpc.get(linha.chave);
    if (!ppc) {
      ppc = {
        ppc: linha.chave,
        campus: linha.campus_nome,
        curso: linha.curso_nome,
        nivel: linha.nivel,
        tipo_oferta: linha.tipo_oferta,
        // relativo a base-conhecimento/, como no índice de PPCs
        path: linha.path.replace(/^base-conhecimento\//, ""),
        ocorrencias: [],
      };
      porPpc.set(linha.chave, ppc);
    }
    ppc.ocorrencias.push(ocorrenciaGravada({ ...linha, dispositivos }));
  }
  return [...porPpc.values()].sort((a, b) => compararTexto(a.ppc, b.ppc));
}

/** `kb citacoes <id> [--confianca-min]`: PPCs que citam a norma, com o título e a situação dela. */
export function citacoesBanco(db: Database, id: string, opcoes: { confiancaMinima?: number } = {}): RelatorioCitacoes {
  return relatorioCitacoes(id, ppcsQueCitamBanco(db, id, opcoes), registroBanco(db));
}

/* =================================================================== impacto */

const esquemaSegmento = z.strictObject({
  norma_id: z.string(),
  ato_id: z.string(),
  segmento: z.string(),
  citado_id: z.string(),
  dispositivos_json: z.string(),
  trecho: z.string(),
});

/** O que o impacto lê, pelo banco. Sem os textos das skills: `arquivosConteudo` são só as fichas. */
export function fonteImpactoBanco(db: Database): FonteImpacto {
  const vigencia = fonteVigenciaBanco(db);
  return {
    registro: registroBanco(db),
    vigencia,
    dataReferencia: () => dataReferenciaBanco(db),
    relacoes: () => vigencia.relacoes(),
    correspondencia: fonteCorrespondenciaBanco(db),
    dispositivosDoAto: (a) =>
      z
        .array(z.strictObject({ dispositivo: z.string(), texto: z.string() }))
        .parse(
          db
            .query(
              "SELECT dispositivo, texto FROM dispositivos WHERE ato_id = ? AND canonico = 1 ORDER BY norma_id <> ato_id, norma_id, ordem",
            )
            .all(a),
        ),
    topicos: () =>
      z
        .array(z.strictObject({ dados_json: z.string() }))
        .parse(db.query("SELECT dados_json FROM topicos ORDER BY ordem").all())
        .map((t) => JSON.parse(t.dados_json) as TopicoTaxonomia),
    arquivosConteudo: () =>
      z
        .array(z.strictObject({ path: z.string(), arquivo_json: z.string() }))
        .parse(db.query("SELECT path, arquivo_json FROM fichas ORDER BY path").all())
        .map((f) => ({ arquivo: f.path, texto: f.arquivo_json })),
    // uma citação por segmento: o impacto só pergunta se o segmento cita a norma
    segmentosCitantes: (excetoAto) =>
      z
        .array(esquemaSegmento)
        .parse(
          db
            .query(
              "SELECT norma_id, ato_id, segmento, citado_id, dispositivos_json, trecho FROM normas_citacoes WHERE ato_id <> ? ORDER BY rowid",
            )
            .all(excetoAto),
        )
        .map((c) => ({
          norma: c.norma_id,
          ato: c.ato_id,
          segmento: c.segmento,
          citacoes: [
            {
              id: c.citado_id,
              dispositivos: z.array(z.string()).parse(JSON.parse(c.dispositivos_json)),
              trecho: c.trecho,
            },
          ],
        })),
    ppcsQueCitam: (id) => ppcsQueCitamBanco(db, id),
  };
}

/**
 * `kb impacto <id>` pelo banco: relações, sucessoras, transições, normas que citam, fichas da
 * `revisar-ppc` (referência, citação, tema) e PPCs. Sem os outros textos das skills.
 */
export function impactoBanco(
  db: Database,
  id: string,
  opcoes: { data?: string; incluirPpcs?: boolean } = {},
): ResultadoImpacto {
  return impactoEm(id, fonteImpactoBanco(db), opcoes);
}

/* ======================================================= adequação ao art. 71 */

const esquemaCursoAdequacao = z.strictObject({
  campus_id: z.string(),
  curso_slug: z.string(),
  nome: z.string(),
  nivel: z.string().nullable(),
  forma_oferta: z.string().nullable(),
  situacao: z.string().nullable(),
  ppc_markdown_path: z.string().nullable(),
  ppc_ano_documento: z.number().int().nullable(),
});

/** Cursos da tabela `cursos` e citações da tabela `citacoes` (PPC pelo `path`). */
export function fonteAdequacaoBanco(db: Database): FonteAdequacao {
  return {
    cursos: () =>
      z
        .array(esquemaCursoAdequacao)
        .parse(
          db
            .query(
              "SELECT campus_id, curso_slug, nome, nivel, forma_oferta, situacao, ppc_markdown_path, ppc_ano_documento FROM cursos ORDER BY id",
            )
            .all(),
        )
        .map((c): CursoParaAdequacao => {
          const curso: CursoParaAdequacao = { campus_id: c.campus_id, curso_slug: c.curso_slug, nome: c.nome };
          if (c.nivel !== null) curso.nivel = c.nivel;
          if (c.forma_oferta !== null) curso.forma_oferta = c.forma_oferta;
          if (c.situacao !== null) curso.situacao = c.situacao;
          if (c.ppc_markdown_path !== null || c.ppc_ano_documento !== null) {
            curso.ppc = {
              ...(c.ppc_markdown_path !== null ? { markdown_path: c.ppc_markdown_path } : {}),
              ...(c.ppc_ano_documento !== null ? { ano_documento: c.ppc_ano_documento } : {}),
            };
          }
          return curso;
        }),
    citacoesDoPpc: (markdown) => {
      const ppc = z
        .strictObject({ id: z.string() })
        .nullable()
        .parse(db.query("SELECT id FROM ppcs WHERE path = ?").get(`base-conhecimento/${markdown}`) ?? null);
      if (!ppc) return null;
      return z
        .array(z.strictObject({ id: z.string().nullable(), linha: z.number().int(), regra: z.string() }))
        .parse(
          db.query("SELECT norma_id AS id, linha, regra FROM citacoes WHERE ppc_id = ? ORDER BY ordem").all(ppc.id),
        );
    },
  };
}

/** `kb adequacao-art71 [--incluir-tecnologia]`. */
export function adequacaoArt71Banco(db: Database, opcoes: { incluirTecnologia?: boolean } = {}): RelatorioAdequacao {
  return adequacaoArt71Em(fonteAdequacaoBanco(db), opcoes);
}

/* ============================================================ PPCs e cursos */

/** `kb buscar-secoes`: `buscarSecoes` com o léxico do banco (salvo outro informado). */
export function buscarSecoesBanco(
  db: Database,
  consulta: string,
  filtros: FiltrosSecoes = {},
  opcoes: { limite?: number; modo?: ModoBusca; integral?: boolean; somenteTodos?: boolean } = {},
): ReturnType<typeof buscarSecoes> {
  return buscarSecoes(db, consulta, filtros, { ...opcoes, lexico: sinonimosBanco(db) });
}

/** `kb pacote-contexto <tarefa> <ppc>` de um PPC da base, com léxico, tópicos e tamanho do PPC do banco. */
export function pacoteContextoBanco(
  db: Database,
  tarefa: string,
  ppc: string,
  opcoes: { buscasPorFicha?: number } = {},
): PacoteContexto {
  return pacoteContexto(db, tarefa, ppc, opcoes);
}

/**
 * `kb pacote-contexto <tarefa> <arquivo.md>`: o pacote de um PPC fora da base (o da pasta de
 * trabalho), com registro, léxico e tópicos do banco. `markdown` dispensa a leitura de `arquivo`,
 * que então só identifica o PPC no pacote.
 */
export function pacoteDoMarkdownBanco(
  db: Database,
  tarefa: string,
  arquivo: string,
  opcoes: { markdown?: string } = {},
): ReturnType<typeof pacoteDoMarkdown> {
  return pacoteDoMarkdown(db, tarefa, arquivo, opcoes);
}
