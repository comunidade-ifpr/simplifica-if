// @effect-diagnostics nodeBuiltinImport:off -- teste: confere o kb.sqlite real no disco
/**
 * Smoke do `pacote_contexto` (T4) contra a base real: os `dados` são, byte a byte, o JSON de
 * `kb pacote-contexto` (para um PPC da base e para um `.md` da pasta de trabalho, aqui a raiz do
 * repositório), o texto fica no teto de 80 mil caracteres mesmo com `todas`, e o mesmo PPC pela base
 * e pelo arquivo dá as mesmas fichas, normas, marcos e transições. Roda só com `SIMPLIFICA_SMOKE=1`
 * (`pnpm mcp:smoke`); a CLI roda antes e compila o `tmp/kb.sqlite` se ele faltar ou estiver velho.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { beforeAll, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { pacoteContexto, TETO_PACOTE_CONTEXTO } from "../src/ferramentas/pacote-contexto.ts";
import { layerHandlers } from "../src/ferramentas/toolkit.ts";
import { layerLeituraComPasta } from "../src/servidor.ts";
import { responder, saidaValida } from "./apoio.ts";

const RAIZ = NodePath.resolve(import.meta.dirname, "../../..");
const BANCO = NodePath.join(RAIZ, "tmp/kb.sqlite");
const ATIVO = process.env.SIMPLIFICA_SMOKE === "1";
const PPC = "curitiba/tecnico-em-enfermagem";
const ARQUIVO = `base-conhecimento/institucional/ifpr/ppcs/${PPC}.md`;

/** JSON da CLI. */
type Json = any;

/** `kb pacote-contexto <tarefa> <ppc ou arquivo> --json`, na raiz do repositório. */
function kb(tarefa: string, alvo: string): string {
  const r = NodeChildProcess.spawnSync(
    process.execPath,
    ["packages/kb/src/cli.ts", "pacote-contexto", tarefa, alvo, "--json"],
    { cwd: RAIZ, encoding: "utf-8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error(`kb pacote-contexto ${tarefa} ${alvo}: ${r.stderr}`);
  return r.stdout;
}

/** A chamada sobre o banco real, com a raiz do repositório como pasta de trabalho. */
const chamar = (args: Record<string, unknown>) =>
  Effect.gen(function* () {
    const r = yield* responder(pacoteContexto, args);
    expect(saidaValida(pacoteContexto, r.resposta)).toBe(true);
    expect(r.texto.length).toBeLessThanOrEqual(TETO_PACOTE_CONTEXTO);
    return r;
  }).pipe(
    Effect.provide(
      layerHandlers.pipe(
        Layer.provideMerge(layerLeituraComPasta({ banco: BANCO, canal: "dev", pastaTrabalho: RAIZ })),
        Layer.provide(NodeServices.layer),
      ),
    ),
  );

/** O JSON como a CLI o imprime (`paraJson`: indentado com 2 espaços, com quebra de linha no fim). */
const comoCli = (valor: unknown) => `${JSON.stringify(valor, null, 2)}\n`;

describe.skipIf(!ATIVO)("smoke: pacote_contexto × kb pacote-contexto na base real", () => {
  const cli: Record<string, string> = {};

  beforeAll(() => {
    // CLI primeiro: ela recompila o banco se estiver velho
    for (const tarefa of ["CT-CURR-12", "grupo-001", "todas"]) cli[tarefa] = kb(tarefa, PPC);
    cli.arquivo = kb("CT-CURR-12", ARQUIVO);
  }, 300_000);

  it.effect("PPC da base: dados = kb pacote-contexto, byte a byte (uma ficha, um grupo e todas)", () =>
    Effect.gen(function* () {
      for (const tarefa of ["CT-CURR-12", "grupo-001", "todas"]) {
        const { resposta } = yield* chamar({ tarefa, ppc: PPC });
        expect(comoCli(resposta.dados)).toBe(cli[tarefa]);
      }
    }),
  );

  it.effect("arquivo .md da pasta de trabalho: dados = kb pacote-contexto <arquivo>, byte a byte", () =>
    Effect.gen(function* () {
      const { resposta } = yield* chamar({ tarefa: "CT-CURR-12", arquivo: ARQUIVO });
      expect(comoCli(resposta.dados)).toBe(cli.arquivo);
    }),
  );

  it.effect("acima do teto (grupo e todas): texto no teto, com o aviso e as seções marcadas", () =>
    Effect.gen(function* () {
      for (const tarefa of ["grupo-001", "todas"]) {
        const { resposta, texto } = yield* chamar({ tarefa, ppc: PPC });
        expect(JSON.parse(cli[tarefa]!).tamanho.caracteres).toBeGreaterThan(TETO_PACOTE_CONTEXTO);
        expect(resposta.avisos.map((a) => a.tipo)).toContain("resultado-resumido");
        expect(texto.length).toBeGreaterThan(TETO_PACOTE_CONTEXTO * 0.9);
      }
      // uma ficha cabe inteira
      const { resposta } = yield* chamar({ tarefa: "CT-CURR-12", ppc: PPC });
      expect(resposta.avisos.map((a) => a.tipo)).not.toContain("resultado-resumido");
    }),
  );

  it.effect("o mesmo PPC pela base e pelo arquivo: mesmas fichas, normas, marcos e transições", () =>
    Effect.gen(function* () {
      const daBase: Json = (yield* chamar({ tarefa: "CT-CURR-12", ppc: PPC })).resposta.dados;
      const doArquivo: Json = (yield* chamar({ tarefa: "CT-CURR-12", arquivo: ARQUIVO })).resposta.dados;
      for (const parte of ["fichas_ids", "fichas", "normas", "marcos", "data_referencia", "transicoes"]) {
        expect(doArquivo[parte]).toEqual(daBase[parte]);
      }
      // cada seção do PPC da base está entre as do arquivo, com as mesmas linhas e o mesmo texto
      const chave = (s: Json) => [s.id.split("#")[1], s.tipo, s.linha_inicio, s.linha_fim, s.texto].join("\u0000");
      const doArquivoChaves = new Set(doArquivo.secoes.map(chave));
      for (const s of daBase.secoes) expect(doArquivoChaves.has(chave(s))).toBe(true);
    }),
  );
});
