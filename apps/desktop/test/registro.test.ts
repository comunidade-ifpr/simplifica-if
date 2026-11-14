// @effect-diagnostics nodeBuiltinImport:off -- teste do processo principal (sem Effect): arquivos temporários
/** O arquivo de log do app: cria a pasta, acrescenta e gira no limite. */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { abrirLog, NOME_LOG } from "../src/registro.ts";

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
