/**
 * Construtor de PDFs sintéticos para testes (não é usado em produção): páginas de texto em
 * Helvetica 12 com `WinAnsiEncoding` (os acentos do português cabem no Latin-1), escritas à mão,
 * com a tabela `xref` calculada aqui.
 */

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
}

const ENTRELINHA = 14;

const literal = (texto: string) => `(${texto.replace(/[\\()]/g, (c) => `\\${c}`)})`;

function conteudoDaPagina(linhas: ReadonlyArray<string>): string {
  const comandos = ["BT", "/F1 12 Tf", `${ENTRELINHA} TL`, "72 720 Td"];
  for (const linha of linhas) comandos.push(linha ? `${literal(linha)} Tj T*` : "T*");
  comandos.push("ET");
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
  const filhas: number[] = [];
  for (const linhas of opcoes.paginas) {
    const conteudo = conteudoDaPagina(linhas);
    const fluxo = reservar();
    objetos[fluxo - 1] = `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`;
    const pagina = reservar();
    objetos[pagina - 1] =
      `<< /Type /Page /Parent ${paginas} 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${fonte} 0 R >> >> /Contents ${fluxo} 0 R >>`;
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
