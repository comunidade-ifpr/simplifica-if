// @effect-diagnostics nodeBuiltinImport:off -- teste: pastas do app, pacotes adulterados e bancos corrompidos em pastas temporárias
/**
 * Os cenários do M1.10 contra um servidor HTTP local, com manifesto e pacotes gerados pela fábrica
 * (`gerarCanal`) e assinados por um par descartável. Nada sai para a rede.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import type { SkillDaFabrica } from "../src/fabrica.ts";
import { caminhos, lerEstado, lerInfoBanco, prepararAbertura } from "../src/local.ts";
import { gerarChaves } from "../src/minisign.ts";
import { criarBanco, limparTemporarios } from "../src/testes/apoio.ts";
import { type Cenario, cenario } from "../src/testes/cenario.ts";

afterEach(limparTemporarios);

const semPendente = (c: Cenario) => {
  expect(NodeFS.existsSync(caminhos(c.pastaApp).pendente)).toBe(false);
  expect(NodeFS.existsSync(caminhos(c.pastaApp).baixando)).toBe(false);
  expect(lerEstado(c.pastaApp).pendente).toBeUndefined();
};

describe("atualização da base", () => {
  it("normal: baixa o pacote inteiro, deixa pendente e troca na abertura seguinte", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13" });
      expect(await c.atualizar()).toMatchObject({ tipo: "baixada", versao: "2026.11.13", via: "inteiro" });
      expect(lerEstado(c.pastaApp).pendente?.versao).toBe("2026.11.13");
      const abertura = prepararAbertura({ pasta: c.pastaApp, bancoEmpacotado: c.empacotada });
      expect(abertura).toMatchObject({ origem: "baixada", banco: caminhos(c.pastaApp).atual });
      expect(abertura.info?.versao).toBe("2026.11.13");
      expect(lerEstado(c.pastaApp).novidades).toMatchObject({ versao: "2026.11.13", vista: false });
      // Conferir de novo: em dia, nada se baixa além do manifesto.
      c.servidor.pedidos.length = 0;
      expect(await c.atualizar()).toEqual({ tipo: "em-dia" });
      expect(c.servidor.pedidos).toEqual(["beta/beta.json", "beta/beta.json.minisig"]);
    } finally {
      await c.fechar();
    }
  });

  it("patch: com a versão anterior em uso, baixa só o patch", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13", anteriores: [c.empacotada] });
      expect(await c.atualizar()).toMatchObject({ tipo: "baixada", via: "patch" });
      expect(c.servidor.pedidos).toContain("beta/base-2026.11.10-2026.11.13.patch.zst");
      expect(c.servidor.pedidos).not.toContain("beta/base-2026.11.13.sqlite.zst");
      expect(prepararAbertura({ pasta: c.pastaApp, bancoEmpacotado: c.empacotada }).info?.versao).toBe("2026.11.13");
    } finally {
      await c.fechar();
    }
  });

  it("assinatura de outra chave: manifesto recusado, nada baixado", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13", chave: gerarChaves() });
      await expect(c.atualizar()).rejects.toThrow("manifesto recusado");
      expect(c.servidor.pedidos).toEqual(["beta/beta.json", "beta/beta.json.minisig"]);
      semPendente(c);
    } finally {
      await c.fechar();
    }
  });

  it("manifesto alterado depois de assinado: recusado", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13" });
      const arquivo = NodePath.join(c.raiz, "servido", "beta", "beta.json");
      NodeFS.writeFileSync(arquivo, NodeFS.readFileSync(arquivo, "utf8").replace('"0.1.0"', '"0.0.1"'));
      await expect(c.atualizar()).rejects.toThrow("assinatura inválida");
    } finally {
      await c.fechar();
    }
  });

  it("sha256 errado no pacote: recusado, base em uso intacta", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13" });
      const pacote = NodePath.join(c.raiz, "servido", "beta", "base-2026.11.13.sqlite.zst");
      const bytes = NodeFS.readFileSync(pacote);
      bytes[100] = bytes[100]! ^ 0xff;
      NodeFS.writeFileSync(pacote, bytes);
      await expect(c.atualizar()).rejects.toThrow("sha256 diferente do manifesto");
      semPendente(c);
      expect(prepararAbertura({ pasta: c.pastaApp, bancoEmpacotado: c.empacotada }).origem).toBe("empacotada");
    } finally {
      await c.fechar();
    }
  });

  it("app_minimo maior que o app: avisa e não baixa nada", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13", appMinimo: "0.2.0" });
      expect(await c.atualizar()).toEqual({ tipo: "app-desatualizado", appMinimo: "0.2.0", versao: "2026.11.13" });
      expect(c.servidor.pedidos).toHaveLength(2);
      semPendente(c);
    } finally {
      await c.fechar();
    }
  });

  it("banco corrompido ou de outro esquema: recusado depois do hash, base em uso intacta", async () => {
    const c = await cenario();
    try {
      const banco = criarBanco(NodePath.join(c.fabrica, "corrompido.sqlite"), "2026.11.13");
      const bytes = NodeFS.readFileSync(banco);
      bytes.fill(0x5a, bytes.length - 3 * 4096, bytes.length - 4096);
      NodeFS.writeFileSync(banco, bytes);
      expect(lerInfoBanco(banco)?.versao).toBe("2026.11.13");
      c.publicar({ versao: "2026.11.13", banco });
      await expect(c.atualizar()).rejects.toThrow(/corrompida|não pôde ser lida|não abre/);
      semPendente(c);

      const outroEsquema = criarBanco(NodePath.join(c.fabrica, "esquema.sqlite"), "2026.11.14", { esquema: 999 });
      c.publicar({ versao: "2026.11.14", banco: outroEsquema });
      await expect(c.atualizar()).rejects.toThrow("outro esquema");
      semPendente(c);
    } finally {
      await c.fechar();
    }
  });

  it("rede cai no meio do download: falha limpa, e a próxima conferência baixa", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13" });
      c.servidor.cortar.add("beta/base-2026.11.13.sqlite.zst");
      await expect(c.atualizar()).rejects.toThrow(/caiu no meio|sem conexão|tamanho diferente/);
      semPendente(c);
      c.servidor.cortar.clear();
      expect(await c.atualizar()).toMatchObject({ tipo: "baixada" });
    } finally {
      await c.fechar();
    }
  });

  it("manifesto antigo servido de novo (bem assinado) não faz voltar", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.09" });
      expect(await c.atualizar()).toEqual({ tipo: "em-dia" });
      semPendente(c);
    } finally {
      await c.fechar();
    }
  });

  it("skills: baixa as elegíveis e mais novas, e a pasta entra na abertura", async () => {
    const c = await cenario();
    try {
      const skill = (nome: string, extra: Partial<SkillDaFabrica> = {}): SkillDaFabrica => ({
        nome,
        versao: "1.1.0",
        appMinimo: "0.1.0",
        baseMinima: "2026.11.01",
        arquivos: [{ caminho: "SKILL.md", conteudo: Buffer.from(`---\nname: ${nome}\n---\n`) }],
        ...extra,
      });
      c.publicar({
        versao: "2026.11.13",
        skills: [
          skill("conferir-a"),
          skill("so-no-app-novo", { appMinimo: "9.0.0" }),
          skill("base-futura", { baseMinima: "2030.01.01" }),
        ],
      });
      expect(await c.atualizar()).toMatchObject({ tipo: "baixada", skills: 1 });
      const abertura = prepararAbertura({ pasta: c.pastaApp, bancoEmpacotado: c.empacotada });
      expect(abertura.pastasSkills).toEqual([NodePath.join(c.pastaApp, "skills", "2026.11.13")]);
      expect(NodeFS.readdirSync(abertura.pastasSkills[0]!)).toEqual(["conferir-a"]);
    } finally {
      await c.fechar();
    }
  });
});
