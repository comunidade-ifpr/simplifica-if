// @effect-diagnostics nodeBuiltinImport:off -- o teste lê os PPCs convertidos da base
/**
 * Os filtros de texto dirigido à IA não marcam nenhuma linha dos PPCs convertidos da base, que não
 * têm nada disso: toda linha marcada seria falso positivo.
 *
 * - `dirigidoAIa` (triagem da pré-conferência);
 * - `linhaDirigidaARevisao` (prova de leitura, etapa 5b), na linha sozinha ou junto da seguinte: uma
 *   linha marcada tiraria uma prova legítima da seção.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { expect, test } from "vite-plus/test";
import { dirigidoAIa } from "../src/pre-conferencia.ts";
import { linhaDirigidaARevisao } from "../src/revisao-ia/conversa.ts";

const RAIZ = NodePath.join(import.meta.dirname, "../../../base-conhecimento/institucional/ifpr/ppcs");

test("nenhuma linha dos PPCs da base é texto dirigido à IA nem pedido à revisão", () => {
  const dirigidas: string[] = [];
  const pedidos: string[] = [];
  let ppcs = 0;
  // ppcs/<campus>/<curso>/<versao>.md
  for (const campus of NodeFS.readdirSync(RAIZ)) {
    const pastaCampus = NodePath.join(RAIZ, campus);
    if (!NodeFS.statSync(pastaCampus).isDirectory() || campus === "secoes") continue;
    for (const curso of NodeFS.readdirSync(pastaCampus)) {
      const pasta = NodePath.join(pastaCampus, curso);
      if (!NodeFS.statSync(pasta).isDirectory()) continue;
      for (const arquivo of NodeFS.readdirSync(pasta).filter((f) => f.endsWith(".md"))) {
        ppcs += 1;
        const linhas = NodeFS.readFileSync(NodePath.join(pasta, arquivo), "utf8").split("\n");
        linhas.forEach((linha, i) => {
          const onde = `${campus}/${curso}/${arquivo}:${i + 1}`;
          if (dirigidoAIa(linha)) dirigidas.push(onde);
          if (linhaDirigidaARevisao(linha) || linhaDirigidaARevisao(`${linha} ${linhas[i + 1] ?? ""}`))
            pedidos.push(onde);
        });
      }
    }
  }
  const indice = JSON.parse(NodeFS.readFileSync(NodePath.join(RAIZ, "index.json"), "utf8")) as { total_itens: number };
  expect(ppcs).toBe(indice.total_itens);
  expect(dirigidas).toEqual([]);
  expect(pedidos).toEqual([]);
}, 120_000);
