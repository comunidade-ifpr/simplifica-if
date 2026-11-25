// @effect-diagnostics nodeBuiltinImport:off -- a compilação escreve dezenas de milhares de linhas pelo node:sqlite direto, numa transação (ver Compilador.ts)
/**
 * Compila o `kb.sqlite` a partir dos arquivos do checkout.
 *
 *   pnpm kb:compilar [--destino tmp/kb.sqlite] [--versao 2026.11.13] [--commit <sha>] [--canal beta]
 *
 * O serviço `Compilador` orquestra (temporário, renomeação, mtime); aqui ficam as partes síncronas:
 * `prepararCompilacao` (fontes e impressão digital) e `preencherBanco`.
 *
 * O banco é derivado e fica fora do git (`tmp/`). Determinismo: as mesmas fontes geram o mesmo
 * arquivo, byte a byte. Para isso:
 * - toda leitura é ordenada por code point (caminhos, IDs) e os `rowid` saem dessa ordem;
 * - nada vem do relógio (nem a data do build: `meta` guarda versão do esquema, data de referência e
 *   hashes das fontes; `versao`, `commit` e `canal` só quando informados, e então vêm de quem builda);
 * - `page_size` fixo, um único `INSERT` por linha numa transação, `optimize` do FTS5 e `VACUUM` no
 *   fim, que reescreve as páginas na ordem lógica e zera o espaço livre;
 * - o arquivo é escrito num temporário e renomeado (quem lê nunca vê um banco pela metade).
 * O teste `base.test.ts` compila duas vezes e compara o SHA-256 dos arquivos.
 */
import * as Schema from "effect/Schema";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { expansaoDoTipo, lerSinonimos, type Sinonimos } from "../busca/sinonimos.ts";
import { radicais } from "../busca/tokens.ts";
import type { Canal } from "../canal.ts";
import { cruzarPpcSuap } from "../fatos/divergencias.ts";
import { extrairFatosPpc, type SecaoDoPpc } from "../fatos/ppc.ts";
import { carregarDadosInstitucionaisKb, linhaDaChave, linhaDoValor, matrizesDoResumo } from "../institucional/dados.ts";
import { CAMINHOS, noCheckout } from "../caminhos.ts";
import { analisarFrontMatter, listaDeTextos, normaDoFrontMatter } from "../normas/front-matter.ts";
import { listarNormas } from "../normas/estrutura.ts";
import { metadadosDoIdNorma } from "../normas/ids.ts";
import { caminhoStubs, carregarRegistro, lerRegistroStubs, type Registro } from "../normas/registro.ts";
import { segmentosCitantes } from "../normas/citacoes-normas.ts";
import { extrairCitacoes } from "../normas/resolver.ts";
import { carregarDatas, dataReferencia, derivarLinha } from "../normas/vigencia.ts";
import { carregarRelacoes } from "../normas/relacoes.ts";
import { FONTE_TEXTO, linhaDaEvidenciaAno, mascararFrontMatter } from "../ppcs/front-matter.ts";
import { lerTextoSecao } from "../ppcs/citacoes.ts";
import { decodificarIndicePpcs, itensPorId } from "../ppcs/indice.ts";
import { compararTexto } from "../texto.ts";
import { DDL, VERSAO_ESQUEMA } from "./esquema.ts";
import { arquivosFonte, hashConteudo, hashLista } from "./fontes.ts";
import {
  linhasCorrespondencias,
  linhasDispositivos,
  linhasRelacoes,
  linhasTabelasCorrespondencia,
  linhasTransicoes,
  linhasVigencias,
} from "../normas/fontes-db.ts";
import { lerTopicosSecoes, type TopicosSecoes } from "../ppcs/topicos.ts";
import { emTransacao } from "./transacao.ts";

const PAGE_SIZE = 4096;

export interface OpcoesCompilacao {
  /** Léxico de sinônimos (padrão: `packages/kb/dados/sinonimos.yaml` do checkout em `raiz`). */
  sinonimos?: Sinonimos;
  /** Tópicos das fichas → tipos de seção (padrão: `packages/kb/dados/topicos-secoes.yaml` do checkout). */
  topicosSecoes?: TopicosSecoes;
  /**
   * Identificação do build, gravada em `meta` só quando informada (sem ela, o banco depende só das
   * fontes): `versao` (como `2026.11.13`), `commit` (o SHA das fontes) e `canal` (`dev`, `beta` ou `estavel`).
   */
  versao?: string;
  commit?: string;
  canal?: Canal;
}

export interface ResumoCompilacao {
  destino: string;
  fontes: number;
  fontes_sha256: string;
  contagens: Record<string, number>;
}

const json = (valor: unknown): string => JSON.stringify(valor ?? null);

function lerJson(arquivo: string): unknown {
  return JSON.parse(NodeFS.readFileSync(arquivo, "utf-8"));
}

/* ---------------------------------------------------------- esquemas de leitura */

const texto = Schema.optionalKey(Schema.String);
const resto = [Schema.Record(Schema.String, Schema.Unknown)] as const;
/** Objeto frouxo: exige os campos dados e deixa os demais na saída, na ordem de entrada, depois deles. */
const solto = <Campos extends Schema.Struct.Fields>(campos: Campos) =>
  Schema.StructWithRest(Schema.Struct(campos), resto);

const esquemaSecaoJsonl = solto({
  id: Schema.String,
  ppc_id: Schema.String,
  section_kind: Schema.String,
  origem_tipo: texto,
  heading: Schema.String,
  numeracao: Schema.optionalKey(Schema.NullOr(Schema.String)),
  path: Schema.String,
  linha_inicio: Schema.Int,
  linha_fim: Schema.Int,
});
type SecaoJsonl = typeof esquemaSecaoJsonl.Type;

const esquemaCnctIndice = solto({
  items: Schema.Array(
    solto({
      id: Schema.String,
      denominacao: Schema.String,
      eixo_tecnologico: Schema.String,
      area_tecnologica: texto,
      carga_horaria_minima_horas: Schema.optionalKey(Schema.Number),
      path: texto,
    }),
  ),
});

const esquemaFicha = solto({
  id: Schema.String,
  titulo: Schema.String,
  dominio: texto,
  criticidade: texto,
  tipo_escopo: texto,
  pergunta: texto,
  rubrica: texto,
  topicos_tematicos: Schema.optionalKey(Schema.Array(Schema.String)),
  referencias_normativas: Schema.optionalKey(
    Schema.Array(
      solto({
        ref: Schema.String,
        dispositivo: texto,
        papel: Schema.String,
        nota: texto,
      }),
    ),
  ),
});

/** Só a lista de tópicos, crua: `dados_json` de cada tópico guarda o item como está no arquivo. */
const esquemaTopicosBrutos = Schema.Struct({ topicos: Schema.Array(Schema.Unknown) });

const esquemaTopicos = solto({
  topicos: Schema.Array(
    solto({
      id: Schema.String,
      titulo: Schema.String,
      grupo: texto,
      tipo_escopo: texto,
      descricao: texto,
      aliases_titulo: Schema.optionalKey(Schema.Array(Schema.String)),
      termos_busca: Schema.optionalKey(Schema.Array(Schema.String)),
      fichas: Schema.optionalKey(Schema.Array(Schema.String)),
    }),
  ),
});

const esquemaMarcos = solto({
  marcos: Schema.Array(
    solto({
      id: Schema.String,
      tema: Schema.String,
      /** Atos do tema, do mais antigo ao mais recente conhecido (o resto é derivado: `derivarLinha`). */
      linha: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
      aplica_a: texto,
      transicao: texto,
      orientacao_analise: texto,
    }),
  ),
});

// Decodificadores compilados uma vez.
const decodificarSecaoJsonl = Schema.decodeUnknownSync(esquemaSecaoJsonl);
const decodificarCnctIndice = Schema.decodeUnknownSync(esquemaCnctIndice);
const decodificarFicha = Schema.decodeUnknownSync(esquemaFicha);
const decodificarTopicosBrutos = Schema.decodeUnknownSync(esquemaTopicosBrutos);
const decodificarTopicos = Schema.decodeUnknownSync(esquemaTopicos);
const decodificarMarcos = Schema.decodeUnknownSync(esquemaMarcos);

/* ------------------------------------------------------------------- papel */

const RE_ROTULO_BIBLIOGRAFIA =
  /^[\s*_#>|-]*(?:\d+(?:\.\d+)*\.?\s*)?(?:bibliografias?|refer[eê]ncias(?: bibliogr[aá]ficas)?)\b/i;

/**
 * Papel de uma citação no PPC: `referencia-bibliografica` dentro da seção de referências do PPC ou
 * depois de um rótulo "Bibliografia"/"Referências" na mesma seção (ementário, regulamento);
 * `fundamento` no resto.
 */
export function papelDaCitacao(
  linhas: readonly string[],
  linha: number,
  secao: { tipo: string; linha_inicio: number } | null,
): "fundamento" | "referencia-bibliografica" {
  if (secao?.tipo === "referencias") return "referencia-bibliografica";
  const limite = secao ? secao.linha_inicio : Math.max(1, linha - 60);
  for (let l = linha; l >= limite; l -= 1) {
    const texto = linhas[l - 1] ?? "";
    if (RE_ROTULO_BIBLIOGRAFIA.test(texto)) return "referencia-bibliografica";
    if (!secao && /^#{1,6}\s/.test(texto) && l !== linha) break;
  }
  return "fundamento";
}

/* --------------------------------------------------------------- compilação */

export class Inseridor {
  private readonly db: NodeSqlite.DatabaseSync;
  private readonly cache = new Map<string, NodeSqlite.StatementSync>();
  readonly contagens: Record<string, number> = {};
  constructor(db: NodeSqlite.DatabaseSync) {
    this.db = db;
  }

  inserir(tabela: string, linha: Record<string, unknown>): number {
    const colunas = Object.keys(linha);
    const chave = `${tabela}(${colunas.join(",")})`;
    let st = this.cache.get(chave);
    if (!st) {
      st = this.db.prepare(
        `INSERT INTO ${tabela} (${colunas.join(", ")}) VALUES (${colunas.map(() => "?").join(", ")})`,
      );
      this.cache.set(chave, st);
    }
    const valores = colunas.map((c) => {
      const v = linha[c];
      return v === undefined ? null : typeof v === "boolean" ? Number(v) : v;
    }) as (string | number | null)[];
    const resultado = st.run(...valores);
    this.contagens[tabela] = (this.contagens[tabela] ?? 0) + 1;
    return Number(resultado.lastInsertRowid);
  }
}

/** Seção de PPC a gravar em `secoes` e `secoes_fts` (texto integral já recortado). */
export interface SecaoParaGravar {
  id: string;
  tipo: string;
  origem_tipo: string | null;
  titulo: string;
  numeracao: string | null;
  linha_inicio: number;
  linha_fim: number;
  texto: string;
}

/**
 * Grava as seções de um PPC (com o FTS: tokens, radicais e expansão do léxico pelo tipo) e as
 * citações normativas do texto, cada uma com a seção e o papel. É o mesmo caminho da compilação do
 * banco e do banco em memória de um PPC fora da base (`ppc-avulso.ts`).
 */
export function gravarSecoesECitacoes(
  ins: Inseridor,
  p: {
    ppcId: string;
    caminhoMd: string;
    markdown: string;
    secoes: readonly SecaoParaGravar[];
    registro: Registro;
    lexico: Sinonimos;
    /** Cache da expansão por tipo de seção, compartilhado entre PPCs. */
    expansoes: Map<string, string>;
    insFts: NodeSqlite.StatementSync;
  },
): void {
  const linhas = p.markdown.split("\n");
  for (const secao of p.secoes) {
    let linhaTexto = secao.linha_inicio + 1;
    while (linhaTexto < secao.linha_fim && !linhas[linhaTexto - 1]!.trim()) linhaTexto += 1;
    const rowid = ins.inserir("secoes", {
      id: secao.id,
      ppc_id: p.ppcId,
      tipo: secao.tipo,
      origem_tipo: secao.origem_tipo,
      titulo: secao.titulo,
      numeracao: secao.numeracao,
      path: p.caminhoMd,
      linha_inicio: secao.linha_inicio,
      linha_fim: secao.linha_fim,
      linha_texto: linhaTexto,
      texto: secao.texto,
    });
    let expansao = p.expansoes.get(secao.tipo);
    if (expansao === undefined) {
      expansao = radicais(expansaoDoTipo(p.lexico, secao.tipo)).join(" ");
      p.expansoes.set(secao.tipo, expansao);
    }
    p.insFts.run(
      rowid,
      secao.titulo,
      secao.texto,
      radicais(secao.titulo).join(" "),
      radicais(secao.texto).join(" "),
      expansao,
    );
  }

  const secaoDaLinha = (linha: number) => {
    let achada: SecaoParaGravar | null = null;
    for (const s of p.secoes) {
      if (s.linha_inicio > linha) break;
      if (linha <= s.linha_fim) achada = s;
    }
    return achada;
  };
  const citacoes = extrairCitacoes(mascararFrontMatter(p.markdown), p.registro);
  citacoes.forEach((citacao, ordem) => {
    const secao = secaoDaLinha(citacao.linha);
    const dispositivos = citacao.dispositivos ?? (citacao.dispositivoId ? [citacao.dispositivoId] : []);
    ins.inserir("citacoes", {
      ppc_id: p.ppcId,
      ordem,
      linha: citacao.linha,
      trecho: citacao.trecho,
      norma_id: citacao.id,
      dispositivos_json: json(dispositivos),
      regra: citacao.regra,
      confianca: citacao.confianca,
      situacao: citacao.situacao,
      secao_id: secao?.id ?? null,
      secao_tipo: secao?.tipo ?? null,
      papel: papelDaCitacao(
        linhas,
        citacao.linha,
        secao ? { tipo: secao.tipo, linha_inicio: secao.linha_inicio } : null,
      ),
      path: p.caminhoMd,
    });
  });
}

function linhaNoYaml(conteudo: string, id: string): number {
  const linhas = conteudo.split("\n");
  const indice = linhas.findIndex((l) => l.trim() === `- id: ${id}`);
  return indice === -1 ? 1 : indice + 1;
}

/** O que a compilação precisa antes de abrir o banco: fontes lidas e a impressão digital delas. */
export interface PreparoCompilacao {
  readonly destino: string;
  /** Instante anterior à leitura das fontes, em milissegundos (vira o mtime do banco no fim). */
  readonly leitura: number;
  readonly contexto: ContextoPreenchimento;
}

/**
 * Lê as fontes e calcula a impressão digital. `leitura` é o instante anterior à leitura: vira o mtime
 * do banco no fim, para que uma fonte editada durante a compilação fique mais nova que ele e o atalho
 * por mtime de `estadoDoBanco` não o declare fresco.
 */
export function prepararCompilacao(
  opcoes: OpcoesCompilacao & { raiz: string; destino: string },
  leitura: number,
): PreparoCompilacao {
  const raiz = opcoes.raiz;
  const arquivos = arquivosFonte(raiz);
  const fontesSha = hashConteudo(raiz, arquivos);
  return {
    destino: opcoes.destino,
    leitura,
    contexto: {
      raiz,
      base: noCheckout(raiz, CAMINHOS.base),
      lexico: opcoes.sinonimos ?? lerSinonimos(raiz),
      topicosSecoes: opcoes.topicosSecoes ?? lerTopicosSecoes(raiz),
      arquivos,
      fontesSha,
      versao: opcoes.versao,
      commit: opcoes.commit,
      canal: opcoes.canal,
    },
  };
}

/** Resumo de uma compilação (o que `pnpm kb:compilar` imprime). */
export function resumoCompilacao(
  preparo: PreparoCompilacao,
  contagensInsercao: Record<string, number>,
): ResumoCompilacao {
  const contagens = Object.fromEntries(
    Object.entries(contagensInsercao)
      .filter(([tabela]) => tabela !== "meta")
      .sort(([a], [b]) => compararTexto(a, b)),
  );
  return {
    destino: preparo.destino,
    fontes: preparo.contexto.arquivos.length,
    fontes_sha256: preparo.contexto.fontesSha,
    contagens,
  };
}

export interface ContextoPreenchimento {
  raiz: string;
  base: string;
  lexico: Sinonimos;
  topicosSecoes: ReturnType<typeof lerTopicosSecoes>;
  arquivos: readonly string[];
  fontesSha: string;
  /** Identificação da distribuição gravada em `meta` (só quando informada). */
  versao?: string | undefined;
  commit?: string | undefined;
  canal?: Canal | undefined;
}

/** Esquema, carga de todas as tabelas, `optimize` do FTS5 e `VACUUM`; devolve as contagens por tabela. */
export function preencherBanco(db: NodeSqlite.DatabaseSync, c: ContextoPreenchimento): Record<string, number> {
  const { raiz, base, lexico, topicosSecoes, arquivos, fontesSha } = c;
  db.exec(`PRAGMA page_size = ${PAGE_SIZE}`);
  db.exec("PRAGMA journal_mode = OFF");
  db.exec("PRAGMA synchronous = OFF");
  db.exec("PRAGMA encoding = 'UTF-8'");
  db.exec(`PRAGMA user_version = ${VERSAO_ESQUEMA}`);
  db.exec(DDL);
  const ins = new Inseridor(db);

  emTransacao(db, () => {
    /* ---------- normas */
    const registro = carregarRegistro(raiz);
    const insFtsNorma = db.prepare("INSERT INTO normas_fts (rowid, titulo, texto, radicais) VALUES (?, ?, ?, ?)");
    const blocoMetadados = (
      id: string,
      titulo: string,
      partes: (string | undefined)[],
      caminho: string,
      linha: number,
    ) => {
      const texto = partes.filter((p): p is string => Boolean(p)).join("\n");
      const rowid = ins.inserir("normas_metadados", { norma_id: id, texto, path: caminho, linha });
      insFtsNorma.run(rowid, titulo, texto, radicais(`${titulo}\n${texto}`).join(" "));
    };
    for (const norma of [...listarNormas(raiz)].sort((a, b) => compararTexto(a.id, b.id))) {
      const caminhoMd = `${CAMINHOS.base}/${norma.path}`;
      const md = NodeFS.readFileSync(norma.arquivo, "utf-8").replace(/\r\n?/g, "\n");
      const { meta } = analisarFrontMatter(md, caminhoMd);
      const item = normaDoFrontMatter(meta, caminhoMd);
      ins.inserir("normas", {
        id: item.id,
        situacao: "base",
        titulo: item.title,
        tipo_documento: item.tipo_documento,
        numero: item.numero,
        ano: item.ano,
        orgao: item.orgao,
        jurisdicao: item.jurisdicao,
        data_publicacao: item.data_publicacao,
        status_vigencia: item.status_vigencia,
        status_fonte: null,
        ementa: item.ementa,
        fonte_url: item.fonte_url ?? null,
        fonte_referencia: item.fonte_referencia ?? null,
        curadoria: null,
        path: caminhoMd,
        aliases_json: json(item.aliases ?? []),
        keywords_json: json(item.keywords),
        front_matter_json: json(meta),
      });
      ins.inserir("documentos", { path: caminhoMd, texto: md });
      blocoMetadados(
        item.id,
        item.title,
        [...(item.aliases ?? []), ...item.keywords, item.ementa, ...listaDeTextos(meta, "pontos_chave")],
        caminhoMd,
        1,
      );
    }
    const arquivoStubs = caminhoStubs(raiz);
    if (NodeFS.existsSync(arquivoStubs)) {
      const conteudo = NodeFS.readFileSync(arquivoStubs, "utf-8");
      const stubs = lerRegistroStubs(arquivoStubs);
      const caminho = NodePath.relative(raiz, arquivoStubs).split(NodePath.sep).join("/");
      const todos = [
        ...stubs.normas.map((s) => ({ ...s, situacao: "stub" as const, ementa: s.ementa })),
        ...stubs.externos.map((s) => ({ ...s, situacao: "externo" as const, ementa: s.descricao })),
      ].sort((a, b) => compararTexto(a.id, b.id));
      for (const stub of todos) {
        // o stub não registra tipo, órgão, número nem ano: saem do ID (o `externo:` fica sem eles)
        const doId = metadadosDoIdNorma(stub.id);
        ins.inserir("normas", {
          id: stub.id,
          situacao: stub.situacao,
          titulo: stub.title,
          tipo_documento: doId?.tipo_documento ?? null,
          numero: doId?.numero ?? null,
          ano: doId?.ano ?? null,
          orgao: doId?.orgao ?? null,
          jurisdicao: doId?.jurisdicao ?? null,
          data_publicacao: "data_publicacao" in stub ? stub.data_publicacao : null,
          status_vigencia: "status_vigencia" in stub ? stub.status_vigencia : null,
          status_fonte: "status_fonte" in stub ? stub.status_fonte : null,
          ementa: stub.ementa,
          fonte_url: stub.fonte_url ?? null,
          fonte_referencia: stub.fonte_referencia ?? null,
          curadoria: stub.curadoria,
          path: null,
          aliases_json: json(stub.aliases ?? []),
          keywords_json: json([]),
          front_matter_json: null,
        });
        blocoMetadados(
          stub.id,
          stub.title,
          [...(stub.aliases ?? []), stub.ementa],
          caminho,
          linhaNoYaml(conteudo, stub.id),
        );
      }
    }

    /* ---------- institucional */
    const dados = carregarDadosInstitucionaisKb(raiz);
    for (const { arquivo, dados: c } of dados.campi) {
      ins.inserir("campi", {
        id: `campus:${c.campus_id}`,
        campus_id: c.campus_id,
        nome: c.nome,
        site: c.site,
        calendario_academico: c.calendario_academico,
        horarios_url: c.horarios_url,
        horarios_coletado_em: c.horarios_coletado_em,
        path: arquivo,
      });
    }
    for (const { arquivo, dados: c } of dados.conselhos) {
      ins.inserir("conselhos", {
        id: c.conselho_id,
        sigla: c.sigla,
        nome: c.nome,
        situacao: c.situacao,
        pagina_oficial: c.pagina_oficial,
        path: arquivo,
      });
    }
    for (const { arquivo, conteudo, dados: r } of dados.reunioes) {
      ins.inserir("conselhos_reunioes", {
        id: r.reuniao_id,
        conselho_id: r.conselho_id,
        data: r.data,
        titulo: r.titulo,
        tipo: r.tipo,
        situacao: r.situacao,
        fonte: r.fonte,
        path: arquivo,
      });
      r.documentos.forEach((d, ordem) => {
        ins.inserir("conselhos_documentos", {
          reuniao_id: r.reuniao_id,
          ordem,
          documento_id: d.documento_id,
          tipo: d.tipo,
          titulo: d.titulo,
          numero: d.numero,
          ano: d.ano,
          data: d.data,
          resumo: d.resumo,
          url: d.url,
          path: arquivo,
          linha: linhaDoValor(conteudo, "documento_id", d.documento_id),
        });
      });
      // a ordem é a oficial da pauta (`ordem` do item), não a posição no arquivo
      for (const i of r.itens_pauta) {
        ins.inserir("conselhos_itens", {
          reuniao_id: r.reuniao_id,
          ordem: i.ordem,
          item_id: i.item_id,
          titulo: i.titulo,
          resumo: i.resumo,
          tipo_demanda: i.tipo_demanda,
          resultado: i.resultado,
          documento_id: i.documento_id,
          processo_sei: i.processo_sei,
          campus_texto: i.campus_texto,
          campus_id: i.campus_id,
          curso_texto: i.curso_texto,
          curso_id: i.curso_id,
          palavras_chave_json: json(i.palavras_chave ?? []),
          path: arquivo,
          linha: linhaDoValor(conteudo, "item_id", i.item_id),
        });
      }
    }
    const cnct = decodificarCnctIndice(lerJson(noCheckout(raiz, CAMINHOS.indiceCnct)));
    for (const item of [...cnct.items].sort((a, b) => compararTexto(a.id, b.id))) {
      const caminho = item.path ? `${CAMINHOS.base}/${item.path}` : null;
      const completo =
        caminho && NodeFS.existsSync(NodePath.join(raiz, caminho)) ? lerJson(NodePath.join(raiz, caminho)) : item;
      ins.inserir("cnct", {
        id: `cnct:${item.id}`,
        slug: item.id,
        denominacao: item.denominacao,
        eixo_tecnologico: item.eixo_tecnologico,
        area_tecnologica: item.area_tecnologica,
        carga_horaria_minima_h: item.carga_horaria_minima_horas,
        path: caminho,
        dados_json: json(completo),
      });
    }

    const indice = decodificarIndicePpcs(lerJson(noCheckout(raiz, CAMINHOS.indicePpcs)));
    const itensPpc = itensPorId(indice);
    const ppcPorPath = new Map(itensPpc.map((item) => [item.path, item]));
    const idsCursos = new Set(dados.cursos.map(({ dados: c }) => `curso:${c.campus_id}/${c.curso_slug}`));

    for (const { arquivo, conteudo, dados: c } of dados.cursos) {
      const id = `curso:${c.campus_id}/${c.curso_slug}`;
      const markdown = c.ppc?.markdown_path;
      const ppc = markdown ? ppcPorPath.get(markdown) : undefined;
      ins.inserir("cursos", {
        id,
        campus_id: c.campus_id,
        curso_slug: c.curso_slug,
        nome: c.nome,
        nivel: c.nivel,
        forma_oferta: c.forma_oferta,
        modalidade: c.modalidade,
        situacao: c.situacao,
        pagina_oficial: c.pagina_oficial,
        cnct_id: c.cnct_id,
        cnct_ausencia: c.cnct_ausencia,
        suap_id: c.suap?.id,
        suap_codigo: c.suap?.codigo,
        suap_vagas: c.suap?.vagas,
        suap_matrizes_situacao: c.suap?.matrizes?.situacao,
        suap_ch_comum_h: c.suap?.matrizes?.carga_horaria_comum_h,
        ppc_id: ppc ? `ppc:${ppc.id}` : null,
        ppc_url: c.ppc?.url,
        ppc_markdown_path: markdown,
        ppc_ano_documento: ppc?.ano_documento,
        path: arquivo,
      });
      const resumo = c.suap?.matrizes?.resumo;
      if (resumo) {
        const linha = linhaDaChave(conteudo, "resumo");
        for (const m of matrizesDoResumo(resumo)) {
          ins.inserir("suap_matrizes", {
            curso_id: id,
            ordem: m.ordem,
            matriz_id: m.matriz_id,
            descricao: m.descricao,
            ano: m.ano,
            ch_exibida_h: m.ch_exibida_h,
            estagio_exigido: m.estagio_exigido,
            ch_estagio_h: m.ch_estagio_h,
            trecho: m.trecho,
            path: arquivo,
            linha,
          });
        }
      }
    }
    for (const { arquivo, dados: p } of dados.processos) {
      ins.inserir("processos", {
        id: p.processo_seletivo_id,
        nome: p.nome,
        ano_ingresso: p.ano_ingresso,
        status_curadoria: p.status_curadoria,
        path: arquivo,
      });
    }
    for (const { arquivo, dados: e } of dados.editais) {
      ins.inserir("editais", {
        id: e.edital_id,
        titulo: e.titulo,
        url: e.url,
        numero: e.numero,
        ano: e.ano,
        tipo: e.tipo,
        processos_json: json(e.processos),
        path: arquivo,
      });
    }
    // o mesmo oferta_id aparece em processos diferentes: a chave é o caminho (processo/oferta)
    const chaveOferta = (arquivo: string) =>
      arquivo.slice(`${CAMINHOS.institucional}/ofertas/`.length).replace(/\.json$/, "");
    const ofertas = [...dados.ofertas].sort((a, b) => compararTexto(chaveOferta(a.arquivo), chaveOferta(b.arquivo)));
    for (const { arquivo, conteudo, dados: o } of ofertas) {
      ins.inserir("ofertas", {
        id: chaveOferta(arquivo),
        oferta_id: o.oferta_id,
        curso_nome: o.curso_nome,
        tipo_oferta: o.tipo_oferta,
        vagas: o.vagas,
        // No banco, `turno` é o enum e `turno_original` a grafia (nos dados: turno_padronizado e turno).
        turno: o.turno_padronizado,
        turno_original: o.turno,
        turno_nota: o.turno_nota,
        modalidade: o.modalidade,
        status_curadoria: o.status_curadoria,
        campus_id: o.campi?.[0] ?? o.campus_id_original,
        url_fonte: o.url_fonte,
        pagina_fonte: o.pagina_fonte,
        trecho_fonte: o.trecho_fonte,
        editais_json: json(o.editais ?? []),
        path: arquivo,
        linha_turno: linhaDaChave(conteudo, "turno_padronizado"),
      });
      for (const processo of [...new Set(o.processos)].sort(compararTexto)) {
        ins.inserir("ofertas_processos", { oferta_id: chaveOferta(arquivo), processo_id: processo });
      }
      for (const curso of [...new Set(o.cursos ?? [])].sort(compararTexto)) {
        ins.inserir("ofertas_cursos", { oferta_id: chaveOferta(arquivo), curso_id: `curso:${curso}` });
      }
    }

    /* ---------- PPCs, seções, citações e fatos */
    const secoesPorPath = new Map<string, SecaoJsonl[]>();
    for (const tipo of Object.keys(indice.secoes.paths).sort(compararTexto)) {
      const arquivo = NodePath.join(base, indice.secoes.paths[tipo]!);
      for (const linha of NodeFS.readFileSync(arquivo, "utf-8").split("\n")) {
        if (!linha.trim()) continue;
        const secao = decodificarSecaoJsonl(JSON.parse(linha));
        const lista = secoesPorPath.get(secao.path) ?? [];
        lista.push(secao);
        secoesPorPath.set(secao.path, lista);
      }
    }
    const cursoDados = new Map(dados.cursos.map((r) => [`curso:${r.dados.campus_id}/${r.dados.curso_slug}`, r]));
    const insFtsSecao = db.prepare(
      "INSERT INTO secoes_fts (rowid, titulo, texto, titulo_radicais, radicais, expansao) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const expansoes = new Map<string, string>();
    const cache = new Map<string, string>();
    for (const item of itensPpc) {
      const caminhoMd = `${CAMINHOS.base}/${item.path}`;
      const bruto = NodeFS.readFileSync(NodePath.join(raiz, caminhoMd), "utf-8");
      const markdown = bruto.replace(/\r\n?/g, "\n");
      cache.clear();
      cache.set(item.path, markdown);
      const linhas = markdown.split("\n");
      const ppcId = `ppc:${item.id}`;
      const idCurso = `curso:${item.campus_id}/${item.curso_slug}`;
      const cursoId = idsCursos.has(idCurso) ? idCurso : null;
      ins.inserir("ppcs", {
        id: ppcId,
        chave: item.id,
        chave_curso: `${item.campus_id}/${item.curso_slug}`,
        versao: item.versao,
        vigente: item.vigente ? 1 : 0,
        substituido_por: item.substituido_por ? `ppc:${item.substituido_por}` : null,
        campus_id: item.campus_id,
        campus_nome: item.campus_nome,
        curso_slug: item.curso_slug,
        curso_nome: item.curso_nome,
        curso_id: cursoId,
        nivel: item.nivel,
        taxonomia: item.taxonomia,
        tipo_oferta: item.tipo_oferta,
        ano_documento: item.ano_documento,
        curso_url: item.curso_url,
        fonte_pdf: item.fonte_pdf,
        path: caminhoMd,
        linhas: linhas.length,
        caracteres: bruto.length,
        proveniencia_json: json(item.proveniencia ?? null),
      });
      ins.inserir("documentos", { path: caminhoMd, texto: markdown });

      const secoes = [...(secoesPorPath.get(item.path) ?? [])].sort(
        (a, b) => a.linha_inicio - b.linha_inicio || compararTexto(a.id, b.id),
      );
      gravarSecoesECitacoes(ins, {
        ppcId,
        caminhoMd,
        markdown,
        secoes: secoes.map((secao) => ({
          id: secao.id,
          tipo: secao.section_kind,
          origem_tipo: secao.origem_tipo ?? null,
          titulo: secao.heading,
          numeracao: secao.numeracao ?? null,
          linha_inicio: secao.linha_inicio,
          linha_fim: secao.linha_fim,
          texto: lerTextoSecao(secao, { raiz, cache }),
        })),
        registro,
        lexico,
        expansoes,
        insFts: insFtsSecao,
      });

      const fatos = extrairFatosPpc(
        markdown,
        secoes.map((s): SecaoDoPpc => ({ tipo: s.section_kind, linha_inicio: s.linha_inicio, linha_fim: s.linha_fim })),
      );
      // O cruzamento com o SUAP vale para o PPC vigente: o registro do curso descreve ele.
      const curso = cursoId && item.vigente ? cursoDados.get(cursoId) : undefined;
      for (const fato of fatos) {
        ins.inserir("ppc_fatos", {
          ppc_id: ppcId,
          fato: fato.fato,
          valor: fato.valor,
          valor_num: fato.valor_num,
          unidade: fato.unidade,
          status_curadoria: fato.status_curadoria,
          regra: fato.regra,
          trecho_fonte: fato.trecho_fonte,
          path: caminhoMd,
          linha: fato.linha,
          alternativas_json: json(fato.alternativas),
        });
      }
      // O ano do documento vem do front matter, com a evidência literal que o validar_base confere.
      const ano = item.ano_documento;
      ins.inserir("ppc_fatos", {
        ppc_id: ppcId,
        fato: "ano_documento",
        valor: String(ano),
        valor_num: ano,
        unidade: null,
        status_curadoria: "Revisado",
        regra: item.ano_fonte === FONTE_TEXTO ? "evidencia-no-texto" : "evidencia-na-fonte",
        trecho_fonte: item.ano_evidencia,
        path: caminhoMd,
        linha: linhaDaEvidenciaAno(markdown, item.ano_evidencia, item.ano_fonte),
        alternativas_json: json([]),
      });
      if (curso) {
        const valor = (nome: string) => fatos.find((f) => f.fato === nome);
        const resumo = curso.dados.suap?.matrizes?.resumo;
        const cruzamento = cruzarPpcSuap({
          chPpc: valor("carga_horaria_total_h")?.valor_num ?? null,
          chPpcEmHoraAula: valor("carga_horaria_total_h")?.regra.endsWith("-aula") ?? false,
          estagioObrigatorio: (valor("estagio_obrigatorio")?.valor as "sim" | "nao" | undefined) ?? null,
          estagioCargaH: valor("estagio_carga_h")?.valor_num ?? null,
          estagioCargaEmHoraAula: valor("estagio_carga_h")?.regra.endsWith("-aula") ?? false,
          anoPpc: ano ?? null,
          chComumSuap: curso.dados.suap?.matrizes?.carga_horaria_comum_h ?? null,
          matrizes: resumo ? matrizesDoResumo(resumo) : [],
        });
        for (const linha of cruzamento) ins.inserir("ppc_suap", { ppc_id: ppcId, ...linha });
      }
    }

    /* ---------- fichas, tópicos e marcos da revisão de PPC */
    const dirFichas = noCheckout(raiz, CAMINHOS.fichas);
    const arquivosFichas = NodeFS.existsSync(dirFichas)
      ? NodeFS.readdirSync(dirFichas)
          .filter((nome) => nome.endsWith(".json"))
          .sort(compararTexto)
      : [];
    const fichas = arquivosFichas
      .map((nome) => {
        const bruto = lerJson(NodePath.join(dirFichas, nome));
        return { nome, bruto, ficha: decodificarFicha(bruto) };
      })
      .sort((a, b) => compararTexto(a.ficha.id, b.ficha.id));
    const fichaTopico = new Set<string>();
    for (const { nome, bruto, ficha } of fichas) {
      ins.inserir("fichas", {
        id: ficha.id,
        titulo: ficha.titulo,
        dominio: ficha.dominio,
        criticidade: ficha.criticidade,
        tipo_escopo: ficha.tipo_escopo,
        pergunta: ficha.pergunta,
        rubrica: ficha.rubrica,
        path: `${CAMINHOS.fichas}/${nome}`,
        dados_json: json(ficha),
        arquivo_json: json(bruto),
      });
      (ficha.referencias_normativas ?? []).forEach((ref, ordem) => {
        ins.inserir("fichas_referencias", {
          ficha_id: ficha.id,
          ordem,
          ref: ref.ref,
          dispositivo: ref.dispositivo,
          papel: ref.papel,
          nota: ref.nota,
        });
      });
      for (const topico of ficha.topicos_tematicos ?? []) fichaTopico.add(`${ficha.id}\0${topico}`);
    }
    const arquivoTopicos = noCheckout(raiz, CAMINHOS.topicosFichas);
    if (NodeFS.existsSync(arquivoTopicos)) {
      const bruto = lerJson(arquivoTopicos);
      const brutos = decodificarTopicosBrutos(bruto).topicos;
      const topicos = decodificarTopicos(bruto).topicos.map((t, ordem) => ({ ...t, ordem, bruto: brutos[ordem] }));
      for (const t of [...topicos].sort((a, b) => compararTexto(a.id, b.id))) {
        ins.inserir("topicos", {
          id: t.id,
          ordem: t.ordem,
          titulo: t.titulo,
          grupo: t.grupo,
          tipo_escopo: t.tipo_escopo,
          descricao: t.descricao,
          termos_json: json({ aliases_titulo: t.aliases_titulo ?? [], termos_busca: t.termos_busca ?? [] }),
          path: CAMINHOS.topicosFichas,
          dados_json: json(t.bruto),
        });
        for (const ficha of t.fichas ?? []) fichaTopico.add(`${ficha}\0${t.id}`);
      }
    }
    for (const par of [...fichaTopico].sort(compararTexto)) {
      const [ficha, topico] = par.split("\0") as [string, string];
      ins.inserir("fichas_topicos", { ficha_id: ficha, topico_id: topico });
    }
    Object.entries(topicosSecoes).forEach(([topico, tipos], ordem) => {
      ins.inserir("topicos_secoes", {
        ordem,
        topico,
        tipos_json: json(tipos),
        path: CAMINHOS.topicosSecoes,
      });
    });

    // os textos que o impacto percorre além das fichas, na ordem do caminho
    for (const relativo of [CAMINHOS.marcos, CAMINHOS.topicosFichas]) {
      const arquivo = noCheckout(raiz, relativo);
      if (NodeFS.existsSync(arquivo)) {
        ins.inserir("revisao_ppc_arquivos", { path: relativo, arquivo_json: json(lerJson(arquivo)) });
      }
    }

    /* ---------- léxico da busca de seções */
    Object.entries(lexico.tipos).forEach(([tipo, termos], ordem) => {
      ins.inserir("sinonimos_tipos", { ordem, tipo, termos_json: json(termos) });
    });
    lexico.grupos.forEach((termos, ordem) => ins.inserir("sinonimos_grupos", { ordem, termos_json: json(termos) }));
    // marcos-normativos.json guarda a linha do tema; vigente, substituídas, antecessoras e
    // dispositivos revogados vêm de derivarLinha na data_referencia, como na validação das fichas.
    const arquivoMarcos = noCheckout(raiz, CAMINHOS.marcos);
    if (NodeFS.existsSync(arquivoMarcos)) {
      const marcos = decodificarMarcos(lerJson(arquivoMarcos));
      const referencia = dataReferencia(raiz);
      for (const m of [...marcos.marcos].sort((a, b) => compararTexto(a.id, b.id))) {
        const derivado = derivarLinha(m.linha, referencia, {
          datas: carregarDatas(raiz),
          relacoes: carregarRelacoes(raiz),
        });
        ins.inserir("marcos", {
          id: m.id,
          tema: m.tema,
          vigente: derivado.vigente,
          aplica_a: m.aplica_a,
          transicao: m.transicao,
          orientacao_analise: m.orientacao_analise,
          normas_json: json({ linha: m.linha, data_referencia: referencia, ...derivado }),
          path: CAMINHOS.marcos,
          dados_json: json(m),
        });
      }
    }

    /* ---------- dispositivos (com FTS), relações, vigências, transições, correspondências */
    const insFtsDispositivo = db.prepare("INSERT INTO dispositivos_fts (rowid, texto, radicais) VALUES (?, ?, ?)");
    for (const { caput, estrutura, notas, ...d } of linhasDispositivos(raiz)) {
      const rowid = ins.inserir("dispositivos", {
        ...d,
        caput_json: json(caput),
        estrutura_json: json(estrutura),
        notas_json: json(notas),
      });
      insFtsDispositivo.run(rowid, d.texto_com_caput, radicais(d.texto_com_caput).join(" "));
    }
    for (const linha of linhasRelacoes(raiz)) ins.inserir("relacoes", linha);
    for (const linha of linhasVigencias(raiz)) ins.inserir("vigencias", linha);
    for (const linha of linhasTransicoes(raiz)) ins.inserir("transicoes", linha);
    for (const linha of linhasTabelasCorrespondencia(raiz)) {
      ins.inserir("correspondencias_tabelas", linha);
    }
    for (const { destino, ...c } of linhasCorrespondencias(raiz)) {
      ins.inserir("correspondencias", { ...c, destino_json: json(destino) });
    }
    // citações entre normas (para o impacto): as mesmas que o impacto extrai dos arquivos
    for (const segmento of segmentosCitantes(registro, raiz)) {
      for (const citacao of segmento.citacoes) {
        ins.inserir("normas_citacoes", {
          norma_id: segmento.norma,
          segmento: segmento.segmento,
          citado_id: citacao.id,
          dispositivos_json: json(citacao.dispositivos),
          trecho: citacao.trecho,
          path: segmento.path,
          linha_inicio: segmento.linha_inicio,
        });
      }
    }

    /* ---------- meta */
    const meta: [string, string][] = [
      ["versao_esquema", String(VERSAO_ESQUEMA)],
      // data declarada em base-conhecimento/config/vigencia.yaml (fonte), não o relógio
      ["data_referencia", dataReferencia(raiz)],
      ["fontes_sha256", fontesSha],
      ["fontes_lista_sha256", hashLista(arquivos)],
      ["fontes_total", String(arquivos.length)],
      [
        "contagens_json",
        json(Object.fromEntries(Object.entries(ins.contagens).sort(([a], [b]) => compararTexto(a, b)))),
      ],
    ];
    for (const chave of ["versao", "commit", "canal"] as const) {
      const valor = c[chave];
      if (valor !== undefined) meta.push([chave, valor]);
    }
    for (const [chave, valor] of meta) ins.inserir("meta", { chave, valor });
  });

  db.exec("INSERT INTO normas_fts(normas_fts) VALUES ('optimize')");
  db.exec("INSERT INTO secoes_fts(secoes_fts) VALUES ('optimize')");
  db.exec("INSERT INTO dispositivos_fts(dispositivos_fts) VALUES ('optimize')");
  db.exec("VACUUM");
  return ins.contagens;
}
