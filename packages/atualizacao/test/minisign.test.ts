// @effect-diagnostics nodeBuiltinImport:off -- teste: assinatura legada montada à mão com o node:crypto
import * as NodeCrypto from "node:crypto";
import { describe, expect, it } from "@effect/vitest";
import {
  assinar,
  escreverChavePublica,
  escreverChaveSecreta,
  gerarChaves,
  lerChavePublica,
  lerChaveSecreta,
  parametrosScrypt,
  verificar,
} from "../src/minisign.ts";

const dados = Buffer.from('{"canal":"beta","versao":"2026.11.13"}\n', "utf8");

describe("minisign", () => {
  it("assina e confere, e o arquivo .pub lido de volta é a mesma chave", () => {
    const chave = gerarChaves();
    const publica = lerChavePublica(escreverChavePublica(chave));
    const assinatura = assinar(dados, chave, "timestamp:1\tfile:beta.json");
    expect(assinatura.split("\n")[2]).toBe("trusted comment: timestamp:1\tfile:beta.json");
    expect(verificar(dados, assinatura, publica)).toBe("timestamp:1\tfile:beta.json");
  });

  it("recusa dado alterado, outra chave e comentário confiável trocado", () => {
    const chave = gerarChaves();
    const assinatura = assinar(dados, chave, "versao:2026.11.13");
    expect(() => verificar(Buffer.from("outro"), assinatura, chave)).toThrow("assinatura inválida");
    expect(() => verificar(dados, assinatura, gerarChaves())).toThrow("outra chave");
    const outraMesmoId = { ...gerarChaves(), id: chave.id };
    expect(() => verificar(dados, assinatura, outraMesmoId)).toThrow("assinatura inválida");
    const trocada = assinatura.replace("versao:2026.11.13", "versao:2099.01.01");
    expect(() => verificar(dados, trocada, chave)).toThrow("comentário confiável adulterado");
    expect(() => verificar(dados, "lixo", chave)).toThrow();
  });

  it("aceita a assinatura legada (Ed, sem pré-hash)", () => {
    const chave = gerarChaves();
    const privada = NodeCrypto.createPrivateKey({
      key: {
        kty: "OKP",
        crv: "Ed25519",
        d: Buffer.from(chave.secreta.subarray(0, 32)).toString("base64url"),
        x: Buffer.from(chave.chave).toString("base64url"),
      },
      format: "jwk",
    });
    const sig = NodeCrypto.sign(null, dados, privada);
    const comentario = "legado";
    const global = NodeCrypto.sign(null, Buffer.concat([sig, Buffer.from(comentario)]), privada);
    const texto = [
      "untrusted comment: x",
      Buffer.concat([Buffer.from("Ed"), chave.id, sig]).toString("base64"),
      `trusted comment: ${comentario}`,
      global.toString("base64"),
    ].join("\n");
    expect(verificar(dados, texto, chave)).toBe("legado");
  });

  it("lê a chave secreta sem senha e cifrada (scrypt), e recusa a senha errada", () => {
    const chave = gerarChaves();
    const semSenha = lerChaveSecreta(escreverChaveSecreta(chave));
    expect(Buffer.from(semSenha.secreta).equals(Buffer.from(chave.secreta))).toBe(true);
    const cifrada = escreverChaveSecreta(chave, { senha: "segredo", opslimit: 32768, memlimit: 8 * 1024 * 1024 });
    expect(cifrada).toContain("encrypted");
    const lida = lerChaveSecreta(cifrada, "segredo");
    expect(verificar(dados, assinar(dados, lida, "c"), chave)).toBe("c");
    expect(() => lerChaveSecreta(cifrada, "errada")).toThrow("senha errada");
    expect(() => lerChaveSecreta(cifrada)).toThrow("falta a senha");
  });

  it("os parâmetros do scrypt são os do libsodium para os limites padrão do minisign", () => {
    expect(parametrosScrypt(33_554_432, 1_073_741_824)).toEqual({ N: 2 ** 20, r: 8, p: 1 });
    expect(parametrosScrypt(32768, 8 * 1024 * 1024)).toEqual({ N: 2 ** 10, r: 8, p: 1 });
  });
});
