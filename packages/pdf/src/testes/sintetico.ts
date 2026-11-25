/**
 * Construtor de PDFs sintéticos para testes (não é usado em produção): páginas de texto em
 * Helvetica 12 com `WinAnsiEncoding` (os acentos do português cabem no Latin-1), escritas à mão,
 * com a tabela `xref` calculada aqui. A linha entre `**` sai em Helvetica-Bold; a tabela é desenhada
 * com traços (`re` e `S`), com o texto de cada célula dentro dela.
 */

/** Tabela desenhada: o canto de cima à esquerda, a largura de cada coluna e as células. */
export interface TabelaSintetica {
  readonly x: number;
  readonly y: number;
  readonly larguras: ReadonlyArray<number>;
  readonly celulas: ReadonlyArray<ReadonlyArray<string>>;
}

export interface OpcoesPdfSintetico {
  /**
   * As linhas de cada página, de cima para baixo, a partir de (72, 720), com 14 pontos de
   * entrelinha; a linha vazia só deixa o espaço (separa parágrafos). Página sem linhas sai vazia.
   */
  readonly paginas: ReadonlyArray<ReadonlyArray<string>>;
  /**
   * Um dicionário `/Encrypt` cuja senha de usuário não é vazia: o leitor pede senha. O conteúdo não
   * é cifrado de fato, porque o leitor para antes, na conferência da senha.
   */
  readonly protegido?: boolean;
  /** Linha no alto de cada página (y 770), como um cabeçalho. */
  readonly cabecalho?: string;
  /** O número da página no pé de cada página (y 30). */
  readonly numerarPaginas?: boolean;
  /** As tabelas de cada página (índice da página → tabelas), abaixo do texto. */
  readonly tabelas?: Readonly<Record<number, ReadonlyArray<TabelaSintetica>>>;
}

const ALTURA_LINHA_TABELA = 20;

function desenharTabela(tabela: TabelaSintetica): string[] {
  const comandos: string[] = ["0.5 w"];
  const largura = tabela.larguras.reduce((a, b) => a + b, 0);
  const altura = tabela.celulas.length * ALTURA_LINHA_TABELA;
  for (let i = 0; i <= tabela.celulas.length; i++) {
    const y = tabela.y - i * ALTURA_LINHA_TABELA;
    comandos.push(`${tabela.x} ${y} m ${tabela.x + largura} ${y} l S`);
  }
  let x = tabela.x;
  for (let j = 0; j <= tabela.larguras.length; j++) {
    comandos.push(`${x} ${tabela.y} m ${x} ${tabela.y - altura} l S`);
    x += tabela.larguras[j] ?? 0;
  }
  tabela.celulas.forEach((linha, i) => {
    let xCelula = tabela.x;
    linha.forEach((texto, j) => {
      if (texto)
        comandos.push(
          `BT /F1 10 Tf ${xCelula + 3} ${tabela.y - (i + 1) * ALTURA_LINHA_TABELA + 6} Td ${literal(texto)} Tj ET`,
        );
      xCelula += tabela.larguras[j] ?? 0;
    });
  });
  return comandos;
}

const ENTRELINHA = 14;

const literal = (texto: string) => `(${texto.replace(/[\\()]/g, (c) => `\\${c}`)})`;

function conteudoDaPagina(linhas: ReadonlyArray<string>, numero: number, opcoes: OpcoesPdfSintetico): string {
  const comandos = ["BT", "/F1 12 Tf", `${ENTRELINHA} TL`, "72 720 Td"];
  for (const linha of linhas) {
    const negrito = /^\*\*(.+)\*\*$/u.exec(linha);
    if (negrito) comandos.push(`/F2 12 Tf ${literal(negrito[1]!)} Tj T* /F1 12 Tf`);
    else comandos.push(linha ? `${literal(linha)} Tj T*` : "T*");
  }
  comandos.push("ET");
  if (opcoes.cabecalho) comandos.push(`BT /F1 10 Tf 72 770 Td ${literal(opcoes.cabecalho)} Tj ET`);
  if (opcoes.numerarPaginas) comandos.push(`BT /F1 10 Tf 300 30 Td (${numero}) Tj ET`);
  for (const tabela of opcoes.tabelas?.[numero - 1] ?? []) comandos.push(...desenharTabela(tabela));
  return comandos.join("\n");
}

/** Bytes de um texto Latin-1 (um caractere, um byte); lança com caractere fora do Latin-1. */
function latin1(texto: string): Uint8Array {
  const bytes = new Uint8Array(texto.length);
  for (let i = 0; i < texto.length; i++) {
    const codigo = texto.charCodeAt(i);
    if (codigo > 0xff) throw new Error(`caractere fora do Latin-1 no PDF sintético: ${texto[i]}`);
    bytes[i] = codigo;
  }
  return bytes;
}

/** Um PDF 1.4 válido, com `xref` e `trailer`. */
export function montarPdf(opcoes: OpcoesPdfSintetico): Uint8Array {
  const objetos: string[] = [];
  const reservar = () => objetos.push("");
  const catalogo = reservar();
  const paginas = reservar();
  const fonte = reservar();
  objetos[fonte - 1] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  const negrito = reservar();
  objetos[negrito - 1] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  const filhas: number[] = [];
  for (const [indice, linhas] of opcoes.paginas.entries()) {
    const conteudo = conteudoDaPagina(linhas, indice + 1, opcoes);
    const fluxo = reservar();
    objetos[fluxo - 1] = `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`;
    const pagina = reservar();
    objetos[pagina - 1] =
      `<< /Type /Page /Parent ${paginas} 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${fonte} 0 R /F2 ${negrito} 0 R >> >> /Contents ${fluxo} 0 R >>`;
    filhas.push(pagina);
  }
  objetos[catalogo - 1] = `<< /Type /Catalog /Pages ${paginas} 0 R >>`;
  objetos[paginas - 1] =
    `<< /Type /Pages /Kids [${filhas.map((n) => `${n} 0 R`).join(" ")}] /Count ${filhas.length} >>`;
  let cifra = "";
  if (opcoes.protegido) {
    const encrypt = reservar();
    const bloco = "7a".repeat(32);
    objetos[encrypt - 1] = `<< /Filter /Standard /V 1 /R 2 /O <${bloco}> /U <${bloco}> /P -4 >>`;
    cifra = ` /Encrypt ${encrypt} 0 R /ID [<${"01".repeat(16)}> <${"01".repeat(16)}>]`;
  }

  let arquivo = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const posicoes: number[] = [];
  objetos.forEach((corpo, i) => {
    posicoes.push(arquivo.length);
    arquivo += `${i + 1} 0 obj\n${corpo}\nendobj\n`;
  });
  const inicioXref = arquivo.length;
  arquivo += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const posicao of posicoes) arquivo += `${String(posicao).padStart(10, "0")} 00000 n \n`;
  arquivo += `trailer\n<< /Size ${objetos.length + 1} /Root ${catalogo} 0 R${cifra} >>\nstartxref\n${inicioXref}\n%%EOF\n`;
  return latin1(arquivo);
}
