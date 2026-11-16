/**
 * Ementário: cada componente curricular num quadro de uma coluna, com nome, período, carga
 * horária, ementa e bibliografias básica e complementar.
 *
 * A parte difícil é separar as referências bibliográficas, que chegam numa célula só: uma por
 * linha, com hífen de lista ou emendadas ("…2013.IEZZI, Gelson…"). A separação combina as quebras
 * do próprio texto com padrões ABNT (fim em ano, ISBN, volume; início em SOBRENOME, Nome) e uma
 * busca aproximada de "Local: Editora, ano." que tolera erro de digitação no local.
 */
import { finditer, match, search, split, sub } from "@simplifica-if/kb/python/re";
import { inteiroDeTexto } from "@simplifica-if/kb/python/valores";
import { aparar, contarCaracteres } from "@simplifica-if/kb/texto";
import { mascarasDoPalheiro, partialRatio, partialRatioNoTrecho, prepararAgulha } from "./similaridade.ts";
import { colunasDaTabela, type TabelaNormalizada, todasAsLinhas } from "./tabelas.ts";

const r = String.raw;

export type ComponenteDoEmentario = {
  nome: string;
  periodo_letivo: string | null;
  carga_horaria_aula: number | null;
  ementa: string;
  bibliografia_basica: string[];
  bibliografia_complementar: string[];
};

const LOCAIS_CONHECIDOS = [
  "São Paulo",
  "Rio de Janeiro",
  "Porto Alegre",
  "Curitiba",
  "Belo Horizonte",
  "Campinas",
  "Florianópolis",
  "Salvador",
  "Brasília",
  "Recife",
  "Londrina",
  "Niterói",
  "Petrópolis",
  "Barueri",
  "Bauru",
  "Ribeirão Preto",
  "Santa Maria",
  "Maringá",
].map((local) => prepararAgulha(local.toLowerCase()));

const MAIUSCULA = "A-ZÁÉÍÓÚÀÂÊÔÃÕÇ";
const LETRA = `A-Za-zÁÉÍÓÚÀÂÊÔÃÕÇáéíóúàâêôãõç`;
/** Início de referência: `SOBRENOME,` (com sobrenomes compostos). */
const SOBRENOME = `[${MAIUSCULA}]{2,}[${MAIUSCULA}\\s]*,`;
/** Autor institucional: `BRASIL.`, `___.` (autor repetido) ou sigla composta seguida de ponto. */
const AUTOR_INSTITUCIONAL = `[${MAIUSCULA}]{2,}(?:[\\s/&()\\-]+[${MAIUSCULA}]{2,}){1,8}(?:\\s+\\([${LETRA}]{2,}\\))?`;
const HIFEN_INICIAL = r`^[\-–—]\s*`;

// ---------------------------------------------------------------- campos do quadro

/**
 * Colunas com conteúdo. Os quadros de ementário do Google Docs têm colunas extras vazias, e só a
 * primeira traz texto.
 */
function colunasEfetivas(tabela: TabelaNormalizada): number {
  const colunas = colunasDaTabela(tabela);
  if (colunas <= 1) return colunas;
  const algumaOutraPreenchida = todasAsLinhas(tabela).some((linha) => linha.slice(1).some((item) => aparar(item)));
  return algumaOutraPreenchida ? colunas : 1;
}

function nome(texto: string): string {
  // O nome vai até a quebra de linha ou até o rótulo seguinte na mesma linha.
  const m = search(r`componente\s*curricular:\s*(.+?)(?=\n|período|carga|$)`, texto, {
    ignoreCase: true,
    dotAll: true,
  });
  return m ? sub(r`\s+`, " ", aparar(m[1]!)) : "";
}

function periodo(texto: string): string | null {
  const m = search(r`período\s*(?:letivo)?:\s*(\d+º?\s*ano)`, texto, { ignoreCase: true });
  return m ? sub(r`(\d+)º?\s*ano`, r`\1º Ano`, aparar(m[1]!), { ignoreCase: true }) : null;
}

function cargaHoraria(texto: string): number | null {
  const padroes = [
    r`carga\s*hor[áa]ria\s*(?:total)?(?:\s+do\s+componente)?:\s*(\d+)`,
    r`c\.?\s*h\.?\s*(?:total)?:\s*(\d+)`,
    r`(\d+)\s*(?:horas?[/\- ]aula|h/a)`,
  ];
  for (const padrao of padroes) {
    const m = search(padrao, texto, { ignoreCase: true });
    const valor = m ? inteiroDeTexto(m[1]!) : null;
    if (valor !== null) return valor;
  }
  return null;
}

function ementa(texto: string): string {
  const m = search(r`ementa:?\s*(.+?)(?=bibliografia|$)`, texto, { ignoreCase: true, dotAll: true });
  if (!m) return "";
  return aparar(sub(r`[ \t]+`, " ", sub(r`\n{3,}`, "\n\n", aparar(m[1]!))));
}

function bibliografiaBasica(texto: string): string {
  const m = search(r`bibliografia\s*b[áa]sica:?\s*(.+?)(?=bibliografia\s*complementar|$)`, texto, {
    ignoreCase: true,
    dotAll: true,
  });
  return m ? aparar(m[1]!) : "";
}

function bibliografiaComplementar(texto: string): string {
  const m = search(r`bibliografia\s*complementar:?\s*(.+?)$`, texto, { ignoreCase: true, dotAll: true });
  return m ? aparar(m[1]!) : "";
}

/** Dados do componente, quando a tabela é um quadro de ementário; senão, `null`. */
export function extrairComponenteDoEmentario(tabela: TabelaNormalizada): ComponenteDoEmentario | null {
  if (colunasEfetivas(tabela) !== 1) return null;
  const texto = todasAsLinhas(tabela)
    .filter((linha) => linha[0])
    .map((linha) => linha[0]!)
    .join("\n");
  const minusculo = texto.toLowerCase();
  if (!["componente curricular:", "ementa", "bibliografia"].every((termo) => minusculo.includes(termo))) return null;
  return {
    nome: nome(texto),
    periodo_letivo: periodo(texto),
    carga_horaria_aula: cargaHoraria(texto),
    ementa: ementa(texto),
    bibliografia_basica: separarReferencias(bibliografiaBasica(texto)),
    bibliografia_complementar: separarReferencias(bibliografiaComplementar(texto)),
  };
}

// ---------------------------------------------------------------- referências

/** Separa as referências de um texto de bibliografia, sem repetições e com espaços colapsados. */
export function separarReferencias(texto: string): string[] {
  if (!texto) return [];
  const vistas = new Set<string>();
  for (const bloco of blocosDeReferencias(texto)) {
    for (const referencia of referenciasDoBloco(bloco)) {
      const limpa = aparar(sub(r`\s+`, " ", referencia));
      if (limpa) vistas.add(limpa);
    }
  }
  return [...vistas];
}

/**
 * Blocos separados por linha em branco ou por marcador de lista. Muitos PPCs trazem uma referência
 * por linha; preservar essas fronteiras evita fundir referências antes das heurísticas.
 */
function blocosDeReferencias(texto: string): string[] {
  const linhas = sub(r`<br\s*/?>`, "\n", texto, { ignoreCase: true })
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")
    .map((linha) => aparar(linha));
  const blocos: string[] = [];
  let atual: string[] = [];
  const fechar = () => {
    if (atual.length) blocos.push(aparar(atual.join(" ")));
    atual = [];
  };
  for (const linha of linhas) {
    if (!linha) {
      fechar();
      continue;
    }
    const limpa = aparar(sub(r`^[|•▪◦●]\s*`, "", linha));
    if (match(r`^[\-–—]\s+`, limpa)) fechar();
    atual.push(limpa);
  }
  fechar();
  return blocos.filter(Boolean);
}

function referenciasDoBloco(bloco: string): string[] {
  const texto = aparar(sub(r`\s+`, " ", bloco));
  if (!texto) return [];
  const quebras = new Set([...quebrasPorFim(texto), ...quebrasPorInicio(texto)]);
  if (!quebras.size) {
    const porAutor = referenciasPorAutor(texto);
    if (porAutor.length) return porAutor;
    return pareceReferencia(texto) ? [texto] : [];
  }
  const referencias: string[] = [];
  let inicio = 0;
  const considerar = (trecho: string) => {
    const candidato = sub(HIFEN_INICIAL, "", aparar(trecho));
    if (pareceReferencia(candidato)) referencias.push(candidato);
  };
  for (const posicao of [...quebras].sort((a, b) => a - b)) {
    if (posicao <= inicio) continue;
    considerar(texto.slice(inicio, posicao));
    inicio = posicao;
  }
  considerar(texto.slice(inicio));
  return referencias.length ? referencias : referenciasPorAutor(texto);
}

/** Separação só por novo autor: `SOBRENOME,` depois de um fim de frase. */
function referenciasPorAutor(texto: string): string[] {
  return split(`(?<=[.!?])\\s+(?=${SOBRENOME})`, aparar(sub(r`\s+`, " ", texto)))
    .map((referencia) => aparar(referencia))
    .filter((referencia) => contarCaracteres(referencia) > 10 && match(`^[${MAIUSCULA}]`, referencia));
}

const proximaDe = (quebras: number[], posicao: number): boolean =>
  quebras.some((quebra) => Math.abs(quebra - posicao) < 5);

/** Posições em que começa uma referência, pelo fim da anterior (ano, ISBN, volume, "Local: Editora, ano."). */
function quebrasPorFim(texto: string): number[] {
  const quebras: number[] = [];
  // Hífen de lista antes do sobrenome: "…2020. - MATOSO, Rubiane…" ou "…2020.-SILVA, José…".
  for (const m of finditer(`[.\\s]+[\\-–—]\\s*(?=${SOBRENOME})`, texto)) {
    let posicao = m.index + m[0].length;
    while (posicao < texto.length && (texto[posicao] === " " || texto[posicao] === "\t")) posicao += 1;
    quebras.push(posicao);
  }
  // Ano, ISBN, volume, páginas ou número, seguido direto de "SOBRENOME, Nome": "…2013.IEZZI, Gelson…".
  const fimDeReferencia = r`((?:(?:19|20)\d{2})|(?:ISBN\s*[\d\-X]+)|(?:v\.\s*\d+)|(?:p\.\s*\d+[\-\d]*)|(?:n\.\s*\d+))`;
  for (const m of finditer(
    `${fimDeReferencia}[.\\s]*(?=[${MAIUSCULA}]{2,}[${MAIUSCULA}\\s]*,\\s*[A-Za-záéíóúàâêôãõç])`,
    texto,
  )) {
    const posicao = m.index + m[0].length;
    if (!proximaDe(quebras, posicao)) quebras.push(posicao);
  }
  quebras.push(...quebrasPorLocal(texto));
  return quebras;
}

/**
 * Posições em que começa uma referência, pelo padrão do autor. Cobre a referência anterior que
 * termina em frase, URL ou observação, sem ano, ISBN ou volume logo antes.
 */
function quebrasPorInicio(texto: string): number[] {
  const autorPessoa =
    `(?:[${MAIUSCULA}][${LETRA}]+(?:[\\s\\-]+[${MAIUSCULA}][${LETRA}]+){0,3}` +
    `|[${MAIUSCULA}]{2,}(?:[\\s\\-]+(?:[${MAIUSCULA}]{2,}|DA|DE|DI|DO|DU|DAS|DOS|DEL|E)){0,6})` +
    // Depois da vírgula não pode vir uma UF e dois-pontos ("Curitiba, PR: Editora").
    `,+\\s*(?![A-Z]{2}\\s*:)[${MAIUSCULA}a-záéíóúàâêôãõç]`;
  const padrao =
    `(?:(?<=^)|(?<=[.!?])\\s+|(?<=[.!?])(?=[${MAIUSCULA}_]))` +
    `(?=(?:[\\-–—]\\s*)?(?:${autorPessoa}|_{3,}\\.|BRASIL\\.|(?:${AUTOR_INSTITUCIONAL})\\.))`;
  const quebras: number[] = [];
  for (const m of finditer(padrao, texto)) {
    if (m.index !== 0 && !proximaDe(quebras, m.index)) quebras.push(m.index);
  }
  return quebras;
}

/** Posições (em code points do texto) em que o local ocorre com semelhança de pelo menos `limiar`. */
function ocorrenciasAproximadas(
  caracteres: string[],
  local: (typeof LOCAIS_CONHECIDOS)[number],
  limiar: number,
): number[] {
  const n = local.caracteres.length;
  const diretas = mascarasDoPalheiro(local.direta, caracteres);
  const invertidas = mascarasDoPalheiro(local.invertida, caracteres);
  const posicoes: number[] = [];
  let i = 0;
  while (i < caracteres.length - n + 1) {
    // Janela um pouco maior que o termo; no fim do texto ela encolhe até o tamanho dele.
    const fim = Math.min(i + n + 5, caracteres.length);
    const valor =
      fim - i > n
        ? partialRatioNoTrecho(n, diretas, invertidas, i, fim)
        : partialRatio(local.caracteres.join(""), caracteres.slice(i, fim).join(""));
    if (valor >= limiar) {
      posicoes.push(i);
      // Pula o termo, para não achar a mesma ocorrência de novo.
      i += n;
    } else i += 1;
  }
  return posicoes;
}

/**
 * Minúsculas caractere a caractere, quando isso é o mesmo que passar a janela inteira para
 * minúsculas (o que a comparação pede). Não é o caso com `İ` (que vira dois caracteres) nem com
 * `Σ` (cuja minúscula depende da posição na palavra); com eles, devolve `null`.
 */
function minusculasPorCaractere(caracteres: string[]): string[] | null {
  const saida: string[] = [];
  for (const caractere of caracteres) {
    const minusculo = caractere.toLowerCase();
    if (caractere === "Σ" || minusculo.length !== caractere.length) return null;
    saida.push(minusculo);
  }
  return saida;
}

/**
 * Quebras depois de "Local: Editora, ano." quando o que segue é um novo `SOBRENOME,`. O local é
 * procurado por semelhança (85%), para tolerar "Sao Paulo" ou "Rio de Janiero".
 */
function quebrasPorLocal(texto: string): number[] {
  // As posições desta busca são contadas em code points, como as janelas (150 e 60 caracteres);
  // `unidades` as converte para índices do texto.
  const caracteres = Array.from(texto);
  const semSubstitutos = caracteres.length === texto.length;
  const unidades = (posicao: number) => (semSubstitutos ? posicao : caracteres.slice(0, posicao).join("").length);
  const fatia = (inicio: number, fim?: number) =>
    semSubstitutos ? texto.slice(inicio, fim) : caracteres.slice(inicio, fim).join("");
  const minusculos = minusculasPorCaractere(caracteres);

  const quebras: number[] = [];
  for (const local of LOCAIS_CONHECIDOS) {
    const posicoes = minusculos
      ? ocorrenciasAproximadas(minusculos, local, 85)
      : ocorrenciasLentas(caracteres, local, 85);
    for (const posicao of posicoes) {
      // ": Editora, ano", com volume e ISBN opcionais, e a pontuação final.
      const fim = search(
        r`:\s*[^,]+,\s*(?:19|20)\d{2}(?:\.\s*v\.\s*\d+)?(?:\.\s*ISBN[^.]+)?[.\s]*`,
        fatia(posicao, posicao + 150),
      );
      if (!fim) continue;
      const quebra = posicao + contarCaracteres(fatia(posicao, posicao + 150).slice(0, fim.index + fim[0].length));
      if (quebra >= caracteres.length) continue;
      if (!match(`^[\\-–—]?\\s*${SOBRENOME}`, aparar(fatia(quebra, quebra + 60)))) continue;
      // Pula o hífen e os espaços antes do sobrenome.
      let ajuste = 0;
      while (quebra + ajuste < caracteres.length && "-–— \t".includes(caracteres[quebra + ajuste]!)) ajuste += 1;
      quebras.push(unidades(quebra + ajuste));
    }
  }
  return quebras;
}

/** Como `ocorrenciasAproximadas`, passando cada janela inteira para minúsculas (textos com `İ` ou `Σ`). */
function ocorrenciasLentas(caracteres: string[], local: (typeof LOCAIS_CONHECIDOS)[number], limiar: number): number[] {
  const n = local.caracteres.length;
  const posicoes: number[] = [];
  let i = 0;
  while (i < caracteres.length - n + 1) {
    const janela = Array.from(
      caracteres
        .slice(i, i + n + 5)
        .join("")
        .toLowerCase(),
    );
    if (partialRatio(local.caracteres.join(""), janela.join("")) >= limiar) {
      posicoes.push(i);
      i += n;
    } else i += 1;
  }
  return posicoes;
}

// ---------------------------------------------------------------- validação

/**
 * Referência plausível: 20 caracteres ou mais, começa com maiúscula, número ou `_`, tem ponto e
 * tem vírgula (autor, Nome) ou começa com autor institucional.
 */
function pareceReferencia(candidato: string): boolean {
  if (!candidato || contarCaracteres(candidato) < 20) return false;
  const texto = sub(HIFEN_INICIAL, "", aparar(candidato));
  if (!texto || !match(`^[${MAIUSCULA}0-9_]`, texto)) return false;
  if (!texto.includes(",") && !pareceReferenciaInstitucional(texto)) return false;
  return texto.includes(".");
}

/** Referência institucional ou normativa, sem vírgula no autor: `BRASIL. Lei nº …`. */
function pareceReferenciaInstitucional(texto: string): boolean {
  if (!match(`^(?:_{3,}|BRASIL|${AUTOR_INSTITUCIONAL})\\.`, texto)) return false;
  return (
    search(
      r`((?:19|20)\d{2}|c(?:19|20)\d{2}|Disponível em:|Lei nº|Resolução nº|Ministério|Secretaria|Política de|Proposta Pedagógica)`,
      texto,
      { ignoreCase: true },
    ) !== null
  );
}
