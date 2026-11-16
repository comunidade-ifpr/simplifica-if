import type { EstadoAtualizacao } from "@simplifica-if/contratos-app";
import { describe, expect, it } from "vite-plus/test";
import { descreverBase, descreverSituacao, versaoComoData } from "./textos.ts";

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
  novidades: null,
};

describe("textos da seção Atualizações", () => {
  it("versões como datas brasileiras", () => {
    expect(versaoComoData("2026.11.20")).toBe("20/11/2026");
    expect(versaoComoData("2026.11.20.2")).toBe("20/11/2026 (2ª do dia)");
    expect(versaoComoData("desconhecida")).toBe("desconhecida");
  });

  it("a base em uso, com o commit e a origem", () => {
    expect(descreverBase(estado)).toBe("Base de 20/11/2026, commit abc1234 (baixada pela atualização).");
  });

  it("a situação: desligada, pronta, erro", () => {
    expect(descreverSituacao({ ...estado, desligada: "sem feed" })).toBe("Atualização da base desligada: sem feed.");
    expect(
      descreverSituacao({ ...estado, situacao: "pronta", pendente: "2026.11.21", skillsPendentes: "2026.11.21" }),
    ).toBe("Pronta para usar: a base de 21/11/2026 e skills novas. Entra quando o app reiniciar o servidor.");
    expect(descreverSituacao({ ...estado, situacao: "erro", erro: "manifesto recusado" })).toContain(
      "manifesto recusado",
    );
  });
});
