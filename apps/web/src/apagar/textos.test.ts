import type { PreviaApagarConversa } from "@simplifica-if/contratos-app";
import { describe, expect, it } from "vite-plus/test";
import {
  CONVERSA,
  notaDepoisDeApagar,
  pastasParaLixeira,
  textosApagarConversa,
  textosApagarConversas,
} from "./textos.ts";

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
    expect(notaDepoisDeApagar([{ titulo: "a" }], CONVERSA)).toBeNull();
    expect(notaDepoisDeApagar([{ titulo: "a", transcricaoFicou: "Claude" }], CONVERSA)?.titulo).toBe("Apagado");
    expect(notaDepoisDeApagar([{ titulo: "a" }, { titulo: "b" }], CONVERSA)).toBeNull();
    expect(
      notaDepoisDeApagar(
        [{ titulo: "a", transcricaoFicou: "Claude", pastasFicaram: ["/d/Simplifica IF/Tarefa"] }],
        CONVERSA,
      )?.texto,
    ).toBe(
      "A conversa saiu do app. O registro que o Claude guarda neste computador não pôde ser apagado agora; o app tenta de novo quando abrir. A pasta “Tarefa” não foi para a Lixeira e continua em Documentos/Simplifica IF.",
    );
  });

  it("em lote, a falha de uma não esconde as que saíram", () => {
    expect(
      notaDepoisDeApagar([{ titulo: "a" }, { titulo: "b", falhou: true }, { titulo: "c", falhou: true }], CONVERSA),
    ).toEqual({
      titulo: "Apagado em parte",
      texto: "1 de 3 conversas saiu do app. Não foi possível apagar “b”, “c”. Tente de novo.",
    });
    expect(
      notaDepoisDeApagar([{ titulo: "a" }, { titulo: "b" }, { titulo: "c", falhou: true }], {
        um: "revisão",
        varios: "revisões",
      })?.texto,
    ).toBe("2 de 3 revisões saíram do app. Não foi possível apagar “c”. Tente de novo.");
    expect(
      notaDepoisDeApagar(
        [
          { titulo: "a", falhou: true },
          { titulo: "b", falhou: true },
        ],
        CONVERSA,
      ),
    ).toEqual({ titulo: "Nada foi apagado", texto: "Não foi possível apagar “a”, “b”. Tente de novo." });
    expect(
      notaDepoisDeApagar(
        [
          { titulo: "a", transcricaoFicou: "Claude" },
          { titulo: "b", transcricaoFicou: "Claude" },
        ],
        CONVERSA,
      )?.texto,
    ).toMatch(/^2 conversas saíram do app\. O registro de 2 conversas/);
  });

  it("as pastas que ficaram: todas, de uma revisão com várias conversas ou de várias revisões", () => {
    const revisao = { um: "revisão", varios: "revisões" };
    expect(
      notaDepoisDeApagar([{ titulo: "a", pastasFicaram: ["/d/PPC – estágio", "/d/PPC – matriz"] }], revisao)?.texto,
    ).toBe(
      "A revisão saiu do app. As pastas “PPC – estágio”, “PPC – matriz” não foram para a Lixeira e continuam em Documentos/Simplifica IF.",
    );
    expect(
      notaDepoisDeApagar(
        [
          { titulo: "a", pastasFicaram: ["/d/1", "/d/2", "/d/3"] },
          { titulo: "b", pastasFicaram: ["/d/4"] },
        ],
        revisao,
      )?.texto,
    ).toBe("2 revisões saíram do app. 4 pastas não foram para a Lixeira e continuam em Documentos/Simplifica IF.");
  });

  it("várias conversas: as contagens somadas, o aviso e só as pastas que podem ir à Lixeira", () => {
    const a = { previa: previa(), titulo: "a", ia: "Claude" };
    const b = {
      previa: previa({ respondendo: true, mensagens: 1, pasta: { ...previa().pasta, caminho: "/x/B", arquivos: 4 } }),
      titulo: "b",
      ia: "Claude",
    };
    const c = {
      previa: previa({ mensagens: 0, pasta: { caminho: "/fora/C", gerida: false, compartilhada: false, arquivos: 1 } }),
      titulo: "c",
      ia: "Claude",
    };
    const t = textosApagarConversas([a, b, c], true);
    expect(t.titulo).toBe("Apagar 3 conversas?");
    expect(t.saiDoApp[0]).toBe("4 mensagens suas e as respostas da IA, em 3 conversas");
    expect(t.ficaNoComputador[0]!.texto).toBe("3 pastas de tarefa, com 7 arquivos");
    expect(t.aviso).toBe("A IA está respondendo em uma delas. O app para as respostas antes de apagar.");
    expect(pastasParaLixeira([a, b, c])).toEqual([a.previa.pasta.caminho, "/x/B"]);
    expect(t.opcaoPasta).toBe("Mandar também as 2 pastas para a Lixeira, com 6 arquivos");
    expect(t.confirmar).toBe("Apagar 3 conversas");
    // Duas conversas da mesma pasta: a pasta e os arquivos dela contam uma vez.
    expect(textosApagarConversas([a, { ...a, titulo: "a2" }], true).ficaNoComputador[0]!.texto).toBe(
      "1 pasta de tarefa, com 2 arquivos",
    );
    // Uma só: os textos de uma conversa.
    expect(textosApagarConversas([a], true).titulo).toBe("Apagar a conversa “a”?");
  });
});
