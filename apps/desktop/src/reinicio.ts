/**
 * A troca do servidor, um de cada vez. Quem pede reinício (o vigia do desenvolvimento, a troca da base,
 * o "Reiniciar" do diálogo de erro) pode pedir no meio de outra troca; duas em paralelo deixavam um
 * servidor órfão (o atual ainda encerrando, o novo ainda subindo). Um pedido no meio de uma troca marca
 * "de novo": quando ela acaba, roda mais uma, nunca duas ao mesmo tempo. Sem Electron.
 */

export interface Serializador {
  /** Pede uma execução; termina quando não há mais execução em curso nem pedida. Nunca rejeita. */
  pedir(): Promise<void>;
  /** Termina quando não há execução em curso (na hora, se não há nenhuma). Nunca rejeita. */
  ocioso(): Promise<void>;
}

/** Serializa `executar`: uma execução por vez, e os pedidos no meio de uma viram uma só execução depois. */
export function serializar(executar: () => Promise<void>, aoFalhar: (erro: unknown) => void): Serializador {
  let emCurso: Promise<void> | undefined;
  let deNovo = false;

  const ciclo = async () => {
    try {
      do {
        deNovo = false;
        try {
          await executar();
        } catch (erro) {
          aoFalhar(erro);
        }
      } while (deNovo);
    } finally {
      emCurso = undefined;
    }
  };

  return {
    pedir() {
      if (emCurso !== undefined) {
        deNovo = true;
        return emCurso;
      }
      // Pela fila de microtarefas: um `pedir` de dentro do próprio `executar` já encontra `emCurso`.
      emCurso = Promise.resolve().then(ciclo);
      return emCurso;
    },
    ocioso: () => emCurso ?? Promise.resolve(),
  };
}
