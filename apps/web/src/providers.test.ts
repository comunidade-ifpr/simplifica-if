import { assert, describe, it } from "@effect/vitest";
import { comandoInstalarClaude } from "./components/PassoClaude.tsx";
import { explicarMensagemMotor, orientacao } from "./providers.ts";

describe("orientacao", () => {
  it("sem operação no app, um texto genérico em português, sem comando", () => {
    const geral = orientacao("antigravity", "entrar");
    assert.match(geral.texto, /^O app ainda não faz o login do Gemini \(Antigravity\)/);
    assert.isUndefined(geral.comando);
  });
});

describe("passo guiado do Claude", () => {
  it("o comando do instalador oficial de cada sistema", () => {
    assert.strictEqual(comandoInstalarClaude(false), "curl -fsSL https://claude.ai/install.sh | bash");
    assert.strictEqual(comandoInstalarClaude(true), "irm https://claude.ai/install.ps1 | iex");
  });
});

describe("explicarMensagemMotor", () => {
  it("o progresso do código copiado do T3 em português", () => {
    assert.deepStrictEqual(explicarMensagemMotor("Extracting Codex."), { texto: "Extraindo o Codex." });
    assert.deepStrictEqual(explicarMensagemMotor("Waiting for Google to finish sign-in."), {
      texto: "Esperando o Google concluir o login.",
    });
  });

  it("as falhas em inglês pelo tipo, com o original nos detalhes técnicos", () => {
    const rede = explicarMensagemMotor(
      "Antigravity has not reached Google after 30 seconds. Check this machine's network connection. Broken IPv6 is a common cause.",
    );
    assert.match(rede.texto, /^Não foi possível falar com o serviço pela internet/);
    assert.match(rede.detalhe ?? "", /Broken IPv6/);
    assert.match(
      explicarMensagemMotor("Google requires an eligible Antigravity subscription for this account.").texto,
      /não tem o plano que o Antigravity exige/,
    );
    assert.match(
      explicarMensagemMotor("The Codex download failed its size or SHA-256 check. Nothing was installed.").texto,
      /^A instalação ficou incompleta/,
    );
    assert.deepStrictEqual(explicarMensagemMotor("The runtime crashed."), {
      texto: "Algo deu errado. Tente de novo; se continuar, veja os detalhes técnicos.",
      detalhe: "The runtime crashed.",
    });
  });

  it("a mensagem que já está em português fica como veio", () => {
    assert.deepStrictEqual(explicarMensagemMotor("O login não terminou em 10 minutos. Tente de novo."), {
      texto: "O login não terminou em 10 minutos. Tente de novo.",
    });
  });
});
