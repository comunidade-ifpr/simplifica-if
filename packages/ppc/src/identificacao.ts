/**
 * Identificação do curso no PPC: o curso do CNCT e a forma de oferta, lidos do próprio documento.
 *
 * Heurística pura (sem I/O), sobre o Markdown da conversão. As fontes, em ordem de preferência:
 *
 * 1. rótulo explícito, em linha ("Nome do curso: …"), em título numerado seguido do valor
 *    ("1.1.3 Denominação do Curso" / "Curso Técnico em …") ou em tabela de identificação
 *    (`| Denominação | Técnico em … |`);
 * 2. capa e folha de rosto ("CURSO TÉCNICO EM … FORMA DE OFERTA: …");
 * 3. menções no início do documento (só para a forma de oferta).
 *
 * Um rótulo só vale no início de um segmento (linha, célula, trecho em negrito) ou, no meio da linha,
 * com inicial maiúscula e dois-pontos: assim "Base legal específica do curso: Resolução CNE/CP nº
 * 1/2021" não vira nome de curso. Cada valor passa por um validador do campo antes de ser aceito.
 *
 * A denominação achada é casada com o CNCT pelo núcleo do nome (sem "curso", "técnico em" e os
 * qualificadores de oferta): igualdade, ou um único curso muito parecido. Sem confiança, o curso fica
 * sem CNCT: a revisão sai "a conferir", que é melhor que conferir o PPC contra o curso errado.
 * A medição sobre os PPCs técnicos da base está em `test/identificacao-medicao.test.ts`.
 */
import { SequenceMatcher } from "@simplifica-if/kb/primitivas/sequencias";
import { sub } from "@simplifica-if/kb/primitivas/regex";
import { casefold, colapsarEspacos, semMarcas } from "@simplifica-if/kb/primitivas/texto";
import { chavesDoMapaYaml } from "@simplifica-if/kb/ppcs/front-matter";
import { apararFimEnquanto, dividirLinhas } from "@simplifica-if/kb/texto";
import type { CursoCnct, FormaOferta } from "./verificadores/comum.ts";

/** Linhas não vazias do início do documento onde a identificação é procurada. */
const MAX_UNIDADES_IDENTIFICACAO = 400;
/** Linhas não vazias consideradas capa e folha de rosto. */
const MAX_UNIDADES_CAPA = 60;
/** Linhas do início onde a forma de oferta é procurada fora de rótulo. */
const MAX_UNIDADES_INICIO = 120;
/** Semelhança mínima do núcleo da denominação com o do CNCT, quando não são iguais. */
const SEMELHANCA_MINIMA = 0.9;
/** Folga mínima entre o curso mais parecido e o segundo. */
const FOLGA_MINIMA = 0.05;

export type CursoNoDocumento = {
  /** A denominação como o PPC a escreve, sem os qualificadores de oferta; vazia se não achada. */
  denominacao: string;
  /** O curso do CNCT casado com a denominação, ou `null` sem confiança. */
  cnct: CursoCnct | null;
  forma: FormaOferta | null;
};

/** Texto sem acentos, em casefold, só com `[a-z0-9]` separados por um espaço. */
export function normalizarBusca(texto: string): string {
  return colapsarEspacos(sub("[^a-z0-9]+", " ", casefold(semMarcas(texto))));
}

/**
 * Remove o front matter YAML (`---` … `---`) do topo, se houver. Como no Pandoc, o `---` de abertura
 * não pode ser seguido de linha em branco, e o bloco precisa ser um mapa YAML: uma minuta que abre
 * com régua horizontal mantém o texto entre as réguas.
 */
function removerFrontMatter(texto: string): string {
  const semBom = texto.replace(/^﻿/, "");
  const m = /^---[ \t]*\r?\n(?![ \t]*\r?\n)([\s\S]*?\r?\n)(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(semBom);
  return m && chavesDoMapaYaml(m[1]!) ? semBom.slice(m[0].length) : semBom;
}

// ---------------------------------------------------------------- texto

/** Marca de início de rótulo em negrito (`**NOME DO CURSO:**`), que também fecha o valor anterior. */
const MARCA = "\u0001";

/** Texto legível de um trecho de Markdown, com `MARCA` antes de rótulos em negrito. */
function limparMarkdown(trecho: string): string {
  let texto = trecho
    .replace(/\\([\\`*_{}[\]()#+\-.!|])/g, "$1")
    .replace(/\*\*([^*\n]{1,80}?:)\s*\*\*/g, `${MARCA}$1 `)
    .replace(/\*\*([^*\n]{1,80}?)\*\*(\s*:)/g, `${MARCA}$1$2`)
    .replace(/\*+/g, "")
    .replace(/(^|[\s(/|])_+/g, "$1")
    .replace(/_+(?=[\s).,:;/|]|$)/g, "")
    .replace(/<\/?[a-z][^>]*>/gi, " ");
  texto = texto.replace(/^\s*(?:#{1,6}\s*|>\s*|[-•●▪◦]\s+)+/, "");
  return colapsarEspacos(texto).trim();
}

/** Minúsculas sem acento, com o mesmo comprimento do texto (posições alinhadas). */
function dobrar(texto: string): string {
  let saida = "";
  for (const unidade of texto.split("")) {
    const base = unidade.normalize("NFD")[0] ?? unidade;
    const minuscula = base.toLowerCase();
    saida += minuscula.length === 1 ? minuscula : base;
  }
  return saida;
}

type Unidade = {
  /** Texto limpo (pode conter `MARCA`). */
  texto: string;
  /** Versão dobrada de `texto`, para casar rótulos. */
  dobrado: string;
  /** Linha de título Markdown. */
  titulo: boolean;
  /** Linha iniciada por numeração de seção. */
  numerado: boolean;
  /** Células, se a unidade veio de uma linha de tabela. */
  celulas: string[] | null;
};

const NUMERACAO = /^(?:\d+(?:\.\d+)*\.?|[ivx]+\.)\s*[-–—.)]?\s+/i;

function criarUnidade(texto: string, titulo: boolean, celulas: string[] | null = null): Unidade {
  return { texto, dobrado: dobrar(texto), titulo, numerado: NUMERACAO.test(texto.replace(MARCA, "")), celulas };
}

/** Linhas não vazias do documento como unidades; `<br>` separa unidades, e tabelas viram uma unidade por linha. */
function unidadesDoDocumento(texto: string, limite: number): Unidade[] {
  const unidades: Unidade[] = [];
  for (const bruta of dividirLinhas(removerFrontMatter(texto).normalize("NFC"))) {
    if (unidades.length >= limite) break;
    const linha = bruta.trim();
    if (!linha) continue;
    const titulo = /^#{1,6}\s/.test(linha);
    if (linha.startsWith("|")) {
      if (/^\|[\s:|-]+\|?$/.test(linha)) continue;
      const celulas = linha
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((celula) => limparMarkdown(celula.replace(/<br\s*\/?>/gi, " ")))
        .filter((celula) => celula.replaceAll(MARCA, "").trim());
      if (!celulas.length) continue;
      unidades.push(criarUnidade(celulas.join(" | "), false, celulas));
      continue;
    }
    for (const parte of linha.split(/<br\s*\/?>/i)) {
      const limpo = limparMarkdown(parte);
      if (limpo.replaceAll(MARCA, "").trim()) unidades.push(criarUnidade(limpo, titulo));
    }
  }
  return unidades;
}

// ---------------------------------------------------------------- rótulos

type Campo = "curso" | "campus" | "forma" | "modalidade" | "eixo";

/**
 * Rótulos dos campos do formulário de identificação, já dobrados. Campus e eixo não são lidos, mas
 * terminam o valor anterior e impedem que a célula seguinte vire nome de curso.
 */
const ROTULOS: Record<Campo, string> = {
  curso: "denominacao(?: do curso)?|nome do curso|titulo do curso|habilitacao(?: profissional)?(?: conferida)?|curso",
  campus: "local de realizacao ?/ ?campus|informacoes do campus|campus|unidade",
  forma: "forma de oferta|forma de articulacao|forma|oferta",
  modalidade: "modalidade(?: de (?:oferta|ensino))?",
  eixo: "eixo tecnologico|eixo",
};

/** Outros rótulos de formulário de identificação, que só servem para terminar um valor. */
const OUTROS_ROTULOS =
  "numero do processo|processo|coordenacao do curso|coordenacao|coordenador(?:a)?(?: do curso)?|nivel|" +
  "tempo (?:de|minimo de|maximo de) (?:duracao|integralizacao)(?: do curso)?|duracao(?: do curso)?|" +
  "turno(?: de oferta| do curso)?|horario(?: de oferta)?(?: do curso)?|(?:total de |numero de )?vagas(?: totais)?|" +
  "requisitos? de acesso(?: ao curso)?|carga[ -]horaria(?: total)?(?: do curso)?|regime(?: academico| de oferta)?|" +
  "periodicidade|endereco|telefone|e-?mail|home-?page|pagina|site|cnpj|instituicoes parceiras|" +
  "escolaridade(?: minima)?(?: exigida)?|formas? de ingresso|local de realizacao|tipo de matricula|ano de [a-z]+|" +
  "resolucao(?: de [a-z]+)?|autorizacao(?: de [a-z]+)?|ato (?:de )?autorizacao";

const TODOS_ROTULOS = new RegExp(`(?:${Object.values(ROTULOS).join("|")}|${OUTROS_ROTULOS})(?![a-z])`, "g");

const PREPOSICAO_ANTES = /\b(?:d[aeo]s?|n[ao]s?|a[os]?|pel[ao]s?|em|para|e)\s*$/;

/**
 * Um rótulo na posição `inicio` vale se estiver no começo do segmento, depois de uma marca de negrito
 * ou de "/"; ou, no meio do texto, se tiver inicial maiúscula, não vier depois de preposição e for
 * seguido de dois-pontos.
 */
function rotuloAceito(unidade: Unidade, inicio: number, fim: number): boolean {
  const antes = unidade.dobrado.slice(0, inicio);
  const antesSemMarca = apararFimEnquanto(antes, (caractere) => /[\s\u0001]/.test(caractere));
  if (!antesSemMarca || antes.endsWith(MARCA) || /\u0001\s*$/.test(antes)) return true;
  if (NUMERACAO.test(antes) && !antes.replace(NUMERACAO, "").trim()) return true;
  if (/[/|]\s*$/.test(antes)) return true;
  const original = unidade.texto[inicio] ?? "";
  if (original === original.toLowerCase()) return false;
  if (PREPOSICAO_ANTES.test(antesSemMarca)) return false;
  return /^\s*:/.test(unidade.dobrado.slice(fim));
}

/** Fim do valor que começa em `inicio`: próxima marca de negrito, `|` ou rótulo aceito seguido de dois-pontos. */
function fimDoValor(unidade: Unidade, inicio: number): number {
  let fim = unidade.dobrado.length;
  const marca = unidade.dobrado.indexOf(MARCA, inicio);
  if (marca >= 0) fim = marca;
  const barra = unidade.dobrado.indexOf(" | ", inicio);
  if (barra >= 0 && barra < fim) fim = barra;
  TODOS_ROTULOS.lastIndex = inicio;
  for (let m = TODOS_ROTULOS.exec(unidade.dobrado); m && m.index < fim; m = TODOS_ROTULOS.exec(unidade.dobrado)) {
    if (m.index === inicio || !/(^|[\s(])$/.test(unidade.dobrado.slice(0, m.index))) continue;
    const depois = unidade.dobrado.slice(m.index + m[0].length);
    const original = unidade.texto[m.index] ?? "";
    if (/^\s*:/.test(depois) && original !== original.toLowerCase()) {
      fim = m.index;
      break;
    }
  }
  return fim;
}

function limparValor(valor: string): string {
  const semInicio = colapsarEspacos(valor.replaceAll(MARCA, " ")).replace(/^[\s:–—-]+/, "");
  return apararFimEnquanto(semInicio, (caractere) => /[\s.;,:–—-]/.test(caractere)).trim();
}

type Candidato = { campo: Campo; valor: string };

/** Rótulo de campo que ocupa a unidade inteira (com numeração e dois-pontos opcionais). */
function campoDoRotuloInteiro(dobrado: string): Campo | null {
  const semNumero = dobrado.replaceAll(MARCA, "").trim().replace(NUMERACAO, "").replace(/\s*:$/, "").trim();
  for (const [campo, rotulo] of Object.entries(ROTULOS) as Array<[Campo, string]>) {
    if (new RegExp(`^(?:${rotulo})$`).test(semNumero)) return campo;
  }
  return null;
}

function campoComecaComRotulo(unidade: Unidade): boolean {
  const semNumero = unidade.dobrado.replaceAll(MARCA, "").trim().replace(NUMERACAO, "");
  return Object.values(ROTULOS).some((rotulo) => new RegExp(`^(?:${rotulo})\\s*:`).test(semNumero));
}

/** Candidatos de rótulo de uma unidade; `proxima` é a unidade seguinte, para rótulos sozinhos. */
function candidatosDaUnidade(unidade: Unidade, proxima: Unidade | undefined): Candidato[] {
  const candidatos: Candidato[] = [];
  if (unidade.celulas) {
    const celulas = unidade.celulas;
    celulas.forEach((celula, i) => {
      const campo = campoDoRotuloInteiro(dobrar(celula));
      const resto = celulas.slice(i + 1).filter((c) => c.replaceAll(MARCA, "").trim());
      // Forma e modalidade em grade de opções ("| MODALIDADE: | PROEJA | INTEGRADO | CONCOMITANTE |"):
      // o valor é a linha inteira, e opções sem marca ficam ambíguas.
      const valor = campo === "forma" || campo === "modalidade" ? resto.join(" ") : resto[0];
      if (campo && valor) candidatos.push({ campo, valor: limparValor(valor) });
      candidatos.push(...candidatosDaUnidade(criarUnidade(celula, false), undefined));
    });
    return candidatos;
  }

  // Rótulo sozinho na unidade (título "1.1.3 Denominação do Curso" ou "NOME DO CURSO:"): valor na unidade seguinte.
  const campoInteiro = campoDoRotuloInteiro(unidade.dobrado);
  if (campoInteiro) {
    if (proxima && !proxima.celulas && !proxima.numerado && !campoComecaComRotulo(proxima)) {
      candidatos.push({ campo: campoInteiro, valor: limparValor(proxima.texto) });
    }
    return candidatos;
  }

  for (const [campo, rotulo] of Object.entries(ROTULOS) as Array<[Campo, string]>) {
    const padrao = new RegExp(`(?<![a-z])(?:${rotulo})(?![a-z])`, "g");
    for (const m of unidade.dobrado.matchAll(padrao)) {
      const fimRotulo = m.index + m[0].length;
      if (!rotuloAceito(unidade, m.index, fimRotulo)) continue;
      const resto = unidade.dobrado.slice(fimRotulo);
      const separador = /^\s*[:–—]\s*|^\s+-\s+/.exec(resto);
      // Sem dois-pontos, só vale em título numerado ("1.1.6 Forma de Oferta Integrado").
      const noInicio = !unidade.dobrado.slice(0, m.index).replace(NUMERACAO, "").replaceAll(MARCA, "").trim();
      if (!separador && !(noInicio && (unidade.titulo || unidade.numerado))) continue;
      const inicioValor = fimRotulo + (separador ? separador[0].length : 0);
      const valor = limparValor(unidade.texto.slice(inicioValor, fimDoValor(unidade, inicioValor)));
      if (valor) candidatos.push({ campo, valor });
    }
  }
  return candidatos;
}

// ---------------------------------------------------------------- denominação e forma

const RUIDO_CURSO =
  /(?<![\p{L}\d])(?:resolu[çc][ãa]o|lei|portaria|parecer|decreto|instru[çc][ãa]o normativa|cne|consup|consepe|n[º°.]|https?|www|\d+\s*h)(?![\p{L}\d])|@|\d{3,}/iu;

const QUALIFICADOR_OFERTA =
  /[\s,–—(-]*\b(?:na forma |na modalidade |modalidade |forma de oferta:? |forma )?(?:articulad[oa] )?(?:integrad[oa]|subsequente|concomitante)(?: (?:ao|com o|com|de) (?:ensino )?m[ée]dio)?\)?\s*$/i;
const QUALIFICADOR_PROEJA = /[\s,–—(-]*\b(?:na modalidade |modalidade )?proeja\)?\s*$/i;
const QUALIFICADOR_EXPERIMENTAL = /[\s,–—(-]*\b(?:em )?oferta experimental\)?\s*$/i;

/**
 * Denominação limpa do curso, ou vazio se o valor não parece nome de curso. Qualificadores de oferta
 * no fim ("Integrado ao Ensino Médio", "PROEJA") saem do nome e voltam como `forma`.
 */
export function limparDenominacaoCurso(valor: string): { curso: string; forma: string } {
  let texto = colapsarEspacos(valor.replaceAll(MARCA, " "))
    .replace(/[\s.;,:–—-]+$/, "")
    .trim();
  // Ruído depois do nome ("Curso Técnico em Mecânica Resolução de Criação: …") é cortado; no início, descarta o valor.
  const ruido = RUIDO_CURSO.exec(texto);
  if (ruido) texto = texto.slice(0, ruido.index).trim();
  if (!texto || !/\p{L}{3}/u.test(texto)) return { curso: "", forma: "" };
  if (ruido && !/\bt[ée]cnico\b/i.test(texto)) return { curso: "", forma: "" };
  texto = texto.replace(/^curso\s+(?:de\s+)?(?=\S)/i, "");
  texto = texto.replace(
    /^ensino m[ée]dio integrado (?:(?:ao|com o) (?:curso )?t[ée]cnico )?(?:em|de) /i,
    "Técnico em ",
  );
  let forma = "";
  texto = texto.replace(
    /^(t[ée]cnico)\s+(?:de n[íi]vel m[ée]dio\s+)?(integrado|subsequente|concomitante)?\s*(?:ao ensino m[ée]dio\s+)?(?:em|de)\s+/i,
    (_m, tecnico: string, qualificador: string | undefined) => {
      if (qualificador) forma = qualificador;
      return `${tecnico} em `;
    },
  );
  for (let anterior = ""; anterior !== texto;) {
    anterior = texto;
    texto = texto.replace(QUALIFICADOR_EXPERIMENTAL, "");
    texto = texto.replace(QUALIFICADOR_PROEJA, () => {
      forma = forma ? `${forma} PROEJA` : "PROEJA";
      return "";
    });
    texto = texto.replace(QUALIFICADOR_OFERTA, (m) => {
      forma = forma ? `${m.trim()} ${forma}` : m.trim();
      return "";
    });
    texto = texto.replace(/[\s.;,:–—-]+$/, "").trim();
  }
  const palavras = texto.split(/\s+/).filter(Boolean);
  if (!palavras.length || palavras.length > 12) return { curso: "", forma: "" };
  return { curso: texto.replace(/^t[ée]cnico\b/i, "Técnico"), forma };
}

/**
 * Escolha marcada em caixa de seleção: "( X ) Presencial ( ) A distância" → "Presencial"; em grade sem
 * parênteses, o X vem depois da opção ("PROEJA INTEGRADO X CONCOMITANTE" → "INTEGRADO").
 */
function opcaoMarcada(valor: string): string | null {
  const m = /[([]\s*[xX]\s*[)\]]\s*([\p{L}][\p{L} ]*?)(?=\s*[([]|$)/u.exec(valor);
  if (m) return m[1]!;
  const m2 = /([\p{L}][\p{L} ]*?)\s*[([]\s*[xX]\s*[)\]]/u.exec(valor);
  if (m2) return m2[1]!;
  const m3 = /(?<![\p{L}])(\p{L}+)[\s|]+X(?![\p{L}])/u.exec(valor);
  return m3 ? m3[1]! : null;
}

/**
 * A forma de oferta no valor: `integrado`, `subsequente`, `concomitante` ou `proeja` (o integrado da
 * EJA), ou `null` se o valor não diz uma só.
 */
export function formaOfertaNoValor(valor: string): FormaOferta | null {
  const escolhido = opcaoMarcada(valor) ?? valor;
  const n = normalizarBusca(escolhido);
  const categorias = new Set<FormaOferta>();
  if (/\bintegrad[oa]s?\b/.test(n)) categorias.add("integrado");
  if (/\bsubsequentes?\b/.test(n)) categorias.add("subsequente");
  if (/\bconcomitantes?\b/.test(n)) categorias.add("concomitante");
  if (/\bproeja\b/.test(n)) {
    // PROEJA no IFPR é integrado; com outra forma ao lado, o valor fica ambíguo.
    if (categorias.size > 1 || (categorias.size === 1 && !categorias.has("integrado"))) return null;
    return "proeja";
  }
  return categorias.size === 1 ? [...categorias][0]! : null;
}

// ---------------------------------------------------------------- capa

/** "CURSO TÉCNICO EM ENFERMAGEM FORMA DE OFERTA: SUBSEQUENTE" na capa. */
const CURSO_NA_CAPA =
  /\b(?:curso )?tecnico (?:de nivel medio )?(?:(?:integrado|subsequente|concomitante) )?(?:em|de) (.+?)(?=\s+(?:forma de oferta|campus|modalidade|eixo|integrado|subsequente|concomitante|autorizad|ajuste|\d{4})\b|\s*[:|]|$)/;

function candidatosDaCapa(unidades: Unidade[]): { curso: string[]; forma: string[] } {
  const curso: string[] = [];
  const forma: string[] = [];
  for (const unidade of unidades) {
    const texto = unidade.texto.replaceAll(MARCA, " ");
    const dobrado = unidade.dobrado.replaceAll(MARCA, " ");
    if (/\b(?:coordenador|professor|docente|diretor|membro)/.test(dobrado)) continue;
    const m = CURSO_NA_CAPA.exec(dobrado);
    if (m) curso.push(texto.slice(m.index, m.index + m[0].length));
    const f = /\b(?:forma de oferta|modalidade)\s*:?\s*(.+)$/.exec(dobrado);
    if (f) forma.push(f[1]!);
    else if (
      /\b(?:integrado ao ensino medio|subsequente|concomitante|proeja)\b/.test(dobrado) &&
      /tecnico|curso/.test(dobrado)
    )
      forma.push(dobrado);
  }
  return { curso, forma };
}

function primeiro<T, R>(itens: Iterable<T>, transformar: (item: T) => R | null): R | null {
  for (const item of itens) {
    const valor = transformar(item);
    if (valor) return valor;
  }
  return null;
}

// ---------------------------------------------------------------- CNCT

/** Núcleo da denominação para casar com o CNCT: sem "curso", "técnico em" e qualificadores de oferta. */
export function nucleoDaDenominacao(texto: string): string {
  return normalizarBusca(limparDenominacaoCurso(texto).curso || texto).replace(
    /^(?:curso )?(?:tecnico )?(?:(?:em|de) )?/,
    "",
  );
}

function semelhanca(a: string, b: string): number {
  return new SequenceMatcher(a, b).ratio();
}

/**
 * O curso do CNCT de uma denominação: o de núcleo igual; senão, o único bem parecido (folga sobre o
 * segundo), ou `null`.
 */
export function casarComCnct(denominacao: string, cncts: readonly CursoCnct[]): CursoCnct | null {
  const nucleo = nucleoDaDenominacao(denominacao);
  if (!nucleo) return null;
  const pontuados = cncts
    .map((curso) => ({ curso, nucleo: nucleoDaDenominacao(curso.denominacao) }))
    .filter((c) => c.nucleo);
  const iguais = pontuados.filter((c) => c.nucleo === nucleo);
  if (iguais.length === 1) return iguais[0]!.curso;
  if (iguais.length > 1) return null;
  const ordenados = pontuados
    .map((c) => ({ curso: c.curso, nota: semelhanca(nucleo, c.nucleo) }))
    .sort((a, b) => b.nota - a.nota);
  const [melhor, segundo] = ordenados;
  if (!melhor || melhor.nota < SEMELHANCA_MINIMA) return null;
  if (segundo && melhor.nota - segundo.nota < FOLGA_MINIMA) return null;
  return melhor.curso;
}

// ---------------------------------------------------------------- extração

const ehProeja = (valor: string) => formaOfertaNoValor(valor) === "proeja";

/** O curso e a forma de oferta que o PPC declara, com o curso casado no CNCT. */
export function identificarCurso(markdown: string, cncts: readonly CursoCnct[]): CursoNoDocumento {
  const unidades = unidadesDoDocumento(markdown, MAX_UNIDADES_IDENTIFICACAO);
  const candidatos = unidades.flatMap((unidade, i) => candidatosDaUnidade(unidade, unidades[i + 1]));
  const doCampo = (campo: Campo) => candidatos.filter((c) => c.campo === campo).map((c) => c.valor);
  const capa = candidatosDaCapa(unidades.slice(0, MAX_UNIDADES_CAPA));

  // Curso: rótulo com "técnico", qualquer rótulo válido, capa.
  const denominacoes = doCampo("curso").map(limparDenominacaoCurso);
  const denominacao =
    denominacoes.find((d) => /^t[ée]cnico /i.test(d.curso)) ??
    denominacoes.find((d) => d.curso) ??
    capa.curso.map(limparDenominacaoCurso).find((d) => /^t[ée]cnico /i.test(d.curso)) ??
    null;

  // Forma de oferta: os rótulos se confundem nos PPCs ("Modalidade: Integrado", "Forma de oferta:
  // Presencial"), então cada valor vale pelo que diz, não pelo rótulo.
  const inicio = unidades.slice(0, MAX_UNIDADES_INICIO).map((u) => u.texto.replaceAll(MARCA, " "));
  const valoresOferta = [...doCampo("forma"), ...doCampo("modalidade")];
  let forma =
    primeiro(valoresOferta, formaOfertaNoValor) ??
    primeiro([denominacao?.forma ?? "", ...capa.forma], formaOfertaNoValor) ??
    // Opção marcada fora de rótulo, em grade de formulário ("| SUBSEQUENTE | | X |").
    primeiro(inicio, (linha) => {
      const opcao = opcaoMarcada(linha);
      return opcao ? formaOfertaNoValor(opcao) : null;
    }) ??
    formaOfertaNoValor(
      inicio
        .join(" ")
        .match(/\b(?:integrad[oa] ao ensino m[ée]dio|subsequente|concomitante|proeja)\b/gi)
        ?.join(" ") ?? "",
    );
  // "Integrado" num rótulo e PROEJA noutro ou no nome do curso: é o integrado da EJA. A capa não
  // conta: "cursos PROEJA" na apresentação do campus não é a forma deste curso.
  if (forma === "integrado" && [...valoresOferta, denominacao?.forma ?? ""].some(ehProeja)) {
    forma = "proeja";
  }

  const nome = denominacao?.curso ?? "";
  return { denominacao: nome, cnct: nome ? casarComCnct(nome, cncts) : null, forma };
}
