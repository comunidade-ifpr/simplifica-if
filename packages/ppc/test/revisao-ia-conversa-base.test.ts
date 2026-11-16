// @effect-diagnostics nodeBuiltinImport:off -- o teste lê os PPCs convertidos da base
/**
 * O filtro de pedidos à revisão da prova de leitura (`linhaDirigidaARevisao`, etapa 5b) não marca
 * nenhuma linha dos PPCs convertidos da base, sozinha ou junto da seguinte: nenhum deles tem pedido à
 * revisão, então toda linha marcada seria falso positivo (e tiraria uma prova legítima da seção).
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { expect, test } from "vite-plus/test";
import { linhaDirigidaARevisao } from "../src/revisao-ia/conversa.ts";

const RAIZ = NodePath.join(import.meta.dirname, "../../../base-conhecimento/institucional/ifpr/ppcs");

test("nenhuma linha dos PPCs da base é pedido à revisão", () => {
  const marcadas: string[] = [];
  let ppcs = 0;
  for (const campus of NodeFS.readdirSync(RAIZ)) {
    const pasta = NodePath.join(RAIZ, campus);
    if (!NodeFS.statSync(pasta).isDirectory()) continue;
    for (const arquivo of NodeFS.readdirSync(pasta).filter((f) => f.endsWith(".md"))) {
      ppcs += 1;
      const linhas = NodeFS.readFileSync(NodePath.join(pasta, arquivo), "utf8").split("\n");
      linhas.forEach((linha, i) => {
        if (linhaDirigidaARevisao(linha) || linhaDirigidaARevisao(`${linha} ${linhas[i + 1] ?? ""}`))
          marcadas.push(`${campus}/${arquivo}:${i + 1}`);
      });
    }
  }
  expect(ppcs).toBeGreaterThan(200);
  expect(marcadas).toEqual([]);
}, 120_000);
