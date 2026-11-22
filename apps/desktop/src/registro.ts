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

/* ---------------------------------------------------------- registros da interface */

// Sequências ANSI (CSI e OSC) e os caracteres de controle, menos `\n` e `\t`.
const ANSI = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;
const CONTROLE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/**
 * A linha que um registro da interface (`PonteDesktop.registrarErro`) ocupa no log: as quebras
 * normalizadas para `\n` (`\r\n`, `\r`, U+2028, U+2029), sem sequências ANSI nem caracteres de controle,
 * e as linhas de continuação (a pilha) recuadas, para cada registro começar com a data.
 */
export function linhaDaInterface(instante: string, texto: string): string {
  const limpo = texto
    .replace(/\r\n?|[\u2028\u2029]/g, "\n")
    .replace(ANSI, "")
    .replace(CONTROLE, "")
    .trimEnd();
  return `${instante} [interface] ${limpo.replaceAll("\n", "\n    ")}\n`;
}

export interface OpcoesLimite {
  /** Quantos registros por janela; o excedente é descartado e contado. */
  readonly maximo: number;
  readonly janelaMs: number;
  readonly agora: () => number;
  /** Grava um registro aceito, ou o aviso dos suprimidos (`suprimidos`). */
  readonly gravar: (texto: string) => void;
  /** O texto do aviso de `n` registros suprimidos na janela que acabou. */
  readonly suprimidos: (n: number) => string;
}

/**
 * Um teto de registros por janela de tempo, contra uma interface que entra em laço: passando de
 * `maximo`, o resto da janela é descartado, e o primeiro registro da janela seguinte vem depois de uma
 * linha com quantos foram suprimidos.
 */
export function limitarRegistros(opcoes: OpcoesLimite): (texto: string) => void {
  let inicio: number | undefined;
  let aceitos = 0;
  let descartados = 0;
  return (texto) => {
    const agora = opcoes.agora();
    if (inicio === undefined || agora - inicio >= opcoes.janelaMs) {
      if (descartados > 0) opcoes.gravar(opcoes.suprimidos(descartados));
      inicio = agora;
      aceitos = 0;
      descartados = 0;
    }
    if (aceitos >= opcoes.maximo) {
      descartados += 1;
      return;
    }
    aceitos += 1;
    opcoes.gravar(texto);
  };
}
