/**
 * Limpeza determinística do Markdown convertido de um PDF (`limparMarkdownConvertido`): tira o ruído
 * que a paginação deixa e normaliza a marcação, sem mudar as palavras do documento.
 *
 * Vale para o texto do `pdfParaMarkdown` e para o dos PPCs antigos da base (convertidos por outra
 * ferramenta, com títulos `## **…**` e tabelas Markdown). O texto é tratado em blocos, separados
 * por linha em branco; as passadas, nesta ordem:
 *
 * 1. `marcadores`: os marcadores de lista das fontes Symbol e Wingdings (área de uso privado do
 *    Unicode, como U+F0B7) viram item de lista `- ` (ou `•` dentro de tabela);
 * 2. `cabecalhos`: cabeçalho e rodapé de página, o bloco curto repetido (3 vezes ou mais) com termo
 *    institucional (Ministério da Educação, Instituto Federal, câmpus, pró-reitoria, endereço, CEP);
 * 3. `paginas`: o número de página solto, quando segue a sequência das páginas;
 * 4. `sumario`: a sequência de 5 ou mais entradas de sumário (título seguido do número da página);
 * 5. `tabelas`: a linha de tabela toda vazia e a tabela partida pela página, quando a parte de baixo
 *    repete o cabeçalho ou o tem vazio e o número de colunas é o mesmo;
 * 6. `titulos`: título sem o negrito que o envolve, no nível da numeração (`2.4.1` → `####`); o
 *    item de lista ou a linha em negrito que só traz um título numerado vira título, e a linha
 *    numerada curta sem marcação também, quando continua a numeração do título anterior (2.4 →
 *    2.4.1, 2.5 ou 3; "1.1 Conceitos" numa ementa depois de "4.2" não continua);
 * 7. `paragrafos`: o parágrafo partido pela página ou pela coluna, quando o primeiro pedaço tem 50
 *    caracteres ou mais, não acaba em pontuação final e o seguinte começa com minúscula;
 * 8. `espacos`: o espaço antes da pontuação depois de ênfase (`_campus_ ;`) e o espaço repetido.
 *
 * O que a regra não decide sozinha (parágrafo partido antes de maiúscula, título colado no texto,
 * célula de tabela partida) fica para o diagnóstico (`./diagnostico.ts`) e a revisão com IA.
 */

export type Passada =
  | "marcadores"
  | "cabecalhos"
  | "paginas"
  | "sumario"
  | "tabelas"
  | "titulos"
  | "paragrafos"
  | "espacos";

export const PASSADAS: ReadonlyArray<Passada> = [
  "marcadores",
  "cabecalhos",
  "paginas",
  "sumario",
  "tabelas",
  "titulos",
  "paragrafos",
  "espacos",
];

export type Contagens = Record<Passada, number>;

export interface ResultadoLimpeza {
  readonly texto: string;
  /** Quantas mudanças cada passada fez. */
  readonly contagens: Contagens;
}

/* ---------------------------------------------------------------- utilidades */

/** Marcadores de lista das fontes de símbolos, na área de uso privado. */
// Escritos como código: o formatador troca o escape "\uF0B7" pelo caractere, que não se vê no editor.
const MARCADORES_PRIVADOS = [0xf0b7, 0xf0fc, 0xf02d, 0xf0a7, 0xf0d8, 0xf06c, 0xf0e0, 0xf076, 0xf0a8, 0xf0f0, 0xf0fb]
  .map((codigo) => String.fromCharCode(codigo))
  .join("");
const RE_MARCADOR_INICIO = new RegExp(`^[ \\t]*[${MARCADORES_PRIVADOS}][ \\t\\u00A0]*`, "u");
const RE_MARCADOR_MEIO = new RegExp(`[ \\t\\u00A0]+[${MARCADORES_PRIVADOS}][ \\t\\u00A0]*(?=\\S)`, "gu");
const RE_MARCADOR_QUALQUER = new RegExp(`[${MARCADORES_PRIVADOS}][ \\t\\u00A0]*`, "gu");
const RE_TEM_MARCADOR = new RegExp(`[${MARCADORES_PRIVADOS}]`, "u");

function semAcentos(texto: string): string {
  return texto.normalize("NFKD").replace(/\p{Mn}/gu, "");
}

/** O texto de um bloco sem a marcação (título, negrito, itálico, lista, cerca de código). */
export function textoSemMarcacao(bloco: string): string {
  return bloco
    .replace(/^```.*$/gmu, "")
    .replace(/<br\s*\/?>/gu, " ")
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/^[-*]\s+/gmu, "")
    .replace(/[*_`]+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function ehTabela(bloco: string): boolean {
  return bloco.startsWith("|");
}

function ehTitulo(bloco: string): boolean {
  return /^#{1,6}\s/u.test(bloco);
}

function ehItem(bloco: string): boolean {
  return /^[-*]\s/u.test(bloco);
}

function ehCerca(bloco: string): boolean {
  return bloco.startsWith("```");
}

function ehComentario(bloco: string): boolean {
  return bloco.startsWith("<!--");
}

/** Parágrafo comum: nem título, nem tabela, nem item, nem cerca, nem comentário. */
function ehParagrafo(bloco: string): boolean {
  return !ehTabela(bloco) && !ehTitulo(bloco) && !ehItem(bloco) && !ehCerca(bloco) && !ehComentario(bloco);
}

export function blocosDoTexto(texto: string): string[] {
  return texto
    .replace(/\r\n?/gu, "\n")
    .split(/\n[ \t]*\n/u)
    .map((bloco) =>
      bloco
        .split("\n")
        .map((linha) => linha.trimEnd())
        .join("\n")
        .replace(/^\n+|\n+$/gu, ""),
    )
    .filter((bloco) => bloco.trim() !== "");
}

/* ---------------------------------------------------------------- 1. marcadores */

function marcadores(blocos: string[], contar: () => void): string[] {
  const saida: string[] = [];
  for (const bloco of blocos) {
    if (!RE_TEM_MARCADOR.test(bloco)) {
      saida.push(bloco);
      continue;
    }
    if (ehTabela(bloco)) {
      saida.push(
        bloco.replace(RE_MARCADOR_QUALQUER, () => {
          contar();
          return "• ";
        }),
      );
      continue;
    }
    // Cada marcador começa um item; o texto antes do primeiro, se houver, fica como parágrafo.
    const partes = bloco
      .replace(RE_MARCADOR_MEIO, () => {
        contar();
        return "\n\u0000";
      })
      .split("\n\u0000");
    partes.forEach((parte, i) => {
      if (i === 0 && !RE_MARCADOR_INICIO.test(parte)) {
        if (parte.trim()) saida.push(parte.trim());
        return;
      }
      if (i === 0) contar();
      const texto = parte
        .replace(RE_MARCADOR_INICIO, "")
        .replace(/\n[ \t]*/gu, " ")
        .trim();
      if (texto) saida.push(`- ${texto}`);
    });
  }
  return saida;
}

/* ---------------------------------------------------------------- 2. cabeçalhos */

const RE_INSTITUCIONAL =
  /ministerio ?da ?educa|instituto ?federal|institutofederal|\bifpr\b|\bc[a]mpus\b|pro-?reitoria|\bproens\b|\bcep\b|^(rua|av\.?|avenida|rodovia|estrada) |www\.|\.edu\.br|\b(?:tele)?fone\s*:|^parana$|pagina # de #/u;

/** Legenda e fonte de figura ou tabela repetem o nome do IFPR sem serem cabeçalho. */
const RE_LEGENDA = /^(fonte|figura|quadro|tabela|grafico|imagem|foto)\b/u;

/** A chave que identifica o mesmo cabeçalho em páginas diferentes: sem marcação, números e acentos. */
function chaveDeRepeticao(bloco: string): string {
  return semAcentos(textoSemMarcacao(bloco))
    .toLowerCase()
    .replace(/\d+/gu, "#")
    .replace(/\s*\|\s*/gu, " | ")
    .trim();
}

function ehCandidatoACabecalho(bloco: string): boolean {
  if (ehTabela(bloco) || ehCerca(bloco) || ehComentario(bloco)) return false;
  const texto = textoSemMarcacao(bloco);
  return (
    texto.length > 0 &&
    texto.length <= 160 &&
    texto.split(" ").length <= 24 &&
    !RE_LEGENDA.test(semAcentos(texto).toLowerCase())
  );
}

export const MINIMO_REPETICOES_CABECALHO = 3;

/** As chaves dos blocos curtos repetidos, com quantas vezes cada uma aparece. */
export function repeticoes(blocos: ReadonlyArray<string>): Map<string, number> {
  const contagem = new Map<string, number>();
  for (const bloco of blocos) {
    if (!ehCandidatoACabecalho(bloco)) continue;
    const chave = chaveDeRepeticao(bloco);
    contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
  }
  return contagem;
}

/**
 * Referência bibliográfica ("São Paulo: Campus, 2005"), URL, frase ("…do Paraná. Resolução…"), ato
 * ("Resolução de autorização do curso no IFPR"), assinatura de reitor e item longo citam o IFPR ou
 * um endereço sem serem cabeçalho.
 */
const RE_CONTEUDO =
  /https?:|acesso em|disponivel em|\p{L}{3,}\. \p{L}|\bed\.|: campus\b|\breitor\b|resolu|portaria|parecer|autoriza|decreto|\blei\b|^[^\p{L}\p{N}#]/u;

export function ehChaveInstitucional(chave: string): boolean {
  if (!RE_INSTITUCIONAL.test(chave) || RE_CONTEUDO.test(chave) || RE_LEGENDA.test(chave)) return false;
  return chave.split(" ").length <= 12 || /\||\bcep\b/u.test(chave);
}

function cabecalhos(blocos: string[], contar: () => void): string[] {
  const contagem = repeticoes(blocos);
  return blocos.filter((bloco) => {
    if (!ehCandidatoACabecalho(bloco)) return true;
    const chave = chaveDeRepeticao(bloco);
    const remover = (contagem.get(chave) ?? 0) >= MINIMO_REPETICOES_CABECALHO && ehChaveInstitucional(chave);
    if (remover) contar();
    return !remover;
  });
}

/* ---------------------------------------------------------------- 3. páginas */

const RE_NUMERO_PAGINA = /^(?:p[áa]g(?:ina)?\.?\s*)?[-–]?\s*(\d{1,3})\s*[-–]?(?:\s*(?:de|\/)\s*\d{1,3})?$/iu;

/** O número de página de um bloco que só tem ele (também dentro de cerca de código), ou `null`. */
export function numeroDePagina(bloco: string): number | null {
  if (ehTabela(bloco) || ehTitulo(bloco) || ehItem(bloco)) return null;
  const texto = textoSemMarcacao(bloco);
  const casamento = RE_NUMERO_PAGINA.exec(texto);
  return casamento ? Number(casamento[1]) : null;
}

/** `seguinte` vem depois de `anterior` na sequência das páginas (até 6 adiante, ou recomeço em 1 a 3). */
const segueNaSequencia = (anterior: number, seguinte: number) =>
  (seguinte > anterior && seguinte - anterior <= 6) || seguinte <= 3;

function paginas(blocos: string[], contar: () => void): string[] {
  const numeros = blocos.map(numeroDePagina);
  const proximoNumero = (i: number) => numeros.slice(i + 1).find((n) => n !== null) ?? null;
  let ultimo: number | undefined;
  return blocos.filter((_, i) => {
    const numero = numeros[i];
    if (numero === null || numero === undefined) return true;
    // Sem página aceita antes (ou fora da sequência dela), vale o número que o próximo número solto segue.
    const proximo = proximoNumero(i);
    const segue =
      (ultimo === undefined ? numero <= 30 : segueNaSequencia(ultimo, numero)) ||
      (proximo !== null && proximo > numero && proximo - numero <= 6);
    if (!segue) return true;
    ultimo = numero;
    contar();
    return false;
  });
}

/* ---------------------------------------------------------------- 4. sumário */

const RE_ENTRADA_SUMARIO =
  /^(?:(?:\d{1,2}(?:\.\d{1,3})*\.?|[IVX]{1,5}[.\s-])\s*\S.{0,160}?|\p{L}.{1,160}?)(?:\s*\.{3,}\s*|\s+|(?<=[\p{L})\]]))\d{1,3}$/u;
/** Linha de sumário partida: o título continua no bloco seguinte, que traz o número da página. */
const RE_PEDACO_SUMARIO = /^[^|]{3,120}(?<![.;!?:])$/u;
const RE_TITULO_SUMARIO = /^(sumario|indice|lista de (figuras|tabelas|quadros|ilustracoes|siglas|graficos))\b/u;

function ehEntradaDeSumario(bloco: string): boolean {
  if (ehTabela(bloco) || bloco.includes("\n")) return false;
  return RE_ENTRADA_SUMARIO.test(textoSemMarcacao(bloco));
}

function sumario(blocos: string[], contar: () => void): string[] {
  const remover = new Set<number>();
  let i = 0;
  while (i < blocos.length) {
    if (!ehEntradaDeSumario(blocos[i]!)) {
      i += 1;
      continue;
    }
    let fim = i;
    for (;;) {
      if (fim + 1 < blocos.length && ehEntradaDeSumario(blocos[fim + 1]!)) fim += 1;
      else if (
        fim + 2 < blocos.length &&
        !ehTabela(blocos[fim + 1]!) &&
        !blocos[fim + 1]!.includes("\n") &&
        RE_PEDACO_SUMARIO.test(textoSemMarcacao(blocos[fim + 1]!)) &&
        ehEntradaDeSumario(blocos[fim + 2]!)
      )
        fim += 2;
      else break;
    }
    if (fim - i + 1 >= 5) {
      let inicio = i;
      const anterior = blocos[i - 1];
      if (anterior !== undefined && RE_TITULO_SUMARIO.test(semAcentos(textoSemMarcacao(anterior)).toLowerCase()))
        inicio -= 1;
      for (let j = inicio; j <= fim; j += 1) remover.add(j);
    }
    i = fim + 1;
  }
  for (let j = 0; j < remover.size; j += 1) contar();
  return blocos.filter((_, j) => !remover.has(j));
}

/* ---------------------------------------------------------------- 5. tabelas */

function celulas(linha: string): string[] {
  return linha.replace(/^\||\|$/gu, "").split("|");
}

const RE_SEPARADOR = /^\|(?:\s*:?-{3,}:?\s*\|)+$/u;
const RE_LINHA_VAZIA = /^\|(?:\s*\|)+$/u;

/**
 * Linha de tabela que só traz o cabeçalho de página (`|INSTITUTOFEDERAL<br>Parana||`): cada pedaço
 * de cada célula preenchida é termo institucional ou número, e há ao menos um termo.
 */
export function ehLinhaDeCabecalhoDePagina(linha: string): boolean {
  if (RE_SEPARADOR.test(linha)) return false;
  const pedacos = celulas(linha)
    .flatMap((celula) => celula.split(/<br\s*\/?>/u))
    .map((pedaco) => chaveDeRepeticao(pedaco.replace(/[[\]]/gu, " ")))
    .filter((chave) => chave !== "");
  // O título da matriz ("INSTITUTO FEDERAL DE EDUCAÇÃO, CIÊNCIA E TECNOLOGIA DO PARANÁ") é mais longo.
  const curta = (chave: string) => ehChaveInstitucional(chave) && chave.split(" ").length <= 8;
  return pedacos.some(curta) && pedacos.every((chave) => /^[#\s.]+$/u.test(chave) || curta(chave));
}

function tabelas(blocos: string[], contar: () => void): string[] {
  const saida: string[] = [];
  for (const bloco of blocos) {
    if (!ehTabela(bloco)) {
      saida.push(bloco);
      continue;
    }
    const linhas = bloco.split("\n");
    const separador = linhas.findIndex((linha) => RE_SEPARADOR.test(linha));
    // O cabeçalho de página que caiu dentro da tabela: na primeira linha, ela fica vazia (e a
    // tabela pode juntar-se à anterior); nas outras, sai.
    if (separador === 1 && ehLinhaDeCabecalhoDePagina(linhas[0]!)) {
      contar();
      linhas[0] = `|${"|".repeat(celulas(linhas[1]!).length)}`;
    }
    const corpo = linhas.filter((linha, i) => {
      const sai = i > separador && separador >= 0 && (RE_LINHA_VAZIA.test(linha) || ehLinhaDeCabecalhoDePagina(linha));
      if (sai) contar();
      return !sai;
    });
    const anterior = saida.at(-1);
    if (anterior !== undefined && ehTabela(anterior) && separador === 1) {
      const linhasAnterior = anterior.split("\n");
      const separadorAnterior = linhasAnterior.find((linha) => RE_SEPARADOR.test(linha));
      const mesmasColunas =
        separadorAnterior !== undefined && celulas(separadorAnterior).length === celulas(corpo[1]!).length;
      const cabecalhoVazio = RE_LINHA_VAZIA.test(corpo[0]!);
      const cabecalhoRepetido = corpo[0]!.replace(/\s+/gu, "") === linhasAnterior[0]!.replace(/\s+/gu, "");
      if (mesmasColunas && (cabecalhoVazio || cabecalhoRepetido)) {
        contar();
        saida[saida.length - 1] = [...linhasAnterior, ...corpo.slice(2)].join("\n");
        continue;
      }
    }
    saida.push(corpo.join("\n"));
  }
  return saida;
}

/* ---------------------------------------------------------------- 6. títulos */

const RE_NUMERACAO_TITULO = /^(\d{1,2}(?:\.\d{1,3})*)\.?(?![\dºª°])\s*[-–.]?\s+(?=\S)/u;
const RE_TITULO_EM_ITEM = /^[-*]\s+(?:\*\*)?(\d{1,2}(?:\.\d{1,3})+\.?\s+\p{Lu}[^.;:!?|]{1,110}?)(?:\*\*)?$/u;
const RE_TITULO_EM_NEGRITO = /^\*\*(\d{1,2}(?:\.\d{1,3})*\.?\s+\p{Lu}[^*.;!?|]{1,110}?):?\*\*$/u;

/** O nível do título pela numeração: `2` → 2, `2.4` → 3, `2.4.1` → 4 (até 6); sem numeração, `null`. */
export function nivelDaNumeracao(texto: string): number | null {
  const casamento = RE_NUMERACAO_TITULO.exec(texto);
  if (!casamento) return null;
  return Math.min(6, casamento[1]!.split(".").length + 1);
}

function limparTextoDoTitulo(texto: string): string {
  let limpo = texto.replace(/\*\*/gu, "").replace(/\s+/gu, " ").trim();
  const italico = /^_([^_]+)_$/u.exec(limpo);
  if (italico) limpo = italico[1]!.trim();
  return limpo;
}

const RE_SO_NUMERACAO = /^#{1,6}\s+(?:\*\*)?(\d{1,2}(?:\.\d{1,3})*\.?)(?:\*\*)?$/u;
const RE_RESTO_DO_TITULO = /^(?:\*\*)?\p{Lu}[^.;!?|\n]{1,110}?(?:\*\*)?$/u;

/** O título partido em dois blocos, a numeração num e o texto no seguinte, volta a ser um só. */
function juntarNumeracaoSolta(blocos: string[], contar: () => void): string[] {
  const saida: string[] = [];
  for (const bloco of blocos) {
    const anterior = saida.at(-1);
    const numeracao = anterior === undefined ? null : RE_SO_NUMERACAO.exec(anterior);
    if (numeracao && ehParagrafo(bloco) && RE_RESTO_DO_TITULO.test(bloco)) {
      contar();
      saida[saida.length - 1] = `## ${numeracao[1]} ${bloco}`;
    } else saida.push(bloco);
  }
  return saida;
}

const RE_TITULO_SEM_MARCACAO = /^(\d{1,2}(?:\.\d{1,3})*)\.?\s*[-–]?\s+(\p{Lu}[^.;:!?|\n]{1,110})$/u;

/** A numeração `2.4.1` em números, ou `null`. */
function numeros(texto: string): number[] | null {
  const casamento = RE_NUMERACAO_TITULO.exec(texto);
  return casamento ? casamento[1]!.split(".").map(Number) : null;
}

/**
 * `proxima` continua a numeração de `anterior`: vem depois dela, no mesmo capítulo ou no seguinte, e
 * desce no máximo um nível (2.4 → 2.4.1, 2.5, 2.7.1 ou 3; não 2.3, 1.1 nem 2.4.1.1). Pular um número
 * é aceito porque um título do meio pode ter escapado ao reconhecimento.
 */
export function continuaNumeracao(anterior: ReadonlyArray<number>, proxima: ReadonlyArray<number>): boolean {
  if (proxima.length > anterior.length + 1) return false;
  const capitulo = proxima[0]! - anterior[0]!;
  if (capitulo < 0 || capitulo > 1) return false;
  if (capitulo === 1) return proxima.length === 1 || proxima.slice(1).every((n) => n === 1);
  for (let i = 0; i < Math.max(anterior.length, proxima.length); i += 1) {
    const a = anterior[i] ?? 0;
    const b = proxima[i] ?? 0;
    if (b !== a) return b > a && b - a <= 3;
  }
  return false;
}

function titulos(blocos: string[], contar: () => void): string[] {
  // A última numeração de título vista: a linha numerada sem marcação vira título quando a continua.
  let ultima: number[] | undefined;
  return juntarNumeracaoSolta(blocos, contar).map((bloco) => {
    let titulo: { nivel: number; texto: string } | undefined;
    const markdown = /^(#{1,6})\s+(.+)$/u.exec(bloco);
    if (markdown && !bloco.includes("\n")) {
      const texto = limparTextoDoTitulo(markdown[2]!);
      titulo = { nivel: nivelDaNumeracao(texto) ?? Math.max(2, markdown[1]!.length), texto };
    } else if (!bloco.includes("\n")) {
      const promovido = RE_TITULO_EM_ITEM.exec(bloco) ?? RE_TITULO_EM_NEGRITO.exec(bloco);
      if (promovido) {
        const texto = limparTextoDoTitulo(promovido[1]!);
        titulo = { nivel: nivelDaNumeracao(texto) ?? 2, texto };
      } else if (ultima && ehParagrafo(bloco)) {
        const texto = limparTextoDoTitulo(bloco);
        const candidato = RE_TITULO_SEM_MARCACAO.test(texto) ? numeros(texto) : null;
        if (candidato && continuaNumeracao(ultima, candidato))
          titulo = { nivel: nivelDaNumeracao(texto) ?? 2, texto };
      }
    }
    if (!titulo || !titulo.texto) return bloco;
    ultima = numeros(titulo.texto) ?? ultima;
    const novo = `${"#".repeat(titulo.nivel)} ${titulo.texto}`;
    if (novo !== bloco) contar();
    return novo;
  });
}

/* ---------------------------------------------------------------- 7. parágrafos */

const RE_FIM_ABERTO = /[\p{L}\p{N},]$/u;
const RE_COMECA_MINUSCULA = /^\p{Ll}/u;
export const MINIMO_CARACTERES_CONTINUACAO = 50;

function textoDoItem(bloco: string): string {
  return bloco.replace(/^[-*]\s+/u, "");
}

/** O bloco seguinte continua o anterior (parágrafo ou item partido pela página)? */
export function continua(anterior: string, seguinte: string): boolean {
  if (!(ehParagrafo(anterior) || ehItem(anterior)) || anterior.includes("\n")) return false;
  if (!(ehParagrafo(seguinte) || ehItem(seguinte))) return false;
  const textoAnterior = ehItem(anterior) ? textoDoItem(anterior) : anterior;
  const textoSeguinte = ehItem(seguinte) ? textoDoItem(seguinte) : seguinte;
  return (
    textoAnterior.length >= MINIMO_CARACTERES_CONTINUACAO &&
    RE_FIM_ABERTO.test(textoAnterior) &&
    RE_COMECA_MINUSCULA.test(textoSeguinte)
  );
}

function paragrafos(blocos: string[], contar: () => void): string[] {
  const saida: string[] = [];
  for (const bloco of blocos) {
    const anterior = saida.at(-1);
    if (anterior !== undefined && continua(anterior, bloco)) {
      contar();
      const resto = (ehItem(bloco) ? textoDoItem(bloco) : bloco).replace(/\n/gu, " ");
      saida[saida.length - 1] = `${anterior} ${resto}`;
    } else saida.push(bloco);
  }
  return saida;
}

/* ---------------------------------------------------------------- 8. espaços */

function espacos(blocos: string[], contar: () => void): string[] {
  return blocos.map((bloco) => {
    if (ehCerca(bloco)) return bloco;
    let novo = bloco.replace(/(?<=\S[_*]) (?=[,.;:!?](?:\s|$))/gu, "");
    if (!ehTabela(novo)) novo = novo.replace(/(?<=\S)[ \t ]{2,}(?=\S)/gu, " ");
    if (novo !== bloco) contar();
    return novo;
  });
}

/* ---------------------------------------------------------------- entrada */

const FUNCOES: Record<Passada, (blocos: string[], contar: () => void) => string[]> = {
  marcadores,
  cabecalhos,
  paginas,
  sumario,
  tabelas,
  titulos,
  paragrafos,
  espacos,
};

export interface OpcoesLimpeza {
  /** As passadas a aplicar (padrão: todas, na ordem de `PASSADAS`). */
  readonly passadas?: ReadonlyArray<Passada>;
}

/** O corpo limpo (sem front matter: quem chama o separa antes), com as contagens por passada. */
export function limparMarkdownConvertido(corpo: string, opcoes: OpcoesLimpeza = {}): ResultadoLimpeza {
  const escolhidas = new Set(opcoes.passadas ?? PASSADAS);
  const contagens = Object.fromEntries(PASSADAS.map((p) => [p, 0])) as Contagens;
  let blocos = blocosDoTexto(corpo);
  // Uma passada revela trabalho para outra (o cabeçalho que sai da tabela deixa o número de página
  // solto): repete até o texto parar de mudar, para que limpar duas vezes dê o mesmo resultado.
  for (let rodada = 0; rodada < 5; rodada += 1) {
    const antes = blocos.join("\n\n");
    for (const passada of PASSADAS) {
      if (!escolhidas.has(passada)) continue;
      blocos = FUNCOES[passada](blocos, () => {
        contagens[passada] += 1;
      });
    }
    if (blocos.join("\n\n") === antes) break;
  }
  return { texto: blocos.length ? `${blocos.join("\n\n")}\n` : "", contagens };
}
