import { describe, expect, test } from "bun:test";
import { ErroUso, executarComando, exigirOpcoesDe, inteiro, lerArgumentos, type Saida } from "./cli.ts";

function capturar() {
  const saida = { out: [] as string[], err: [] as string[] };
  const destino: Saida = {
    escrever: (texto) => saida.out.push(texto),
    escreverErro: (texto) => saida.err.push(texto),
  };
  return { saida, destino };
}

const OPCOES = { check: { type: "boolean" } } as const;
const USO = "uso: x.ts [--check]";

describe("lerArgumentos", () => {
  test("lê a flag e aceita ausência", () => {
    const { destino } = capturar();
    const com = lerArgumentos(["--check"], OPCOES, { uso: USO, saida: destino });
    const sem = lerArgumentos([], OPCOES, { uso: USO, saida: destino });
    expect("values" in com && com.values.check).toBe(true);
    expect("values" in sem && sem.values.check).toBeUndefined();
  });

  test("--help e -h imprimem o uso e saem com 0", () => {
    for (const ajuda of ["--help", "-h"]) {
      const { saida, destino } = capturar();
      expect(lerArgumentos([ajuda], OPCOES, { uso: USO, saida: destino })).toEqual({ codigo: 0 });
      expect(saida.out).toEqual([USO]);
    }
  });

  test("opção desconhecida, abreviação, valor indevido e posicional dão código 2 com o uso no stderr", () => {
    for (const argv of [["--foo"], ["--chec"], ["--check=1"], ["extra"]]) {
      const { saida, destino } = capturar();
      expect(lerArgumentos(argv, OPCOES, { uso: USO, saida: destino })).toEqual({ codigo: 2 });
      expect(saida.err[0]).toStartWith(`${USO}\nerro: `);
      expect(saida.out).toEqual([]);
    }
  });

  test("posicionais só com permissão explícita", () => {
    const { destino } = capturar();
    const lido = lerArgumentos(["a"], OPCOES, { uso: USO, saida: destino, posicionais: true });
    expect("positionals" in lido && lido.positionals).toEqual(["a"]);
  });
});

describe("executarComando e auxiliares", () => {
  test("ErroUso vira código 2; erro tratado vira o código devolvido; o resto propaga", async () => {
    const { saida, destino } = capturar();
    expect(
      await executarComando(USO, destino, () => {
        throw new ErroUso("ruim");
      }),
    ).toBe(2);
    expect(saida.err).toEqual([`${USO}\nerro: ruim`]);
    const tratar = (erro: unknown) => (erro instanceof RangeError ? 1 : undefined);
    expect(
      await executarComando(
        USO,
        destino,
        () => {
          throw new RangeError("x");
        },
        tratar,
      ),
    ).toBe(1);
    await expect(
      executarComando(
        USO,
        destino,
        () => {
          throw new TypeError("y");
        },
        tratar,
      ),
    ).rejects.toThrow("y");
  });

  test("inteiro e exigirOpcoesDe", () => {
    expect(inteiro("n", undefined)).toBeUndefined();
    expect(inteiro("n", " 7 ")).toBe(7);
    expect(() => inteiro("n", "7x")).toThrow(ErroUso);
    expect(() => exigirOpcoesDe("cmd", { json: true, help: true }, ["json"])).not.toThrow();
    expect(() => exigirOpcoesDe("cmd", { campus: "x" }, ["json"])).toThrow("opção não aceita por cmd: --campus");
  });
});
