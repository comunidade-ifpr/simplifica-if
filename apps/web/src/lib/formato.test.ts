import { assert, describe, it } from "@effect/vitest";
import {
  dataCurta,
  dataHora,
  dataPorExtenso,
  diaDe,
  dolares,
  inteiro,
  megabytes,
  numeroMegabytes,
  tamanhoArquivo,
} from "./formato.ts";

describe("formato em pt-BR (M1.14)", () => {
  it("dólares pelo Intl, com 3 casas abaixo de 10 centavos", () => {
    assert.strictEqual(dolares(0.0254), "US$ 0,025");
    assert.strictEqual(dolares(0.33), "US$ 0,33");
    assert.strictEqual(dolares(1.5), "US$ 1,50");
    assert.strictEqual(dolares(1234.5), "US$ 1.234,50");
    assert.strictEqual(dolares(0), "US$ 0,00");
  });

  it("números com separador de milhar e vírgula decimal", () => {
    assert.strictEqual(inteiro(12345), "12.345");
    assert.strictEqual(megabytes(1_310_720), "1,3 MB");
    assert.strictEqual(numeroMegabytes(47_815_066), "45,6");
    assert.strictEqual(tamanhoArquivo(512), "512 B");
    assert.strictEqual(tamanhoArquivo(12_800), "13 KB");
    assert.strictEqual(tamanhoArquivo(1_310_720), "1,3 MB");
  });

  it("datas sem hora em UTC, e o que não é data como veio", () => {
    assert.strictEqual(dataCurta("2026-11-12"), "12/11/2026");
    assert.strictEqual(dataCurta("2026-01-01T00:00:00Z"), "01/01/2026");
    assert.strictEqual(dataCurta("a confirmar"), "a confirmar");
    assert.strictEqual(dataPorExtenso("2026-11-11"), "11 de novembro de 2026");
  });

  it("instantes no fuso do computador, no formato curto", () => {
    assert.match(dataHora("2026-11-12T15:05:00"), /^12\/11\/2026,? 15:05$/);
    assert.strictEqual(diaDe(new Date(2026, 10, 12, 23, 30)), "12/11/2026");
    assert.strictEqual(dataHora("não é data"), "não é data");
  });
});
