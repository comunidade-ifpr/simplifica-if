// @effect-diagnostics nodeBuiltinImport:off -- teste do processo principal (sem Effect): arquivos temporários
/** O arquivo de log do app: cria a pasta, acrescenta e gira no limite. */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { abrirLog, limitarRegistros, linhaDaInterface, NOME_LOG } from "../src/registro.ts";

const pastas: Array<string> = [];
afterEach(() => {
  for (const pasta of pastas.splice(0)) NodeFS.rmSync(pasta, { recursive: true, force: true });
});

function pastaTemporaria(): string {
  const pasta = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "simplifica-log-"));
  pastas.push(pasta);
  return pasta;
}

describe("abrirLog", () => {
  test("cria a pasta e acrescenta ao que já havia", () => {
    const pasta = NodePath.join(pastaTemporaria(), "Logs", "Simplifica IF");
    abrirLog(pasta).escrever("primeira\n");
    const log = abrirLog(pasta);
    log.escrever("segunda\n");
    expect(log.caminho).toBe(NodePath.join(pasta, NOME_LOG));
    expect(NodeFS.readFileSync(log.caminho, "utf8")).toBe("primeira\nsegunda\n");
  });

  test("passando do limite, o arquivo vira .1 e outro começa", () => {
    const pasta = pastaTemporaria();
    const log = abrirLog(pasta, 10);
    log.escrever("123456");
    log.escrever("7890ab");
    log.escrever("novo");
    expect(NodeFS.readFileSync(`${log.caminho}.1`, "utf8")).toBe("1234567890ab");
    expect(NodeFS.readFileSync(log.caminho, "utf8")).toBe("novo");
    // Ao abrir de novo um arquivo que já passou do limite, ele também gira.
    NodeFS.writeFileSync(log.caminho, "x".repeat(20));
    abrirLog(pasta, 10).escrever("depois");
    expect(NodeFS.readFileSync(`${log.caminho}.1`, "utf8")).toBe("x".repeat(20));
    expect(NodeFS.readFileSync(log.caminho, "utf8")).toBe("depois");
  });

  test("uma pasta que não se cria não derruba quem escreve", () => {
    const arquivo = NodePath.join(pastaTemporaria(), "arquivo");
    NodeFS.writeFileSync(arquivo, "");
    const log = abrirLog(NodePath.join(arquivo, "logs"));
    expect(() => log.escrever("nada")).not.toThrow();
  });
});

describe("linhaDaInterface", () => {
  test("normaliza as quebras, tira ANSI e controles e recua a continuação", () => {
    const texto = "erro\r\nlinha 2\rlinha 3\u2028linha 4\u2029linha 5\u001b[31m vermelho\u001b[0m\u0007\u0000\tfim\n\n";
    expect(linhaDaInterface("T", texto)).toBe(
      "T [interface] erro\n    linha 2\n    linha 3\n    linha 4\n    linha 5 vermelho\tfim\n",
    );
  });

  test("uma linha forjada não começa um registro novo", () => {
    const linha = linhaDaInterface("T", "a\r2026-01-01T00:00:00.000Z [desktop] falso");
    expect(linha.split("\n").filter((parte) => parte.startsWith("2026"))).toHaveLength(0);
  });
});

describe("limitarRegistros", () => {
  test("passando do teto, descarta o resto da janela e avisa quantos na janela seguinte", () => {
    let agora = 0;
    const gravados: Array<string> = [];
    const registrar = limitarRegistros({
      maximo: 2,
      janelaMs: 60_000,
      agora: () => agora,
      gravar: (texto) => gravados.push(texto),
      suprimidos: (n) => `${n} suprimidos`,
    });
    for (const texto of ["a", "b", "c", "d"]) registrar(texto);
    expect(gravados).toEqual(["a", "b"]);
    agora = 59_999;
    registrar("e");
    expect(gravados).toEqual(["a", "b"]);
    agora = 60_000;
    registrar("f");
    expect(gravados).toEqual(["a", "b", "3 suprimidos", "f"]);
    agora = 200_000;
    registrar("g");
    expect(gravados).toEqual(["a", "b", "3 suprimidos", "f", "g"]);
  });
});
