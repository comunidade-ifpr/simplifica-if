import type { EstadoAtualizacao } from "@simplifica-if/contratos-app";
import { describe, expect, it } from "vite-plus/test";
import {
  avisoSemConfirmacao,
  descreverBase,
  descreverSituacao,
  textoConfirmarVolta,
  versaoComoData,
} from "./textos.ts";

const estado: EstadoAtualizacao = {
  desligada: null,
  canal: "beta",
  situacao: "parada",
  erro: null,
  aviso: null,
  versaoApp: "0.1.0",
  base: { versao: "2026.11.20", dataReferencia: "2026-11-20", commit: "abc1234", origem: "baixada" },
  anterior: "2026.11.13",
  pendente: null,
  skills: "empacotadas",
  skillsPendentes: null,
  ultimaConferencia: null,
  manifestoGeradoEm: null,
  novidades: null,
};

describe("textos da seção Atualizações", () => {
  it("versões como datas brasileiras", () => {
    expect(versaoComoData("2026.11.20")).toBe("20/11/2026");
    expect(versaoComoData("2026.11.20.2")).toBe("20/11/2026 (2ª do dia)");
    expect(versaoComoData("desconhecida")).toBe("desconhecida");
  });

  it("a base em uso, com a revisão e a origem", () => {
    expect(descreverBase(estado)).toBe("Base de 20/11/2026, revisão abc1234 (baixada pela atualização).");
    const dev = {
      ...estado,
      base: { ...estado.base, versao: "dev-ab12cd34", commit: null, origem: "empacotada" as const },
    };
    expect(descreverBase(dev)).toBe("Base de desenvolvimento (dev-ab12cd34) (a que veio com o app).");
  });

  it("a situação: desligada, pronta, erro", () => {
    expect(descreverSituacao({ ...estado, desligada: "sem feed" })).toBe("Atualização da base desligada: sem feed.");
    expect(
      descreverSituacao({ ...estado, situacao: "pronta", pendente: "2026.11.21", skillsPendentes: "2026.11.21" }),
    ).toBe("Pronta para usar: a base de 21/11/2026 e tarefas novas. Entra em uso quando o app reiniciar.");
    // O motivo técnico fica em "Detalhes técnicos" (Atualizacoes.tsx), não na frase.
    expect(descreverSituacao({ ...estado, situacao: "erro", erro: "fetch failed" })).toBe(
      "A última procura falhou. A base em uso continua a mesma, e o app tenta de novo mais tarde.",
    );
  });

  it("avisa quando o manifesto conferido tem mais de 14 dias", () => {
    const agora = Date.parse("2026-12-01T12:00:00Z");
    expect(avisoSemConfirmacao({ ...estado, manifestoGeradoEm: "2026-11-25T00:00:00Z" }, agora)).toBeNull();
    expect(avisoSemConfirmacao({ ...estado, manifestoGeradoEm: "2026-11-10T00:00:00Z" }, agora)).toContain(
      "Não foi possível confirmar que a base está atualizada",
    );
    expect(
      avisoSemConfirmacao({ ...estado, manifestoGeradoEm: "2026-11-10T00:00:00Z", desligada: "x" }, agora),
    ).toBeNull();
  });

  it("a confirmação de Voltar diz para qual versão, de qual e que o app reinicia", () => {
    const texto = textoConfirmarVolta(estado);
    expect(texto).toContain("volta de 20/11/2026 para 13/11/2026");
    expect(texto).toContain("o Simplifica IF reinicia");
    expect(textoConfirmarVolta({ ...estado, anterior: null })).toBeNull();
  });
});
