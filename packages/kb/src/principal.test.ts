import * as Cause from "effect/Cause";
import * as CliError from "effect/cli/CliError";
import { describe, expect, test } from "vite-plus/test";
import { EncerrarComCodigo, mensagemDoErro, textoDaFalha } from "./principal.ts";

describe("textoDaFalha", () => {
  const padrao = textoDaFalha("kb");

  test.each([
    ["interrupção", Cause.interrupt()],
    ["EncerrarComCodigo", Cause.fail(new EncerrarComCodigo({ codigo: 2 }))],
    ["erro de uso", Cause.fail(new CliError.UnrecognizedOption({ option: "--x", suggestions: [] }))],
  ])("%s não escreve nada", (_, causa) => {
    expect(padrao(causa)).toBeUndefined();
  });

  test("erro tipado vira `<nome>: <mensagem>`, ou a linha de mensagemDe", () => {
    const causa = Cause.fail(new Error("ID desconhecido"));
    expect(padrao(causa)).toBe("kb: ID desconhecido");
    expect(textoDaFalha("sei", { mensagemDe: mensagemDoErro })(causa)).toBe("ID desconhecido");
  });

  test("defeito vira Cause.pretty, ou o texto de mensagemDoDefeito", () => {
    const causa = Cause.die(new TypeError("quebrou"));
    expect(padrao(causa)).toBe(Cause.pretty(causa));
    expect(textoDaFalha("x", { mensagemDoDefeito: (c) => String(Cause.squash(c)) })(causa)).toBe("TypeError: quebrou");
  });
});
