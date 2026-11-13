#!/usr/bin/env bun
/**
 * Compila o `kb.sqlite` a partir dos arquivos do checkout (fase 6 do plano).
 *
 *   bun run kb:compilar [--destino tmp/kb.sqlite]
 *
 * O banco é derivado e fica fora do git (`tmp/`). Determinismo: as mesmas fontes geram o mesmo
 * arquivo, byte a byte. Para isso:
 * - toda leitura é ordenada por code point (caminhos, IDs) e os `rowid` saem dessa ordem;
 * - nada vem do relógio (nem a data do build: `meta` guarda só versão do esquema e hashes das fontes);
 * - `page_size` fixo, um único `INSERT` por linha numa transação, `optimize` do FTS5 e `VACUUM` no
 *   fim, que reescreve as páginas na ordem lógica e zera o espaço livre;
 * - o arquivo é escrito num temporário e renomeado (quem lê nunca vê um banco pela metade).
 * O teste `compilar.test.ts` compila duas vezes e compara o SHA-256 dos arquivos.
 */
import { Database, type Statement } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { expansaoDoTipo, lerSinonimos, type Sinonimos } from "../busca/sinonimos.ts";
import { radicais } from "../busca/tokens.ts";
import { cruzarPpcSuap } from "../fatos/divergencias.ts";
import { extrairFatosPpc, type SecaoDoPpc } from "../fatos/ppc.ts";
import { carregarDadosInstitucionaisKb, linhaDaChave, matrizesDoResumo } from "../institucional/dados.ts";
import { analisarFrontMatter } from "../normas/front-matter.ts";
import { idDoAto } from "../normas/ids.ts";
import { caminhoStubs, carregarRegistro, lerRegistroStubs, raizRepositorio } from "../normas/registro.ts";
import { extrairCitacoes } from "../normas/resolver.ts";
import { mascararFrontMatter } from "../ppcs/front-matter.ts";
import { lerTextoSecao } from "../ppcs/citacoes.ts";
import { compararTexto } from "../texto.ts";
import { DDL, VERSAO_ESQUEMA } from "./esquema.ts";
import { arquivosFonte, hashConteudo, hashLista } from "./fontes.ts";
import {
  esquemaLinhaCorrespondencia,
  esquemaLinhaDispositivo,
  esquemaLinhaRelacao,
  esquemaLinhaTransicao,
  esquemaLinhaVigencia,
  type FontesNormativas,
  fontesNormativasVazias,
} from "./fontes-normativas.ts";
import { blocosDaNorma } from "./normas-blocos.ts";

/** Implementação padrão das fontes da fase 5 (troque aqui ao ligar os módulos de `normas/`). */
export const fontesNormativasPadrao: FontesNormativas = fontesNormativasVazias;

export const PAGE_SIZE = 4096;

export function caminhoBancoPadrao(raiz: string = raizRepositorio()): string {
  return process.env.KB_SQLITE ? path.resolve(process.env.KB_SQLITE) : path.join(raiz, "tmp", "kb.sqlite");
}

export interface OpcoesCompilacao {
  raiz?: string;
  destino?: string;
  fontesNormativas?: FontesNormativas;
  /** Léxico de sinônimos (padrão: `packages/kb/dados/sinonimos.yaml`). */
  sinonimos?: Sinonimos;
}

export interface ResumoCompilacao {
  destino: string;
  fontes: number;
  fontes_sha256: string;
  contagens: Record<string, number>;
}

const BASE = "base-conhecimento";
const ANALISE = ".agents/skills/analise-ppc/base-analise";

const json = (valor: unknown): string => JSON.stringify(valor ?? null);

function lerJson(arquivo: string): unknown {
  return JSON.parse(readFileSync(arquivo, "utf-8"));
}

/* ---------------------------------------------------------- esquemas de leitura */

const esquemaManifest = z.array(
  z.looseObject({
    id: z.string(),
    title: z.string(),
    tipo_documento: z.string().optional(),
    numero: z.union([z.string(), z.number()]).optional(),
    ano: z.number().int().optional(),
    data_publicacao: z.string().optional(),
    orgao: z.string().optional(),
    jurisdicao: z.string().optional(),
    ementa: z.string().optional(),
    status_vigencia: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    aliases: z.array(z.string()).optional(),
    fonte: z.string().optional(),
    path: z.string(),
  }),
);

const esquemaIndicePpcs = z.looseObject({
  items: z.array(
    z.looseObject({
      id: z.string(),
      campus_id: z.string(),
      campus_nome: z.string(),
      curso_slug: z.string(),
      curso_nome: z.string(),
      nivel: z.string(),
      taxonomia: z.string().optional(),
      tipo_oferta: z.string(),
      curso_url: z.string().optional(),
      fonte_pdf: z.string().optional(),
      path: z.string(),
      proveniencia: z.unknown().optional(),
      ano_documento: z.number().int().optional(),
    }),
  ),
  secoes: z.looseObject({ paths: z.record(z.string(), z.string()) }),
});

const esquemaSecaoJsonl = z.looseObject({
  id: z.string(),
  ppc_id: z.string(),
  section_kind: z.string(),
  origem_tipo: z.string().optional(),
  heading: z.string(),
  numeracao: z.string().nullable().optional(),
  path: z.string(),
  linha_inicio: z.number().int(),
  linha_fim: z.number().int(),
});

const esquemaCnctIndice = z.looseObject({
  items: z.array(
    z.looseObject({
      id: z.string(),
      denominacao: z.string(),
      eixo_tecnologico: z.string(),
      area_tecnologica: z.string().optional(),
      carga_horaria_minima_horas: z.number().optional(),
      path: z.string().optional(),
    }),
  ),
});

const esquemaFicha = z.looseObject({
  id: z.string(),
  titulo: z.string(),
  dominio: z.string().optional(),
  criticidade: z.string().optional(),
  tipo_escopo: z.string().optional(),
  pergunta: z.string().optional(),
  rubrica: z.string().optional(),
  topicos_tematicos: z.array(z.string()).optional(),
  referencias_normativas: z
    .array(
      z.looseObject({
        ref: z.string(),
        dispositivo: z.string().optional(),
        papel: z.string(),
        nota: z.string().optional(),
      }),
    )
    .optional(),
});

const esquemaTopicos = z.looseObject({
  topicos: z.array(
    z.looseObject({
      id: z.string(),
      titulo: z.string(),
      grupo: z.string().optional(),
      tipo_escopo: z.string().optional(),
      descricao: z.string().optional(),
      aliases_titulo: z.array(z.string()).optional(),
      termos_busca: z.array(z.string()).optional(),
      fichas: z.array(z.string()).optional(),
    }),
  ),
});

const esquemaMarcos = z.looseObject({
  marcos: z.array(
    z.looseObject({
      id: z.string(),
      tema: z.string(),
      vigente: z.string(),
      aplica_a: z.string().optional(),
      substitui: z.array(z.string()).optional(),
      antecessoras_historicas: z.array(z.string()).optional(),
      dispositivos_revogados: z.array(z.string()).optional(),
      transicao: z.string().optional(),
      orientacao_analise: z.string().optional(),
    }),
  ),
});

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

class Inseridor {
  private readonly cache = new Map<string, Statement>();
  readonly contagens: Record<string, number> = {};
  constructor(private readonly db: Database) {}

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

function linhaNoYaml(conteudo: string, id: string): number {
  const linhas = conteudo.split("\n");
  const indice = linhas.findIndex((l) => l.trim() === `- id: ${id}`);
  return indice === -1 ? 1 : indice + 1;
}

export function compilarBanco(opcoes: OpcoesCompilacao = {}): ResumoCompilacao {
  const raiz = opcoes.raiz ?? raizRepositorio();
  const destino = opcoes.destino ?? caminhoBancoPadrao(raiz);
  const fontesNormativas = opcoes.fontesNormativas ?? fontesNormativasPadrao;
  const lexico = opcoes.sinonimos ?? lerSinonimos();
  const base = path.join(raiz, BASE);

  const arquivos = arquivosFonte(raiz);
  const fontesSha = hashConteudo(raiz, arquivos);

  mkdirSync(path.dirname(destino), { recursive: true });
  const temporario = `${destino}.tmp-${process.pid}`;
  rmSync(temporario, { force: true });
  const db = new Database(temporario, { create: true, strict: true });
  db.run(`PRAGMA page_size = ${PAGE_SIZE}`);
  db.run("PRAGMA journal_mode = OFF");
  db.run("PRAGMA synchronous = OFF");
  db.run("PRAGMA encoding = 'UTF-8'");
  db.run(`PRAGMA user_version = ${VERSAO_ESQUEMA}`);
  db.run(DDL);
  const ins = new Inseridor(db);

  db.transaction(() => {
    /* ---------- normas */
    const registro = carregarRegistro(raiz);
    const manifest = esquemaManifest.parse(lerJson(path.join(base, "manifest.json")));
    const insFtsNorma = db.prepare("INSERT INTO normas_fts (rowid, titulo, texto, radicais) VALUES (?, ?, ?, ?)");
    const blocoMetadados = (
      id: string,
      titulo: string,
      partes: (string | undefined)[],
      caminho: string,
      linha: number,
    ) => {
      const texto = partes.filter((p): p is string => Boolean(p)).join("\n");
      const rowid = ins.inserir("normas_blocos", {
        norma_id: id,
        ordem: -1,
        titulo,
        nivel: 0,
        caminho: "metadados",
        artigo: null,
        dispositivo: null,
        path: caminho,
        linha_inicio: linha,
        linha_fim: linha,
        texto,
      });
      insFtsNorma.run(rowid, titulo, texto, radicais(`${titulo}\n${texto}`).join(" "));
    };
    for (const item of [...manifest].sort((a, b) => compararTexto(a.id, b.id))) {
      const caminhoMd = `${BASE}/${item.path}`;
      const md = readFileSync(path.join(raiz, caminhoMd), "utf-8").replace(/\r\n?/g, "\n");
      const { meta } = analisarFrontMatter(md, caminhoMd);
      ins.inserir("normas", {
        id: item.id,
        situacao: "base",
        titulo: item.title,
        tipo_documento: item.tipo_documento,
        numero: item.numero === undefined ? null : String(item.numero),
        ano: item.ano,
        orgao: item.orgao,
        jurisdicao: item.jurisdicao,
        data_publicacao: item.data_publicacao,
        status_vigencia: item.status_vigencia,
        status_fonte: null,
        ementa: item.ementa,
        fonte: item.fonte,
        curadoria: null,
        path: caminhoMd,
        aliases_json: json(item.aliases ?? []),
        keywords_json: json(item.keywords ?? []),
        front_matter_json: json(meta),
      });
      blocoMetadados(
        item.id,
        item.title,
        [...(item.aliases ?? []), ...(item.keywords ?? []), item.ementa],
        caminhoMd,
        1,
      );
      for (const bloco of blocosDaNorma(md)) {
        const rowid = ins.inserir("normas_blocos", {
          norma_id: item.id,
          ordem: bloco.ordem,
          titulo: bloco.titulo,
          nivel: bloco.nivel,
          caminho: bloco.caminho,
          artigo: bloco.artigo,
          dispositivo: bloco.dispositivo,
          path: caminhoMd,
          linha_inicio: bloco.linha_inicio,
          linha_fim: bloco.linha_fim,
          texto: bloco.texto,
        });
        insFtsNorma.run(rowid, bloco.caminho, bloco.texto, radicais(`${bloco.caminho}\n${bloco.texto}`).join(" "));
      }
    }
    const arquivoStubs = caminhoStubs(raiz);
    if (existsSync(arquivoStubs)) {
      const conteudo = readFileSync(arquivoStubs, "utf-8");
      const stubs = lerRegistroStubs(arquivoStubs);
      const caminho = path.relative(raiz, arquivoStubs).split(path.sep).join("/");
      const todos = [
        ...stubs.normas.map((s) => ({ ...s, situacao: "stub" as const, ementa: s.ementa })),
        ...stubs.externos.map((s) => ({ ...s, situacao: "externo" as const, ementa: s.descricao })),
      ].sort((a, b) => compararTexto(a.id, b.id));
      for (const stub of todos) {
        ins.inserir("normas", {
          id: stub.id,
          situacao: stub.situacao,
          titulo: stub.title,
          data_publicacao: "data_publicacao" in stub ? stub.data_publicacao : null,
          status_vigencia: "status_vigencia" in stub ? stub.status_vigencia : null,
          status_fonte: "status_fonte" in stub ? stub.status_fonte : null,
          ementa: stub.ementa,
          fonte: stub.fonte,
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
        path: arquivo,
      });
    }
    const cnct = esquemaCnctIndice.parse(lerJson(path.join(base, "catalogos", "cnct", "index.json")));
    for (const item of [...cnct.items].sort((a, b) => compararTexto(a.id, b.id))) {
      const caminho = item.path ? `${BASE}/${item.path}` : null;
      const completo = caminho && existsSync(path.join(raiz, caminho)) ? lerJson(path.join(raiz, caminho)) : item;
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

    const indice = esquemaIndicePpcs.parse(lerJson(path.join(base, "institucional", "ifpr", "ppcs", "index.json")));
    const itensPpc = [...indice.items].sort((a, b) => compararTexto(a.id, b.id));
    const ppcPorPath = new Map(itensPpc.map((item) => [item.path, item]));
    const cursoPorPpcPath = new Map<string, string>();

    for (const { arquivo, conteudo, dados: c } of dados.cursos) {
      const id = `curso:${c.campus_id}/${c.curso_slug}`;
      const markdown = c.ppc?.markdown_path;
      const ppc = markdown ? ppcPorPath.get(markdown) : undefined;
      if (markdown && ppc) cursoPorPpcPath.set(markdown, id);
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
        ppc_ano_documento: c.ppc?.ano_documento,
        ppc_curadoria_ano: c.ppc?.curadoria_ano,
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
      arquivo.replace(/^dados\/institucional\/ofertas\//, "").replace(/\.json$/, "");
    const ofertas = [...dados.ofertas].sort((a, b) => compararTexto(chaveOferta(a.arquivo), chaveOferta(b.arquivo)));
    for (const { arquivo, conteudo, dados: o } of ofertas) {
      ins.inserir("ofertas", {
        id: chaveOferta(arquivo),
        oferta_id: o.oferta_id,
        curso_nome: o.curso_nome,
        tipo_oferta: o.tipo_oferta,
        vagas: o.vagas,
        turno: o.turno,
        turno_original: o.turno_original,
        turno_nota: o.turno_nota,
        modalidade: o.modalidade,
        status_curadoria: o.status_curadoria,
        campus_id: o.campi?.[0] ?? o.campus_id_original,
        url_fonte: o.url_fonte,
        pagina_fonte: o.pagina_fonte,
        trecho_fonte: o.trecho_fonte,
        editais_json: json(o.editais ?? []),
        path: arquivo,
        linha_turno: linhaDaChave(conteudo, "turno"),
      });
      for (const processo of [...new Set(o.processos)].sort(compararTexto)) {
        ins.inserir("ofertas_processos", { oferta_id: chaveOferta(arquivo), processo_id: processo });
      }
      for (const curso of [...new Set(o.cursos ?? [])].sort(compararTexto)) {
        ins.inserir("ofertas_cursos", { oferta_id: chaveOferta(arquivo), curso_id: `curso:${curso}` });
      }
    }

    /* ---------- PPCs, seções, citações e fatos */
    const secoesPorPath = new Map<string, z.output<typeof esquemaSecaoJsonl>[]>();
    for (const tipo of Object.keys(indice.secoes.paths).sort(compararTexto)) {
      const arquivo = path.join(base, indice.secoes.paths[tipo]!);
      for (const linha of readFileSync(arquivo, "utf-8").split("\n")) {
        if (!linha.trim()) continue;
        const secao = esquemaSecaoJsonl.parse(JSON.parse(linha));
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
      const caminhoMd = `${BASE}/${item.path}`;
      const markdown = readFileSync(path.join(raiz, caminhoMd), "utf-8").replace(/\r\n?/g, "\n");
      cache.clear();
      cache.set(item.path, markdown);
      const linhas = markdown.split("\n");
      const ppcId = `ppc:${item.id}`;
      const cursoId = cursoPorPpcPath.get(item.path) ?? null;
      ins.inserir("ppcs", {
        id: ppcId,
        chave: item.id,
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
        proveniencia_json: json(item.proveniencia ?? null),
      });

      const secoes = [...(secoesPorPath.get(item.path) ?? [])].sort(
        (a, b) => a.linha_inicio - b.linha_inicio || compararTexto(a.id, b.id),
      );
      for (const secao of secoes) {
        const texto = lerTextoSecao(secao, { raiz, cache });
        let linhaTexto = secao.linha_inicio + 1;
        while (linhaTexto < secao.linha_fim && !linhas[linhaTexto - 1]!.trim()) linhaTexto += 1;
        const rowid = ins.inserir("secoes", {
          id: secao.id,
          ppc_id: ppcId,
          tipo: secao.section_kind,
          origem_tipo: secao.origem_tipo,
          titulo: secao.heading,
          numeracao: secao.numeracao ?? null,
          path: caminhoMd,
          linha_inicio: secao.linha_inicio,
          linha_fim: secao.linha_fim,
          linha_texto: linhaTexto,
          texto,
        });
        let expansao = expansoes.get(secao.section_kind);
        if (expansao === undefined) {
          expansao = radicais(expansaoDoTipo(lexico, secao.section_kind)).join(" ");
          expansoes.set(secao.section_kind, expansao);
        }
        insFtsSecao.run(
          rowid,
          secao.heading,
          texto,
          radicais(secao.heading).join(" "),
          radicais(texto).join(" "),
          expansao,
        );
      }

      const secaoDaLinha = (linha: number) => {
        let achada: (typeof secoes)[number] | null = null;
        for (const s of secoes) {
          if (s.linha_inicio > linha) break;
          if (linha <= s.linha_fim) achada = s;
        }
        return achada;
      };
      const citacoes = extrairCitacoes(mascararFrontMatter(markdown), registro);
      citacoes.forEach((citacao, ordem) => {
        const secao = secaoDaLinha(citacao.linha);
        const dispositivos = citacao.dispositivos ?? (citacao.dispositivoId ? [citacao.dispositivoId] : []);
        ins.inserir("citacoes", {
          ppc_id: ppcId,
          ordem,
          linha: citacao.linha,
          trecho: citacao.trecho,
          norma_id: citacao.id,
          ato_id: citacao.id ? idDoAto(citacao.id) : null,
          dispositivos_json: json(dispositivos),
          regra: citacao.regra,
          confianca: citacao.confianca,
          situacao: citacao.situacao,
          secao_id: secao?.id ?? null,
          secao_tipo: secao?.section_kind ?? null,
          papel: papelDaCitacao(
            linhas,
            citacao.linha,
            secao ? { tipo: secao.section_kind, linha_inicio: secao.linha_inicio } : null,
          ),
          path: caminhoMd,
        });
      });

      const fatos = extrairFatosPpc(
        markdown,
        secoes.map((s): SecaoDoPpc => ({ tipo: s.section_kind, linha_inicio: s.linha_inicio, linha_fim: s.linha_fim })),
      );
      const curso = cursoId ? cursoDados.get(cursoId) : undefined;
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
      const ano = curso?.dados.ppc?.ano_documento;
      if (curso && ano !== undefined) {
        const linha = linhaDaChave(curso.conteudo, "ano_documento");
        ins.inserir("ppc_fatos", {
          ppc_id: ppcId,
          fato: "ano_documento",
          valor: String(ano),
          valor_num: ano,
          unidade: null,
          status_curadoria: curso.dados.ppc?.curadoria_ano ?? "registrado",
          regra: "dados-institucionais",
          trecho_fonte: curso.conteudo.split("\n")[linha - 1]!.trim(),
          path: curso.arquivo,
          linha,
          alternativas_json: json([]),
        });
      }
      if (curso) {
        const valor = (nome: string) => fatos.find((f) => f.fato === nome);
        const resumo = curso.dados.suap?.matrizes?.resumo;
        const cruzamento = cruzarPpcSuap({
          chPpc: valor("carga_horaria_total_h")?.valor_num ?? null,
          chPpcEmHoraAula: valor("carga_horaria_total_h")?.regra.endsWith("-aula") ?? false,
          estagioObrigatorio: (valor("estagio_obrigatorio")?.valor as "sim" | "nao" | undefined) ?? null,
          estagioCargaH: valor("estagio_carga_h")?.valor_num ?? null,
          anoPpc: ano ?? null,
          chComumSuap: curso.dados.suap?.matrizes?.carga_horaria_comum_h ?? null,
          matrizes: resumo ? matrizesDoResumo(resumo) : [],
        });
        for (const linha of cruzamento) ins.inserir("ppc_suap", { ppc_id: ppcId, ...linha });
      }
    }

    /* ---------- fichas, tópicos e marcos da analise-ppc */
    const dirFichas = path.join(raiz, ANALISE, "fichas");
    const arquivosFichas = existsSync(dirFichas)
      ? readdirSync(dirFichas)
          .filter((nome) => nome.endsWith(".json"))
          .sort(compararTexto)
      : [];
    const fichas = arquivosFichas
      .map((nome) => ({ nome, ficha: esquemaFicha.parse(lerJson(path.join(dirFichas, nome))) }))
      .sort((a, b) => compararTexto(a.ficha.id, b.ficha.id));
    const fichaTopico = new Set<string>();
    for (const { nome, ficha } of fichas) {
      ins.inserir("fichas", {
        id: ficha.id,
        titulo: ficha.titulo,
        dominio: ficha.dominio,
        criticidade: ficha.criticidade,
        tipo_escopo: ficha.tipo_escopo,
        pergunta: ficha.pergunta,
        rubrica: ficha.rubrica,
        path: `${ANALISE}/fichas/${nome}`,
        dados_json: json(ficha),
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
    const arquivoTopicos = path.join(raiz, ANALISE, "topicos-fichas.json");
    if (existsSync(arquivoTopicos)) {
      const topicos = esquemaTopicos.parse(lerJson(arquivoTopicos));
      for (const t of [...topicos.topicos].sort((a, b) => compararTexto(a.id, b.id))) {
        ins.inserir("topicos", {
          id: t.id,
          titulo: t.titulo,
          grupo: t.grupo,
          tipo_escopo: t.tipo_escopo,
          descricao: t.descricao,
          termos_json: json({ aliases_titulo: t.aliases_titulo ?? [], termos_busca: t.termos_busca ?? [] }),
          path: `${ANALISE}/topicos-fichas.json`,
        });
        for (const ficha of t.fichas ?? []) fichaTopico.add(`${ficha}\0${t.id}`);
      }
    }
    for (const par of [...fichaTopico].sort(compararTexto)) {
      const [ficha, topico] = par.split("\0") as [string, string];
      ins.inserir("fichas_topicos", { ficha_id: ficha, topico_id: topico });
    }
    const arquivoMarcos = path.join(raiz, ANALISE, "marcos-normativos.json");
    if (existsSync(arquivoMarcos)) {
      const marcos = esquemaMarcos.parse(lerJson(arquivoMarcos));
      for (const m of [...marcos.marcos].sort((a, b) => compararTexto(a.id, b.id))) {
        ins.inserir("marcos", {
          id: m.id,
          tema: m.tema,
          vigente: m.vigente,
          aplica_a: m.aplica_a,
          transicao: m.transicao,
          orientacao_analise: m.orientacao_analise,
          normas_json: json({
            vigente: m.vigente,
            substitui: m.substitui ?? [],
            antecessoras_historicas: m.antecessoras_historicas ?? [],
            dispositivos_revogados: m.dispositivos_revogados ?? [],
          }),
          path: `${ANALISE}/marcos-normativos.json`,
          dados_json: json(m),
        });
      }
    }

    /* ---------- fase 5 */
    for (const linha of fontesNormativas.dispositivos()) {
      const { notas, ...d } = esquemaLinhaDispositivo.parse(linha);
      ins.inserir("dispositivos", { ...d, notas_json: json(notas) });
    }
    for (const linha of fontesNormativas.relacoes()) ins.inserir("relacoes", esquemaLinhaRelacao.parse(linha));
    for (const linha of fontesNormativas.vigencias()) ins.inserir("vigencias", esquemaLinhaVigencia.parse(linha));
    for (const linha of fontesNormativas.transicoes()) ins.inserir("transicoes", esquemaLinhaTransicao.parse(linha));
    for (const linha of fontesNormativas.correspondencias()) {
      ins.inserir("correspondencias", esquemaLinhaCorrespondencia.parse(linha));
    }

    /* ---------- meta */
    const meta: [string, string][] = [
      ["versao_esquema", String(VERSAO_ESQUEMA)],
      ["fontes_sha256", fontesSha],
      ["fontes_lista_sha256", hashLista(arquivos)],
      ["fontes_total", String(arquivos.length)],
      [
        "contagens_json",
        json(Object.fromEntries(Object.entries(ins.contagens).sort(([a], [b]) => compararTexto(a, b)))),
      ],
    ];
    for (const [chave, valor] of meta) ins.inserir("meta", { chave, valor });
  })();

  db.run("INSERT INTO normas_fts(normas_fts) VALUES ('optimize')");
  db.run("INSERT INTO secoes_fts(secoes_fts) VALUES ('optimize')");
  db.run("VACUUM");
  db.close();
  renameSync(temporario, destino);
  const contagens = Object.fromEntries(
    Object.entries(ins.contagens)
      .filter(([tabela]) => tabela !== "meta")
      .sort(([a], [b]) => compararTexto(a, b)),
  );
  return { destino, fontes: arquivos.length, fontes_sha256: fontesSha, contagens };
}

if (import.meta.main) {
  const indice = process.argv.indexOf("--destino");
  const destino = indice !== -1 ? path.resolve(process.argv[indice + 1]!) : undefined;
  const inicio = performance.now();
  const resumo = compilarBanco(destino ? { destino } : {});
  const segundos = ((performance.now() - inicio) / 1000).toFixed(1);
  const { createHash } = await import("node:crypto");
  const sha = createHash("sha256").update(readFileSync(resumo.destino)).digest("hex");
  const tamanho = (readFileSync(resumo.destino).byteLength / 1024 / 1024).toFixed(1);
  console.log(`${path.relative(process.cwd(), resumo.destino) || resumo.destino}: ${tamanho} MB em ${segundos} s`);
  console.log(`sha256 ${sha}`);
  console.log(`fontes ${resumo.fontes} (sha256 ${resumo.fontes_sha256.slice(0, 16)}…)`);
  console.log(
    Object.entries(resumo.contagens)
      .map(([tabela, n]) => `${tabela} ${n}`)
      .join(", "),
  );
}
