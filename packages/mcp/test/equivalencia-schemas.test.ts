// @effect-diagnostics nodeBuiltinImport:off -- teste: lê o gabarito versionado em testes-gabarito/
/**
 * Equivalência dos JSON Schemas (passo 7 do C2): as definições das ferramentas, com os schemas gerados
 * do Effect Schema, contra o `tools/list` do gabarito do C0 (gerado pelo zod). Mesmos nomes, títulos,
 * descrições e anotações; mesma forma normalizada, salvo as diferenças listadas em `equivalencia.ts`;
 * e o mesmo veredito do ajv para as amostras válidas e inválidas de entrada e de saída. Não depende do
 * `tmp/kb.sqlite`: o gabarito está no git. Pelo protocolo, o mesmo confere `gabarito.ts --comparar
 * --schemas-equivalentes`.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { jsonSchema } from "../src/esquema.ts";
import { FERRAMENTAS } from "../src/ferramentas/toolkit.ts";
import { type ChamadaDoGabarito, compararDefinicoes, type DefinicaoListada } from "./equivalencia.ts";

const GABARITO = NodePath.resolve(import.meta.dirname, "../../../testes-gabarito/mcp.json");

const gabarito = JSON.parse(NodeFS.readFileSync(GABARITO, "utf8")) as {
  readonly tools: readonly DefinicaoListada[];
  readonly chamadas: readonly ChamadaDoGabarito[];
};

/** As definições como o `registrarFerramentas` as publica no `tools/list`. */
const novas: DefinicaoListada[] = FERRAMENTAS.map((f) => ({
  name: f.nome,
  title: f.titulo,
  description: f.descricao,
  annotations: {
    title: f.titulo,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: jsonSchema(f.entrada),
  outputSchema: jsonSchema(f.saida),
}));

describe("equivalência dos JSON Schemas com o gabarito do C0", () => {
  it("mesmas ferramentas, textos e anotações; forma e veredito equivalentes", () => {
    const { problemas, amostras } = compararDefinicoes(gabarito.tools, novas, gabarito.chamadas);
    expect(problemas).toEqual([]);
    // as amostras cobrem todas as ferramentas, com os limites de cada campo
    expect(amostras).toBeGreaterThan(5000);
  });
});
