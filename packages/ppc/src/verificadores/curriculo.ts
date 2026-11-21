/**
 * Verificadores D de currículo: carga horária total (CT-CURR-02), requisito de ingresso (CT-CURR-16),
 * componentes da Formação Geral Básica no integrado (CT-CURR-18) e AEE como componente (CT-CURR-22).
 */
import {
  type Apontamento,
  chave,
  type FormaOferta,
  linkCnct,
  linkNorma,
  linhasDasSecoes,
  type PpcPreparado,
  resultado,
  type Trecho,
  trecho,
  type Verificador,
} from "./comum.ts";

/** Trecho de uma linha do Markdown como aparece no DOCX: sem negrito, barras de tabela nem marcador de lista. */
export const comoNoDocumento = (linha: string) =>
  linha
    .replace(/!?\[([^\]]*)\]\([^)\s]*\)/g, "$1")
    .replace(/[*|]/g, " ")
    .replace(/^\s*[-+]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();

const MINIMO_INTEGRADO = 3000;
const MENOR_MINIMO_CNCT = 800;
const ART29_PAR2 = linkNorma("br/cne-cp/res/2026/2#art29-par2");

export const cargaHorariaTotal: Verificador = {
  id: "d-carga-horaria-total",
  ficha: "CT-CURR-02",
  descricao:
    "A carga horária total extraída do PPC (fato `extraido` do kb) contra o mínimo do CNCT e, no integrado (fora o PROEJA), as 3.000 h da Res. CNE/CP nº 2/2026, art. 29, § 2º; valor abaixo do mínimo, outro total de 800 h ou mais no texto ou valor não encontrado saem a conferir.",
  verificar(ppc, base) {
    const { cnct, forma } = base;
    const total = ppc.fatos.find((f) => f.fato === "carga_horaria_total_h");
    const art29 = base.vigencia("br/cne-cp/res/2026/2").certo
      ? "Res. CNE/CP nº 2/2026, art. 29, § 2º"
      : "Res. CNE/CP nº 2/2026, art. 29, § 2º, cuja data de início ainda não foi confirmada";
    // PROEJA cadastrado como integrado: a EJA articulada tem a carga horária do art. 30, não as 3.000 h.
    const eja = /proeja|educa[cç][aã]o de jovens e adultos/i.test(ppc.linhas.slice(0, 120).join("\n"));
    const minimoForma = forma === "integrado" && !eja ? MINIMO_INTEGRADO : 0;
    const minimoCnct = cnct?.carga_horaria_minima_horas ?? 0;
    const minimo = Math.max(minimoCnct, minimoForma);
    const fontes = [...(cnct ? [linkCnct(cnct.slug)] : []), ...(minimoForma ? [ART29_PAR2] : [])];
    if (!total)
      return resultado(
        this,
        [{ estado: "a_conferir", mensagem: "Não encontramos a carga horária total declarada.", trechos: [], fontes }],
        { estado: "a_conferir", mensagem: "" },
      );
    const evidencia = trecho(ppc, total.linha);
    if (!cnct && !minimoForma)
      return resultado(this, [], {
        estado: "a_conferir",
        mensagem: `Carga horária total de ${total.valor} h; sem o curso no CNCT, não há mínimo a comparar.`,
        evidencias: [evidencia],
      });
    if (total.valor_num !== null && total.valor_num < minimo)
      return resultado(
        this,
        [
          {
            estado: "a_conferir",
            mensagem: `Carga horária total de ${total.valor_num} h, abaixo do mínimo de ${minimo} h (${minimoForma > minimoCnct ? `forma integrada, ${art29}` : "CNCT"}).`,
            trechos: [evidencia],
            fontes: minimoForma > minimoCnct ? [ART29_PAR2] : fontes,
          },
        ],
        { estado: "a_conferir", mensagem: "" },
      );
    // Alternativa abaixo de 800 h (o menor mínimo do CNCT) não é total de curso: é célula de tabela ou subtotal.
    // Na mesma linha que o total (a linha "Carga horária total" da matriz, com os anos), também não é divergência.
    const comTotal = (linha: number) =>
      (ppc.linhas[linha - 1] ?? "").replace(/(\d)\.(\d{3})/g, "$1$2").includes(String(total.valor_num));
    const diferentes = total.alternativas.filter((a) => {
      const valor = Number.parseInt(a.valor, 10);
      return valor >= MENOR_MINIMO_CNCT && valor !== total.valor_num && !comTotal(a.linha);
    });
    if (diferentes.length)
      return resultado(
        this,
        [
          {
            estado: "a_conferir",
            mensagem: `A carga horária total aparece com valores diferentes: ${[total.valor, ...diferentes.map((a) => a.valor)].join(", ")} h.`,
            trechos: [evidencia, ...diferentes.slice(0, 3).map((a) => trecho(ppc, a.linha))],
            fontes,
          },
        ],
        { estado: "a_conferir", mensagem: "" },
      );
    return resultado(this, [], {
      estado: "atende",
      mensagem: `Carga horária total de ${total.valor} h, não inferior ao mínimo de ${minimo} h.`,
      evidencias: [evidencia],
      fontes,
    });
  },
};

/* ------------------------------------------------------------------ CT-CURR-16 */

type Escolaridade = "fundamental" | "medio" | "cursando_medio";
const NOME_ESCOLARIDADE: Record<Escolaridade, string> = {
  fundamental: "ensino fundamental concluído",
  medio: "ensino médio concluído",
  cursando_medio: "estar cursando o ensino médio",
};

/** Escolaridade dita num texto (sem acento e em minúsculas), na ordem do mais específico. */
function escolaridadeDe(texto: string): Escolaridade | null {
  if (/cursando o ensino medio|matriculad[oa]s? (no|na|em) .{0,25}ensino medio/.test(texto)) return "cursando_medio";
  const nivel = (n: string) =>
    new RegExp(
      `(conclu[ií]d[oa]s?|conclus[aã]o|concluir|concluintes?|egress[oa]s?|termino|formacao complet[ao] n[oa])( (o|a|do|da|de))? ensino ${n}|ensino ${n}\\W{0,3}(anos finais |ii )?(complet|conclu)|(escolaridade|requisito)[^.]{0,60}(: ?|\\be o |exigencia de )ensino ${n}\\b`,
    );
  if (nivel("fundamental").test(texto)) return "fundamental";
  if (nivel("medio").test(texto)) return "medio";
  return null;
}

/** Rótulo de requisito cujo valor pode vir na linha seguinte ("Requisito de acesso:" ↵ "Ensino Fundamental e aprovação…"). */
const RE_ROTULO_INGRESSO = /(requisito|escolaridade|forma de (acesso|ingresso)|pre-requisito)/;
const escolaridadeNoInicio = (texto: string): Escolaridade | null =>
  /^\W*ensino fundamental\b/.test(texto) ? "fundamental" : /^\W*ensino medio\b/.test(texto) ? "medio" : null;

/** Forma citada numa frase do CNCT. */
function formaDaFrase(frase: string): FormaOferta | null {
  if (/jovens e adultos|proeja/.test(frase)) return "proeja";
  if (/subsequente/.test(frase)) return "subsequente";
  if (/concomitante/.test(frase)) return "concomitante";
  if (/integrad/.test(frase)) return "integrado";
  return null;
}

/** Forma de oferta → escolaridade de ingresso: as do CNCT (frases por forma, ou uma só para todas) ou, sem CNCT, as do art. 18 da Res. CNE/CP nº 2/2026. */
export function escolaridadeExigida(preRequisitos: string | null | undefined, forma: FormaOferta): Escolaridade | null {
  const padrao: Record<string, Escolaridade> = {
    integrado: "fundamental",
    subsequente: "medio",
    concomitante: "cursando_medio",
    proeja: "fundamental",
  };
  const frases = chave(preRequisitos ?? "")
    .split(/[.\n]/)
    .filter((f) => f.trim());
  const porForma = new Map<FormaOferta, Escolaridade>();
  const semForma: Escolaridade[] = [];
  for (const frase of frases) {
    const escolaridade = escolaridadeDe(frase);
    if (!escolaridade) continue;
    const formaFrase = formaDaFrase(frase);
    if (formaFrase) porForma.set(formaFrase, escolaridade);
    else semForma.push(escolaridade);
  }
  if (porForma.size) return porForma.get(forma) ?? padrao[forma] ?? null;
  if (semForma.length) return semForma[0]!;
  return padrao[forma] ?? null;
}

/** Linha que fala de ingresso: requisito, acesso, candidato, matrícula, público-alvo. */
const RE_CONTEXTO_INGRESSO =
  /ingress|acesso|requisit|candidat|processo seletivo|publico[- ]alvo|destina-se|destinado|inscri/;

export const requisitoIngresso: Verificador = {
  id: "d-requisito-ingresso",
  ficha: "CT-CURR-16",
  descricao:
    "A escolaridade de ingresso dita nas frases sobre ingresso (requisito, acesso, candidato, processo seletivo, público-alvo) ou na seção de requisitos de acesso contra a que o CNCT exige para a forma de oferta (sem frase por forma no CNCT, o art. 18 da Res. CNE/CP nº 2/2026). Encontrar a exigida é atender; não a encontrar sai a conferir.",
  verificar(ppc, { cnct, forma }) {
    const exigida = escolaridadeExigida(cnct?.pre_requisitos_ingresso, forma);
    const fontes = [...(cnct ? [linkCnct(cnct.slug)] : []), linkNorma("br/cne-cp/res/2026/2#art18")];
    if (!exigida)
      return resultado(
        this,
        [
          {
            estado: "a_conferir",
            mensagem: `Forma de oferta "${forma}" sem requisito de ingresso conhecido; confira a escolaridade exigida.`,
            trechos: [],
            fontes,
          },
        ],
        { estado: "a_conferir", mensagem: "" },
      );
    const secoesIngresso = new Set(linhasDasSecoes(ppc, new Set(["requisitos_acesso"])));
    const achados: Array<{ escolaridade: Escolaridade; trecho: Trecho }> = [];
    // Contexto e escolaridade na mesma frase: num parágrafo longo, "acesso" e "ensino médio" podem não ter relação.
    ppc.linhas.forEach((linha, indice) => {
      const naSecao = secoesIngresso.has(indice + 1);
      for (const frase of linha.split(/(?<=[.;])\s+|<br>/)) {
        const texto = chave(frase.replace(/\*/g, ""));
        if (/transferencia/.test(texto) || (!naSecao && !RE_CONTEXTO_INGRESSO.test(texto))) continue;
        const escolaridade = escolaridadeDe(texto);
        if (escolaridade) achados.push({ escolaridade, trecho: trecho(ppc, indice + 1, frase.trim()) });
      }
      // Valor na linha seguinte a um rótulo de requisito.
      if (RE_ROTULO_INGRESSO.test(chave(linha))) {
        const seguinte = ppc.linhas.findIndex((l, i) => i > indice && l.trim() !== "");
        const escolaridade =
          seguinte > 0 && seguinte - indice <= 2
            ? escolaridadeNoInicio(chave(ppc.linhas[seguinte]!.replace(/\*/g, "")))
            : null;
        if (escolaridade) achados.push({ escolaridade, trecho: trecho(ppc, seguinte + 1) });
      }
    });
    const compativel = achados.find((a) => a.escolaridade === exigida);
    if (compativel)
      return resultado(this, [], {
        estado: "atende",
        mensagem: `O PPC exige ${NOME_ESCOLARIDADE[exigida]} para o ingresso, como o CNCT para a forma ${forma}.`,
        evidencias: [compativel.trecho],
        fontes,
      });
    const outro = achados[0];
    return resultado(
      this,
      [
        outro
          ? {
              estado: "a_conferir",
              mensagem: `O PPC fala em ${NOME_ESCOLARIDADE[outro.escolaridade]} no ingresso; para a forma ${forma}, o CNCT exige ${NOME_ESCOLARIDADE[exigida]}.`,
              trechos: [outro.trecho],
              fontes,
            }
          : {
              estado: "a_conferir",
              mensagem: `Não encontramos o requisito de escolaridade para o ingresso; para a forma ${forma}, o CNCT exige ${NOME_ESCOLARIDADE[exigida]}.`,
              trechos: [],
              fontes,
            },
      ],
      { estado: "a_conferir", mensagem: "" },
    );
  },
};

/* ------------------------------------------------------------------ CT-CURR-18 */

/** Componentes obrigatórios da Formação Geral Básica (LDB, art. 35-D; Res. CNE/CEB nº 2/2024, art. 17), sobre texto sem acento. */
export const COMPONENTES_FGB: ReadonlyArray<[nome: string, padrao: RegExp]> = [
  ["Língua Portuguesa", /lingua portuguesa|\bportugues\b/],
  ["Língua Inglesa", /lingua inglesa|\bingles\b/],
  ["Arte", /\bartes?\b/],
  ["Educação Física", /educacao fisica/],
  ["Matemática", /matematica/],
  ["Biologia", /biologia/],
  ["Física", /(?<!educacao )\bfisica\b/],
  ["Química", /\bquimica\b/],
  ["Filosofia", /filosofia/],
  ["Geografia", /geografia/],
  ["História", /\bhistoria\b/],
  ["Sociologia", /sociologia/],
];

/** Seções cujas tabelas não são de componentes (cursos do campus, docentes, laboratórios, referências). */
const SECOES_NAO_CURRICULARES = new Set([
  "identificacao",
  "justificativa",
  "objetivos",
  "perfil_egresso",
  "corpo_docente",
  "infraestrutura",
  "gestao_curso",
  "atendimento_estudante",
  "acessibilidade_inclusao",
  "referencias",
  "mundo_trabalho",
  "avaliacao_curso",
]);

/** Linhas que nomeiam componentes: linhas de tabela, títulos e "Componente curricular: …". */
function linhasDeComponentes(ppc: PpcPreparado): number[] {
  const ementas = new Set(linhasDasSecoes(ppc, new Set(["ementas", "matriz_curricular", "organizacao_curricular"])));
  const foraDoCurriculo = new Set(linhasDasSecoes(ppc, SECOES_NAO_CURRICULARES));
  const saida: number[] = [];
  ppc.linhas.forEach((linha, indice) => {
    const aparada = linha.trimStart();
    if (
      (aparada.startsWith("|") && !foraDoCurriculo.has(indice + 1)) ||
      (ementas.has(indice + 1) &&
        (aparada.startsWith("#") || /componente curricular|disciplina|unidade curricular/i.test(linha)))
    )
      saida.push(indice + 1);
  });
  return saida;
}

export const componentesFgb: Verificador = {
  id: "d-componentes-fgb",
  ficha: "CT-CURR-18",
  descricao:
    "No integrado, os 12 componentes obrigatórios da Formação Geral Básica (LDB, art. 35-D; Res. CNE/CEB nº 2/2024, art. 17) procurados pelo nome nas linhas de tabela e nos títulos e campos “componente curricular” da matriz e do ementário. Fora do integrado, não se aplica.",
  verificar(ppc, { forma }) {
    const fontes = [linkNorma("br/lei/1996/9394#art35D"), linkNorma("br/cne-ceb/res/2024/2#art17")];
    if (forma !== "integrado")
      return resultado(this, [], {
        estado: "nao_se_aplica",
        mensagem: "Só se aplica ao curso integrado ao ensino médio.",
      });
    const linhas = linhasDeComponentes(ppc);
    const encontrados = new Map<string, Trecho>();
    const ausentes: string[] = [];
    for (const [nome, padrao] of COMPONENTES_FGB) {
      const linha = linhas.find((n) => padrao.test(chave(ppc.linhas[n - 1] ?? "")));
      if (linha) encontrados.set(nome, trecho(ppc, linha));
      else ausentes.push(nome);
    }
    if (!ausentes.length)
      return resultado(this, [], {
        estado: "atende",
        mensagem: "Os 12 componentes obrigatórios da Formação Geral Básica aparecem na matriz ou no ementário.",
        evidencias: [...encontrados.values()],
        fontes,
      });
    // Muitos ausentes: a matriz provavelmente não foi reconhecida (imagem, tabela quebrada), não está ausente.
    const apontamento: Apontamento = {
      estado: "a_conferir",
      mensagem:
        ausentes.length > 4
          ? `Não reconhecemos a matriz da Formação Geral Básica: ${ausentes.length} dos 12 componentes obrigatórios não foram encontrados (${ausentes.join(", ")}). Confira a matriz.`
          : `Não encontramos na matriz nem no ementário: ${ausentes.join(", ")} (componentes obrigatórios da Formação Geral Básica).`,
      trechos: [],
      fontes,
    };
    return resultado(this, [apontamento], { estado: "a_conferir", mensagem: "" });
  },
};

/* ------------------------------------------------------------------ CT-CURR-22 */

const SECOES_CURRICULARES = new Set(["matriz_curricular", "organizacao_curricular", "ementas", "carga_horaria"]);
/** Célula que é o nome do componente: "Atendimento Educacional Especializado (5)", "Componente curricular: AEE". */
const RE_CELULA_AEE =
  /^(componente curricular\s*:?\s*)?(atendimento\s*educacional\s*especializado|aee)\s*(\(\d+\)|\*+)?$/i;

export const aeeComoComponente: Verificador = {
  id: "d-aee-componente",
  ficha: "CT-CURR-22",
  descricao:
    "Célula de tabela das seções de matriz, organização curricular, carga horária ou ementário que é o nome “Atendimento Educacional Especializado” ou “AEE” (linha da matriz, “Componente curricular: AEE”): o AEE é serviço, não componente (NT PROENS nº 1/2025). Menção em texto de ementa ou bibliografia não conta, nem o AEE com outro nome (“Educação Especial”), que fica com a IA.",
  verificar(ppc) {
    const fontes = [linkNorma("ifpr/proens/nt/2025/1")];
    const trechos: Trecho[] = [];
    for (const n of linhasDasSecoes(ppc, SECOES_CURRICULARES)) {
      const linha = ppc.linhas[n - 1] ?? "";
      if (!linha.trimStart().startsWith("|")) continue;
      const nomeiaAee = linha.split("|").some((c) => RE_CELULA_AEE.test(c.replace(/\*/g, "").trim()));
      const aee = nomeiaAee && /atendimento\s*educacional\s*especializado|\bAEE\b/i.exec(linha);
      if (aee) trechos.push(trecho(ppc, n, aee[0]));
    }
    const apontamentos: Apontamento[] = trechos.length
      ? [
          {
            estado: "nao_atende",
            mensagem: `O AEE aparece como componente na matriz ou no quadro de componentes (${trechos.length} ${trechos.length === 1 ? "linha" : "linhas"}); ele é serviço, não componente.`,
            trechos: trechos.slice(0, 3),
            fontes,
          },
        ]
      : [];
    return resultado(this, apontamentos, {
      estado: "atende",
      mensagem: "O AEE não aparece como componente nas tabelas da matriz, do ementário ou da organização curricular.",
      fontes,
    });
  },
};
