import { assert, describe, it } from "@effect/vitest";
import { comandoInstalarClaude } from "./components/PassoClaude.tsx";
import { classificarFalhaEstado } from "@simplifica-if/motor/falhas";
import { explicarMensagemMotor } from "./providers.ts";

/** A mensagem com o tipo que o motor dá a ela, como chega no estado. */
const explicar = (mensagem: string) => explicarMensagemMotor({ mensagem, tipoFalha: classificarFalhaEstado(mensagem) });

describe("passo guiado do Claude", () => {
  it("o comando do instalador oficial de cada sistema", () => {
    assert.strictEqual(comandoInstalarClaude(false), "curl -fsSL https://claude.ai/install.sh | bash");
    assert.strictEqual(comandoInstalarClaude(true), "irm https://claude.ai/install.ps1 | iex");
  });
});

describe("explicarMensagemMotor", () => {
  it("o progresso do código copiado do T3 em português", () => {
    assert.deepStrictEqual(explicar("Extracting Codex."), { texto: "Extraindo o Codex." });
    assert.deepStrictEqual(explicar("Waiting for Google to finish sign-in."), {
      texto: "Esperando o Google concluir o login.",
    });
  });

  it("as falhas em inglês pelo tipo, com o original nos detalhes técnicos", () => {
    const rede = explicar(
      "Antigravity has not reached Google after 30 seconds. Check this machine's network connection. Broken IPv6 is a common cause.",
    );
    assert.match(rede.texto, /^Não foi possível falar com o serviço pela internet/);
    assert.match(rede.detalhe ?? "", /Broken IPv6/);
    assert.match(
      explicar("Google requires an eligible Antigravity subscription for this account.").texto,
      /não tem o plano que o Antigravity exige/,
    );
    assert.match(
      explicar("The Codex download failed its size or SHA-256 check. Nothing was installed.").texto,
      /^A instalação ficou incompleta/,
    );
    assert.deepStrictEqual(explicar("The runtime crashed."), {
      texto: "Algo deu errado. Tente de novo; se continuar, veja os detalhes técnicos.",
      detalhe: "The runtime crashed.",
    });
  });

  it("a mensagem que já está em português fica como veio", () => {
    assert.deepStrictEqual(explicar("O login não terminou em 10 minutos. Tente de novo."), {
      texto: "O login não terminou em 10 minutos. Tente de novo.",
    });
  });
});
