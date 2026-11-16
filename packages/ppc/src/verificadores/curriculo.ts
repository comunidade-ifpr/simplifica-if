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
    .replace(/[*|]/g, " ")
    .replace(/^\s*[-+]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();

const MINIMO_INTEGRADO = 3000;
const ART29_PAR2 = linkNorma("br/cne-cp/res/2026/2#art29-par2");

export const cargaHorariaTotal: Verificador = {
  id: "d-carga-horaria-total",
  ficha: "CT-CURR-02",
  descricao:
    "A carga horária total extraída do PPC (fato `extraido` do kb) contra o mínimo do CNCT e, no integrado, as 3.000 h da Res. CNE/CP nº 2/2026, art. 29, § 2º; valor abaixo do mínimo, valores divergentes no texto ou valor não encontrado saem a conferir.",
  verificar(ppc, { cnct, forma }) {
    const total = ppc.fatos.find((f) => f.fato === "carga_horaria_total_h");
    const minimoForma = forma === "integrado" ? MINIMO_INTEGRADO : 0;
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
            mensagem: `Carga horária total de ${total.valor_num} h, abaixo do mínimo de ${minimo} h (${minimoForma > minimoCnct ? "forma integrada, Res. CNE/CP nº 2/2026, art. 29, § 2º" : "CNCT"}).`,
            trechos: [evidencia],
            fontes: minimoForma > minimoCnct ? [ART29_PAR2] : fontes,
          },
        ],
        { estado: "a_conferir", mensagem: "" },
      );
    const diferentes = total.alternativas.filter((a) => Number.parseInt(a.valor, 10) !== total.valor_num);
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
  if (
    /(conclu[ií]d[oa]s?|conclus[aã]o|concluir|concluintes?|egress[oa]s?)( (o|a|do|da|de))? ensino fundamental|ensino fundamental (complet|conclu)/.test(
      texto,
    )
  )
    return "fundamental";
  if (
    /(conclu[ií]d[oa]s?|conclus[aã]o|concluintes?|egress[oa]s?)( (o|a|do|da|de))? ensino medio|ensino medio (complet|conclu)/.test(
      texto,
    )
  )
    return "medio";
  return null;
}

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
  /ingress|acesso|requisit|candidat|matr[ií]cul|processo seletivo|publico[- ]alvo|destina-se|destinado|inscri/;

export const requisitoIngresso: Verificador = {
  id: "d-requisito-ingresso",
  ficha: "CT-CURR-16",
  descricao:
    "A escolaridade de ingresso dita nas linhas sobre ingresso (requisito, acesso, candidato, matrícula, público-alvo) contra a que o CNCT exige para a forma de oferta (sem frase por forma no CNCT, o art. 18 da Res. CNE/CP nº 2/2026). Encontrar a exigida é atender; não a encontrar sai a conferir.",
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
    ppc.linhas.forEach((linha, indice) => {
      const texto = chave(linha);
      if (!secoesIngresso.has(indice + 1) && !RE_CONTEXTO_INGRESSO.test(texto)) return;
      const escolaridade = escolaridadeDe(texto);
      if (escolaridade) achados.push({ escolaridade, trecho: trecho(ppc, indice + 1) });
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

/** Linhas que nomeiam componentes: linhas de tabela, títulos e "Componente curricular: …". */
function linhasDeComponentes(ppc: PpcPreparado): number[] {
  const ementas = new Set(linhasDasSecoes(ppc, new Set(["ementas", "matriz_curricular", "organizacao_curricular"])));
  const saida: number[] = [];
  ppc.linhas.forEach((linha, indice) => {
    const aparada = linha.trimStart();
    if (
      aparada.startsWith("|") ||
      (ementas.has(indice + 1) && (aparada.startsWith("#") || /componente curricular|disciplina|unidade curricular/i.test(linha)))
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

export const aeeComoComponente: Verificador = {
  id: "d-aee-componente",
  ficha: "CT-CURR-22",
  descricao:
    "Célula curta (até 80 caracteres) de tabela das seções de matriz, organização curricular, carga horária ou ementário que nomeia o “Atendimento Educacional Especializado” ou “AEE” (linha da matriz, “Componente curricular: AEE”): o AEE é serviço, não componente (NT PROENS nº 1/2025). Menção em texto de ementa ou bibliografia não conta.",
  verificar(ppc) {
    const fontes = [linkNorma("ifpr/proens/nt/2025/1")];
    const trechos: Trecho[] = [];
    for (const n of linhasDasSecoes(ppc, SECOES_CURRICULARES)) {
      const linha = ppc.linhas[n - 1] ?? "";
      if (!linha.trimStart().startsWith("|")) continue;
      const celula = linha
        .split("|")
        .map((c) => c.replace(/\*/g, "").trim())
        .find((c) => c.length <= 80 && /atendimento\s*educacional\s*especializado|\bAEE\b/i.test(c));
      const aee = celula && /atendimento\s*educacional\s*especializado|\bAEE\b/i.exec(linha);
      if (aee) trechos.push(trecho(ppc, n, aee[0]));
    }
    const apontamentos: Apontamento[] = trechos.length
      ? [
          {
            estado: "nao_atende",
            mensagem: `O AEE aparece como componente na matriz ou no quadro de componentes (${trechos.length} linha(s)); ele é serviço, não componente.`,
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
