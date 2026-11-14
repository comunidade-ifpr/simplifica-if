// @effect-diagnostics nodeBuiltinImport:off -- comparação síncrona do PPC da rodada com o CNCT, sobre arquivos locais
/**
 * Comparação do curso do PPC com o Catálogo Nacional de Cursos Técnicos
 * (porte de `cnct_catalogo.py`): busca por denominação, resumo do estágio no
 * CNCT e comparação de denominação, eixo, carga horária mínima e estágio.
 *
 * O score é um float do Python (`round(score, 4)`), escrito como `1.0` no
 * JSON: por isso é `FloatPy`.
 */
import * as NodePath from "node:path";
import { SequenceMatcher } from "@simplifica-if/kb/python/difflib";
import { escape, finditer, search, sub } from "@simplifica-if/kb/python/re";
import { casefold, colapsarEspacos, semMarcas } from "@simplifica-if/kb/python/texto";
import {
  ehIntPy,
  ehObjetoPy,
  FloatPy,
  inteiroDeTexto,
  numeroPy,
  obrigatorio,
  obter,
  type ObjetoPy,
  ou,
  padraoSeAusente,
  roundPy,
  strPy,
  textoOuVazioPy as textoOuVazio,
  verdadeiro,
} from "@simplifica-if/kb/python/valores";
import { aparar, compararTexto, prefixo } from "@simplifica-if/kb/texto";
import { type CaminhosAnalise, caminhosPadrao } from "./caminhos.ts";
import { caminhosRodada, escreverJsonPy, existe, lerJsonPy, sha256Arquivo } from "./rodada.ts";

const CAMPOS_COMPLETOS = [
  "eixo_tecnologico",
  "area_tecnologica",
  "denominacao",
  "perfil_profissional",
  "carga_horaria_minima",
  "carga_horaria_minima_horas",
  "descricao_carga_horaria_minima",
  "pre_requisitos_ingresso",
  "itinerarios_formativos",
  "campo_atuacao",
  "ocupacoes_cbo",
  "codigos_cbo",
  "infraestrutura_minima",
  "legislacao_profissional",
];

export function caminhosCnct(caminhos: CaminhosAnalise = caminhosPadrao()) {
  const raiz = NodePath.join(caminhos.baseConhecimentoDir, "catalogos", "cnct");
  return { raiz, manifesto: NodePath.join(raiz, "manifest.json"), indice: NodePath.join(raiz, "index.json") };
}

/** Texto sem acentos, em casefold, só com `[a-z0-9]` separados por espaço. */
export function normalizarTextoCnct(texto: unknown): string {
  return colapsarEspacos(sub("[^a-z0-9]+", " ", casefold(semMarcas(textoOuVazio(texto)))));
}

export function normalizarDenominacaoCnct(texto: unknown): string {
  return aparar(sub(String.raw`^curso\s+`, "", normalizarTextoCnct(texto)));
}

/** Primeiro número do texto (com pontos de milhar), como inteiro. */
export function extrairNumeroHoras(valor: unknown): number | null {
  const m = search(String.raw`\d[\d.]*`, textoOuVazio(valor));
  if (!m) return null;
  const digitos = sub(String.raw`\D`, "", m[0]);
  return digitos ? inteiroDeTexto(digitos) : null;
}

function textoLimpo(valor: unknown): string {
  return colapsarEspacos(textoOuVazio(valor));
}

function janelasTermo(textoNormalizado: string, termo: string, raio = 160): string[] {
  return finditer(escape(termo), textoNormalizado).map((m) =>
    textoNormalizado.slice(Math.max(0, m.index - raio), m.index + m[0].length + raio),
  );
}

/** Resumo da exigência de estágio na descrição de carga horária mínima do CNCT. */
export function resumirEstagioCnct(curso: ObjetoPy): ObjetoPy {
  const descricao = textoLimpo(obter(curso, "descricao_carga_horaria_minima"));
  const legislacao = textoLimpo(obter(curso, "legislacao_profissional"));
  const texto = normalizarTextoCnct(descricao);
  const mencionaEstagio = texto.includes("estagio");
  const contexto = janelasTermo(texto, "estagio").join(" ");
  const mencionaObrigatorio = contexto.includes("obrigatorio");
  const mencionaFaculdade = contexto.includes("podera");
  const mencionaDever = ["devera", "deve", "exige", "obrigatorio conforme"].some((termo) => contexto.includes(termo));

  let obrigatoriedade: string;
  let sintese: string;
  if (!mencionaEstagio) {
    obrigatoriedade = "NAO_MENCIONADO";
    sintese = "A descrição de carga horária mínima do CNCT não menciona estágio.";
  } else if (mencionaFaculdade && mencionaObrigatorio) {
    obrigatoriedade = "FACULTADO_A_INSTITUICAO";
    sintese = "O CNCT faculta estágio curricular supervisionado obrigatório à instituição ofertante.";
  } else if (mencionaDever && mencionaObrigatorio) {
    obrigatoriedade = "OBRIGATORIO";
    sintese = "O CNCT indica estágio curricular supervisionado obrigatório.";
  } else if (mencionaObrigatorio) {
    obrigatoriedade = "OBRIGATORIO_OU_CONDICIONADO";
    sintese = "O CNCT menciona estágio obrigatório, mas a condição precisa ser conferida no texto do catálogo.";
  } else {
    obrigatoriedade = "MENCIONA_SEM_OBRIGATORIEDADE_CLARA";
    sintese = "O CNCT menciona estágio, sem obrigatoriedade clara na descrição.";
  }
  const termosNormas = [
    "legislacoes normativas especificas",
    "legislacao especifica",
    "normativas especificas",
    "normas especificas",
  ];
  return {
    fonte_campo: "Descrição Carga Horária Mínima",
    menciona_estagio: mencionaEstagio,
    obrigatoriedade,
    sintese,
    exige_presencialidade_em_ead: mencionaEstagio && texto.includes("ead") && texto.includes("presencial"),
    menciona_normas_especificas: termosNormas.some((termo) => texto.includes(termo)) || Boolean(legislacao),
    legislacao_profissional_cnct: legislacao,
    trecho_descricao_carga_horaria: mencionaEstagio ? prefixo(descricao, 900) : "",
  };
}

function carregarCursoCompleto(itemIndice: ObjetoPy, caminhos: CaminhosAnalise): ObjetoPy {
  const curso: ObjetoPy = { ...itemIndice };
  const valorPath = textoOuVazio(obter(itemIndice, "path"));
  if (valorPath) {
    const arquivo = NodePath.isAbsolute(valorPath) ? valorPath : NodePath.join(caminhos.baseConhecimentoDir, valorPath);
    if (existe(arquivo)) {
      const payload = lerJsonPy(arquivo);
      if (ehObjetoPy(payload)) {
        Object.assign(curso, payload);
        curso.path = valorPath;
        curso.arquivo = arquivo;
      }
    }
  }
  const horas = obter(curso, "carga_horaria_minima_horas");
  padraoSeAusente(curso, "carga_horaria_minima", ehIntPy(horas) ? `${strPy(horas)} horas` : "");
  padraoSeAusente(curso, "ocupacoes_cbo", "");
  padraoSeAusente(curso, "infraestrutura_minima", "");
  padraoSeAusente(curso, "legislacao_profissional", "");
  padraoSeAusente(curso, "denominacao_normalizada", normalizarDenominacaoCnct(obter(curso, "denominacao")));
  return curso;
}

/** Cursos do índice do CNCT, completados com o arquivo de cada curso. */
export function carregarCatalogoCnct(catalogo?: string, caminhos: CaminhosAnalise = caminhosPadrao()): ObjetoPy[] {
  const payload = lerJsonPy(catalogo ?? caminhosCnct(caminhos).indice);
  const itens = ehObjetoPy(payload) ? obter(payload, "items") : [];
  if (!Array.isArray(itens)) return [];
  const cursos: ObjetoPy[] = [];
  itens.forEach((item, posicao) => {
    if (!ehObjetoPy(item)) return;
    if (!aparar(textoOuVazio(obter(item, "denominacao")))) return;
    const curso = carregarCursoCompleto(item, caminhos);
    padraoSeAusente(curso, "indice", posicao + 1);
    cursos.push(curso);
  });
  return cursos;
}

function scoreDenominacao(consulta: string, denominacao: string): number {
  if (!consulta || !denominacao) return 0;
  if (consulta === denominacao) return 1;
  const scoreSequencia = new SequenceMatcher(consulta, denominacao).ratio();
  const tokensConsulta = new Set(consulta.split(" "));
  const tokensDenominacao = new Set(denominacao.split(" "));
  const intersecao = [...tokensConsulta].filter((token) => tokensDenominacao.has(token)).length;
  let scoreTokens = (2 * intersecao) / (tokensConsulta.size + tokensDenominacao.size);
  if (consulta.includes(denominacao) || denominacao.includes(consulta)) scoreTokens = Math.max(scoreTokens, 0.9);
  return Math.max(scoreSequencia, scoreTokens);
}

function tipoCorrespondencia(score: number): string {
  if (score >= 1) return "EXATA";
  if (score >= 0.86) return "ALTA_CONFIANCA";
  if (score >= 0.72) return "POSSIVEL";
  return "BAIXA_CONFIANCA";
}

function resumirCurso(curso: ObjetoPy, score: number, completo: boolean): ObjetoPy {
  const resumo: ObjetoPy = {
    indice: obrigatorio(curso, "indice"),
    id: obter(curso, "id", ""),
    path: obter(curso, "path", ""),
    score: new FloatPy(roundPy(score, 4)),
    denominacao: obrigatorio(curso, "denominacao"),
    eixo_tecnologico: obrigatorio(curso, "eixo_tecnologico"),
    area_tecnologica: obrigatorio(curso, "area_tecnologica"),
    carga_horaria_minima: obrigatorio(curso, "carga_horaria_minima"),
    carga_horaria_minima_horas: obrigatorio(curso, "carga_horaria_minima_horas"),
    ocupacoes_cbo: obrigatorio(curso, "ocupacoes_cbo"),
    infraestrutura_minima: obrigatorio(curso, "infraestrutura_minima"),
    legislacao_profissional: obrigatorio(curso, "legislacao_profissional"),
    estagio: resumirEstagioCnct(curso),
  };
  if (completo) {
    for (const campo of CAMPOS_COMPLETOS) resumo[campo] = obter(curso, campo, "");
    if (verdadeiro(obter(curso, "arquivo"))) resumo.arquivo = curso.arquivo;
  }
  return resumo;
}

/** Cursos do CNCT com denominação parecida (score ≥ 0,55), do maior score para o menor. */
export function buscarCursosCnct(
  consulta: string,
  opcoes: { catalogo?: string; limite?: number; completo?: boolean; caminhos?: CaminhosAnalise } = {},
): ObjetoPy[] {
  const { limite = 5, completo = false } = opcoes;
  const consultaNormalizada = normalizarDenominacaoCnct(consulta);
  if (!consultaNormalizada) return [];
  const candidatos: ObjetoPy[] = [];
  for (const curso of carregarCatalogoCnct(opcoes.catalogo, opcoes.caminhos)) {
    const score = scoreDenominacao(consultaNormalizada, strPy(curso.denominacao_normalizada));
    if (score >= 0.55) candidatos.push(resumirCurso(curso, score, completo));
  }
  candidatos.sort((a, b) => numeroPy(b.score) - numeroPy(a.score) || compararPy(a.denominacao, b.denominacao));
  return candidatos.slice(0, limite);
}

/** Comparação `<` do Python para textos (por code point) e números. */
function compararPy(a: unknown, b: unknown): number {
  if (typeof a === "string" && typeof b === "string") return compararTexto(a, b);
  return numeroPy(a) - numeroPy(b);
}

function dadosExtraidos(dadosConversao: unknown): ObjetoPy {
  const dados = ehObjetoPy(dadosConversao) ? obter(dadosConversao, "dados_extraidos", {}) : {};
  return ehObjetoPy(dados) ? dados : {};
}

function primeiroValorPreenchido(...valores: unknown[]): unknown {
  for (const valor of valores) if (aparar(textoOuVazio(valor))) return valor;
  return null;
}

/** `_read_json_if_exists`. */
export function lerJsonSeExistir(valorCaminho: unknown): ObjetoPy {
  if (!verdadeiro(valorCaminho)) return {};
  const caminho = strPy(valorCaminho);
  if (!existe(caminho)) return {};
  const payload = lerJsonPy(caminho);
  return ehObjetoPy(payload) ? payload : {};
}

type Horas = { valor_horas: number | null; fonte: string | null; valor_original: unknown };

function cargaHorariaPpc(dados: ObjetoPy, matriz: ObjetoPy): Horas {
  const candidatos: Array<[string, unknown]> = [
    ["dados_extraidos.carga_horaria_total", obter(dados, "carga_horaria_total")],
    ["dados_extraidos.carga_horaria_total_curso", obter(dados, "carga_horaria_total_curso")],
    ["dados_extraidos.carga_horaria_minima", obter(dados, "carga_horaria_minima")],
    ["dados_extraidos.carga_horaria_minima_cnct", obter(dados, "carga_horaria_minima_cnct")],
  ];
  const totais = obter(matriz, "totais", {});
  if (ehObjetoPy(totais)) {
    candidatos.push(
      ["matriz_curricular.totais.ch_total_hora_relogio", obter(totais, "ch_total_hora_relogio")],
      ["matriz_curricular.totais.ch_total_hora_aula", obter(totais, "ch_total_hora_aula")],
    );
  }
  for (const [fonte, valor] of candidatos) {
    const horas = extrairNumeroHoras(valor);
    if (horas !== null) return { valor_horas: horas, fonte, valor_original: valor };
  }
  return { valor_horas: null, fonte: null, valor_original: null };
}

/** Componentes da matriz: `componentes[]` da raiz e de cada item de `anos[]` e `series[]`. */
export function componentesMatriz(matriz: ObjetoPy): ObjetoPy[] {
  const componentes: ObjetoPy[] = [];
  const raiz = obter(matriz, "componentes");
  if (Array.isArray(raiz)) componentes.push(...raiz.filter(ehObjetoPy));
  for (const chave of ["anos", "series"]) {
    const grupos = obter(matriz, chave);
    if (!Array.isArray(grupos)) continue;
    for (const grupo of grupos) {
      if (!ehObjetoPy(grupo)) continue;
      const itens = obter(grupo, "componentes");
      if (Array.isArray(itens)) componentes.push(...itens.filter(ehObjetoPy));
    }
  }
  return componentes;
}

function cargaHorariaComponente(componente: ObjetoPy): number | null {
  const horas = [
    obter(componente, "ch_hora_relogio_cnct"),
    obter(componente, "ch_hora_relogio"),
    obter(componente, "ch_hora_aula"),
    obter(componente, "carga_horaria"),
  ]
    .map(extrairNumeroHoras)
    .filter((valor): valor is number => valor !== null);
  return horas.length ? Math.max(...horas) : null;
}

function linhasEstagioMatriz(matriz: ObjetoPy): ObjetoPy[] {
  const linhas: ObjetoPy[] = [];
  for (const componente of componentesMatriz(matriz)) {
    const nome = textoLimpo(
      ou(obter(componente, "nome"), obter(componente, "componente"), obter(componente, "titulo")),
    );
    if (!normalizarTextoCnct(nome).includes("estagio")) continue;
    linhas.push({ nome, carga_horaria_efetiva: cargaHorariaComponente(componente) });
  }
  return linhas;
}

function estagioPpc(dados: ObjetoPy, matriz: ObjetoPy): ObjetoPy {
  const candidatos: Array<[string, unknown]> = [
    ["dados_extraidos.carga_horaria_estagio", obter(dados, "carga_horaria_estagio")],
    ["dados_extraidos.estagio", obter(dados, "estagio")],
  ];
  let cargaDeclarada: Horas = { valor_horas: null, fonte: null, valor_original: null };
  for (const [fonte, valor] of candidatos) {
    const horas = extrairNumeroHoras(valor);
    if (horas !== null) {
      cargaDeclarada = { valor_horas: horas, fonte, valor_original: valor };
      break;
    }
  }
  const linhas = linhasEstagioMatriz(matriz);
  const cargas = linhas
    .map((linha) => linha.carga_horaria_efetiva)
    .filter((valor): valor is number => typeof valor === "number");
  const maiorCarga = cargas.length ? Math.max(...cargas) : null;
  const indicio = [cargaDeclarada.valor_horas, maiorCarga].some((valor) => typeof valor === "number" && valor > 0);
  return {
    carga_horaria_declarada: cargaDeclarada,
    linhas_estagio_matriz: linhas,
    maior_carga_horaria_matriz: maiorCarga,
    indicio_estagio_obrigatorio_por_carga: indicio,
    observacao:
      "Carga de estágio maior que zero em dados estruturados ou matriz é tratada como indício " +
      "de estágio obrigatório; a confirmação depende da leitura do PPC completo.",
  };
}

function compararEstagioCnct(estagioCnct: ObjetoPy, estagio: ObjetoPy): ObjetoPy {
  const obrigatoriedade = textoOuVazio(obter(estagioCnct, "obrigatoriedade"));
  const temCarga = verdadeiro(obter(estagio, "indicio_estagio_obrigatorio_por_carga"));
  if (obrigatoriedade === "OBRIGATORIO") {
    return {
      status: temCarga ? "COMPATIVEL" : "DIVERGENTE",
      obrigatoriedade_cnct: obrigatoriedade,
      indicio_estagio_obrigatorio_ppc: temCarga,
      motivo: temCarga
        ? "CNCT indica estágio obrigatório e há carga de estágio no PPC estruturado."
        : "CNCT indica estágio obrigatório, mas o PPC estruturado não trouxe carga de estágio.",
    };
  }
  if (obrigatoriedade === "FACULTADO_A_INSTITUICAO") {
    return {
      status: "COMPATIVEL",
      obrigatoriedade_cnct: obrigatoriedade,
      indicio_estagio_obrigatorio_ppc: temCarga,
      exige_justificativa_no_ppc_se_obrigatorio: temCarga,
      motivo:
        "CNCT faculta a decisão à instituição; se houver estágio obrigatório, o PPC deve justificar e organizar a oferta.",
    };
  }
  return {
    status: temCarga ? "INCONCLUSIVO" : "NAO_APLICAVEL",
    obrigatoriedade_cnct: obrigatoriedade,
    indicio_estagio_obrigatorio_ppc: temCarga,
    motivo: "O texto estruturado do CNCT não permite uma comparação automática conclusiva sobre estágio.",
  };
}

/** `comparar_ppc_com_cnct`. */
export function compararPpcComCnct(
  metadata: ObjetoPy,
  dadosConversao: unknown,
  matriz: ObjetoPy,
  opcoes: { catalogo?: string; caminhos?: CaminhosAnalise } = {},
): ObjetoPy {
  const caminhos = opcoes.caminhos ?? caminhosPadrao();
  const cnct = caminhosCnct(caminhos);
  const catalogo = opcoes.catalogo ?? cnct.indice;
  const dados = dadosExtraidos(dadosConversao);
  const cursoDeclarado = primeiroValorPreenchido(
    obter(dados, "curso_cnct"),
    obter(metadata, "curso"),
    obter(dados, "nome_curso"),
  );
  const eixoDeclarado = primeiroValorPreenchido(obter(dados, "eixo_tecnologico"), obter(metadata, "eixo_tecnologico"));
  const cargaPpc = cargaHorariaPpc(dados, matriz);
  const estagio = estagioPpc(dados, matriz);

  if (!existe(catalogo)) {
    return {
      disponivel: false,
      fonte_catalogo: catalogo,
      fonte_manifesto: cnct.manifesto,
      motivo: "Catálogo CNCT não encontrado.",
      curso_declarado: cursoDeclarado,
      eixo_declarado: eixoDeclarado,
      carga_horaria_ppc: cargaPpc,
      estagio_ppc: estagio,
      candidatos: [],
      correspondencia: null,
      comparacoes: {},
    };
  }

  const consulta = textoOuVazio(cursoDeclarado);
  const candidatos = buscarCursosCnct(consulta, { catalogo, caminhos });
  const completos = buscarCursosCnct(consulta, { catalogo, caminhos, limite: 5, completo: true });
  const correspondencia = candidatos[0] && numeroPy(candidatos[0].score) >= 0.72 ? candidatos[0] : null;
  const completa = completos[0] && numeroPy(completos[0].score) >= 0.72 ? completos[0] : null;
  const comparacoes: ObjetoPy = {};
  if (correspondencia) {
    const tipo = tipoCorrespondencia(numeroPy(correspondencia.score));
    comparacoes.denominacao = {
      status: tipo === "EXATA" || tipo === "ALTA_CONFIANCA" ? "COMPATIVEL" : "INCONCLUSIVO",
      tipo_correspondencia: tipo,
      valor_ppc: cursoDeclarado,
      valor_cnct: correspondencia.denominacao,
      score: correspondencia.score,
    };
    const eixoCnct = obter(correspondencia, "eixo_tecnologico");
    if (verdadeiro(eixoDeclarado)) {
      comparacoes.eixo_tecnologico = {
        status: normalizarTextoCnct(eixoDeclarado) === normalizarTextoCnct(eixoCnct) ? "COMPATIVEL" : "DIVERGENTE",
        valor_ppc: eixoDeclarado,
        valor_cnct: eixoCnct,
      };
    }
    const cargaMinima = obter(correspondencia, "carga_horaria_minima_horas");
    if (cargaMinima !== null && cargaPpc.valor_horas !== null) {
      comparacoes.carga_horaria_minima = {
        status: cargaPpc.valor_horas >= numeroPy(cargaMinima) ? "COMPATIVEL" : "DIVERGENTE",
        valor_ppc_horas: cargaPpc.valor_horas,
        valor_cnct_minimo_horas: cargaMinima,
        fonte_ppc: cargaPpc.fonte,
      };
    }
    const estagioCnct = obter(correspondencia, "estagio");
    if (ehObjetoPy(estagioCnct)) comparacoes.estagio_cnct = compararEstagioCnct(estagioCnct, estagio);
  }

  return {
    disponivel: true,
    fonte_catalogo: catalogo,
    fonte_manifesto: cnct.manifesto,
    catalogo_sha256: sha256Arquivo(catalogo),
    manifesto_sha256: existe(cnct.manifesto) ? sha256Arquivo(cnct.manifesto) : "",
    curso_declarado: cursoDeclarado,
    eixo_declarado: eixoDeclarado,
    carga_horaria_ppc: cargaPpc,
    estagio_ppc: estagio,
    candidatos,
    correspondencia: completa
      ? { ...completa, tipo_correspondencia: tipoCorrespondencia(numeroPy(completa.score)) }
      : null,
    comparacoes,
  };
}

/** `gerar_contexto_cnct_rodada`: grava `cnct-contexto.json` na rodada. */
export function gerarContextoCnctRodada(
  rodada: string,
  opcoes: { catalogo?: string; caminhos?: CaminhosAnalise } = {},
): ObjetoPy {
  const caminhos = caminhosRodada(rodada);
  const metadata = existe(caminhos.metadata) ? (lerJsonPy(caminhos.metadata) as ObjetoPy) : {};
  const preparacao = existe(caminhos.preparacaoDocx) ? (lerJsonPy(caminhos.preparacaoDocx) as ObjetoPy) : {};
  const dadosConversao = lerJsonSeExistir(obter(preparacao, "dados"));
  const matriz = lerJsonSeExistir(obter(preparacao, "matriz_curricular"));
  const contexto = compararPpcComCnct(metadata, dadosConversao, matriz, opcoes);
  escreverJsonPy(caminhos.cnctContexto, contexto);
  return contexto;
}
