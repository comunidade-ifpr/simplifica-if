import type { ListaPendencias, PreviaApagarConversa } from "@simplifica-if/contratos-app";
import { describe, expect, it } from "vite-plus/test";
import { avisoDeSaida, notaDepoisDeApagar, textosApagarConversa, textosApagarRevisao } from "./textos.ts";

const previa = (mudar: Partial<PreviaApagarConversa> = {}): PreviaApagarConversa => ({
  respondendo: false,
  mensagens: 3,
  anexos: 1,
  pasta: {
    caminho: "/Users/x/Documents/Simplifica IF/Conferir base legal",
    gerida: true,
    compartilhada: false,
    arquivos: 2,
  },
  relatos: [],
  ...mudar,
});

describe("apagar a conversa", () => {
  it("diz o que sai, o que fica e oferece a pasta para a Lixeira", () => {
    const t = textosApagarConversa(previa(), { titulo: "Base legal do PPC", ia: "Claude" }, true);
    expect(t.titulo).toBe("Apagar a conversa “Base legal do PPC”?");
    expect(t.saiDoApp).toEqual([
      "3 mensagens suas e as respostas da IA",
      "As cópias que o app guardava para o Desfazer",
      "O registro da conversa que o Claude guarda neste computador",
    ]);
    expect(t.ficaNoComputador[0]).toEqual({
      texto: "A pasta da tarefa “Conferir base legal”, com 2 arquivos (1 anexado por você)",
      caminho: "/Users/x/Documents/Simplifica IF/Conferir base legal",
    });
    expect(t.ficaNoComputador.at(-1)!.texto).toMatch(/política de dados da sua conta/);
    expect(t.opcaoPasta).toBe("Mandar também a pasta “Conferir base legal” para a Lixeira, com 2 arquivos");
    expect(t.aviso).toBeNull();
  });

  it("não oferece a Lixeira sem o desktop, para a pasta de fora do app ou usada por outra conversa", () => {
    const conversa = { titulo: "", ia: "Claude" };
    expect(textosApagarConversa(previa(), conversa, false).opcaoPasta).toBeNull();
    expect(
      textosApagarConversa(previa({ pasta: { ...previa().pasta, gerida: false } }), conversa, true).opcaoPasta,
    ).toBeNull();
    expect(
      textosApagarConversa(previa({ pasta: { ...previa().pasta, compartilhada: true } }), conversa, true).opcaoPasta,
    ).toBeNull();
    expect(textosApagarConversa(previa(), conversa, true).titulo).toBe("Apagar esta conversa?");
  });

  it("avisa que para a resposta e lembra os relatos salvos", () => {
    const t = textosApagarConversa(
      previa({ respondendo: true, mensagens: 1, relatos: ["/r/relato.md"] }),
      { titulo: "x", ia: "Claude" },
      true,
    );
    expect(t.aviso).toMatch(/para a resposta antes de apagar/);
    expect(t.saiDoApp[0]).toBe("1 mensagem sua e as respostas da IA");
    expect(t.ficaNoComputador).toContainEqual({
      texto: "1 relato de erro salvo, com trechos desta conversa",
      caminho: "/r/relato.md",
    });
  });

  it("depois de apagar, diz só o que ficou para trás", () => {
    expect(notaDepoisDeApagar({ transcricao: "apagada", pastaFicou: null }, "Claude")).toBeNull();
    expect(notaDepoisDeApagar({ transcricao: "nenhuma", pastaFicou: null }, "Claude")).toBeNull();
    expect(notaDepoisDeApagar({ transcricao: "ficou", pastaFicou: "/d/Simplifica IF/Tarefa" }, "Claude")).toBe(
      "A conversa saiu do app. O registro que o Claude guarda neste computador não pôde ser apagado. A pasta “Tarefa” não foi para a Lixeira e continua em Documentos/Simplifica IF.",
    );
  });
});

describe("apagar a revisão", () => {
  const lista = {
    id: "l",
    arquivoOriginal: "/d/PPC.docx",
    pendencias: [{}, {}],
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

  it("com a leitura com IA, ela sai junto; em andamento, o app a para antes", () => {
    const t = textosApagarRevisao(lista, true);
    expect(t.saiDoApp).toContain("A leitura com IA, com o que ela guardou do PPC");
    expect(t.aviso).toMatch(/para a leitura antes de apagar/);
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
