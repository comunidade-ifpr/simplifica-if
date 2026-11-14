// @effect-diagnostics nodeBuiltinImport:off -- confere os trechos citados nos arquivos do checkout com node:fs síncrono
import { describe, expect, test } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import {
  carregarConfig,
  carregarGabaritoConjunto,
  carregarPerguntas,
  carregarUniversos,
  interpretarPerguntas,
  RAIZ_REPOSITORIO,
} from "./carregar.ts";

const PERGUNTA_MINIMA = `
versao: 1
perguntas:
  - id: Q01
    origem: plano
    categoria: vigencia
    tipo: pontual
    texto: Pergunta?
    gabarito:
      status: curado
      resposta_esperada: Resposta.
      deve_conter:
        - id: art71
          descricao: Cita o art. 71
          ancora: br/cne-cp/res/2026/2#art71
          padroes: ['art\\.?\\s*71']
`;

function erroDe(texto: string): string {
  try {
    interpretarPerguntas(texto);
  } catch (erro) {
    return (erro as Error).message;
  }
  return "";
}

describe("perguntas.yaml", () => {
  const { perguntas } = carregarPerguntas();

  test("tem de 20 a 30 perguntas, com as 8 do plano", () => {
    expect(perguntas.length).toBeGreaterThanOrEqual(20);
    expect(perguntas.length).toBeLessThanOrEqual(30);
    const doPlano = perguntas.filter((pergunta) => pergunta.origem === "plano").map((pergunta) => pergunta.id);
    expect(doPlano).toEqual(["Q01", "Q02", "Q03", "Q04", "Q05", "Q06", "Q07", "Q08"]);
  });

  test("cobre as categorias de uso real", () => {
    const categorias = new Set(perguntas.map((pergunta) => pergunta.categoria));
    for (const categoria of [
      "citacao-dispositivo",
      "vigencia",
      "impacto-revogacao",
      "agregacao-institucional",
      "busca-tematica-ppc",
      "cnct",
      "correspondencia",
    ]) {
      expect(categorias.has(categoria as never)).toBe(true);
    }
  });

  test("todo trecho citado existe literalmente no arquivo indicado", () => {
    const faltando: string[] = [];
    for (const pergunta of perguntas) {
      for (const criterio of [...pergunta.gabarito.deve_conter, ...pergunta.gabarito.nao_deve_conter]) {
        if (!criterio.trecho && !criterio.arquivo) continue;
        if (!criterio.trecho || !criterio.arquivo) {
          faltando.push(`${pergunta.id}/${criterio.id}: trecho e arquivo andam juntos`);
          continue;
        }
        const caminho = NodePath.join(RAIZ_REPOSITORIO, criterio.arquivo);
        if (!NodeFS.existsSync(caminho) || !NodeFS.readFileSync(caminho, "utf-8").includes(criterio.trecho)) {
          faltando.push(`${pergunta.id}/${criterio.id}: ${criterio.trecho}`);
        }
      }
    }
    expect(faltando).toEqual([]);
  });

  test("cada pergunta de conjunto aponta para um gabarito gerado da mesma pergunta", () => {
    const universos = carregarUniversos();
    for (const pergunta of perguntas.filter((p) => p.tipo === "conjunto")) {
      const conjunto = carregarGabaritoConjunto(pergunta.gabarito.conjunto?.arquivo ?? "");
      expect(conjunto.pergunta).toBe(pergunta.id);
      const ids = new Set(universos[conjunto.universo].map((item) => item.id));
      for (const id of conjunto.esperado) expect(ids.has(id)).toBe(true);
    }
  });

  test("perguntas provisórias explicam o que falta em observacoes", () => {
    for (const pergunta of perguntas.filter((p) => p.gabarito.status === "provisorio")) {
      expect(pergunta.gabarito.observacoes ?? "").not.toBe("");
    }
  });
});

describe("validação do YAML", () => {
  test("aceita a pergunta mínima", () => {
    expect(interpretarPerguntas(PERGUNTA_MINIMA).perguntas[0]?.gabarito.nao_deve_conter).toEqual([]);
  });

  test("recusa id repetido", () => {
    const duplicado = `${PERGUNTA_MINIMA}${PERGUNTA_MINIMA.split("perguntas:\n")[1]}`;
    expect(erroDe(duplicado)).toContain("id repetido: Q01");
  });

  test("recusa regex inválida", () => {
    expect(erroDe(PERGUNTA_MINIMA.replace("['art\\.?\\s*71']", "['art(71']"))).toContain("regex inválida");
  });

  test("recusa âncora fora do formato de ID", () => {
    expect(erroDe(PERGUNTA_MINIMA.replace("br/cne-cp/res/2026/2#art71", "Res CNE/CP 2/2026, art. 71"))).toContain(
      "âncora fora do formato",
    );
  });

  test("recusa pergunta de conjunto sem gabarito de conjunto", () => {
    expect(erroDe(PERGUNTA_MINIMA.replace("tipo: pontual", "tipo: conjunto"))).toContain("sem gabarito.conjunto");
  });

  test("recusa categoria desconhecida e status fora do enum", () => {
    expect(erroDe(PERGUNTA_MINIMA.replace("categoria: vigencia", "categoria: outra"))).toContain("categoria");
    expect(erroDe(PERGUNTA_MINIMA.replace("status: curado", "status: talvez"))).toContain("status");
  });
});

describe("config.yaml", () => {
  test("é válido e só pré-aprova ferramentas de leitura dentro do repositório", () => {
    const config = carregarConfig();
    expect(config.execucoes).toBeGreaterThanOrEqual(1);
    for (const regra of config.ferramentas_permitidas) {
      expect(regra).toMatch(/^(?:Read\(\.\/\*\*\)|Grep|Glob)$/u);
    }
  });
});
