// @effect-diagnostics nodeBuiltinImport:off globalTimers:off -- processo principal do Electron, sem runtime Effect (ver README)
/**
 * Só no desenvolvimento: reinicia o servidor local quando o código dele muda. A interface recarrega
 * sozinha (o Vite), mas o servidor é um processo Node que carrega o código uma vez; sem reiniciar, a
 * interface nova fala com o servidor velho, e um contrato que mudou (`packages/contratos-app`) faz o
 * servidor recusar o pedido antes do handler.
 *
 * Vigia `apps/server/src` e `packages/` (os `.ts`, menos os testes e `node_modules`) e espera as
 * mudanças pararem por `esperaMs` antes de reiniciar: salvar vários arquivos de uma vez reinicia uma vez.
 * `SIMPLIFICA_DEV_SEM_REINICIO=1` desliga (por exemplo, no meio de uma conversa longa).
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export const VARIAVEL_SEM_REINICIO = "SIMPLIFICA_DEV_SEM_REINICIO";

/** O arquivo muda o código do servidor? Caminho relativo à pasta vigiada, com `/` ou `\`. */
export function ehCodigoDoServidor(relativo: string): boolean {
  const partes = relativo.split(/[\\/]/);
  if (partes.includes("node_modules") || partes.includes("dist") || partes.includes("test")) return false;
  const nome = partes.at(-1) ?? "";
  return /\.(ts|tsx|mts)$/.test(nome) && !/\.test\.tsx?$/.test(nome);
}

export interface OpcoesVigia {
  readonly raizRepositorio: string;
  readonly aoMudar: (arquivo: string) => void;
  /** Uma pasta que não se vigia, ou um vigia que falha, vai para o log, e o vigia para. */
  readonly registrar: (mensagem: string) => void;
  readonly esperaMs?: number;
  /** O `fs.watch` (trocado nos testes). */
  readonly observar?: (pasta: string, aoMudar: (nome: string | null) => void) => VigiaPasta;
}

/** O que o vigia usa de um `fs.FSWatcher`. */
export interface VigiaPasta {
  close(): void;
  on(evento: "error", ouvinte: (erro: Error) => void): unknown;
}

const observarPasta = (pasta: string, aoMudar: (nome: string | null) => void): VigiaPasta =>
  NodeFS.watch(pasta, { recursive: true }, (_evento, nome) => aoMudar(nome));

/** Começa a vigiar; devolve a função que para. Nunca lança: na falha, registra e não vigia. */
export function vigiarCodigoDoServidor(opcoes: OpcoesVigia): () => void {
  const esperaMs = opcoes.esperaMs ?? 400;
  const observar = opcoes.observar ?? observarPasta;
  let relogio: ReturnType<typeof setTimeout> | undefined;
  let ultimo = "";
  let parado = false;
  const vigias: Array<VigiaPasta> = [];

  const parar = () => {
    if (parado) return;
    parado = true;
    if (relogio !== undefined) clearTimeout(relogio);
    for (const vigia of vigias) {
      try {
        vigia.close();
      } catch {
        // Fechar um vigia que já falhou não importa.
      }
    }
  };

  const pastas = [
    NodePath.join(opcoes.raizRepositorio, "apps", "server", "src"),
    NodePath.join(opcoes.raizRepositorio, "packages"),
  ];
  for (const pasta of pastas) {
    try {
      const vigia = observar(pasta, (nome) => {
        // `node_modules` primeiro: é de lá que vem a maioria dos eventos (um `pnpm install`).
        if (parado || nome === null || nome.includes("node_modules") || !ehCodigoDoServidor(nome)) return;
        ultimo = NodePath.join(pasta, nome);
        if (relogio !== undefined) clearTimeout(relogio);
        relogio = setTimeout(() => {
          relogio = undefined;
          opcoes.aoMudar(NodePath.relative(opcoes.raizRepositorio, ultimo));
        }, esperaMs);
      });
      vigias.push(vigia);
      vigia.on("error", (erro) => {
        if (parado) return;
        opcoes.registrar(`o vigia do código do servidor falhou em ${pasta} e parou: ${String(erro)}`);
        parar();
      });
    } catch (erro) {
      opcoes.registrar(`não foi possível vigiar ${pasta}; o servidor não reinicia sozinho: ${String(erro)}`);
      parar();
      break;
    }
  }
  return parar;
}
