// @effect-diagnostics nodeBuiltinImport:off -- teste: confere o formato contra o zstd do sistema, quando existir
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { desempacotarSkill, empacotarSkill } from "../src/pacote-skill.ts";
import { aplicarPatch } from "../src/pesado.ts";
import { comprimir, criarPatch, descomprimir } from "../src/zstd.ts";
import { limparTemporarios, pastaTemporaria } from "../src/testes/apoio.ts";

afterEach(limparTemporarios);

const LIMITE_TESTE = 10_000_000;
const anterior = NodeCrypto.randomBytes(1_000_000);
const nova = Buffer.concat([anterior.subarray(0, 400_000), Buffer.from("trecho novo"), anterior.subarray(400_000)]);

const temZstd = (() => {
  try {
    NodeChildProcess.execFileSync("zstd", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("zstd", () => {
  it.effect("o patch é pequeno e reconstrói a versão nova", () =>
    Effect.gen(function* () {
      const patch = criarPatch(anterior, nova, 3);
      expect(patch.byteLength).toBeLessThan(2000);
      expect((yield* aplicarPatch(anterior, patch, LIMITE_TESTE)).equals(nova)).toBe(true);
      expect(descomprimir(comprimir(nova, 3)).equals(nova)).toBe(true);
    }),
  );

  it.effect("o patch aplicado sobre outra base não reconstrói a nova (o checksum do zstd ou o sha256 recusam)", () =>
    Effect.gen(function* () {
      const patch = criarPatch(anterior, nova, 3);
      const outra = NodeCrypto.randomBytes(1_000_000);
      const resultado = yield* aplicarPatch(outra, patch, LIMITE_TESTE).pipe(Effect.orElseSucceed(() => undefined));
      expect(resultado?.equals(nova) ?? false).toBe(false);
    }),
  );

  const testarZstd = temZstd ? it.effect : it.effect.skip;
  testarZstd("é o formato do zstd --patch-from, nos dois sentidos", () =>
    Effect.gen(function* () {
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
      NodeChildProcess.execFileSync("zstd", ["-q", "-d", "-f", `--patch-from=${a}`, p, "-o", r]);
      expect(NodeFS.readFileSync(r).equals(nova)).toBe(true);
      NodeChildProcess.execFileSync("zstd", ["-q", "-f", `--patch-from=${a}`, b, "-o", q]);
      expect((yield* aplicarPatch(anterior, NodeFS.readFileSync(q), LIMITE_TESTE)).equals(nova)).toBe(true);
    }),
  );

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
