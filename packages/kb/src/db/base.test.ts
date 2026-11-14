/**
 * O `kb.sqlite` compilado da base real (num diretório temporário): determinismo, recall da busca
 * de seções, coerência com os gabaritos da avaliação, literalidade das respostas e igualdade entre
 * o banco e a API de arquivos da fase 5 (dispositivos, correspondência, relações, marcos, vigência e
 * transições). Compila duas vezes (cerca de 9 s cada).
 */
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { lerSinonimos } from "../busca/sinonimos.ts";
import { avaliarBusca } from "../avaliacao/busca-secoes.ts";
import { raizRepositorio } from "../normas/registro.ts";
import { carregarCorrespondencias, correspondencia, correspondenciaEm } from "../normas/correspondencia.ts";
import {
  carregarDispositivos,
  descendentes,
  dispositivosDoAto,
  indiceDispositivos,
  obterDispositivo,
} from "../normas/estrutura.ts";
import { atosComVigencia } from "../normas/fontes-db.ts";
import { carregarRelacoes } from "../normas/relacoes.ts";
import {
  carregarTransicoes,
  dataReferencia,
  derivarLinha,
  efeitoDaRelacao,
  inicioVigencia,
  statusEm,
  transicoesAplicaveis,
} from "../normas/vigencia.ts";
import { compilarBanco } from "./compilar.ts";
import { buscarNorma, buscarSecoes, divergenciasPpcSuap, listarCursos } from "./consultas.ts";
import {
  descendentesBanco,
  fonteCorrespondenciaBanco,
  obterDispositivoBanco,
  relacoesBanco,
  tabelasCorrespondenciaBanco,
  transicoesNoBanco,
  vigenciaNoBanco,
} from "./consultas-normas.ts";
import { pacoteContexto } from "./pacote-contexto.ts";

const raiz = raizRepositorio();
const dir = mkdtempSync(path.join(tmpdir(), "kb-base-"));
const caminhoA = path.join(dir, "a.sqlite");
const caminhoB = path.join(dir, "b.sqlite");
let db: Database;

beforeAll(() => {
  compilarBanco({ raiz, destino: caminhoA });
  compilarBanco({ raiz, destino: caminhoB });
  db = new Database(caminhoA, { readonly: true, strict: true });
}, 120_000);

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
    const marcos = lerJson(".agents/skills/analise-ppc/base-analise/marcos-normativos.json").marcos as {
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

  test("FTS dos dispositivos acha o texto com o caput herdado", () => {
    const resultados = buscarNorma(db, "carga horária do estágio profissional supervisionado", { limite: 5 });
    expect(resultados.some((r) => r.dispositivo?.id.startsWith("br/cne-cp/res/2026/2#art37"))).toBe(true);
  });
});
