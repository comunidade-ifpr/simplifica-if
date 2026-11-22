/** A troca do servidor, uma de cada vez: pedidos no meio viram uma execução só, depois. */
import { describe, expect, test } from "vite-plus/test";
import { serializar } from "../src/reinicio.ts";

/** Uma execução controlada pelo teste: cada chamada fica pendente até `concluir`. */
function execucoesControladas() {
  const pendentes: Array<{ readonly concluir: () => void; readonly falhar: (erro: unknown) => void }> = [];
  let ativas = 0;
  let maximoAtivas = 0;
  const executar = () =>
    new Promise<void>((resolve, reject) => {
      ativas += 1;
      maximoAtivas = Math.max(maximoAtivas, ativas);
      const fim = () => {
        ativas -= 1;
      };
      pendentes.push({
        concluir: () => {
          fim();
          resolve();
        },
        falhar: (erro) => {
          fim();
          reject(erro);
        },
      });
    });
  return { executar, pendentes, maximoAtivas: () => maximoAtivas };
}

/** Deixa as microtarefas pendentes rodarem. */
const esvaziar = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

describe("serializar", () => {
  test("um pedido sem nada em curso roda uma vez", async () => {
    const controle = execucoesControladas();
    const reinicio = serializar(controle.executar, () => undefined);
    let terminou = false;
    void reinicio.pedir().then(() => {
      terminou = true;
    });
    await esvaziar();
    expect(controle.pendentes).toHaveLength(1);
    expect(terminou).toBe(false);
    controle.pendentes[0]!.concluir();
    await esvaziar();
    expect(terminou).toBe(true);
  });

  test("pedidos no meio de uma execução viram uma execução só, depois, nunca em paralelo", async () => {
    const controle = execucoesControladas();
    const reinicio = serializar(controle.executar, () => undefined);
    const fins = [reinicio.pedir()];
    await esvaziar();
    fins.push(reinicio.pedir(), reinicio.pedir(), reinicio.pedir());
    await esvaziar();
    expect(controle.pendentes).toHaveLength(1);

    controle.pendentes[0]!.concluir();
    await esvaziar();
    expect(controle.pendentes).toHaveLength(2);
    expect(controle.maximoAtivas()).toBe(1);

    let terminaram = false;
    void Promise.all(fins).then(() => {
      terminaram = true;
    });
    await esvaziar();
    expect(terminaram).toBe(false);
    controle.pendentes[1]!.concluir();
    await esvaziar();
    expect(terminaram).toBe(true);
    expect(controle.pendentes).toHaveLength(2);
  });

  test("um pedido de dentro da execução não roda em paralelo", async () => {
    const vezes: Array<string> = [];
    let reinicio: ReturnType<typeof serializar> | undefined;
    reinicio = serializar(
      async () => {
        vezes.push("início");
        if (vezes.length === 1) void reinicio?.pedir();
        await Promise.resolve();
        vezes.push("fim");
      },
      () => undefined,
    );
    await reinicio.pedir();
    expect(vezes).toEqual(["início", "fim", "início", "fim"]);
  });

  test("a falha vai a `aoFalhar` e não impede a execução pedida no meio", async () => {
    const controle = execucoesControladas();
    const falhas: Array<unknown> = [];
    const reinicio = serializar(controle.executar, (erro) => falhas.push(erro));
    const fim = reinicio.pedir();
    await esvaziar();
    void reinicio.pedir();
    controle.pendentes[0]!.falhar(new Error("não subiu"));
    await esvaziar();
    expect(falhas).toHaveLength(1);
    expect(controle.pendentes).toHaveLength(2);
    controle.pendentes[1]!.concluir();
    await expect(fim).resolves.toBeUndefined();
  });

  test("`ocioso` espera a execução em curso", async () => {
    const controle = execucoesControladas();
    const reinicio = serializar(controle.executar, () => undefined);
    await expect(reinicio.ocioso()).resolves.toBeUndefined();
    void reinicio.pedir();
    let ocioso = false;
    void reinicio.ocioso().then(() => {
      ocioso = true;
    });
    await esvaziar();
    expect(ocioso).toBe(false);
    controle.pendentes[0]!.concluir();
    await esvaziar();
    expect(ocioso).toBe(true);
  });
});
