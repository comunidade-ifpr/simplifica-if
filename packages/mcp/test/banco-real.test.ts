/**
 * Smoke das ferramentas de normas contra o banco real (`tmp/kb.sqlite`, de `pnpm kb:compilar`):
 * cada ferramenta dá os mesmos IDs, textos e totais que o comando correspondente da CLI `kb` em
 * JSON. `resolver`, `vigencia`, `relacoes` e `impacto` da CLI leem os arquivos do repositório; os
 * demais, o banco. Lento e dependente do checkout; roda só com `SIMPLIFICA_SMOKE=1`, como o smoke do
 * T3 (`smoke-base-real.test.ts`): `pnpm mcp:smoke` roda os dois. A CLI roda antes de o banco ser
 * aberto aqui, e compila o `tmp/kb.sqlite` se ele faltar ou estiver velho.
 */
import { spawn } from "node:child_process";
import { beforeAll, describe, expect, test } from "vite-plus/test";
import path from "node:path";
import { buscarNorma } from "../src/ferramentas/buscar-norma.ts";
import { correspondencia } from "../src/ferramentas/correspondencia.ts";
import type { Contexto } from "../src/ferramentas/ferramenta.ts";
import { fichaNorma } from "../src/ferramentas/ficha-norma.ts";
import { lerDispositivos } from "../src/ferramentas/ler-dispositivos.ts";
import { resolverCitacoes } from "../src/ferramentas/resolver-citacoes.ts";
import { criarContexto } from "../src/servidor.ts";
import { diretorioTemporario } from "./fixture.ts";

const RAIZ = path.resolve(import.meta.dirname, "../../..");
const BANCO = path.join(RAIZ, "tmp/kb.sqlite");
const CLI_KB = path.join(RAIZ, "packages/kb/src/cli.ts");

/** `node packages/kb/src/cli.ts <args> --json`, na raiz do repositório. */
async function kb(...args: string[]): Promise<any> {
  const processo = spawn(process.execPath, [CLI_KB, ...args, "--json"], {
    cwd: RAIZ,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  processo.stdout.setEncoding("utf-8").on("data", (parte: string) => (stdout += parte));
  processo.stderr.setEncoding("utf-8").on("data", (parte: string) => (stderr += parte));
  await new Promise((resolve, reject) => {
    processo.once("error", reject);
    processo.once("close", resolve);
  });
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`kb ${args.join(" ")}: saída não é JSON\n${stdout}\n${stderr}`);
  }
}

const ato = (id: string) => id.split("#")[0]!.replace(/~[a-z]+$/, "");
const sufixo = (id: string) => id.slice(id.indexOf("#"));

let ctx: Contexto;

describe.skipIf(process.env.SIMPLIFICA_SMOKE !== "1")("banco real: paridade com a CLI kb", () => {
  beforeAll(async () => {
    await kb("buscar-norma", "LDB"); // recompila o banco, se velho, antes de abri-lo
    ctx = criarContexto({ banco: BANCO, pastaTrabalho: diretorioTemporario(), canal: "dev" });
  }, 120_000);

  test("buscar_norma = kb buscar-norma --limite 8", async () => {
    const consultas = [
      "Resolução CNE/CP nº 1/2021, art. 20",
      "Res. CNE/CP 2/2026, art. 28, inciso VII",
      "LDB, arts. 61 a 63",
      "br/lei/1996/9394#art36",
      "Res. CNE/CP 2/2026, art. 28, XCIX",
      "estágio supervisionado carga horária",
      "acompanhamento de egressos",
      "CNCT",
    ];
    const cli = await Promise.all(consultas.map((c) => kb("buscar-norma", c, "--limite", "8")));
    consultas.forEach((consulta, i) => {
      const esperado = cli[i];
      expect(esperado.total).toBeGreaterThan(0);
      const { resposta } = buscarNorma.responder({ consulta }, ctx);
      expect(buscarNorma.saida.safeParse(resposta).success).toBe(true);
      expect(resposta.dados.resultados.length).toBe(esperado.total);
      expect(
        resposta.dados.resultados.map((r) => ({
          norma: [r.norma.id, r.norma.titulo, r.norma.status_vigencia],
          dispositivo: r.dispositivo
            ? {
                id: r.dispositivo.id,
                caput: r.dispositivo.caput,
                texto: r.dispositivo.texto,
                subordinados: r.dispositivo.subordinados.map((s) => [s.id, s.texto]),
                fonte: [r.dispositivo.fonte.path, r.dispositivo.fonte.linha_inicio, r.dispositivo.fonte.linha_fim],
              }
            : null,
          metadados: r.metadados ? [r.metadados.texto, r.metadados.fonte.path, r.metadados.fonte.linha_inicio] : null,
          pedido: r.citado_fora_do_texto ?? null,
          origem: r.origem,
          pontuacao: r.pontuacao,
        })),
      ).toEqual(
        esperado.resultados.map((r: any) => ({
          norma: [r.norma.id, r.norma.titulo, r.norma.status_vigencia],
          dispositivo: r.dispositivo
            ? {
                id: r.dispositivo.id,
                caput: r.dispositivo.caput,
                texto: r.dispositivo.texto,
                subordinados: r.dispositivo.subordinados.map((s: any) => [s.id, s.texto]),
                fonte: [r.dispositivo.path, r.dispositivo.linha_inicio, r.dispositivo.linha_fim],
              }
            : null,
          metadados: r.metadados ? [r.metadados.texto, r.metadados.path, r.metadados.linha] : null,
          pedido: r.pedido,
          origem: r.origem,
          pontuacao: r.pontuacao,
        })),
      );
    });
  }, 60_000);

  test("ler_dispositivos = kb dispositivo --filhos", async () => {
    const ids = [
      "br/cne-cp/res/2026/2#art71-parunico",
      "br/cne-cp/res/2026/2#art28",
      "br/lei/1996/9394#art24-par1",
      "br/lei/1996/9394#art36",
      "br/lei/1996/9394~compilacao#art26",
      "br/cne-cp/res/2026/2#art999",
    ];
    const cli = await Promise.all(ids.map((id) => kb("dispositivo", id, "--filhos")));
    const { resposta } = lerDispositivos.responder({ ids, filhos: true }, ctx);
    expect(lerDispositivos.saida.safeParse(resposta).success).toBe(true);
    expect(resposta.dados.nao_encontrados).toEqual(ids.filter((_, i) => cli[i].encontrado === false));
    const achados = cli.filter((c) => c.encontrado !== false);
    expect(achados.length).toBe(ids.length - 1);
    expect(achados.some((c) => c.filhos.length > 5 && c.notas.length + c.filhos.length > 0)).toBe(true);
    expect(resposta.dados.dispositivos.length).toBe(achados.length);
    resposta.dados.dispositivos.forEach((d, i) => {
      const e = achados[i];
      expect({
        id: d.id,
        rotulo: d.rotulo,
        tipo: d.tipo,
        caput: d.caput,
        texto: d.texto,
        notas: d.notas,
        estrutura: d.estrutura,
        pai: d.pai,
        revogado: d.revogado,
        vetado: d.vetado,
        subordinados: d.subordinados.map((s) => [s.id, s.rotulo, s.texto]),
        fonte: [d.fonte.path, d.fonte.linha_inicio, d.fonte.linha_fim],
      }).toEqual({
        id: `${e.ato}${e.dispositivo}`,
        rotulo: e.rotulo,
        tipo: e.tipo,
        caput: e.caput,
        texto: e.texto,
        notas: e.notas.map((n: any) => n.texto),
        estrutura: e.estrutura,
        pai: e.pai === null ? null : `${e.ato}${sufixo(e.pai)}`,
        revogado: e.revogado,
        vetado: e.vetado,
        subordinados: e.filhos.map((f: any) => [`${f.ato}${f.dispositivo}`, f.rotulo, f.texto]),
        fonte: [
          `base-conhecimento/${e.path}`,
          e.linha_inicio,
          Math.max(e.linha_fim, ...e.filhos.map((f: any) => f.linha_fim)),
        ],
      });
    });
  }, 60_000);

  test("ficha_norma = kb vigencia + kb relacoes + sucessoras de kb impacto", async () => {
    const normas = ["br/cne-cp/res/2021/1", "br/cne-cp/res/2026/2", "br/lei/1996/9394", "ifpr/consup/res/2025/259"];
    for (const em of [undefined, "2026-11-01", "2030-01-01"]) {
      const [vigencias, relacoes, impactos] = await Promise.all([
        Promise.all(normas.map((id) => kb("vigencia", id, ...(em ? ["--em", em] : [])))),
        Promise.all(normas.map((id) => kb("relacoes", id))),
        Promise.all(normas.map((id) => kb("impacto", id, "--sem-ppcs"))),
      ]);
      normas.forEach((id, i) => {
        const { resposta } = fichaNorma.responder({ id, ...(em ? { em } : {}) }, ctx);
        expect(fichaNorma.saida.safeParse(resposta).success).toBe(true);
        const v = vigencias[i];
        const { vigencia, transicoes } = resposta.dados;
        expect([vigencia.data, vigencia.status, vigencia.certo, vigencia.inicio, vigencia.pendencias]).toEqual([
          v.data,
          v.status,
          v.certo,
          v.inicio,
          v.pendencias,
        ]);
        expect(
          vigencia.eventos.map((e) => [e.tipo, e.origem, e.operador, e.efeito_de, e.efeito_minimo, e.ocorreu]),
        ).toEqual(
          v.eventos.map((e: any) => [
            e.tipo,
            e.origem,
            e.operador,
            e.efeito_de,
            e.efeito_minimo,
            e.ocorreu === true ? "sim" : e.ocorreu === false ? "não" : "a confirmar",
          ]),
        );
        expect(
          transicoes.map((t) => [t.id, t.dispositivo, t.situacao_na_data, t.inicio_em, t.fim_em, t.regra]),
        ).toEqual(
          v.transicoes.map((t: any) => [
            t.id,
            `${t.norma}${t.dispositivo}`,
            t.situacao,
            t.inicio_em,
            t.fim_em,
            t.regra,
          ]),
        );
        if (id === "br/cne-cp/res/2021/1") {
          expect(v.eventos.length).toBeGreaterThan(0);
          expect(v.transicoes.length).toBeGreaterThan(0);
          expect(impactos[i].sucessoras.length).toBeGreaterThan(0);
        }
        if (id === "br/lei/1996/9394") expect(relacoes[i].entrada.length).toBeGreaterThan(5);
        const linha = (r: any) =>
          `${r.origem}${r.operador ?? ""} ${r.tipo} ${r.alvo}${r.alvo_dispositivo ?? ""} | ${r.alcance ?? ""} | ${r.evidencia.trecho}`;
        expect(resposta.dados.relacoes.saida.map(linha)).toEqual(relacoes[i].saida.map(linha));
        expect(resposta.dados.relacoes.entrada.map(linha)).toEqual(relacoes[i].entrada.map(linha));
        expect(resposta.dados.sucessoras).toEqual(impactos[i].sucessoras);
        expect(resposta.avisos.filter((a) => a.tipo === "vigencia-a-confirmar").length).toBe(v.pendencias.length);
      });
    }
  }, 120_000);

  test("correspondencia = kb correspondencia (dispositivo e norma inteira, todas as páginas)", async () => {
    const ids = ["br/cne-cp/res/2021/1#art20", "br/cne-cp/res/2021/1#art20-iii", "br/cne-cp/res/2021/1#art6"];
    const projetar = (itens: any[]) =>
      itens.map((r) => ({
        origem: [r.id, r.texto_origem],
        tipo: r.item.tipo,
        destino: r.textos_destino.map((d: any) => [d.id, d.texto]),
        herdado: r.herdado_de === null ? null : `${ato(r.id)}${r.herdado_de}`,
        nota: r.item.nota ?? null,
        detalhes: r.detalhes.map((d: any) => `${ato(r.id)}${d.origem}`),
      }));
    const projetarFerramenta = (itens: any[]) =>
      itens.map((i) => ({
        origem: [i.origem.id, i.origem.texto],
        tipo: i.tipo,
        destino: i.destino.map((d: any) => [d.id, d.texto]),
        herdado: i.herdado_de,
        nota: i.nota,
        detalhes: i.detalhes.map((d: any) => d.origem),
      }));
    const cli = await Promise.all([...ids, "br/cne-cp/res/2021/1"].map((id) => kb("correspondencia", id)));
    ids.forEach((id, i) => {
      const { resposta } = correspondencia.responder({ id }, ctx);
      expect(correspondencia.saida.safeParse(resposta).success).toBe(true);
      expect(cli[i].length).toBeGreaterThan(0);
      expect(projetarFerramenta(resposta.dados.itens)).toEqual(projetar(cli[i]));
      expect(resposta.dados.tabela?.status).toBe(cli[i][0].status);
    });
    const todos: any[] = [];
    let cursor: string | undefined;
    do {
      const { resposta } = correspondencia.responder(
        { id: "br/cne-cp/res/2021/1", ...(cursor ? { cursor } : {}) },
        ctx,
      );
      expect(resposta.pagina!.total).toBe(cli[ids.length].length);
      todos.push(...resposta.dados.itens);
      cursor = resposta.pagina!.cursor;
    } while (cursor);
    expect(todos.length).toBeGreaterThan(20);
    expect(projetarFerramenta(todos)).toEqual(projetar(cli[ids.length]));
  }, 60_000);

  test("resolver_citacoes = kb resolver, citação a citação", async () => {
    const citacoes = [
      "Resolução CNE/CP nº 1/2021, art. 20",
      "Res. CNE/CP 2/2026, art. 28, inciso VII",
      "LDB, arts. 61 a 63",
      "Lei 11.788/2008",
      "Resolução CNE/CEB nº 1, de 5 de janeiro de 2021",
      "Resolução CNE/CP nº 1, de 5 de janeiro de 2020",
      "Resolução CONSUP/IFPR nº 55/2011",
      "ABNT NBR 6023",
      "CNCT",
      "texto sem citação",
    ];
    const cli = await Promise.all(citacoes.map((c) => kb("resolver", c)));
    const { resposta } = resolverCitacoes.responder({ citacoes }, ctx);
    expect(resolverCitacoes.saida.safeParse(resposta).success).toBe(true);
    expect(
      resposta.dados.itens.map((i) => [i.texto, i.id, i.dispositivos, i.regra, i.confianca, i.situacao, i.titulo]),
    ).toEqual(
      cli.map((r: any) => [
        r.texto,
        r.id,
        r.id ? (r.dispositivos ?? (r.dispositivoId ? [r.dispositivoId] : [])).map((d: string) => `${r.id}${d}`) : [],
        r.regra,
        r.confianca,
        r.situacao,
        r.titulo ?? null,
      ]),
    );
  }, 60_000);
});
