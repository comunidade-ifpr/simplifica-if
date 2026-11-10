/** Interpretação da linha de comando comum a todos os entrypoints: `--help`, opções estritas e erro de uso com código 2. */
import { parseArgs, type ParseArgsConfig } from "node:util";

/** Destinos de saída; os testes substituem para capturar o que seria impresso. */
export interface Saida {
  escrever(texto: string): void;
  escreverErro(texto: string): void;
}

export const SAIDA_PADRAO: Saida = {
  escrever: (texto) => console.log(texto),
  escreverErro: (texto) => console.error(texto),
};

/** Erro de uso da linha de comando: imprime o uso no stderr e sai com código 2. */
export class ErroUso extends Error {}

type Opcoes = NonNullable<ParseArgsConfig["options"]>;
const AJUDA = { help: { type: "boolean", short: "h" } } as const;

/** `parseArgs` estrito com `--help/-h`; erros de sintaxe (opção desconhecida, valor ausente) viram `ErroUso`. */
export function lerLinhaComando<O extends Opcoes>(argv: string[], opcoes: O, { posicionais = false } = {}) {
  try {
    return parseArgs({ args: argv, options: { ...opcoes, ...AJUDA }, allowPositionals: posicionais, strict: true });
  } catch (erro) {
    throw new ErroUso(erro instanceof Error ? erro.message : String(erro));
  }
}

/**
 * Para scripts sem subcomandos: devolve as opções lidas, ou `{ codigo }` quando não há o que executar
 * (`--help` imprime o uso e dá 0; erro de uso imprime o uso no stderr e dá 2).
 */
export function lerArgumentos<O extends Opcoes>(
  argv: string[],
  opcoes: O,
  { uso, saida = SAIDA_PADRAO, posicionais = false }: { uso: string; saida?: Saida; posicionais?: boolean },
): ReturnType<typeof lerLinhaComando<O>> | { codigo: number } {
  try {
    const lido = lerLinhaComando(argv, opcoes, { posicionais });
    if ((lido.values as { help?: boolean }).help) {
      saida.escrever(uso);
      return { codigo: 0 };
    }
    return lido;
  } catch (erro) {
    if (!(erro instanceof ErroUso)) throw erro;
    saida.escreverErro(`${uso}\nerro: ${erro.message}`);
    return { codigo: 2 };
  }
}

/** Recusa opções que não pertencem ao subcomando escolhido. */
export function exigirOpcoesDe(comando: string, valores: Record<string, unknown>, permitidas: string[]): void {
  const indevidas = Object.keys(valores).filter(
    (nome) => valores[nome] !== undefined && nome !== "help" && !permitidas.includes(nome),
  );
  if (indevidas.length) {
    throw new ErroUso(`opção não aceita por ${comando}: ${indevidas.map((nome) => `--${nome}`).join(", ")}`);
  }
}

export function inteiro(nome: string, valor: string | undefined): number | undefined {
  if (valor === undefined) return undefined;
  if (!/^[+-]?\d+$/.test(valor.trim())) throw new ErroUso(`--${nome}: valor inteiro inválido: '${valor}'`);
  return Number(valor);
}

/**
 * Executa um comando com `--help` e erros de uso tratados. `ErroUso` vira código 2;
 * `tratarErro` converte erros esperados do domínio em código de saída (ou devolve `undefined` para propagar).
 */
export async function executarComando(
  uso: string,
  saida: Saida,
  comando: () => Promise<number> | number,
  tratarErro?: (erro: unknown) => number | undefined,
): Promise<number> {
  try {
    return await comando();
  } catch (erro) {
    if (erro instanceof ErroUso) {
      saida.escreverErro(`${uso}\nerro: ${erro.message}`);
      return 2;
    }
    const codigo = tratarErro?.(erro);
    if (codigo === undefined) throw erro;
    return codigo;
  }
}
