/**
 * O `kb.sqlite` compilado da base real (num diretório temporário): determinismo, recall da busca
 * de seções, coerência com os gabaritos da avaliação, literalidade das respostas e igualdade entre
 * o banco e a API de arquivos da fase 5 (dispositivos, correspondência, relações, marcos, vigência e
 * transições). Modo banco (T0): cada consulta de `db/modo-banco.ts` dá a mesma saída que a CLI sobre
 * os arquivos, e todas rodam a partir de uma cópia do banco num diretório vazio, sem ler arquivo
 * fora dele. Compila três vezes (cerca de 9 s cada; a terceira com `versao`, `commit` e `canal`).
 */
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { lerSinonimos } from "../busca/sinonimos.ts";
import { avaliarBusca } from "../avaliacao/busca-secoes.ts";
import { adequacaoArt71 } from "../adequacao/art71.ts";
import { impacto } from "../normas/impacto.ts";
import * as moduloRegistro from "../normas/registro.ts";
import { carregarRegistro, raizRepositorio } from "../normas/registro.ts";
import * as moduloResolver from "../normas/resolver.ts";
import { registroPadrao, resolucaoComEntrada } from "../normas/resolver.ts";
import { ppcsQueCitam, relatorioCitacoes } from "../ppcs/citacoes.ts";
import { carregarCorrespondencias, correspondencia, correspondenciaEm } from "../normas/correspondencia.ts";
import {
  carregarDispositivos,
  descendentes,
  dispositivosDoAto,
  indiceDispositivos,
  obterDispositivo,
} from "../normas/estrutura.ts";
import { atosComVigencia } from "../normas/fontes-db.ts";
import { carregarRelacoes, relacoesDe } from "../normas/relacoes.ts";
import {
  carregarTransicoes,
  dataReferencia,
  derivarLinha,
  efeitoDaRelacao,
  inicioVigencia,
  statusEm,
  transicoesAplicaveis,
} from "../normas/vigencia.ts";
import { bancoDoPpcAvulso, compilarBanco } from "./compilar.ts";
import {
  buscarNorma,
  buscarNormaDetalhada,
  buscarSecoes,
  divergenciasPpcSuap,
  type FiltrosSecoes,
  listarCursos,
} from "./consultas.ts";
import {
  descendentesBanco,
  fonteCorrespondenciaBanco,
  obterDispositivoBanco,
  relacoesBanco,
  tabelasCorrespondenciaBanco,
  transicoesNoBanco,
  vigenciaNoBanco,
} from "./consultas-normas.ts";
import {
  fichasDoBanco,
  lerTopicosFichas,
  lerTopicosSecoes,
  nomesDeCampiDoBanco,
  pacoteContexto,
  pacoteContextoAvulso,
  pacoteDoMarkdown,
} from "./pacote-contexto.ts";
import { palavrasDeCampi } from "../ppcs/secoes.ts";
import { VERSAO_ESQUEMA } from "./esquema.ts";
import * as mb from "./modo-banco.ts";

const raiz = raizRepositorio();
const dir = mkdtempSync(path.join(tmpdir(), "kb-base-"));
const caminhoA = path.join(dir, "a.sqlite");
const caminhoB = path.join(dir, "b.sqlite");
const caminhoC = path.join(dir, "c.sqlite");
let db: Database;
let inicioCompilacaoA = 0;

beforeAll(() => {
  inicioCompilacaoA = Date.now();
  compilarBanco({ raiz, destino: caminhoA });
  compilarBanco({ raiz, destino: caminhoB });
  compilarBanco({ raiz, destino: caminhoC, versao: "2026.11.13", commit: "0123abcd", canal: "teste" });
  db = new Database(caminhoA, { readonly: true, strict: true });
}, 180_000);

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const sha = (arquivo: string) => createHash("sha256").update(readFileSync(arquivo)).digest("hex");
const lerJson = (relativo: string) => JSON.parse(readFileSync(path.join(raiz, relativo), "utf-8"));

describe("kb.sqlite da base", () => {
  test("dois builds sobre as mesmas fontes dão o mesmo arquivo", () => {
    expect(sha(caminhoA)).toBe(sha(caminhoB));
  });

  test("o mtime do banco é o do instante em que as fontes foram lidas, não o do fim da compilação", () => {
    // fonte editada durante a compilação fica mais nova que o banco e força a recompilação seguinte
    expect(statSync(caminhoA).mtimeMs).toBeLessThanOrEqual(inicioCompilacaoA + 1000);
  });

  test("recall@10 da busca de seções ≥ 0,8 (modo completo)", () => {
    const resultado = avaliarBusca(db, { lexico: lerSinonimos() });
    expect(resultado.consultas).toBeGreaterThanOrEqual(20);
    expect(resultado.recall.completo).toBeGreaterThanOrEqual(0.8);
  });

  test("cursos do eixo Informação e Comunicação no PS 2026 = gabarito da Q08", () => {
    const cursos = listarCursos(db, { eixo: "Informação e Comunicação", processo: "processo-seletivo-2026" });
    const campi = [...new Set(cursos.map((c) => `campus:${c.campus.id}`))].sort();
    expect(campi).toEqual(
      [...lerJson("avaliacao/gabaritos/q08-campi-eixo-informacao-comunicacao.json").esperado].sort(),
    );
  });

  test("PPCs que citam a Res. CNE/CP 1/2021 = gabarito da Q02", () => {
    const ppcs = (
      db.query("SELECT DISTINCT ppc_id FROM citacoes WHERE ato_id = ? ORDER BY ppc_id").all("br/cne-cp/res/2021/1") as {
        ppc_id: string;
      }[]
    ).map((l) => l.ppc_id.replace(/^ppc:/, ""));
    const gabarito = lerJson("avaliacao/gabaritos/q02-ppcs-citam-cne-cp-1-2021.json").esperado as string[];
    expect(ppcs.length).toBe(gabarito.length);
  });

  test("respostas trazem texto literal e proveniência", () => {
    const secoes = buscarSecoes(
      db,
      "acompanhamento de egressos",
      { cnct: "tecnico-em-informatica" },
      { lexico: lerSinonimos() },
    );
    expect(secoes.length).toBe(10);
    for (const s of secoes) {
      const linhas = readFileSync(path.join(raiz, s.path), "utf-8").split("\n");
      expect(s.trecho.length).toBeGreaterThan(0);
      for (const t of s.trecho) expect(linhas[t.linha - 1]).toBe(t.texto);
    }
    const [artigo] = buscarNorma(db, "Resolução CNE/CP nº 2/2026, art. 28");
    expect(artigo!.origem).toBe("citacao-resolvida");
    expect(artigo!.dispositivo!.id).toBe("br/cne-cp/res/2026/2#art28");
    expect(artigo!.dispositivo!.subordinados.length).toBeGreaterThan(10);
    const linhasNorma = readFileSync(path.join(raiz, artigo!.dispositivo!.path), "utf-8").split("\n");
    expect(linhasNorma[artigo!.dispositivo!.linha_inicio - 1]).toContain("Art. 28");
    const [inciso] = buscarNorma(db, "Res. CNE/CP 2/2026, art. 28, inciso VII");
    expect(inciso!.dispositivo!.id).toBe("br/cne-cp/res/2026/2#art28-vii");
    expect(inciso!.dispositivo!.caput.length).toBe(1);
    const textuais = buscarNorma(db, "estágio supervisionado carga horária");
    expect(textuais.length).toBe(10);
    for (const r of textuais.filter((x) => x.dispositivo)) {
      const d = r.dispositivo!;
      expect(d.id).toMatch(/^[a-z-]+(\/[\w-]+)+#[\w-]+$/);
      const linhasD = readFileSync(path.join(raiz, d.path), "utf-8").split("\n");
      const trecho = linhasD.slice(d.linha_inicio - 1, d.linha_fim).join("\n");
      expect(trecho).toContain(d.rotulo);
    }
    const { ppcs } = divergenciasPpcSuap(db, { nivel: "médio" });
    for (const p of ppcs) {
      for (const f of p.fatos.filter((x) => x.status_curadoria === "extraido")) {
        const linha = readFileSync(path.join(raiz, f.path), "utf-8").split("\n")[f.linha - 1]!;
        expect(linha).toContain(f.trecho_fonte);
      }
    }
  });

  test("pacote-contexto de uma ficha é menor que o PPC inteiro e traz o artigo citado", () => {
    const pacote = pacoteContexto(db, "CT-CURR-12", "curitiba/tecnico-em-enfermagem", { lexico: lerSinonimos(), raiz });
    expect(pacote.fichas_ids).toEqual(["CT-CURR-12"]);
    expect(pacote.tamanho.caracteres).toBeLessThan(pacote.tamanho.caracteres_ppc_inteiro);
    const dcn = pacote.normas.find((n) => n.ref === "br/cne-cp/res/2026/2");
    // a ficha cita o art. 9º e o inciso VII do art. 28: o inciso vem com o caput do artigo, não o artigo inteiro
    expect(dcn?.dispositivos.map((d) => d.id)).toEqual(["br/cne-cp/res/2026/2#art9", "br/cne-cp/res/2026/2#art28-vii"]);
    expect(dcn?.dispositivos[1]!.caput?.[0]).toContain("Art. 28");
    expect(pacote.marcos.map((m) => m.marco)).toContain("dcn_ept");
    expect(pacote.transicoes.map((t) => t.id)).toContain("dcnept-2026-art71");
    for (const t of pacote.transicoes) expect(t.texto).not.toBeNull();
    expect(pacote.secoes.some((s) => s.tipo === "matriz_curricular")).toBe(true);
  });
});

describe("PPC fora da base (bancoDoPpcAvulso)", () => {
  const AMOSTRA = [
    "curitiba/tecnico-em-enfermagem",
    "jacarezinho/tecnico-em-eletromecanica",
    "campo-largo/administracao-proeja",
    "paranagua/tecnico-em-informatica",
    "arapongas/tecnico-em-melhoria-de-processos",
    "curitiba/tecnico-em-processos-fotograficos-integrado-ao-ensino-medio",
  ];
  const secoesDe = (banco: Database, ppcId: string) =>
    (
      banco
        .query(
          "SELECT id, tipo, titulo, linha_inicio, linha_fim, linha_texto, texto FROM secoes WHERE ppc_id = ? ORDER BY linha_inicio",
        )
        .all(ppcId) as { id: string }[]
    ).map((s) => ({ ...s, id: s.id.slice(s.id.indexOf("#") + 1) }));
  const citacoesDe = (banco: Database, ppcId: string) =>
    banco
      .query("SELECT linha, trecho, ato_id, regra, secao_tipo, papel FROM citacoes WHERE ppc_id = ? ORDER BY ordem")
      .all(ppcId);

  test("o Markdown segmentado em memória dá as mesmas seções e citações do kb.sqlite", () => {
    const palavras = palavrasDeCampi(nomesDeCampiDoBanco(db));
    for (const chave of AMOSTRA) {
      const md = readFileSync(path.join(raiz, "base-conhecimento/institucional/ifpr/ppcs", `${chave}.md`), "utf-8");
      const avulso = bancoDoPpcAvulso(md, { ppcId: "ppc:avulso", palavrasCampi: palavras, raiz });
      try {
        expect(secoesDe(avulso, "ppc:avulso")).toEqual(secoesDe(db, `ppc:${chave}`));
        expect(citacoesDe(avulso, "ppc:avulso")).toEqual(citacoesDe(db, `ppc:${chave}`));
      } finally {
        avulso.close();
      }
    }
  });

  test("o pacote avulso de um tópico tem as normas, marcos, transições e seções do tópico do pacote da base", () => {
    const md = readFileSync(
      path.join(raiz, "base-conhecimento/institucional/ifpr/ppcs/curitiba/tecnico-em-enfermagem.md"),
      "utf-8",
    );
    const avulso = bancoDoPpcAvulso(md, { palavrasCampi: palavrasDeCampi(nomesDeCampiDoBanco(db)), raiz });
    try {
      const lexico = lerSinonimos();
      const base = pacoteContexto(db, "estagio", "curitiba/tecnico-em-enfermagem", { lexico, raiz });
      const pacote = pacoteContextoAvulso(db, avulso, fichasDoBanco(db, base.fichas_ids), { lexico });
      expect(pacote.fichas_ids).toEqual(base.fichas_ids);
      expect(pacote.normas).toEqual(base.normas);
      expect(pacote.marcos).toEqual(base.marcos);
      expect(pacote.transicoes).toEqual(base.transicoes);
      const doTopico = (secoes: { id: string; motivo: string[] }[]) =>
        secoes.filter((s) => s.motivo.some((m) => m.startsWith("topico:"))).map((s) => s.id.slice(s.id.indexOf("#")));
      expect(doTopico(pacote.secoes)).toEqual(doTopico(base.secoes));
      expect(pacote.secoes.every((s) => s.texto.length > 0)).toBe(true);
      const completo = pacoteContextoAvulso(db, avulso, fichasDoBanco(db, base.fichas_ids), { escopo: "completo" });
      expect(completo.secoes).toEqual([]);
      expect(completo.normas).toEqual(base.normas);
    } finally {
      avulso.close();
    }
  });
});

describe("fase 5: o banco dá o mesmo resultado que a API de arquivos", () => {
  test("todos os dispositivos (pelo ID do ato e pelo ID do arquivo) e os descendentes", () => {
    const indice = indiceDispositivos(raiz);
    expect(indice.size).toBeGreaterThan(4000);
    for (const [id, disp] of indice) {
      expect(obterDispositivoBanco(db, id)?.disp).toEqual(disp);
      expect(obterDispositivoBanco(db, disp.id)?.disp).toEqual(obterDispositivo(disp.id, raiz)!);
    }
    for (const disp of carregarDispositivos(raiz).filter((d) => d.norma !== d.ato)) {
      expect(obterDispositivoBanco(db, disp.id)?.disp).toEqual(obterDispositivo(disp.id, raiz)!);
    }
    for (const id of ["br/cne-cp/res/2026/2#art28", "br/lei/1996/9394#art36", "br/cne-cp/res/2021/1#art20"]) {
      expect(descendentesBanco(db, id).map((d) => d.disp)).toEqual(descendentes(id, raiz));
    }
    expect(obterDispositivoBanco(db, "br/cne-cp/res/2026/2#art999")).toBeUndefined();
  });

  test("correspondência de cada dispositivo da 1/2021 e do ato inteiro", () => {
    const fonte = fonteCorrespondenciaBanco(db);
    const ids = ["br/cne-cp/res/2021/1", ...dispositivosDoAto("br/cne-cp/res/2021/1", raiz).map((d) => d.id)];
    for (const id of ids) expect(correspondenciaEm(id, fonte)).toEqual(correspondencia(id, raiz));
    expect(tabelasCorrespondenciaBanco(db)).toEqual(carregarCorrespondencias(raiz));
  });

  test("relações e marcos derivados", () => {
    expect(relacoesBanco(db)).toEqual(carregarRelacoes(raiz));
    const marcos = lerJson(".agents/skills/revisar-ppc/base-analise/marcos-normativos.json").marcos as {
      id: string;
      linha: string[];
    }[];
    for (const m of marcos) {
      const linha = db.query("SELECT vigente, normas_json FROM marcos WHERE id = ?").get(m.id) as {
        vigente: string;
        normas_json: string;
      };
      const derivado = derivarLinha(m.linha, dataReferencia(raiz), raiz);
      expect(linha.vigente).toBe(derivado.vigente);
      expect(JSON.parse(linha.normas_json)).toMatchObject(derivado);
    }
  });

  test("vigência de cada ato em cada data em que o status pode mudar (e na véspera)", () => {
    const atos = atosComVigencia(raiz);
    expect(atos.length).toBeGreaterThan(60);
    for (const ato of atos) {
      const datas = new Set(["1990-01-01", "2026-11-01", "2026-11-12", dataReferencia(raiz), "2030-01-01"]);
      // as datas dos intervalos gravados e, independentemente deles, as que statusEm compara
      const intervalos = db.query("SELECT de FROM vigencias WHERE alvo = ?").all(ato) as { de: string | null }[];
      const inicio = inicioVigencia(ato, raiz);
      const efeitos = carregarRelacoes(raiz)
        .filter((r) => r.alvo === ato)
        .map((r) => efeitoDaRelacao(r, raiz));
      const comparadas = [inicio, ...efeitos].flatMap((e) => [e.data, e.minimo]);
      for (const de of [...intervalos.map((i) => i.de), ...comparadas]) {
        if (!de) continue;
        const vespera = new Date(`${de}T00:00:00Z`);
        vespera.setUTCDate(vespera.getUTCDate() - 1);
        datas.add(de).add(vespera.toISOString().slice(0, 10));
      }
      for (const data of datas) {
        const arquivo = statusEm(ato, data, raiz);
        const banco = vigenciaNoBanco(db, ato, data);
        expect({ ato, data, status: banco?.status, certo: banco?.certo }).toEqual({
          ato,
          data,
          status: arquivo.status,
          certo: arquivo.certo,
        });
      }
    }
  });

  test("regras de transição (datas e situação) em várias datas", () => {
    const atos = [...new Set(carregarTransicoes(raiz).flatMap((t) => [t.norma, t.norma_anterior ?? t.norma]))];
    for (const ato of atos) {
      for (const data of ["2021-01-01", "2026-11-01", dataReferencia(raiz), "2028-11-14", "2035-01-01"]) {
        const banco = transicoesNoBanco(db, [ato], data).map((t) => [t.id, t.inicio_em, t.fim_em, t.situacao]);
        const arquivo = transicoesAplicaveis(ato, data, raiz).map((t) => [t.id, t.inicio_em, t.fim_em, t.situacao]);
        expect(banco).toEqual(arquivo);
      }
    }
  });

  test("citação resolvida respeita --vigentes e --situacao, com aviso", () => {
    const citacao = "Resolução CNE/CP nº 1/2021, art. 20";
    expect(buscarNorma(db, citacao)[0]!.dispositivo!.id).toBe("br/cne-cp/res/2021/1#art20");
    // revogada em 2026-11-11 pela Res. CNE/CP nº 2/2026 (data_referencia 2026-11-13)
    const vigentes = buscarNormaDetalhada(db, citacao, { vigentes: true });
    expect(vigentes.resultados).toEqual([]);
    expect(vigentes.avisos.join("\n")).toMatch(/br\/cne-cp\/res\/2021\/1.*vigente/);
    // antes da revogação, passa
    expect(buscarNorma(db, citacao, { vigentes: true, em: "2025-01-01" })[0]!.dispositivo!.id).toBe(
      "br/cne-cp/res/2021/1#art20",
    );
    const situacao = buscarNormaDetalhada(db, citacao, { situacao: "stub" });
    expect(situacao.resultados).toEqual([]);
    expect(situacao.avisos.join("\n")).toContain("situação base");
    // dispositivo revogado de norma em vigor
    const revogado = buscarNormaDetalhada(db, "br/lei/1996/9394#art20", { vigentes: true });
    expect(revogado.resultados).toEqual([]);
    expect(revogado.avisos.join("\n")).toContain("revogado");
    expect(buscarNorma(db, "Lei 9.394/1996, art. 3º", { vigentes: true })[0]!.dispositivo!.id).toBe(
      "br/lei/1996/9394#art3",
    );
  });

  test("ID de norma desconhecido devolve aviso, não busca textual", () => {
    const r = buscarNormaDetalhada(db, "br/naoexiste/x");
    expect(r.resultados).toEqual([]);
    expect(r.avisos).toEqual(["ID desconhecido: br/naoexiste/x não está entre as normas da base"]);
    expect(buscarNormaDetalhada(db, "ifpr/consup/res/1900/1#art1").avisos[0]).toContain("ID desconhecido");
  });

  test("FTS dos dispositivos acha o texto com o caput herdado", () => {
    const resultados = buscarNorma(db, "carga horária do estágio profissional supervisionado", { limite: 5 });
    expect(resultados.some((r) => r.dispositivo?.id.startsWith("br/cne-cp/res/2026/2#art37"))).toBe(true);
  });
});

/* ------------------------------------------------------------- modo banco (T0) */

/** Saída igual byte a byte (JSON, com a ordem das chaves), não só igualdade estrutural. */
const mesmoJson = (banco: unknown, arquivos: unknown) => expect(JSON.stringify(banco)).toBe(JSON.stringify(arquivos));

const NORMAS = ["br/cne-cp/res/2021/1", "br/cne-cp/res/2026/2", "br/lei/1996/9394", "br/cne-cp/res/2021/1#art20"];
const CITACOES = [
  "Resolução CNE/CP nº 1/2021, art. 20",
  "Res. CNE/CP 2/2026, art. 28, inciso VII",
  "LDB, arts. 61 a 63",
  "CNCT",
  "texto sem citação",
];
const PPC = "curitiba/tecnico-em-enfermagem";
const FICHAS_DA_ANALISE = ".agents/skills/revisar-ppc/base-analise/fichas/";

describe("modo banco: a mesma saída da CLI sobre os arquivos", () => {
  test("léxico, tópicos, registro e meta", () => {
    mesmoJson(mb.sinonimosBanco(db), lerSinonimos());
    mesmoJson(mb.topicosSecoesBanco(db), lerTopicosSecoes());
    mesmoJson(mb.topicosFichasBanco(db), lerTopicosFichas(raiz));
    mesmoJson(mb.registroBanco(db).entradas, carregarRegistro(raiz).entradas);
    const meta = mb.metaBanco(db);
    expect(meta.versao_esquema).toBe(String(VERSAO_ESQUEMA));
    expect(meta.data_referencia).toBe(dataReferencia(raiz));
    expect(["versao", "commit", "canal"].filter((c) => c in meta)).toEqual([]);
  });

  test("resolver e buscar-norma", () => {
    for (const texto of CITACOES) mesmoJson(mb.resolverBanco(db, texto), resolucaoComEntrada(texto, registroPadrao()));
    for (const consulta of [...CITACOES, "estágio supervisionado carga horária"]) {
      mesmoJson(mb.buscarNormaBanco(db, consulta), buscarNorma(db, consulta));
    }
  }, 60_000);

  test("citacoes, vigencia e relacoes", () => {
    for (const id of NORMAS) {
      const ato = id.split("#")[0]!;
      mesmoJson(mb.citacoesBanco(db, id), relatorioCitacoes(id, ppcsQueCitam(id), registroPadrao()));
      mesmoJson(
        mb.citacoesBanco(db, id, { confiancaMinima: 0.9 }),
        relatorioCitacoes(id, ppcsQueCitam(id, { confiancaMinima: 0.9 }), registroPadrao()),
      );
      for (const em of [undefined, "2020-01-01", "2026-11-01", "2030-01-01"]) {
        const quando = em ?? dataReferencia(raiz);
        mesmoJson(mb.vigenciaBanco(db, id, em ? { em } : {}), {
          ...statusEm(ato, quando, raiz),
          transicoes: transicoesAplicaveis(ato, quando, raiz),
        });
      }
      mesmoJson(mb.relacoesDaNormaBanco(db, id), { id: ato, ...relacoesDe(ato, raiz) });
    }
  }, 60_000);

  test("vigência de cada ato na data de referência (registro, datas e relações do banco)", () => {
    const data = dataReferencia(raiz);
    for (const ato of atosComVigencia(raiz)) {
      mesmoJson(mb.vigenciaBanco(db, ato), {
        ...statusEm(ato, data, raiz),
        transicoes: transicoesAplicaveis(ato, data, raiz),
      });
    }
  }, 60_000);

  test("impacto: igual ao dos arquivos restrito às fichas (o banco não tem os outros textos das skills)", () => {
    for (const id of NORMAS) {
      const arquivos = impacto(id, { raiz });
      arquivos.arquivos = arquivos.arquivos.filter((a) => a.arquivo.startsWith(FICHAS_DA_ANALISE));
      mesmoJson(mb.impactoBanco(db, id), arquivos);
    }
    const semPpcs = impacto("br/cne-cp/res/2021/1", { raiz, incluirPpcs: false, data: "2026-11-01" });
    semPpcs.arquivos = semPpcs.arquivos.filter((a) => a.arquivo.startsWith(FICHAS_DA_ANALISE));
    mesmoJson(mb.impactoBanco(db, "br/cne-cp/res/2021/1", { incluirPpcs: false, data: "2026-11-01" }), semPpcs);
  }, 60_000);

  test("adequacao-art71", () => {
    mesmoJson(mb.adequacaoArt71Banco(db), adequacaoArt71({ raiz }));
    mesmoJson(
      mb.adequacaoArt71Banco(db, { incluirTecnologia: true }),
      adequacaoArt71({ raiz, incluirTecnologia: true }),
    );
  }, 60_000);

  test("buscar-secoes e pacote-contexto (PPC da base e Markdown fora dela)", () => {
    const lexico = lerSinonimos();
    const buscas: [string, FiltrosSecoes][] = [
      ["acompanhamento de egressos", { cnct: "tecnico-em-informatica" }],
      ["estágio obrigatório", { ppc: PPC }],
      ["avaliação da aprendizagem", { nivel: "médio", tipo: ["avaliacao"] }],
    ];
    for (const [consulta, filtros] of buscas) {
      mesmoJson(mb.buscarSecoesBanco(db, consulta, filtros), buscarSecoes(db, consulta, filtros, { lexico }));
    }
    for (const tarefa of ["CT-CURR-12", "estagio", "grupo-002"]) {
      mesmoJson(mb.pacoteContextoBanco(db, tarefa, PPC), pacoteContexto(db, tarefa, PPC, { lexico, raiz }));
    }
    const arquivo = path.join(raiz, "base-conhecimento/institucional/ifpr/ppcs", `${PPC}.md`);
    for (const tarefa of ["CT-CURR-12", "grupo-001"]) {
      mesmoJson(
        mb.pacoteDoMarkdownBanco(db, tarefa, arquivo, { markdown: readFileSync(arquivo, "utf-8") }),
        pacoteDoMarkdown(db, tarefa, arquivo, { lexico, raiz }),
      );
    }
  }, 60_000);

  test("meta: versao, commit e canal só quando informados no build", () => {
    const comVersao = new Database(caminhoC, { readonly: true, strict: true });
    try {
      const meta = mb.metaBanco(comVersao);
      expect([meta.versao, meta.commit, meta.canal]).toEqual(["2026.11.13", "0123abcd", "teste"]);
      const { versao: _v, commit: _c, canal: _k, ...resto } = meta;
      expect(resto).toEqual(mb.metaBanco(db));
    } finally {
      comVersao.close();
    }
  });
});

/** Todas as consultas do modo banco, com argumentos reais, numa saída só. */
function todasAsConsultas(banco: Database, markdown: string) {
  return {
    meta: mb.metaBanco(banco),
    resolver: CITACOES.map((t) => mb.resolverBanco(banco, t)),
    buscarNorma: CITACOES.map((c) => mb.buscarNormaBanco(banco, c, { limite: 5 })),
    dispositivo: mb.obterDispositivoBanco(banco, "br/cne-cp/res/2026/2#art71-parunico")?.disp ?? null,
    correspondencia: mb.correspondenciaBanco(banco, "br/cne-cp/res/2021/1#art20"),
    citacoes: NORMAS.map((id) => mb.citacoesBanco(banco, id)),
    vigencia: NORMAS.map((id) => mb.vigenciaBanco(banco, id, { em: "2026-11-01" })),
    relacoes: NORMAS.map((id) => mb.relacoesDaNormaBanco(banco, id)),
    impacto: NORMAS.map((id) => mb.impactoBanco(banco, id)),
    adequacao: mb.adequacaoArt71Banco(banco, { incluirTecnologia: true }),
    buscarSecoes: mb.buscarSecoesBanco(banco, "acompanhamento de egressos", { cnct: "tecnico-em-informatica" }),
    cursos: mb.listarCursos(banco, { eixo: "Informação e Comunicação", processo: "processo-seletivo-2026" }),
    fatos: mb.fatosDosPpcs(banco, { ppc: PPC }),
    divergencias: mb.divergenciasPpcSuap(banco, { nivel: "médio" }),
    pacote: ["CT-CURR-12", "grupo-003"].map((t) => mb.pacoteContextoBanco(banco, t, PPC)),
    pacoteMarkdown: mb.pacoteDoMarkdownBanco(banco, "estagio", "PPC.md", { markdown }),
  };
}

describe("modo banco sem o repositório", () => {
  test("todas as consultas a partir de uma cópia do banco num diretório vazio, sem ler arquivo fora dele", () => {
    const markdown = readFileSync(path.join(raiz, "base-conhecimento/institucional/ifpr/ppcs", `${PPC}.md`), "utf-8");
    const esperado = JSON.stringify(todasAsConsultas(db, markdown));
    const vazio = fs.realpathSync(mkdtempSync(path.join(tmpdir(), "kb-sem-repo-")));
    const caminho = path.join(vazio, "kb.sqlite");
    copyFileSync(caminhoA, caminho);
    const tentativas: string[] = [];
    const dentro = (alvo: unknown) => typeof alvo === "string" && path.resolve(alvo).startsWith(`${vazio}${path.sep}`);
    // qualquer acesso a arquivo fora do diretório do banco falha; a raiz do repositório e o
    // registro do checkout também (protegem contra o que já estivesse em cache no processo)
    const espioes = [
      ...(
        ["readFileSync", "readdirSync", "existsSync", "statSync", "lstatSync", "openSync", "realpathSync"] as const
      ).map((nome) => {
        const original = fs[nome] as (...args: unknown[]) => unknown;
        return spyOn(fs, nome).mockImplementation(((...args: unknown[]) => {
          if (dentro(args[0])) return original(...args);
          tentativas.push(`${nome} ${String(args[0])}`);
          throw new Error(`modo banco leu arquivo: ${nome} ${String(args[0])}`);
        }) as never);
      }),
      spyOn(moduloRegistro, "raizRepositorio").mockImplementation(() => {
        tentativas.push("raizRepositorio");
        throw new Error("modo banco procurou a raiz do repositório");
      }),
      spyOn(moduloResolver, "registroPadrao").mockImplementation(() => {
        tentativas.push("registroPadrao");
        throw new Error("modo banco usou o registro do checkout");
      }),
    ];
    const cwd = process.cwd();
    process.chdir(vazio);
    let banco: Database | undefined;
    try {
      banco = mb.abrirBancoSomenteLeitura(caminho);
      const obtido = JSON.stringify(todasAsConsultas(banco, markdown));
      expect(tentativas).toEqual([]);
      expect(obtido).toBe(esperado);
    } finally {
      banco?.close();
      process.chdir(cwd);
      for (const espiao of espioes) espiao.mockRestore();
      rmSync(vazio, { recursive: true, force: true });
    }
    expect(() => mb.abrirBancoSomenteLeitura(path.join(vazio, "nao-existe.sqlite"))).toThrow("não encontrado");
  }, 60_000);
});

describe("modo banco num binário (bun build --compile), só com o kb.sqlite", () => {
  test("o binário roda num diretório vazio e dá a mesma saída que o processo", () => {
    const trabalho = fs.realpathSync(mkdtempSync(path.join(tmpdir(), "kb-binario-")));
    const vazio = fs.realpathSync(mkdtempSync(path.join(tmpdir(), "kb-binario-vazio-")));
    try {
      // entrada fora do pacote, que importa o modo banco pelo caminho absoluto
      const entrada = path.join(trabalho, "entrada.ts");
      fs.writeFileSync(
        entrada,
        `import * as mb from ${JSON.stringify(path.join(import.meta.dir, "modo-banco.ts"))};
const banco = mb.abrirBancoSomenteLeitura(process.argv[2]);
const ids = ${JSON.stringify(NORMAS)};
console.log(JSON.stringify({
  resolver: mb.resolverBanco(banco, "Res. CNE/CP 2/2026, art. 28, inciso VII"),
  citacoes: ids.map((id) => mb.citacoesBanco(banco, id)),
  vigencia: ids.map((id) => mb.vigenciaBanco(banco, id)),
  impacto: ids.map((id) => mb.impactoBanco(banco, id, { incluirPpcs: false })),
  adequacao: mb.adequacaoArt71Banco(banco),
  secoes: mb.buscarSecoesBanco(banco, "acompanhamento de egressos"),
  pacote: mb.pacoteContextoBanco(banco, "grupo-001", ${JSON.stringify(PPC)}),
}));
`,
      );
      const binario = path.join(vazio, "kb-modo-banco");
      const build = Bun.spawnSync(["bun", "build", "--compile", entrada, "--outfile", binario], {
        cwd: trabalho,
        stderr: "pipe",
      });
      expect(build.exitCode, build.stderr.toString()).toBe(0);
      copyFileSync(caminhoA, path.join(vazio, "kb.sqlite"));
      const execucao = Bun.spawnSync([binario, "kb.sqlite"], { cwd: vazio, stderr: "pipe", env: {} });
      expect(execucao.exitCode, execucao.stderr.toString()).toBe(0);
      const esperado = {
        resolver: mb.resolverBanco(db, "Res. CNE/CP 2/2026, art. 28, inciso VII"),
        citacoes: NORMAS.map((id) => mb.citacoesBanco(db, id)),
        vigencia: NORMAS.map((id) => mb.vigenciaBanco(db, id)),
        impacto: NORMAS.map((id) => mb.impactoBanco(db, id, { incluirPpcs: false })),
        adequacao: mb.adequacaoArt71Banco(db),
        secoes: mb.buscarSecoesBanco(db, "acompanhamento de egressos"),
        pacote: mb.pacoteContextoBanco(db, "grupo-001", PPC),
      };
      expect(execucao.stdout.toString().trim()).toBe(JSON.stringify(esperado));
    } finally {
      rmSync(trabalho, { recursive: true, force: true });
      rmSync(vazio, { recursive: true, force: true });
    }
  }, 60_000);
});
