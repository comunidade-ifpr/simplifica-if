/**
 * Matriz curricular: das tabelas do PPC aos dados estruturados e ao Markdown canônico.
 *
 * Dois formatos de matriz de PPC são reconhecidos:
 * - `legacy`: carga horária em hora-aula e em hora-relógio por período;
 * - `nucleos_ftp_fgb_np`: carga distribuída entre formação técnica e profissional (FTP), formação
 *   geral básica (FGB) e núcleo politécnico (NP).
 *
 * Fora deles, um extrator genérico e conservador aceita tabelas simples de componente × carga.
 */
import { fullmatch, match, search, sub } from "@simplifica-if/kb/primitivas/regex";
import { semMarcas } from "@simplifica-if/kb/primitivas/texto";
import { digitosAscii } from "@simplifica-if/kb/primitivas/valores";
import { aparar, dividirLinhas } from "@simplifica-if/kb/texto";
import { type TabelaNormalizada, todasAsLinhas } from "./tabelas.ts";

const r = String.raw;

/** Inteiro lido de uma célula; `bigint` quando passa da faixa segura (um número de processo, por exemplo). */
type Inteiro = number | bigint;

type Subtotais = Record<string, Inteiro>;
type Totais = Record<string, Inteiro>;

type ComponenteLegado = {
  nome: string;
  aulas_semanais: Inteiro | null;
  ch_hora_aula: Inteiro | null;
  ch_teorica: null;
  ch_pratica: null;
  ch_hora_relogio_cnct: Inteiro | null;
};

type ComponenteNucleos = {
  nome: string;
  aulas_semanais: Inteiro | null;
  ch_hora_aula: Inteiro | null;
  ch_hora_relogio_cnct: Inteiro | null;
  ch_ftp: Inteiro | null;
  ch_fgb: Inteiro | null;
  ch_np: Inteiro | null;
};

type Componente = ComponenteLegado | ComponenteNucleos;

type Ano = { ano: string; componentes: Componente[]; subtotais: Subtotais };

/** Linha que o modelo de PPC traz fora dos anos: atividades complementares e estágio supervisionado. */
type LinhaModelo = { nome: string } & Record<string, Inteiro | null | string>;

export type MatrizPpc = {
  tipo: "matriz_curricular_ppc";
  formato: "legacy" | "nucleos_ftp_fgb_np";
  minutos_hora_aula: Inteiro;
  semanas_ano_letivo: Inteiro;
  anos: Ano[];
  linhas_modelo: LinhaModelo[];
  totais: Totais;
};

/**
 * Totais que a tabela declara na linha de total do curso, por chave de `totais`. Os demais são a
 * soma dos componentes da parte. Fica fora do JSON (propriedade não enumerável): serve à mescla
 * das partes, que não pode tomar a soma de uma parte pelo total do curso.
 */
const DECLARADOS: unique symbol = Symbol("totaisDeclarados");

function marcarDeclarados(matriz: MatrizPpc, chaves: Iterable<string>): MatrizPpc {
  Object.defineProperty(matriz, DECLARADOS, { value: new Set(chaves), enumerable: false, configurable: true });
  return matriz;
}

/** Chaves de `totais` declaradas no documento (as outras foram calculadas). */
export function totaisDeclarados(matriz: MatrizPpc): ReadonlySet<string> {
  return (matriz as { [DECLARADOS]?: Set<string> })[DECLARADOS] ?? new Set();
}

/** De que campo dos componentes sai cada total calculado. */
const CAMPO_DO_TOTAL: Record<string, string> = {
  ch_total_hora_aula: "ch_hora_aula",
  ch_total_hora_relogio: "ch_hora_relogio_cnct",
  ch_ftp: "ch_ftp",
  ch_fgb: "ch_fgb",
  ch_np: "ch_np",
};

export type MatrizGenerica = {
  tipo: "matriz_curricular";
  headers: string[];
  componentes: Array<{ nome: string; cargas: Map<string, Inteiro | string>; total?: Inteiro | string }>;
  total_rows: number;
};

export type Matriz = MatrizPpc | MatrizGenerica;

type Mapeamento = Partial<
  Record<"ano" | "componente" | "aulas_semanais" | "ch_total" | "ch_relogio" | "ch_ftp" | "ch_fgb" | "ch_np", number>
>;

// ---------------------------------------------------------------- texto e números

/** Minúsculas, sem acentos, sem `º`/`°` e com espaços colapsados. */
function norm(valor: string): string {
  const texto = aparar(valor).toLowerCase().replaceAll("º", "").replaceAll("°", "");
  return sub(r`\s+`, " ", semMarcas(texto));
}

/** Todos os dígitos da célula lidos como um número (`1.200 h` é 1200); `null` sem dígitos. */
function inteiroDaCelula(valor: string): Inteiro | null {
  const digitos = digitosAscii(valor).replace(/\D/g, "");
  if (!digitos) return null;
  const numero = Number(digitos);
  return Number.isSafeInteger(numero) ? numero : BigInt(digitos);
}

const somar = (valores: Array<Inteiro | null>): Inteiro => {
  let soma: Inteiro = 0;
  for (const valor of valores) {
    if (!valor) continue;
    soma = typeof soma === "bigint" || typeof valor === "bigint" ? BigInt(soma) + BigInt(valor) : soma + valor;
  }
  return soma;
};

const celula = (linha: string[], indice: number | undefined): string =>
  indice === undefined || indice >= linha.length ? "" : aparar(linha[indice]!);

const numeroDa = (linha: string[], indice: number | undefined): Inteiro | null =>
  indice === undefined || indice >= linha.length ? null : inteiroDaCelula(linha[indice]!);

/** Como `numeroDa`, mas a célula que só repete o nome da linha-modelo (mescla) não é carga. */
const cargaDa = (linha: string[], indice: number | undefined): Inteiro | null =>
  indice === undefined || indice >= linha.length || ehLinhaModelo(norm(linha[indice]!))
    ? null
    : inteiroDaCelula(linha[indice]!);

const textoDaLinha = (linha: string[]): string => norm(linha.join(" "));
const textoDasLinhas = (linhas: string[][]): string => norm(linhas.map((linha) => linha.join(" ")).join(" "));
const linhaTemConteudo = (linha: string[]): boolean => linha.some((item) => aparar(item));

/** `1`, `1º`, `2 ano`, `3º Ano` → `3º Ano`; só de 1 a 4. */
function anoNormalizado(valor: string): string | null {
  const texto = norm(valor);
  const m = fullmatch(r`([1-4])(?:\s*ano)?`, texto) ?? search(r`\b([1-4])\s*ano\b`, texto);
  return m ? `${m[1]}º Ano` : null;
}

const numeroDoAno = (valor: string): string => anoNormalizado(valor)?.[0] ?? valor;
const ordemDoAno = (valor: string): number => Number(anoNormalizado(valor)?.[0] ?? 99);

function naoEhComponente(valor: string): boolean {
  const texto = norm(valor);
  return (
    !texto ||
    texto === "ano" ||
    texto === "componente curricular" ||
    ["matriz curricular", "legenda", "semanas do ano letivo", "ch em hora-aula", "hora-aula", "hora-relogio"].some(
      (termo) => texto.includes(termo),
    ) ||
    texto.includes("hora relogio") ||
    texto.includes("formacao geral basica")
  );
}

const ehLinhaModelo = (texto: string): boolean =>
  texto.includes("atividades complementares") || texto.includes("estagio supervisionado");
const ehSubtotal = (texto: string): boolean =>
  texto.includes("subtotal") || texto.includes("total ano") || texto.includes("total do periodo");
const ehTotalGeral = (texto: string): boolean =>
  texto.includes("total do curso") || texto.includes("carga horaria total do curso");

// ---------------------------------------------------------------- extrator genérico

const contemAlgum = (texto: string, termos: string[]): boolean => termos.some((termo) => texto.includes(termo));

/** Quadro do corpo docente, que também tem a coluna "Componente Curricular". */
function ehQuadroDocente(tabela: TabelaNormalizada): boolean {
  const texto = norm(tabela.cabecalho.join(" "));
  return ["nome", "area de formacao", "perfil de formacao", "componente curricular"].every((termo) =>
    texto.includes(termo),
  );
}

/** Tabela simples de componente × carga horária × período, quando nenhum formato de PPC serve. */
export function extrairMatrizGenerica(tabela: TabelaNormalizada): MatrizGenerica | null {
  if (!tabela.cabecalho.length || !tabela.linhas.length || ehQuadroDocente(tabela)) return null;
  const cabecalhos = tabela.cabecalho.map(norm);
  const texto = cabecalhos.join(" ");
  const temComponente = cabecalhos.some((item) => item.includes("componente") || item.includes("disciplina"));
  const temCarga = contemAlgum(texto, ["carga", "ch ", "hora-aula", "hora aula", "hora-relogio", "hora relogio"]);
  const temPeriodo = contemAlgum(texto, ["ano", "semestre", "periodo", "serie"]);
  if (!(temComponente && temCarga && temPeriodo)) return null;

  let colunaComponente: number | null = null;
  let colunaTotal: number | null = null;
  const colunasCarga: number[] = [];
  for (const [indice, item] of cabecalhos.entries()) {
    if (contemAlgum(item, ["componente", "disciplina", "unidade"])) colunaComponente = indice;
    else if (contemAlgum(item, ["ano", "semestre", "periodo", "serie", "carga", "ch", "hora"]))
      colunasCarga.push(indice);
    if (item.includes("total") && contemAlgum(item, ["ch", "carga", "hora"])) colunaTotal = indice;
  }
  if (colunaComponente === null) return null;

  const componentes: MatrizGenerica["componentes"] = [];
  for (const linha of tabela.linhas) {
    if (colunaComponente >= linha.length) continue;
    const nome = aparar(linha[colunaComponente]!);
    if (!nome || naoEhComponente(nome)) continue;
    const cargas = new Map<string, Inteiro | string>();
    for (const coluna of colunasCarga) {
      const valor = coluna < linha.length ? aparar(linha[coluna]!) : "";
      if (valor) cargas.set(tabela.cabecalho[coluna]!, inteiroDaCelula(valor) || valor);
    }
    const total = colunaTotal !== null && colunaTotal < linha.length ? aparar(linha[colunaTotal]!) : "";
    if (!cargas.size && !total) continue;
    componentes.push({ nome, cargas, ...(total ? { total: inteiroDaCelula(total) || total } : {}) });
  }
  if (!componentes.length) return null;
  return { tipo: "matriz_curricular", headers: tabela.cabecalho, componentes, total_rows: componentes.length };
}

// ---------------------------------------------------------------- formatos de PPC

type Formato = {
  nome: MatrizPpc["formato"];
  /** Colunas mínimas de uma linha de continuação (tabela que segue em outra página, sem cabeçalho). */
  colunasMinimas: number;
  parece: (texto: string) => boolean;
  ehCabecalho: (texto: string) => boolean;
  mapearCabecalho: (linha: string[]) => Mapeamento;
  /** Mapeamento por posição, para a tabela de continuação. */
  posicoes: Mapeamento;
  linhaModelo: (nome: string, linha: string[], mapa: Mapeamento) => LinhaModelo;
  componente: (nome: string, linha: string[], mapa: Mapeamento) => Componente;
  totalGeral: (totais: Totais, linha: string[], mapa: Mapeamento) => void;
  ehSubtotal: (componente: string, textoDaLinha: string) => boolean;
  subtotal: (subtotais: Subtotais, linha: string[], mapa: Mapeamento) => void;
  /** Totais por núcleo calculados quando a tabela não traz a linha de total. */
  nucleos: Array<"ch_ftp" | "ch_fgb" | "ch_np">;
};

function mapearCabecalho(linha: string[], nucleos: boolean): Mapeamento {
  const mapa: Mapeamento = {};
  for (const [indice, item] of linha.entries()) {
    const texto = norm(item);
    const horaAula = texto.includes("hora-aula") || texto.includes("hora aula");
    if (texto === "ano" || (texto.includes("periodo") && !texto.includes("hora"))) mapa.ano = indice;
    else if (texto.includes("componente") || texto.includes("disciplina")) mapa.componente = indice;
    else if (contemAlgum(texto, ["aulas semanais", "numero de aulas", "no. de aulas"])) mapa.aulas_semanais = indice;
    else if (!nucleos) {
      if (horaAula) mapa.ch_total = indice;
      else if (texto.includes("hora-relogio") || texto.includes("hora relogio")) mapa.ch_relogio = indice;
    } else if (texto.includes("ftp")) mapa.ch_ftp = indice;
    else if (texto.includes("fgb")) mapa.ch_fgb = indice;
    else if (fullmatch(r`.*\bnp\b.*`, texto)) mapa.ch_np = indice;
    else if (horaAula && texto.includes("total")) mapa.ch_total = indice;
    else if (texto.includes("relogio") && texto.includes("total")) mapa.ch_relogio = indice;
  }
  return mapa;
}

function gravar(destino: Record<string, Inteiro>, chave: string, valor: Inteiro | null): void {
  if (valor !== null) destino[chave] = valor;
}

const LEGADO: Formato = {
  nome: "legacy",
  colunasMinimas: 5,
  parece: (texto) =>
    texto.includes("componente curricular") &&
    contemAlgum(texto, ["ch hora-aula", "hora-aula no periodo", "hora relogio no periodo", "hora-relogio no periodo"]),
  ehCabecalho: (texto) =>
    (texto.includes("ch hora-aula") || texto.includes("hora-aula no periodo")) &&
    (texto.includes("hora-relogio") || texto.includes("hora relogio")),
  mapearCabecalho: (linha) => mapearCabecalho(linha, false),
  posicoes: { ano: 0, componente: 1, aulas_semanais: 2, ch_total: 3, ch_relogio: 4 },
  linhaModelo: (nome, linha, mapa) => ({
    nome,
    ch_hora_aula: cargaDa(linha, mapa.ch_total),
    ch_hora_relogio: cargaDa(linha, mapa.ch_relogio),
  }),
  componente: (nome, linha, mapa) => ({
    nome,
    aulas_semanais: numeroDa(linha, mapa.aulas_semanais),
    ch_hora_aula: numeroDa(linha, mapa.ch_total),
    ch_teorica: null,
    ch_pratica: null,
    ch_hora_relogio_cnct: numeroDa(linha, mapa.ch_relogio),
  }),
  totalGeral: (totais, linha, mapa) => {
    gravar(totais, "ch_total_hora_aula", numeroDa(linha, mapa.ch_total));
    gravar(totais, "ch_total_hora_relogio", numeroDa(linha, mapa.ch_relogio));
  },
  ehSubtotal: (componente) => ehSubtotal(componente),
  subtotal: (subtotais, linha, mapa) => {
    gravar(subtotais, "aulas_semanais", numeroDa(linha, mapa.aulas_semanais));
    gravar(subtotais, "ch_total_hora_aula", numeroDa(linha, mapa.ch_total));
    gravar(subtotais, "ch_total_hora_relogio", numeroDa(linha, mapa.ch_relogio));
  },
  nucleos: [],
};

const NUCLEOS: Formato = {
  nome: "nucleos_ftp_fgb_np",
  colunasMinimas: 8,
  parece: (texto) =>
    texto.includes("componente curricular") &&
    ["ftp", "fgb", "np"].every((termo) => texto.includes(termo)) &&
    texto.includes("hora-aula") &&
    (texto.includes("hora relogio") || texto.includes("hora-relogio")),
  ehCabecalho: (texto) => ["ftp", "fgb", "np"].every((termo) => texto.includes(termo)) && texto.includes("hora-aula"),
  mapearCabecalho: (linha) => mapearCabecalho(linha, true),
  posicoes: { ano: 0, componente: 1, aulas_semanais: 2, ch_ftp: 3, ch_fgb: 4, ch_np: 5, ch_total: 6, ch_relogio: 7 },
  linhaModelo: (nome, linha, mapa) => ({
    nome,
    ch_ftp: cargaDa(linha, mapa.ch_ftp),
    ch_fgb: cargaDa(linha, mapa.ch_fgb),
    ch_np: cargaDa(linha, mapa.ch_np),
    ch_hora_aula: cargaDa(linha, mapa.ch_total),
    ch_hora_relogio: cargaDa(linha, mapa.ch_relogio),
  }),
  componente: (nome, linha, mapa) => ({
    nome,
    aulas_semanais: numeroDa(linha, mapa.aulas_semanais),
    ch_hora_aula: numeroDa(linha, mapa.ch_total),
    ch_hora_relogio_cnct: numeroDa(linha, mapa.ch_relogio),
    ch_ftp: numeroDa(linha, mapa.ch_ftp),
    ch_fgb: numeroDa(linha, mapa.ch_fgb),
    ch_np: numeroDa(linha, mapa.ch_np),
  }),
  // A linha de total do curso deste formato está em hora-relógio: a coluna "Hora-aula TOTAL"
  // também alimenta o total em hora-relógio, e a coluna de hora-relógio, quando preenchida, prevalece.
  totalGeral: (totais, linha, mapa) => {
    for (const chave of ["ch_ftp", "ch_fgb", "ch_np"] as const) gravar(totais, chave, numeroDa(linha, mapa[chave]));
    gravar(totais, "ch_total_hora_relogio", numeroDa(linha, mapa.ch_total));
    gravar(totais, "ch_total_hora_relogio", numeroDa(linha, mapa.ch_relogio));
  },
  ehSubtotal: (componente, texto) => ehSubtotal(componente) || texto.includes("total ano"),
  subtotal: (subtotais, linha, mapa) => {
    const emRelogio = textoDaLinha(linha).includes("relogio");
    for (const chave of ["ch_ftp", "ch_fgb", "ch_np"] as const) {
      gravar(subtotais, emRelogio ? `${chave}_hora_relogio` : chave, numeroDa(linha, mapa[chave]));
    }
    gravar(subtotais, emRelogio ? "ch_total_hora_relogio" : "ch_total_hora_aula", numeroDa(linha, mapa.ch_total));
    gravar(subtotais, "ch_total_hora_relogio", numeroDa(linha, mapa.ch_relogio));
  },
  nucleos: ["ch_ftp", "ch_fgb", "ch_np"],
};

/** Linhas de ano com componente e pelo menos duas cargas: o miolo de uma matriz, com ou sem cabeçalho. */
function contarLinhasDeCarga(linhas: string[][], colunasMinimas: number): number {
  let total = 0;
  for (const linha of linhas) {
    if (linha.length < colunasMinimas || !anoNormalizado(linha[0]!)) continue;
    if (!aparar(linha[1]!) || ehSubtotal(norm(linha[1]!))) continue;
    if (linha.slice(2).filter((item) => inteiroDaCelula(item) !== null).length >= 2) total += 1;
  }
  return total;
}

function pareceMatriz(linhas: string[][], formato: Formato): boolean {
  // Um quadro do ementário também tem "componente curricular" e cargas horárias.
  const inicio = textoDasLinhas(linhas.slice(0, 10));
  if (contemAlgum(inicio, ["ementa:", "bibliografia", "basica:", "complementar:"])) return false;
  if (!linhas.some((linha) => anoNormalizado(linha[0] ?? ""))) return false;
  return formato.parece(textoDasLinhas(linhas)) || contarLinhasDeCarga(linhas, formato.colunasMinimas) >= 3;
}

/** Número declarado no topo da tabela ("hora aula de 50 min", "40 semanas do ano letivo"). */
function numeroDeclarado(
  linhas: string[][],
  termos: string[],
  minimo: number,
  maximo: number,
  padrao: number,
): Inteiro {
  for (const linha of linhas.slice(0, 12)) {
    const texto = textoDaLinha(linha);
    if (!termos.every((termo) => texto.includes(termo))) continue;
    for (const item of linha) {
      const valor = inteiroDaCelula(item);
      if (valor !== null && minimo <= valor && valor <= maximo) return valor;
    }
  }
  return padrao;
}

function extrairFormato(tabela: TabelaNormalizada, formato: Formato): MatrizPpc | null {
  const linhas = todasAsLinhas(tabela);
  if (!pareceMatriz(linhas, formato)) return null;

  const anos = new Map<string, Ano>();
  const anoDe = (nome: string): Ano => {
    let ano = anos.get(nome);
    if (!ano) anos.set(nome, (ano = { ano: nome, componentes: [], subtotais: {} }));
    return ano;
  };
  const linhasModelo: LinhaModelo[] = [];
  const totais: Totais = {};
  let mapa: Mapeamento | null = null;
  let anoCorrente: string | null = null;

  for (const linha of linhas) {
    if (!linhaTemConteudo(linha)) continue;
    const texto = textoDaLinha(linha);
    if (texto.includes("componente curricular") && formato.ehCabecalho(texto)) {
      mapa = formato.mapearCabecalho(linha);
      continue;
    }
    if (mapa === null) {
      // Sem cabeçalho até aqui (continuação da matriz em outra tabela): vale a posição das colunas.
      if (linha.length < formato.colunasMinimas || !anoNormalizado(linha[0]!) || !aparar(linha[1]!)) continue;
      mapa = formato.posicoes;
    }
    const ano = anoNormalizado(celula(linha, mapa.ano));
    if (ano) anoCorrente = ano;
    const nome = celula(linha, mapa.componente);
    if (!nome) continue;

    if (ehLinhaModelo(texto)) {
      linhasModelo.push(formato.linhaModelo(nome, linha, mapa));
    } else if (ehTotalGeral(texto)) {
      formato.totalGeral(totais, linha, mapa);
      anoCorrente = null;
    } else if (formato.ehSubtotal(norm(nome), texto)) {
      if (anoCorrente) formato.subtotal(anoDe(anoCorrente).subtotais, linha, mapa);
    } else if (anoCorrente && !naoEhComponente(nome)) {
      anoDe(anoCorrente).componentes.push(formato.componente(nome, linha, mapa));
    }
  }
  if (!anos.size) return null;

  const declarados = Object.keys(totais);
  const componentes = [...anos.values()].flatMap((ano) => ano.componentes);
  totais.ch_total_hora_aula ??= somar(componentes.map((item) => item.ch_hora_aula));
  totais.ch_total_hora_relogio ??= somar(componentes.map((item) => item.ch_hora_relogio_cnct));
  for (const chave of formato.nucleos)
    totais[chave] ??= somar(componentes.map((item) => (item as ComponenteNucleos)[chave]));

  return marcarDeclarados(
    {
      tipo: "matriz_curricular_ppc",
      formato: formato.nome,
      minutos_hora_aula: numeroDeclarado(linhas, ["hora aula", "min"], 40, 60, 50),
      semanas_ano_letivo: numeroDeclarado(linhas, ["semanas", "ano letivo"], 30, 50, 40),
      anos: [...anos.values()],
      linhas_modelo: linhasModelo,
      totais,
    },
    declarados,
  );
}

/** Matriz num dos formatos de PPC; o de núcleos tem precedência. */
export function extrairMatrizPpc(tabela: TabelaNormalizada): MatrizPpc | null {
  return extrairFormato(tabela, NUCLEOS) ?? extrairFormato(tabela, LEGADO);
}

// ---------------------------------------------------------------- mescla e pontuação

/** Pontuação de uma matriz candidata: a de PPC sempre vence a genérica; depois, a de mais componentes. */
export function pontuarMatriz(matriz: Matriz): number {
  if (matriz.tipo !== "matriz_curricular_ppc") return matriz.componentes.length;
  const componentes = matriz.anos.reduce((soma, ano) => soma + ano.componentes.length, 0);
  return (
    1000 +
    componentes * 10 +
    (Object.keys(matriz.totais).length ? 100 : 0) +
    (matriz.formato === "nucleos_ftp_fgb_np" ? 20 : 0)
  );
}

/**
 * Junta as partes de uma matriz que o PPC divide em várias tabelas (uma por ano, ou quebrada entre
 * páginas). Matrizes de tipos ou formatos diferentes não se juntam: fica a de maior pontuação.
 */
export function mesclarMatrizes(atual: Matriz | null, nova: MatrizPpc): Matriz {
  if (!atual) return nova;
  if (atual.tipo !== "matriz_curricular_ppc" || atual.formato !== nova.formato) {
    return pontuarMatriz(nova) > pontuarMatriz(atual) ? nova : atual;
  }
  const porAno = new Map<string, Ano>();
  for (const ano of atual.anos) {
    porAno.set(ano.ano, { ano: ano.ano, componentes: [...ano.componentes], subtotais: { ...ano.subtotais } });
  }
  for (const ano of nova.anos) {
    const existente = porAno.get(ano.ano);
    if (!existente) {
      porAno.set(ano.ano, { ano: ano.ano, componentes: [...ano.componentes], subtotais: { ...ano.subtotais } });
      continue;
    }
    const nomes = new Set(existente.componentes.map((item) => item.nome));
    for (const item of ano.componentes) if (!nomes.has(item.nome)) existente.componentes.push(item);
    Object.assign(existente.subtotais, ano.subtotais);
  }
  const anos = [...porAno.values()].sort((a, b) => ordemDoAno(a.ano) - ordemDoAno(b.ano));

  const nomesModelo = new Set(atual.linhas_modelo.map((item) => item.nome));
  const linhasModelo = [...atual.linhas_modelo, ...nova.linhas_modelo.filter((item) => !nomesModelo.has(item.nome))];

  // Cada parte traz os totais completos: os que a tabela declara e, para os demais, a soma dos
  // componentes da própria parte.
  const totais: Totais = { ...atual.totais, ...nova.totais };
  // O total declarado vale (o da parte mais recente, se as duas declaram); o que nenhuma parte
  // declara é somado de novo, sobre os componentes de todas.
  const declarados = new Set([...totaisDeclarados(atual), ...totaisDeclarados(nova)]);
  const componentes = anos.flatMap((ano) => ano.componentes) as Array<Record<string, Inteiro | null | string>>;
  for (const chave of Object.keys(totais)) {
    const campo = CAMPO_DO_TOTAL[chave];
    if (totaisDeclarados(nova).has(chave) || !campo) continue;
    if (totaisDeclarados(atual).has(chave)) totais[chave] = atual.totais[chave]!;
    else totais[chave] = somar(componentes.map((item) => (item[campo] ?? null) as Inteiro | null));
  }
  return marcarDeclarados({ ...atual, anos, linhas_modelo: linhasModelo, totais }, declarados);
}

// ---------------------------------------------------------------- Markdown canônico

type ValorDeCelula = string | Inteiro | null | undefined;

const linhaMd = (valores: ValorDeCelula[]): string =>
  `| ${valores.map((valor) => (valor === null || valor === undefined ? "" : String(valor))).join(" | ")} |`;

function legadoEmMarkdown(matriz: MatrizPpc): string {
  const linhas = [
    "| Ano | Componente Curricular | Número de aulas semanais | CH hora-aula no período | CH hora-relógio no período |",
    "|---|---|---:|---:|---:|",
  ];
  for (const ano of matriz.anos) {
    for (const item of ano.componentes) {
      linhas.push(linhaMd([ano.ano, item.nome, item.aulas_semanais, item.ch_hora_aula, item.ch_hora_relogio_cnct]));
    }
    const s = ano.subtotais;
    if (Object.keys(s).length) {
      linhas.push(
        linhaMd([
          ano.ano,
          "Subtotal (Total do período)",
          s.aulas_semanais,
          s.ch_total_hora_aula,
          s.ch_total_hora_relogio,
        ]),
      );
    }
  }
  for (const item of matriz.linhas_modelo) {
    linhas.push(linhaMd([item.nome, item.nome, "", item.ch_hora_aula, item.ch_hora_relogio]));
  }
  if (Object.keys(matriz.totais).length) {
    const titulo = "CARGA HORÁRIA TOTAL DO CURSO";
    linhas.push(linhaMd([titulo, titulo, "", matriz.totais.ch_total_hora_aula, matriz.totais.ch_total_hora_relogio]));
  }
  return linhas.join("\n");
}

function nucleosEmMarkdown(matriz: MatrizPpc): string {
  const linhas = [
    "| Ano | Componente Curricular | No. de aulas semanais | Hora-aula FTP | Hora-aula FGB | Hora-aula NP | Hora-aula TOTAL | Hora relógio TOTAL |",
    "|---:|---|---:|---:|---:|---:|---:|---:|",
  ];
  for (const ano of matriz.anos) {
    for (const item of ano.componentes as ComponenteNucleos[]) {
      linhas.push(
        linhaMd([
          numeroDoAno(ano.ano),
          item.nome,
          item.aulas_semanais,
          item.ch_ftp,
          item.ch_fgb,
          item.ch_np,
          item.ch_hora_aula,
          item.ch_hora_relogio_cnct,
        ]),
      );
    }
    const s = ano.subtotais;
    if (!Object.keys(s).length) continue;
    const aula = "TOTAL ANO HORA-AULA";
    linhas.push(linhaMd([aula, aula, "", s.ch_ftp, s.ch_fgb, s.ch_np, s.ch_total_hora_aula, ""]));
    if (Object.keys(s).some((chave) => chave.endsWith("_hora_relogio"))) {
      const relogio = "TOTAL ANO HORA-RELÓGIO";
      linhas.push(
        linhaMd([
          relogio,
          relogio,
          "",
          s.ch_ftp_hora_relogio,
          s.ch_fgb_hora_relogio,
          s.ch_np_hora_relogio,
          "",
          s.ch_total_hora_relogio,
        ]),
      );
    }
  }
  for (const item of matriz.linhas_modelo) {
    linhas.push(
      linhaMd([
        item.nome,
        item.nome,
        "",
        item.ch_ftp,
        item.ch_fgb,
        item.ch_np,
        item.ch_hora_aula,
        item.ch_hora_relogio,
      ]),
    );
  }
  const t = matriz.totais;
  if (Object.keys(t).length) {
    const titulo = "C.H. (HORA RELÓGIO) TOTAL DO CURSO";
    linhas.push(linhaMd([titulo, titulo, "", t.ch_ftp, t.ch_fgb, t.ch_np, t.ch_total_hora_relogio, ""]));
  }
  return linhas.join("\n");
}

/** Tabela canônica da matriz de PPC; vazio para a matriz genérica, que fica como está no documento. */
export function matrizEmMarkdown(matriz: Matriz): string {
  if (matriz.tipo !== "matriz_curricular_ppc") return "";
  return matriz.formato === "nucleos_ftp_fgb_np" ? nucleosEmMarkdown(matriz) : legadoEmMarkdown(matriz);
}

/**
 * Troca a tabela da seção "5.6 MATRIZ CURRICULAR" do Markdown pela canônica. As várias tabelas em
 * que o PPC divide a matriz (e as linhas em branco entre elas) viram uma só.
 */
export function substituirMatrizNoMarkdown(markdown: string, matriz: Matriz): string {
  const canonica = matrizEmMarkdown(matriz);
  if (!canonica) return markdown;
  const linhas = dividirLinhas(markdown);
  for (const [indiceTitulo, linha] of linhas.entries()) {
    if (!match(r`^#{1,6}\s+5\.6\s+MATRIZ CURRICULAR\b`, aparar(linha), { ignoreCase: true })) continue;

    let inicio: number | null = null;
    for (let i = indiceTitulo + 1; i < linhas.length; i += 1) {
      const texto = aparar(linhas[i]!);
      if (texto.startsWith("#") && i > indiceTitulo + 1) break;
      const ehDaMatriz =
        texto.toUpperCase().includes("MATRIZ CURRICULAR") ||
        texto.includes("Componente Curricular") ||
        match(r`^\|\s*\d`, texto);
      if (texto.startsWith("|") && ehDaMatriz) {
        inicio = i;
        break;
      }
    }
    if (inicio === null) continue;

    let fim = inicio;
    let viuTabela = false;
    while (fim < linhas.length) {
      const texto = aparar(linhas[fim]!);
      if (texto.startsWith("|")) viuTabela = true;
      // Depois da tabela, o primeiro texto que não é linha de tabela encerra o bloco.
      else if (viuTabela && texto) break;
      fim += 1;
    }

    const novas = linhas.slice(0, inicio);
    if (novas.length && aparar(novas.at(-1)!)) novas.push("");
    // Laços, e não `push(...)`: o resto do documento pode ter centenas de milhares de linhas.
    for (const item of dividirLinhas(canonica)) novas.push(item);
    if (fim < linhas.length && aparar(linhas[fim]!)) novas.push("");
    for (let i = fim; i < linhas.length; i += 1) novas.push(linhas[i]!);
    return `${aparar(novas.join("\n"))}\n`;
  }
  return markdown;
}
