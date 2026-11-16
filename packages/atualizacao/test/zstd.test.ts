// @effect-diagnostics nodeBuiltinImport:off -- teste: confere o formato contra o zstd do sistema, quando existir
import * as NodeChild from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { desempacotarSkill, empacotarSkill } from "../src/pacote-skill.ts";
import { aplicarPatch, comprimir, criarPatch, descomprimir } from "../src/zstd.ts";
import { limparTemporarios, pastaTemporaria } from "./apoio.ts";

afterEach(limparTemporarios);

const anterior = NodeCrypto.randomBytes(1_000_000);
const nova = Buffer.concat([anterior.subarray(0, 400_000), Buffer.from("trecho novo"), anterior.subarray(400_000)]);

const temZstd = (() => {
  try {
    NodeChild.execFileSync("zstd", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("zstd", () => {
  it("o patch é pequeno e reconstrói a versão nova", () => {
    const patch = criarPatch(anterior, nova, 3);
    expect(patch.byteLength).toBeLessThan(2000);
    expect(aplicarPatch(anterior, patch).equals(nova)).toBe(true);
    expect(descomprimir(comprimir(nova, 3)).equals(nova)).toBe(true);
  });

  it("o patch aplicado sobre outra base não reconstrói a nova (o checksum do zstd ou o sha256 recusam)", () => {
    const patch = criarPatch(anterior, nova, 3);
    const outra = NodeCrypto.randomBytes(1_000_000);
    let resultado: Buffer | undefined;
    try {
      resultado = aplicarPatch(outra, patch);
    } catch {
      resultado = undefined;
    }
    expect(resultado?.equals(nova) ?? false).toBe(false);
  });

  it.skipIf(!temZstd)("é o formato do zstd --patch-from, nos dois sentidos", () => {
    const pasta = pastaTemporaria();
    const [a, b, p, r, q] = ["a", "b", "p.zst", "r", "q.zst"].map((nome) => NodePath.join(pasta, nome)) as [
      string,
      string,
      string,
      string,
      string,
    ];
    NodeFS.writeFileSync(a, anterior);
    NodeFS.writeFileSync(b, nova);
    NodeFS.writeFileSync(p, criarPatch(anterior, nova, 3));
    NodeChild.execFileSync("zstd", ["-q", "-d", "-f", `--patch-from=${a}`, p, "-o", r]);
    expect(NodeFS.readFileSync(r).equals(nova)).toBe(true);
    NodeChild.execFileSync("zstd", ["-q", "-f", `--patch-from=${a}`, b, "-o", q]);
    expect(aplicarPatch(anterior, NodeFS.readFileSync(q)).equals(nova)).toBe(true);
  });

  it("o pacote de skill volta igual e recusa caminho para fora da pasta", () => {
    const pacote = {
      nome: "verificar-fundamentacao-normativa",
      versao: "1.2.0",
      arquivos: [
        { caminho: "SKILL.md", conteudo: Buffer.from("# skill") },
        { caminho: "references/relatorio.md", conteudo: Buffer.from("modelo") },
      ],
    };
    const lido = desempacotarSkill(empacotarSkill(pacote));
    expect(lido.nome).toBe(pacote.nome);
    expect(lido.arquivos.map((a) => a.caminho)).toEqual(["SKILL.md", "references/relatorio.md"]);
    expect(() =>
      empacotarSkill({ ...pacote, arquivos: [{ caminho: "../fora", conteudo: Buffer.from("x") }] }),
    ).toThrow();
    const hostil = comprimir(
      Buffer.from(
        JSON.stringify({
          formato: 1,
          nome: "x",
          versao: "1.0.0",
          arquivos: [{ caminho: "../../etc/x", conteudo: "" }],
        }),
      ),
    );
    expect(() => desempacotarSkill(hostil)).toThrow("arquivo inválido");
  });
});
