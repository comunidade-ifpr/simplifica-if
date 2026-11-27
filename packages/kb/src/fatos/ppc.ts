/**
 * Fatos extraídos do texto dos PPCs convertidos, cada um com o trecho de origem (linha literal do
 * Markdown) e o status de curadoria `extraido`: são propostas por regra, não confirmadas por pessoa
 * (Princípio 4 do plano). A revisão humana fica em `base-conhecimento/fatos-ppc.yaml`
 * (`revisoes.ts`), e a compilação a aplica por cima da extração. O valor está no cruzamento com o
 * SUAP (`divergencias.ts`), e não no número isolado de um texto convertido de PDF.
 *
 * Fatos:
 * - `carga_horaria_total_h`: carga horária total do curso, em hora-relógio quando o PPC dá as duas;
 * - `estagio_obrigatorio`: `sim` ou `nao`;
 * - `estagio_carga_h`: carga horária do estágio obrigatório.
 *
 * A unidade das horas é a que o trecho declara (`UnidadeFato`): hora-relógio, hora-aula (sem a
 * duração da aula) ou só "horas", sem unidade. A duração da hora-aula (50 ou 45 minutos) só vem da
 * revisão humana: a regra não a deduz.
 *
 * As regras procuram primeiro nas seções de identificação e carga horária (o quadro de dados do
 * curso), depois no resto do PPC, sempre fora do ementário, dos anexos e das referências, onde a
 * "carga horária total" é do componente ou de um regulamento.
 */

/**
 * Status de curadoria de um fato de PPC:
 * - `extraido`: tirado do texto por regra, sem revisão humana;
 * - `revisado`: conferido por uma pessoa, com revisor e data (`base-conhecimento/fatos-ppc.yaml`);
 * - `evidencia-conferida`: o ano do documento, cuja evidência literal o `validar_base` confere no
 *   texto (ou na fonte) por regra; ninguém revisou o valor.
 */
export type StatusCuradoria = "extraido" | "revisado" | "evidencia-conferida";

/**
 * Unidade de um fato de horas:
 * - `hora-relogio`: o trecho declara hora-relógio (ou hora-aula de 60 minutos);
 * - `hora-aula`: o trecho declara hora-aula, sem a duração da aula;
 * - `hora-aula-50min`, `hora-aula-45min`: hora-aula com a duração conferida na revisão humana;
 * - `horas`: o trecho só diz "horas" (ou "h"), sem unidade.
 *
 * Só `hora-relogio` e a hora-aula com duração são unidades conhecidas: com elas a carga se compara
 * em hora-relógio. Fato que não é de horas (`estagio_obrigatorio`) não tem unidade.
 */
export const UNIDADES_HORAS = ["hora-relogio", "hora-aula", "hora-aula-50min", "hora-aula-45min", "horas"] as const;
export type UnidadeFato = (typeof UNIDADES_HORAS)[number];

/** Minutos de cada unidade conhecida (a hora-relógio tem 60); `null` para a unidade não conhecida. */
export function minutosDaUnidade(unidade: UnidadeFato | null): number | null {
  if (unidade === "hora-relogio") return 60;
  if (unidade === "hora-aula-50min") return 50;
  if (unidade === "hora-aula-45min") return 45;
  return null;
}

export const FATOS_PPC = ["carga_horaria_total_h", "estagio_obrigatorio", "estagio_carga_h"] as const;
export type NomeFatoPpc = (typeof FATOS_PPC)[number];

export interface FatoPpc {
  fato: NomeFatoPpc;
  valor: string;
  valor_num: number | null;
  /** Unidade das horas (`null` em `estagio_obrigatorio`). */
  unidade: UnidadeFato | null;
  /** Linha (desde 1, no arquivo com o front matter) do trecho de origem. */
  linha: number;
  /** Linha literal do Markdown de onde o valor saiu. */
  trecho_fonte: string;
  regra: string;
  status_curadoria: StatusCuradoria;
  /** Outros valores achados por regras de menor prioridade, para conferência. */
  alternativas: { valor: string; linha: number }[];
}

export interface SecaoDoPpc {
  tipo: string;
  linha_inicio: number;
  linha_fim: number;
}

const TIPOS_QUADRO = new Set(["identificacao", "carga_horaria", "formato_oferta", "prazo_integralizacao"]);
const TIPOS_EXCLUIDOS = new Set(["ementas", "anexos", "referencias", "legislacao"]);

/** Linha sem marcação: negrito, tabelas e `<br>` viram espaço simples. */
export function limparLinha(linha: string): string {
  return linha
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/[*_`#>]+/g, " ")
    .replace(/\|/g, " | ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Números de horas de um trecho: "3.520", "3520h", "1.600 horas"; fora de 20–9000 são ignorados, assim
 * como a duração da aula em minutos ("aula de 50 minutos").
 */
function numeros(trecho: string): { valor: number; inicio: number; fim: number }[] {
  const saida: { valor: number; inicio: number; fim: number }[] = [];
  for (const m of trecho.matchAll(/(?<![\d.,:])(\d{1,2}\.\d{3}|\d{2,4})(?:,(\d{1,2}))?(?![\d,]|\.\d|:\d)/g)) {
    const valor = Math.round(Number(`${m[1]!.replace(".", "")}.${m[2] ?? "0"}`));
    if (valor < 20 || valor > 9000) continue;
    // ano de ato ("nº 64/2022", "2020/2021") não é carga horária
    if (/^(19|20)\d\d$/.test(m[1]!) && /[/º°]\s*$|n[º°o.]\s*$/i.test(trecho.slice(Math.max(0, m.index! - 4), m.index!)))
      continue;
    if (/n[º°o.]\s*$/i.test(trecho.slice(Math.max(0, m.index! - 4), m.index!))) continue;
    const fim = m.index! + m[0].length;
    if (/^\s*min/i.test(trecho.slice(fim))) continue;
    saida.push({ valor, inicio: m.index!, fim });
  }
  return saida;
}

const RE_RELOGIO = /rel[oó]gio|\bh\s*\/\s*r\b|\bhr\b/gi;
const RE_AULA = /aula|\bh\s*\/\s*a\b/gi;
/** "hora-aula de 60 minutos" é hora-relógio. */
const RE_AULA_60 = /^aulas?\s+de\s+60\s*min/i;

export type UnidadeHoras = "relogio" | "aula";

/** Marcas de unidade de um trecho, em ordem de posição. */
function marcas(trecho: string): { posicao: number; unidade: UnidadeHoras }[] {
  const r = [...trecho.matchAll(RE_RELOGIO)].map((m) => ({ posicao: m.index!, unidade: "relogio" as const }));
  const a = [...trecho.matchAll(RE_AULA)].map((m) => ({
    posicao: m.index!,
    unidade: RE_AULA_60.test(trecho.slice(m.index!)) ? ("relogio" as const) : ("aula" as const),
  }));
  return [...r, ...a].sort((x, y) => x.posicao - y.posicao);
}

/** Unidade declarada num rótulo ("Carga horária total em hora-relógio"), se houver uma só. */
export function unidadeDoRotulo(rotulo: string): UnidadeHoras | null {
  const unidades = new Set(marcas(rotulo).map((m) => m.unidade));
  return unidades.size === 1 ? [...unidades][0]! : null;
}

/**
 * Valor de horas depois de um rótulo: com hora-aula e hora-relógio no mesmo trecho, fica o de
 * hora-relógio; sem marcação, o primeiro número.
 *
 * A unidade de cada número é a marca mais próxima depois dele (até o número seguinte); sem ela, a mais
 * próxima antes (depois do número anterior); sem nenhuma, a do rótulo (`unidadeRotulo`). "Hora-aula de
 * 60 minutos" conta como hora-relógio.
 */
export function horasDoTrecho(
  resto: string,
  unidadeRotulo: UnidadeHoras | null = null,
): { valor: number; unidade: UnidadeHoras | "sem-marca" } | null {
  const lista = numeros(resto);
  if (lista.length === 0) return null;
  const todas = marcas(resto);
  const marcados = lista.map((n, i) => {
    const limiteDepois = Math.min(n.fim + 22, lista[i + 1]?.inicio ?? Infinity);
    const limiteAntes = Math.max(0, n.inicio - 22, lista[i - 1]?.fim ?? 0);
    const depois = todas.find((m) => m.posicao >= n.fim && m.posicao < limiteDepois);
    const antes = todas.filter((m) => m.posicao >= limiteAntes && m.posicao < n.inicio).at(-1);
    return { ...n, unidade: depois?.unidade ?? antes?.unidade ?? unidadeRotulo ?? ("sem-marca" as const) };
  });
  const relogio = marcados.find((n) => n.unidade === "relogio");
  if (relogio) return { valor: relogio.valor, unidade: "relogio" };
  const semMarca = marcados.find((n) => n.unidade === "sem-marca");
  if (semMarca && marcados.some((n) => n.unidade === "aula")) return { valor: semMarca.valor, unidade: "sem-marca" };
  const primeiro = marcados[0]!;
  return { valor: primeiro.valor, unidade: primeiro.unidade };
}

type Zona = "quadro" | "corpo";

/** O rótulo abre a linha (depois de marcadores de lista ou de tabela). */
function inicioDeLinha(limpa: string, indice: number): boolean {
  return /^[\s|:•\-–]*(?:[a-z]\)\s*)?$/i.test(limpa.slice(0, indice));
}

/** Trecho literal da linha: inteira até 400 caracteres; senão, a janela em volta do rótulo. */
function recorte(bruta: string, limpa: string, indiceRotulo: number): string {
  const linha = bruta.trim();
  if (linha.length <= 400) return linha;
  const termo = limpa.slice(indiceRotulo, indiceRotulo + 25);
  const posicao = Math.max(0, linha.toLowerCase().indexOf(termo.toLowerCase().slice(0, 12)));
  return linha.slice(Math.max(0, posicao - 40), posicao + 300).trim();
}

function zonas(totalLinhas: number, secoes: readonly SecaoDoPpc[]): (Zona | null)[] {
  // null: linha excluída (ementário, anexos, referências, legislação)
  const zona: (Zona | null)[] = Array.from({ length: totalLinhas + 1 }, () => "corpo");
  for (const secao of secoes) {
    const valor: Zona | null = TIPOS_EXCLUIDOS.has(secao.tipo)
      ? null
      : TIPOS_QUADRO.has(secao.tipo)
        ? "quadro"
        : "corpo";
    for (let l = secao.linha_inicio; l <= Math.min(secao.linha_fim, totalLinhas); l += 1) zona[l] = valor;
  }
  return zona;
}

interface Candidato {
  prioridade: number;
  linha: number;
  valor: string;
  valor_num: number | null;
  trecho: string;
  regra: string;
}

function melhor(candidatos: Candidato[]): Candidato | null {
  return [...candidatos].sort((a, b) => a.prioridade - b.prioridade || a.linha - b.linha)[0] ?? null;
}

const RE_ROTULO_CH_TOTAL =
  /carga[- ]hor[aá]ria total(?! (?:do|de|da|dos|das|por|em cada|semanal|anual) (?:componente|disciplina|unidade|ano|semestre|m[oó]dulo|per[ií]odo|n[uú]cleo|est[aá]gio|atividade|s[eé]rie|eixo|bloco|etapa))(?: do curso)?(?:[^:|\d]{0,40}?)\s*[:|–-](?:\s*\|)*\s*([^|]{0,120})/i;
const RE_CH_TOTAL_PROSA = /carga[- ]hor[aá]ria total(?: do curso)?(?: [eé]| ser[aá])? de ([\d.]+) ?(?:\(|h|horas)/i;

/** Carga horária total do curso. */
function cargaHorariaTotal(linhas: readonly string[], zona: readonly (Zona | null)[]): Candidato[] {
  const candidatos: Candidato[] = [];
  for (let i = 0; i < linhas.length; i += 1) {
    const l = i + 1;
    const z = zona[l];
    if (z === null || z === undefined) continue;
    const bruta = linhas[i]!;
    if (!/carga[\s-]+hor/i.test(bruta)) continue;
    const limpa = limparLinha(bruta);
    const rotulo = RE_ROTULO_CH_TOTAL.exec(limpa);
    if (rotulo && (z === "quadro" || inicioDeLinha(limpa, rotulo.index))) {
      let resto = rotulo[1]!;
      // valor na linha seguinte não vazia (rótulo sozinho na linha)
      if (numeros(resto).length === 0) {
        let j = i + 1;
        while (j < linhas.length && !limparLinha(linhas[j]!)) j += 1;
        if (j < linhas.length && j - i <= 2) resto = limparLinha(linhas[j]!).slice(0, 120);
      }
      // o rótulo vai do "carga horária total" ao separador antes do valor
      const textoRotulo = rotulo[0].slice(0, rotulo[0].length - rotulo[1]!.length);
      const horas = horasDoTrecho(resto, unidadeDoRotulo(textoRotulo));
      const doCurso = /total do curso/i.test(limpa);
      if (horas && horas.valor >= 160) {
        const tabela = bruta.trimStart().startsWith("|");
        candidatos.push({
          prioridade: (z === "quadro" ? 0 : 2) + (tabela && !doCurso ? 1 : 0),
          linha: l,
          valor: String(horas.valor),
          valor_num: horas.valor,
          trecho: recorte(bruta, limpa, rotulo.index),
          regra: `rotulo-${z}${tabela ? "-tabela" : ""}-${horas.unidade}`,
        });
        continue;
      }
    }
    // título "Carga horária total do curso" com o valor no parágrafo seguinte
    if (/^#/.test(bruta.trim()) && /carga[- ]hor[aá]ria total do curso/i.test(limpa) && numeros(limpa).length === 0) {
      for (let j = i + 1, vistas = 0; j < linhas.length && vistas < 4; j += 1) {
        const seguinte = limparLinha(linhas[j]!);
        if (!seguinte) continue;
        vistas += 1;
        if (/^#/.test(linhas[j]!.trim())) break;
        const m =
          /carga[- ]hor[aá]ria(?: total| global)?(?: do curso)?(?: [eé]| ser[aá])?(?: de)? ([\d.]{3,5}(?:,\d+)?) ?(?:\(|h\b|horas)/di.exec(
            seguinte,
          );
        // o trecho começa no número capturado (índice do grupo, com a flag `d`)
        const horas = m ? horasDoTrecho(seguinte.slice(m.indices![1]![0])) : null;
        if (horas && horas.valor >= 160) {
          candidatos.push({
            prioridade: 1,
            linha: j + 1,
            valor: String(horas.valor),
            valor_num: horas.valor,
            trecho: recorte(linhas[j]!, seguinte, m!.index),
            regra: `titulo-paragrafo-${horas.unidade}`,
          });
          break;
        }
      }
    }
    const prosa = RE_CH_TOTAL_PROSA.exec(limpa);
    // "estágio ... com carga horária total de 246 horas" é do estágio, não do curso
    if (
      prosa &&
      !/est[aá]gio|componente|disciplina|m[oó]dulo/i.test(limpa.slice(Math.max(0, prosa.index - 80), prosa.index))
    ) {
      const valor = Number(prosa[1]!.replace(".", ""));
      if (valor >= 160 && valor <= 9000) {
        candidatos.push({
          prioridade: 4,
          linha: l,
          valor: String(valor),
          valor_num: valor,
          trecho: recorte(bruta, limpa, prosa.index),
          regra: `prosa-${z}`,
        });
      }
    }
  }
  return candidatos;
}

const RE_ROTULO_ESTAGIO =
  /carga[- ]hor[aá]ria (?:de |do |dos )?(?:est[aá]gios?|pr[aá]tica profissional supervisionada)(?: curricular)?(?: supervisionado)?( obrigat[oó]rio)?(?: \(?est[aá]gio curricular\)?)?\s*[:–-]?\s*(.*)$/i;
const RE_NEGA_ESTAGIO =
  /n[aã]o (?:se aplica|h[aá]|haver[aá]|possui|prev[eê]|contempla|exige|requer|tem|ter[aá]|est[aá] previsto)|sem previs[aã]o|inexistente|^0 ?(?:h|horas)?\b|n[aã]o[- ]obrigat[oó]rio|opcional|^-$|^n[aã]o\.?$/i;
const RE_FRASE_SEM_ESTAGIO =
  /n[aã]o (?:contempla|prev[eê]|possui|exige|requer|h[aá]|haver[aá]|ter[aá]|oferta|tem)[^.]{0,40}est[aá]gio(?: curricular)?(?: supervisionado)?(?: profissional)? obrigat[oó]rio/i;
const RE_FRASE_ESTAGIO_CH =
  /est[aá]gio (?:curricular )?(?:supervisionado )?obrigat[oó]rio[^.]{0,60}?(?:de|com|ter[aá]|possui|totaliza(?:ndo)?|carga[- ]hor[aá]ria(?: m[ií]nima)?(?: de)?)\s+([\d.]{2,5})\s*(?:\(|h|horas)/i;

/** Estágio obrigatório (sim/não) e carga, pelo rótulo do quadro ou por frases do PPC. */
function estagio(
  linhas: readonly string[],
  zona: readonly (Zona | null)[],
): { obrigatorio: Candidato[]; carga: Candidato[] } {
  const obrigatorio: Candidato[] = [];
  const carga: Candidato[] = [];
  for (let i = 0; i < linhas.length; i += 1) {
    const l = i + 1;
    const z = zona[l];
    if (z === null || z === undefined) continue;
    const bruta = linhas[i]!;
    if (!/est[aá]gio|supervisionada/i.test(bruta)) continue;
    const limpa = limparLinha(bruta);
    const rotulo = RE_ROTULO_ESTAGIO.exec(limpa);
    if (rotulo && !/^#/.test(bruta.trim()) && (z === "quadro" || inicioDeLinha(limpa, rotulo.index))) {
      let resto = rotulo[2]!.replace(/^[|:\s]+/, "").trim();
      if (!resto) {
        let j = i + 1;
        while (j < linhas.length && !limparLinha(linhas[j]!)) j += 1;
        if (j < linhas.length && j - i <= 2) resto = limparLinha(linhas[j]!);
      }
      const base = z === "quadro" ? 0 : 2;
      if (RE_NEGA_ESTAGIO.test(resto) && !/^\d{2,}/.test(resto)) {
        obrigatorio.push({
          prioridade: base,
          linha: l,
          valor: "nao",
          valor_num: null,
          trecho: recorte(bruta, limpa, rotulo.index),
          regra: `rotulo-${z}-negativo`,
        });
        continue;
      }
      const horas = horasDoTrecho(
        resto.slice(0, 80),
        unidadeDoRotulo(rotulo[0].slice(0, rotulo[0].length - rotulo[2]!.length)),
      );
      if (horas && horas.valor >= 20 && !/n[aã]o[- ]obrigat/i.test(limpa)) {
        obrigatorio.push({
          prioridade: base,
          linha: l,
          valor: "sim",
          valor_num: null,
          trecho: recorte(bruta, limpa, rotulo.index),
          regra: `rotulo-${z}`,
        });
        carga.push({
          prioridade: base,
          linha: l,
          valor: String(horas.valor),
          valor_num: horas.valor,
          trecho: recorte(bruta, limpa, rotulo.index),
          regra: `rotulo-${z}-${horas.unidade}`,
        });
        continue;
      }
    }
    if (RE_FRASE_SEM_ESTAGIO.test(limpa)) {
      obrigatorio.push({
        prioridade: z === "quadro" ? 1 : 3,
        linha: l,
        valor: "nao",
        valor_num: null,
        trecho: recorte(bruta, limpa, Math.max(0, limpa.search(RE_FRASE_SEM_ESTAGIO))),
        regra: `frase-${z}-negativa`,
      });
      continue;
    }
    const frase = RE_FRASE_ESTAGIO_CH.exec(limpa);
    if (frase && !/n[aã]o[- ]obrigat/i.test(limpa.slice(0, frase.index + 30))) {
      const valor = Number(frase[1]!.replace(".", ""));
      if (valor >= 20 && valor <= 3000) {
        const prioridade = z === "quadro" ? 1 : 3;
        obrigatorio.push({
          prioridade,
          linha: l,
          valor: "sim",
          valor_num: null,
          trecho: recorte(bruta, limpa, frase.index),
          regra: `frase-${z}`,
        });
        carga.push({
          prioridade,
          linha: l,
          valor: String(valor),
          valor_num: valor,
          trecho: recorte(bruta, limpa, frase.index),
          regra: `frase-${z}`,
        });
      }
    }
  }
  return { obrigatorio, carga };
}

/** A unidade das horas pelo sufixo da regra (`-relogio`, `-aula`); sem ele, só "horas". */
function unidadeDaRegra(regra: string): UnidadeFato {
  if (regra.endsWith("-relogio")) return "hora-relogio";
  if (regra.endsWith("-aula")) return "hora-aula";
  return "horas";
}

function fato(nome: NomeFatoPpc, candidatos: Candidato[], horas: boolean): FatoPpc | null {
  const escolhido = melhor(candidatos);
  if (!escolhido) return null;
  const alternativas = [...candidatos]
    .filter((c) => c.valor !== escolhido.valor)
    .sort((a, b) => a.linha - b.linha)
    .map((c) => ({ valor: c.valor, linha: c.linha }))
    .filter((c, indice, lista) => lista.findIndex((x) => x.valor === c.valor) === indice);
  return {
    fato: nome,
    valor: escolhido.valor,
    valor_num: escolhido.valor_num,
    unidade: horas ? unidadeDaRegra(escolhido.regra) : null,
    linha: escolhido.linha,
    trecho_fonte: escolhido.trecho,
    regra: escolhido.regra,
    status_curadoria: "extraido",
    alternativas,
  };
}

/** Fatos de um PPC (texto do arquivo, com o front matter; linhas contadas desde 1). */
export function extrairFatosPpc(markdown: string, secoes: readonly SecaoDoPpc[]): FatoPpc[] {
  const linhas = markdown.replace(/\r\n?/g, "\n").split("\n");
  const zona = zonas(linhas.length, secoes);
  // o front matter nunca é fonte de fato
  const fim = markdown.startsWith("---\n") ? markdown.indexOf("\n---", 3) : -1;
  if (fim !== -1) {
    const n = markdown.slice(0, fim + 4).split("\n").length;
    for (let l = 1; l <= n; l += 1) zona[l] = null;
  }
  const saida: FatoPpc[] = [];
  const ch = fato("carga_horaria_total_h", cargaHorariaTotal(linhas, zona), true);
  if (ch) saida.push(ch);
  const est = estagio(linhas, zona);
  const obrigatorio = fato("estagio_obrigatorio", est.obrigatorio, false);
  if (obrigatorio) {
    saida.push(obrigatorio);
    if (obrigatorio.valor === "sim") {
      const carga = fato("estagio_carga_h", est.carga, true);
      if (carga) saida.push(carga);
    }
  }
  return saida;
}
