import type { ListaPendencias } from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import { describe, expect, it } from "vite-plus/test";
import { avisoDeSaida, textosApagarRevisao, textosApagarRevisoes } from "./apagar.ts";

describe("apagar a revisão", () => {
  const lista = {
    id: "l",
    arquivoOriginal: "/d/PPC.docx",
    pendencias: [{}, {}],
    conversas: [],
    resultado: { leituraIa: "nenhuma", arquivoComentado: "/d/PPC - revisão prévia (Simplifica IF).docx" },
  } as unknown as ListaPendencias;

  it("o PPC convertido e o que a pessoa escreveu saem; o arquivo e a cópia comentada ficam", () => {
    const t = textosApagarRevisao(lista, false);
    expect(t.titulo).toBe("Apagar a revisão de “PPC.docx”?");
    expect(t.saiDoApp).toEqual([
      "O texto do PPC convertido e 2 pendências",
      "O que você marcou e o que escreveu ao discordar",
    ]);
    expect(t.ficaNoComputador.map((item) => item.caminho)).toEqual([
      "/d/PPC.docx",
      "/d/PPC - revisão prévia (Simplifica IF).docx",
    ]);
    expect(t.opcaoPasta).toBeNull();
  });

  it("a pasta da conversa ao lado fica no computador, e o desktop oferece mandá-la à Lixeira com a conversa", () => {
    const comConversa = {
      ...lista,
      conversas: [
        {
          conversa: "c",
          pasta: "/Documentos/Simplifica IF/PPC Enfermagem – conversa",
          pendencia: null,
          titulo: "Estágio",
        },
      ],
    } as ListaPendencias;
    const t = textosApagarRevisao(comConversa, false, true);
    expect(t.ficaNoComputador.at(-1)).toEqual({
      texto: "A conversa ao lado e a pasta dela, “PPC Enfermagem – conversa”, com o texto do PPC",
      caminho: "/Documentos/Simplifica IF/PPC Enfermagem – conversa",
    });
    expect(t.opcaoPasta).toBe(
      "Apagar também a conversa ao lado e mandar a pasta dela, “PPC Enfermagem – conversa”, com o texto do PPC, para a Lixeira",
    );
    expect(textosApagarRevisao(comConversa, false, false).opcaoPasta).toBeNull();
    // Em "Revisões recentes", várias de uma vez: as conversas ao lado ficam, e a Lixeira é oferecida.
    const varias = textosApagarRevisoes(
      [
        { lista: comConversa, lendo: false },
        { lista, lendo: false },
      ],
      true,
    );
    expect(varias.ficaNoComputador.at(-1)?.texto).toBe(
      "As conversas ao lado de uma delas e as pastas delas, com o texto do PPC",
    );
    expect(varias.opcaoPasta).toMatch(/^Apagar também as conversas ao lado/);
    expect(
      textosApagarRevisoes(
        [
          { lista, lendo: false },
          { lista, lendo: false },
        ],
        true,
      ).opcaoPasta,
    ).toBeNull();
    expect(textosApagarRevisoes([{ lista: comConversa, lendo: false }], true).opcaoPasta).toBe(t.opcaoPasta);
  });

  it("com uma conversa por pendência, a prévia lista cada pasta, e a Lixeira leva todas", () => {
    const pasta = (nome: string) => `/Documentos/Simplifica IF/${nome}`;
    const comDuas = {
      ...lista,
      conversas: [
        { conversa: "a", pasta: pasta("PPC Enfermagem – Estágio"), pendencia: "k1", titulo: "Estágio" },
        { conversa: "b", pasta: pasta("PPC Enfermagem – conversa"), pendencia: null, titulo: "" },
      ],
    } as ListaPendencias;
    const t = textosApagarRevisao(comDuas, false, true);
    expect(t.ficaNoComputador.slice(2)).toEqual([
      {
        texto: "Uma conversa ao lado e a pasta dela, “PPC Enfermagem – Estágio”, com o texto do PPC",
        caminho: pasta("PPC Enfermagem – Estágio"),
      },
      {
        texto: "Uma conversa ao lado e a pasta dela, “PPC Enfermagem – conversa”, com o texto do PPC",
        caminho: pasta("PPC Enfermagem – conversa"),
      },
    ]);
    expect(t.opcaoPasta).toBe(
      "Apagar também as 2 conversas ao lado e mandar as pastas delas, com o texto do PPC, para a Lixeira",
    );
  });

  it("com a conferência com IA, ela sai junto; em andamento, o app a para antes", () => {
    const t = textosApagarRevisao(lista, true);
    expect(t.saiDoApp).toContain("A conferência com IA, com o que ela guardou do PPC");
    expect(t.aviso).toMatch(/para a conferência antes de apagar/);
  });

  it("várias revisões: as pendências somadas e a leitura em andamento", () => {
    const t = textosApagarRevisoes([
      { lista, lendo: false },
      { lista, lendo: true },
    ]);
    expect(t.titulo).toBe("Apagar 2 revisões?");
    expect(t.saiDoApp).toEqual([
      "O texto de 2 PPCs convertidos e 4 pendências",
      "O que você marcou e o que escreveu ao discordar",
      "As conferências com IA, com o que elas guardaram dos PPCs",
    ]);
    expect(t.aviso).toBe("Uma conferência com IA está em andamento. O app a para antes de apagar.");
    expect(textosApagarRevisoes([{ lista, lendo: false }]).titulo).toBe("Apagar a revisão de “PPC.docx”?");
  });

  it("avisa quando a lista sai sozinha em poucos dias", () => {
    const dia = 24 * 60 * 60 * 1000;
    const agora = Date.parse("2026-11-22T12:00:00Z");
    expect(avisoDeSaida("2026-11-20T12:00:00Z", agora)).toBeNull();
    expect(avisoDeSaida(new Date(agora - 27 * dia).toISOString(), agora)).toBe("some em 3 dias");
    expect(avisoDeSaida(new Date(agora - 29 * dia).toISOString(), agora)).toBe("some amanhã");
    expect(avisoDeSaida(new Date(agora - 31 * dia).toISOString(), agora)).toBe("some hoje");
  });
});
