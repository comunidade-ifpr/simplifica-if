/**
 * Seções do PPC: a hierarquia formada pelos títulos e os dados de identificação que as seções de
 * apresentação trazem ("Campus: …", "Carga horária total: …").
 */
import { match, search } from "@simplifica-if/kb/primitivas/regex";
import { aparar } from "@simplifica-if/kb/texto";
import { type Elemento, type Tabela, textoDosTrechos, type Titulo } from "./elementos.ts";

const r = String.raw;

export type Secao = {
  /** Numeração sem o ponto final (`5.6`); `null` em título não numerado. */
  numero: string | null;
  titulo: string;
  nivel: number;
  /** Elementos até o próximo título (os das subseções ficam nelas). */
  elementos: Elemento[];
  subsecoes: Secao[];
};

/** Título com a numeração. */
export function tituloCompleto(secao: Secao): string {
  return secao.numero ? `${secao.numero} ${secao.titulo}` : secao.titulo;
}

const NUMERO_E_TITULO = r`^(\d+(?:\.\d+)*\.?)\s*[-–—.]?\s*(.+)$`;

function secaoDoTitulo(titulo: Titulo): Secao {
  const texto = aparar(titulo.texto);
  const m = match(NUMERO_E_TITULO, texto);
  if (!m) return { numero: null, titulo: texto, nivel: titulo.nivel, elementos: [], subsecoes: [] };
  const numero = m[1]!.replace(/\.+$/, "");
  // Com numeração, o nível é a profundidade dela, não o do estilo.
  return { numero, titulo: aparar(m[2]!), nivel: numero.split(".").length, elementos: [], subsecoes: [] };
}

/**
 * Organiza os elementos em seções. O que vem antes do primeiro título (capa, folha de rosto) fica
 * de fora.
 */
export function detectarSecoes(elementos: Elemento[]): Secao[] {
  const raizes: Secao[] = [];
  /** Da seção de nível 1 até a seção corrente. */
  let caminho: Secao[] = [];
  for (const elemento of elementos) {
    if (elemento.tipo !== "titulo") {
      caminho.at(-1)?.elementos.push(elemento);
      continue;
    }
    const secao = secaoDoTitulo(elemento);
    if (secao.nivel === 1 || !caminho.length) {
      raizes.push(secao);
      caminho = [secao];
      continue;
    }
    while (caminho.length >= secao.nivel) caminho.pop();
    const pai = caminho.at(-1);
    if (pai) pai.subsecoes.push(secao);
    else raizes.push(secao);
    caminho.push(secao);
  }
  return raizes;
}

/** Títulos completos de todas as seções, em profundidade. */
export function listarSecoes(secoes: Secao[]): string[] {
  return secoes.flatMap((secao) => [tituloCompleto(secao), ...listarSecoes(secao.subsecoes)]);
}

// ---------------------------------------------------------------- dados de identificação

const PADROES_DE_APRESENTACAO = [r`apresenta[çc][ãa]o`, r`identifica[çc][ãa]o`, r`dados\s+gerais`];

/** Seção de apresentação ou identificação do curso, pelo título. */
function ehApresentacao(secao: Secao): boolean {
  const titulos = [secao.titulo.toLowerCase(), tituloCompleto(secao).toLowerCase()];
  return PADROES_DE_APRESENTACAO.some((padrao) => titulos.some((titulo) => search(padrao, titulo)));
}

const VALOR = r`[:\s]+(.+)`;
const VALOR_ANCORADO = r`\s*:\s*(.+)`;
const INICIO_DO_ROTULO = r`^\s*(?:\d+(?:\.\d+)*\.?\s*[-–—.)]?\s*)?`;

/**
 * Rótulos de identificação valem só no início do parágrafo ou da célula, com dois-pontos; na
 * tabela, o rótulo precisa abrir a célula de campo. Sem isso, "Base legal específica do curso:
 * Resolução …" virava nome do curso e "Coordenador do curso" casava com "curso".
 */
const CAMPOS_ANCORADOS = new Set(["nome_curso", "modalidade", "eixo_tecnologico", "campus"]);

const PADROES_LIVRES: Array<[campo: string, padroes: string[]]> = [
  ["nome_curso", [r`nome\s+do\s+curso[:\s]+(.+)`, r`curso[:\s]+(.+)`, r`denomina[çc][ãa]o[:\s]+(.+)`]],
  ["modalidade", [r`modalidade[:\s]+(.+)`, r`forma\s+de\s+oferta[:\s]+(.+)`]],
  ["eixo_tecnologico", [r`eixo\s+tecnol[óo]gico[:\s]+(.+)`]],
  ["campus", [r`campus[:\s]+(.+)`, r`unidade[:\s]+(.+)`]],
  ["carga_horaria_total", [r`carga\s+hor[áa]ria\s+total[:\s]+(.+)`, r`ch\s+total[:\s]+(.+)`]],
  [
    "duracao",
    [
      r`tempo\s+de\s+dura[çc][ãa]o[^:]*[:\s]+(.+)`,
      r`tempo\s+de\s+integraliza[çc][ãa]o[:\s]+(.+)`,
      r`dura[çc][ãa]o\s+do\s+curso[:\s]+(.+)`,
    ],
  ],
  ["turno", [r`turno[:\s]+(.+)`, r`per[íi]odo[:\s]+(.+)`]],
  ["vagas", [r`vagas[:\s]+(\d+)`, r`n[úu]mero\s+de\s+vagas[:\s]+(\d+)`]],
  [
    "ano_vigencia",
    [
      r`in[íi]cio\s+(?:da\s+)?(?:nova\s+)?matriz[^:]*[:\s]+(\d{4})`,
      r`ano\s+de\s+vig[êe]ncia[:\s]+(\d{4})`,
      r`vig[êe]ncia[:\s]+(\d{4})`,
    ],
  ],
];

type PadroesDoCampo = {
  campo: string;
  /** Para texto corrido: "Rótulo: valor". */
  emTexto: string[];
  /** Para a célula de campo de uma tabela campo | valor: só o rótulo. */
  emCelulaDeCampo: string[];
};

const PADROES: PadroesDoCampo[] = PADROES_LIVRES.map(([campo, livres]) => {
  if (CAMPOS_ANCORADOS.has(campo)) {
    const emTexto = livres.map((padrao) => INICIO_DO_ROTULO + padrao.replaceAll(VALOR, VALOR_ANCORADO));
    return {
      campo,
      emTexto,
      emCelulaDeCampo: emTexto.map(
        (padrao) => `${padrao.replaceAll(VALOR_ANCORADO, "")}${r`(?:\s+do\s+curso)?\s*:?\s*$`}`,
      ),
    };
  }
  return {
    campo,
    emTexto: livres,
    // Tira do padrão o trecho do valor. Nos que capturam dígitos (`vagas[:\s]+(\d+)`) sobra o
    // grupo, e o rótulo só casa se vier colado a um número; é o comportamento de sempre, e essas
    // chaves saem da extração das tabelas de identificação (`identificacao-tabelas.ts`).
    emCelulaDeCampo: livres.map((padrao) => padrao.replaceAll(VALOR, "").replaceAll(r`[:\s]+`, "")),
  };
});

type Dicas = Map<string, string>;

function dicasDoTexto(texto: string, dicas: Dicas): void {
  for (const { campo, emTexto } of PADROES) {
    if (dicas.has(campo)) continue;
    for (const padrao of emTexto) {
      const m = search(padrao, texto, { ignoreCase: true });
      if (!m) continue;
      dicas.set(campo, aparar(m[1]!));
      break;
    }
  }
}

function dicasDaTabela(tabela: Tabela): Dicas {
  const dicas: Dicas = new Map();
  for (const linha of tabela.linhas) {
    if (linha.length === 1) {
      dicasDoTexto(aparar(linha[0]!.texto), dicas);
      continue;
    }
    if (linha.length < 2) continue;
    const campoDaLinha = aparar(linha[0]!.texto.toLowerCase());
    const valor = aparar(linha[1]!.texto);
    if (!valor) continue;
    for (const { campo, emCelulaDeCampo } of PADROES) {
      if (dicas.has(campo)) continue;
      if (emCelulaDeCampo.some((padrao) => search(padrao, campoDaLinha, { ignoreCase: true }))) dicas.set(campo, valor);
    }
  }
  return dicas;
}

function dicasDaSecao(secao: Secao): Dicas {
  const dicas: Dicas = new Map();
  for (const elemento of secao.elementos) {
    // O que uma tabela informa prevalece sobre o que veio antes dela na seção.
    if (elemento.tipo === "tabela") for (const [campo, valor] of dicasDaTabela(elemento)) dicas.set(campo, valor);
    else if (elemento.tipo === "paragrafo") dicasDoTexto(textoDosTrechos(elemento), dicas);
  }
  return dicas;
}

/**
 * Dados de identificação lidos das seções de apresentação (as de nível 1 e suas subseções
 * imediatas); uma seção posterior sobrescreve a anterior.
 */
export function dicasDeIdentificacao(secoes: Secao[]): Map<string, string> {
  const dicas: Dicas = new Map();
  for (const secao of secoes) {
    for (const candidata of [secao, ...secao.subsecoes]) {
      if (!ehApresentacao(candidata)) continue;
      for (const [campo, valor] of dicasDaSecao(candidata)) dicas.set(campo, valor);
    }
  }
  return dicas;
}
