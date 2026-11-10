/**
 * Interpretação de flags booleanas com a mesma interface do `argparse` usado
 * pelos antigos scripts Python: `-h/--help`, abreviações não ambíguas, erro de
 * uso com código de saída 2.
 */
import path from "node:path";

export type OpcaoCli = { nome: string; ajuda: string };
export type ResultadoCli = { flags: Record<string, boolean> } | { codigo: number };

function quebrar(texto: string, largura: number): string[] {
  const linhas: string[] = [];
  let atual = "";
  for (const palavra of texto.split(/\s+/).filter(Boolean)) {
    if (atual && atual.length + 1 + palavra.length > largura) {
      linhas.push(atual);
      atual = palavra;
    } else {
      atual = atual ? `${atual} ${palavra}` : palavra;
    }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

function larguraTerminal(): number {
  const colunas = Number(process.env.COLUMNS) || process.stdout.columns || 80;
  return Math.max(colunas - 2, 11);
}

export function uso(programa: string, opcoes: OpcaoCli[]): string {
  return `usage: ${programa} [-h]${opcoes.map((opcao) => ` [--${opcao.nome}]`).join("")}`;
}

export function ajuda(programa: string, descricao: string | undefined, opcoes: OpcaoCli[]): string {
  const largura = larguraTerminal();
  const invocacoes: Array<[string, string]> = [
    ["-h, --help", "show this help message and exit"],
    ...opcoes.map((opcao): [string, string] => [`--${opcao.nome}`, opcao.ajuda]),
  ];
  const maiorInvocacao = Math.max(...invocacoes.map(([invocacao]) => invocacao.length + 2));
  const posicaoAjuda = Math.min(maiorInvocacao + 2, 24);
  const larguraAjuda = Math.max(largura - posicaoAjuda, 11);
  const linhas = [uso(programa, opcoes), ""];
  if (descricao) linhas.push(...quebrar(descricao, largura), "");
  linhas.push("options:");
  for (const [invocacao, texto] of invocacoes) {
    const cabecalho = `  ${invocacao}`;
    const partes = quebrar(texto, larguraAjuda);
    if (cabecalho.length <= posicaoAjuda - 2) {
      linhas.push(`${cabecalho.padEnd(posicaoAjuda)}${partes[0] ?? ""}`.trimEnd());
    } else {
      linhas.push(cabecalho);
      linhas.push(`${" ".repeat(posicaoAjuda)}${partes[0] ?? ""}`);
    }
    for (const parte of partes.slice(1)) linhas.push(`${" ".repeat(posicaoAjuda)}${parte}`);
  }
  return `${linhas.join("\n")}\n`;
}

/** Interpreta `argv` (sem o executável e o script). Imprime ajuda/erros e devolve o código de saída quando não há o que executar. */
export function interpretarArgs(
  argv: string[],
  opcoes: OpcaoCli[],
  { programa = path.basename(process.argv[1] ?? "script"), descricao }: { programa?: string; descricao?: string } = {},
): ResultadoCli {
  const flags = Object.fromEntries(opcoes.map((opcao) => [opcao.nome, false]));
  const nomes = ["help", ...opcoes.map((opcao) => opcao.nome)];
  const desconhecidos: string[] = [];
  const falhar = (mensagem: string): ResultadoCli => {
    process.stderr.write(`${uso(programa, opcoes)}\n${programa}: error: ${mensagem}\n`);
    return { codigo: 2 };
  };

  for (const argumento of argv) {
    if (argumento === "-h") {
      process.stdout.write(ajuda(programa, descricao, opcoes));
      return { codigo: 0 };
    }
    if (!argumento.startsWith("--") || argumento === "--") {
      desconhecidos.push(argumento);
      continue;
    }
    const [chave, valor] = argumento.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    const candidatos = nomes.includes(chave) ? [chave] : nomes.filter((nome) => nome.startsWith(chave));
    if (candidatos.length > 1) {
      return falhar(`ambiguous option: --${chave} could match ${candidatos.map((nome) => `--${nome}`).join(", ")}`);
    }
    const [nome] = candidatos;
    if (nome === undefined) {
      desconhecidos.push(argumento);
      continue;
    }
    if (valor !== undefined) return falhar(`argument --${nome}: ignored explicit argument '${valor}'`);
    if (nome === "help") {
      process.stdout.write(ajuda(programa, descricao, opcoes));
      return { codigo: 0 };
    }
    flags[nome] = true;
  }
  if (desconhecidos.length) return falhar(`unrecognized arguments: ${desconhecidos.join(" ")}`);
  return { flags };
}
