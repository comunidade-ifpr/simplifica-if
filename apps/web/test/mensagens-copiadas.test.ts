import { assert, describe, it } from "@effect/vitest";
import { explicarErroDoTurno, tipoFalha } from "../src/conexao/erros.ts";
import { explicarMensagemMotor, FALHA_GENERICA_MOTOR } from "../src/providers.ts";
import { palavrasSuspeitas } from "./ingles.ts";
import { comExemplo, DESTINOS, frasesCopiadas, frasesDoArquivo } from "./mensagens-copiadas.ts";

describe("frases do código copiado do T3 (M1.14)", () => {
  const achadas = frasesCopiadas();

  it("o varredor acha as frases de string e de template, com as interpolações como …", () => {
    assert.deepStrictEqual(
      frasesDoArquivo(
        [
          'const a = "Checking Codex.";',
          'const b = "Gemini API key";',
          "const c = `Antigravity needs at least ${Math.ceil(x / 1024)} MiB of free space to install.`;",
          'const d = `T3 Code MCP ${m} failed${e === undefined ? "." : `: ${JSON.stringify(e)}`}`;',
          "const e = `Write-Output '${x}'`;",
        ].join("\n"),
      ),
      ["Checking Codex.", "Antigravity needs at least … MiB of free space to install.", "T3 Code MCP … failed…"],
    );
  });

  it("cada frase achada no código está na lista explícita, e a lista não tem frase que sumiu", () => {
    const novas = [...achadas]
      .filter(([frase]) => !(frase in DESTINOS))
      .map(([frase, arquivo]) => `${arquivo}: ${frase}`);
    assert.deepStrictEqual(
      novas,
      [],
      "frase nova no código copiado: dê a ela um destino em test/mensagens-copiadas.ts",
    );
    const sumidas = Object.keys(DESTINOS).filter((frase) => !achadas.has(frase));
    assert.deepStrictEqual(
      sumidas,
      [],
      "frase que não está mais no código copiado: tire de test/mensagens-copiadas.ts",
    );
  });

  it("as do motor viram uma frase em português, não a genérica", () => {
    const problemas: Array<string> = [];
    for (const [frase, destino] of Object.entries(DESTINOS)) {
      if (destino !== "motor") continue;
      const { texto } = explicarMensagemMotor(comExemplo(frase));
      if (texto === FALHA_GENERICA_MOTOR) problemas.push(`genérica: ${frase}`);
      else if (palavrasSuspeitas(texto).length > 0) problemas.push(`inglês ou jargão em "${texto}": ${frase}`);
    }
    assert.deepStrictEqual(problemas, []);
  });

  it("as dos protocolos caem no tipo de falha da lista (ou, as internas, na frase genérica)", () => {
    const problemas: Array<string> = [];
    for (const [frase, destino] of Object.entries(DESTINOS)) {
      if (destino === "motor" || typeof destino === "object") continue;
      const tipo = tipoFalha("", comExemplo(frase));
      const esperado = destino === "generica" ? undefined : destino;
      if (tipo !== esperado) problemas.push(`${frase}: ${tipo ?? "genérica"} (esperado ${esperado ?? "genérica"})`);
      const { texto, detalhe } = explicarErroDoTurno("codex", comExemplo(frase));
      if (palavrasSuspeitas(texto).length > 0) problemas.push(`inglês ou jargão em "${texto}"`);
      if (detalhe !== comExemplo(frase)) problemas.push(`sem o original nos detalhes: ${frase}`);
    }
    assert.deepStrictEqual(problemas, []);
  });
});
