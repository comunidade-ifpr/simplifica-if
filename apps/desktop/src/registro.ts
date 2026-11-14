// @effect-diagnostics nodeBuiltinImport:off -- processo principal do Electron, sem runtime Effect (ver README)
/**
 * O arquivo de log do app: o que o processo principal registra e o stderr do servidor (os logs dele),
 * além do stderr do próprio app, que no app empacotado ninguém vê. Fica na pasta de logs do sistema
 * (`app.getPath("logs")`: `~/Library/Logs/Simplifica IF` no macOS, `<pasta do app>\logs` no Windows).
 *
 * Um arquivo só, `simplifica-if.log`; passando de `LIMITE_LOG`, ele vira `simplifica-if.log.1` (o
 * anterior se perde) e outro começa. O log nunca derruba o app: um erro de escrita desliga o arquivo.
 * O token não passa por aqui (o servidor e o processo principal não o registram).
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export const NOME_LOG = "simplifica-if.log";

/** 5 MB por arquivo. */
export const LIMITE_LOG = 5 * 1024 * 1024;

export interface ArquivoLog {
  readonly caminho: string;
  escrever(texto: string): void;
}

/** Abre (ou cria) o log em `pasta`, girando-o se já passou do limite. */
export function abrirLog(pasta: string, limite = LIMITE_LOG): ArquivoLog {
  const caminho = NodePath.join(pasta, NOME_LOG);
  let descritor: number | undefined;
  let tamanho = 0;

  const girar = () => {
    if (descritor !== undefined) NodeFS.closeSync(descritor);
    NodeFS.renameSync(caminho, `${caminho}.1`);
    descritor = NodeFS.openSync(caminho, "a");
    tamanho = 0;
  };

  try {
    NodeFS.mkdirSync(pasta, { recursive: true });
    descritor = NodeFS.openSync(caminho, "a");
    tamanho = NodeFS.fstatSync(descritor).size;
    if (tamanho >= limite) girar();
  } catch {
    descritor = undefined;
  }

  return {
    caminho,
    escrever(texto) {
      if (descritor === undefined || texto.length === 0) return;
      try {
        const bytes = Buffer.from(texto, "utf8");
        NodeFS.writeSync(descritor, bytes);
        tamanho += bytes.length;
        if (tamanho >= limite) girar();
      } catch {
        descritor = undefined;
      }
    },
  };
}
