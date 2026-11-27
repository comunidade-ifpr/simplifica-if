/**
 * Antes de o app fechar (sair do app ou fechar a janela), a janela grava onde a pessoa estava (a
 * continuidade, `docs/plans/multitarefa.md`): o processo principal pede pelo `CANAIS.antesDeSair`, com um
 * número por pedido, e espera a resposta em `CANAIS.prontoParaSair`, por no máximo `ESPERA_SAIR_MS`. Só
 * vale a resposta da janela a que o pedido foi: outra janela não encerra a espera. Sem janela, ou sem
 * resposta a tempo, segue.
 */
import { CANAIS } from "@simplifica-if/contratos-app/ponte";

/** O máximo que o fechamento espera a janela gravar. */
export const ESPERA_SAIR_MS = 1_000;

/** O que se usa da `BrowserWindow`. */
export interface JanelaQueGrava {
  isDestroyed(): boolean;
  readonly webContents: { send(canal: string, ...argumentos: Array<unknown>): void };
}

export interface DependenciasSair {
  readonly janela: () => JanelaQueGrava | undefined;
  /** Agenda `acao` depois de `ms`; devolve o cancelamento. */
  readonly adiar: (acao: () => void, ms: number) => () => void;
}

export function criarGravacaoAoSair(dependencias: DependenciasSair) {
  let ultimo = 0;
  const esperando = new Map<number, { readonly janela: JanelaQueGrava; readonly terminar: () => void }>();
  return {
    /** Pede à janela que grave e espera a resposta (ou o prazo). */
    pedir(): Promise<void> {
      const janela = dependencias.janela();
      if (janela === undefined || janela.isDestroyed()) return Promise.resolve();
      ultimo += 1;
      const pedido = ultimo;
      return new Promise<void>((resolver) => {
        const terminar = () => {
          esperando.delete(pedido);
          cancelar();
          resolver();
        };
        const cancelar = dependencias.adiar(terminar, ESPERA_SAIR_MS);
        esperando.set(pedido, { janela, terminar });
        try {
          janela.webContents.send(CANAIS.antesDeSair, pedido);
        } catch {
          // A página já se foi (o `webContents` destruído): não há quem grave.
          terminar();
        }
      });
    },
    /** A resposta de `janela` (o pedido chega como `unknown`, pelo IPC). */
    pronto(janela: JanelaQueGrava, pedido: unknown): void {
      if (typeof pedido !== "number") return;
      const espera = esperando.get(pedido);
      if (espera !== undefined && espera.janela === janela) espera.terminar();
    },
  };
}

/**
 * O `close` da janela: o primeiro segura o fechamento e pede a gravação; os seguintes, enquanto ela grava (o
 * segundo clique em fechar), também seguram, sem pedir de novo; gravado, `fechar` fecha de vez. Saindo do app
 * (`saindo`), a gravação já foi pedida no `before-quit`.
 */
export function fecharDepoisDeGravar(dependencias: {
  readonly pedir: () => Promise<void>;
  readonly fechar: () => void;
  readonly saindo: () => boolean;
}): (evento: { preventDefault(): void }) => void {
  let fase: "aberta" | "gravando" | "gravada" = "aberta";
  return (evento) => {
    if (dependencias.saindo() || fase === "gravada") return;
    evento.preventDefault();
    if (fase === "gravando") return;
    fase = "gravando";
    void dependencias.pedir().finally(() => {
      fase = "gravada";
      dependencias.fechar();
    });
  };
}
