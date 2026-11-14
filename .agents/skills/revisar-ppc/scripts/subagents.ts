/**
 * Grupos de fichas, contextos e pacotes de prompt para os sub-agentes e grupo
 * avulso de reavaliação (a mescla da reavaliação fica em `resultados.ts`).
 *
 * Os grupos são por tópico (`topicos_tematicos` das fichas, `agruparPorTopico` do kb): cada ficha
 * entra uma vez, no grupo do seu tópico principal, e o grupo recebe só as seções do `PPC.md` dos
 * tópicos das suas fichas, mais o texto das normas que elas citam, os marcos e as regras de
 * transição, montados pelo `pacote-contexto` do kb (`pacoteContextoAvulso`). O `PPC.md` da rodada
 * é segmentado com a mesma segmentação e taxonomia do índice de seções (`bancoDoPpcAvulso`), porque
 * o PPC analisado pode não estar na base. As fichas transversais vão num grupo com o PPC inteiro.
 */
import type { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { abrirBanco } from "@simplifica-if/kb/db/banco";
import { bancoDoPpcAvulso } from "@simplifica-if/kb/db/compilar";
import {
  agruparPorTopico,
  type FichaPacote,
  nomesDeCampiDoBanco,
  type PacoteAvulso,
  pacoteContextoAvulso,
  TOPICO_TRANSVERSAL,
  type TopicoFichas,
  topicoPrincipal,
} from "@simplifica-if/kb/db/pacote-contexto";
import { lerSinonimos } from "@simplifica-if/kb/busca/sinonimos";
import { palavrasDeCampi, textoDaSecao } from "@simplifica-if/kb/ppcs/secoes";
import { copiarProfundoPy, dumpsPy } from "@simplifica-if/kb/python/json";
import { casefold, somenteDigitos } from "@simplifica-if/kb/python/texto";
import {
  ehIntPy,
  ehFloatPy,
  ehObjetoPy,
  inteiroDeTexto,
  iterarPy,
  numeroPy,
  obrigatorio,
  obter,
  type ObjetoPy,
  ou,
  strPy,
  textoOuVazioPy,
  verdadeiro,
} from "@simplifica-if/kb/python/valores";
import type { UniversoReferencias } from "@simplifica-if/kb/normas/referencia-estruturada";
import { aparar, compararTexto } from "@simplifica-if/kb/texto";
import { listarArquivos } from "./arquivos.ts";
import { type CaminhosAnalise, caminhosPadrao } from "./caminhos.ts";
import { componentesMatriz, gerarContextoCnctRodada, lerJsonSeExistir } from "./cnct-catalogo.ts";
import { marcoLegivel, referenciasLegiveisDaFicha, universoOuVazio } from "./referencias-fichas.ts";
import { carregarMarcos } from "./validacao-base.ts";
import {
  caminhosRodada,
  carregarFichas,
  escreverJsonPy,
  escreverTextoPy,
  existe,
  lerJsonPy,
  lerTexto,
  ordenarPorId,
  resolverCaminho,
  sha256JsonPayload,
  TAMANHO_GRUPO_PADRAO,
} from "./rodada.ts";

const FICHA_REPRESENTACAO_GRAFICA = "CT-CURR-10";
export const STATUS_FUNDAMENTACAO_NORMATIVA = [
  "CONFIRMADA",
  "CONFIRMADA_COM_RESSALVA",
  "IMPRECISA",
  "SEM_SUPORTE_NA_FONTE",
  "CONTRADITORIA",
  "FONTE_AUSENTE_OU_NAO_CONSULTADA",
  "NAO_NORMATIVA",
];
const CAMPOS_TEXTO_FICHA = ["titulo", "pergunta", "rubrica", "boa_evidencia", "ma_evidencia", "escalonar_quando"];

export type OpcoesSkill = { caminhos?: CaminhosAnalise; fichasDir?: string; validacoesDir?: string };

/** Fichas ordenadas por `id` (code point). */
export function carregarFichasOrdenadas(fichasDir?: string): ObjetoPy[] {
  return ordenarPorId(carregarFichas(fichasDir ?? caminhosPadrao().fichasDir));
}

/** Validações cruzadas ordenadas por `id`, cada uma com o caminho do arquivo em `arquivo`. */
export function carregarValidacoesCruzadasOrdenadas(validacoesDir?: string): ObjetoPy[] {
  const diretorio = validacoesDir ?? caminhosPadrao().validacoesCruzadasDir;
  const validacoes: ObjetoPy[] = [];
  for (const arquivo of listarArquivos(diretorio, ".json")) {
    const payload = lerJsonPy(arquivo);
    if (ehObjetoPy(payload)) validacoes.push({ ...payload, arquivo });
  }
  return ordenarPorId(validacoes);
}

export type Grupo = ObjetoPy & { grupo_id: string; fichas: ObjetoPy[] };

/** Tópicos de `topicos-fichas.json`, na ordem da taxonomia. */
export function carregarTopicosFichas(caminho = caminhosPadrao().topicosFichasPath): TopicoFichas[] {
  const payload = lerJsonPy(caminho);
  const topicos = ehObjetoPy(payload) ? obter(payload, "topicos") : [];
  return (Array.isArray(topicos) ? topicos : []).filter(ehObjetoPy).map((topico) => ({
    ...topico,
    id: strPy(obter(topico, "id")),
    fichas: iterarPy(obter(topico, "fichas", [])).map(strPy),
  })) as TopicoFichas[];
}

function comoFichaPacote(ficha: ObjetoPy): FichaPacote {
  return ficha as FichaPacote;
}

/**
 * Grupos por tópico (`grupo-001`, `grupo-002`…), na ordem de `topicos-fichas.json` e com o grupo
 * `transversal` por último: cada ficha entra uma vez, no grupo do tópico principal
 * (`topicoPrincipal`); tópicos com mais de `tamanhoGrupo` fichas viram partes equilibradas.
 */
export function agruparFichasPorTopico(
  fichas: ObjetoPy[],
  topicos: readonly TopicoFichas[],
  tamanhoGrupo = TAMANHO_GRUPO_PADRAO,
): Grupo[] {
  return agruparPorTopico(fichas.map(comoFichaPacote), topicos, tamanhoGrupo).map((grupo, indice) => ({
    grupo_id: `grupo-${String(indice + 1).padStart(3, "0")}`,
    topico: grupo.topico,
    topico_titulo: grupo.topico_titulo,
    parte: grupo.parte,
    partes: grupo.partes,
    escopo_ppc: grupo.escopo,
    total_fichas: grupo.fichas.length,
    fichas: grupo.fichas as ObjetoPy[],
  }));
}

function textoDaFicha(ficha: ObjetoPy): string {
  const texto = CAMPOS_TEXTO_FICHA.map((campo) => strPy(obter(ficha, campo, ""))).join(" ");
  return `${texto} ${iterarPy(obter(ficha, "consultas", []))
    .map(strPy)
    .join(" ")}`;
}

/** A ficha depende do contexto do CNCT (menciona "cnct"). */
export function fichaRequerContextoCnct(ficha: ObjetoPy): boolean {
  const texto = casefold(textoDaFicha(ficha));
  return texto.includes("cnct") || texto.includes("contexto_estrutural.cnct");
}

const TERMOS_NORMATIVOS = [
  "norma",
  "normativa",
  "legal",
  "lei ",
  "resolução",
  "resolucao",
  "portaria",
  "nota técnica",
  "nota tecnica",
  "regulamento",
  "cnct",
  "art.",
  "inciso",
  "parágrafo",
  "paragrafo",
];

/** A ficha tem referências normativas ou fala de norma, lei, resolução etc. */
export function fichaRequerFundamentacaoNormativa(ficha: ObjetoPy): boolean {
  const referencias = obter(ficha, "referencias_normativas");
  if (Array.isArray(referencias) && referencias.length > 0) return true;
  const texto = casefold(textoDaFicha(ficha));
  return TERMOS_NORMATIVOS.some((termo) => texto.includes(termo));
}

/**
 * Ficha como vai para os sub-agentes: `referencias_normativas` em texto legível, uma citação por
 * norma, com o papel, o ID e o arquivo na base (`path`, relativo a `base-conhecimento/`).
 */
export function fichaParaSubagente(ficha: ObjetoPy, universo: UniversoReferencias): ObjetoPy {
  if (!Object.hasOwn(ficha, "referencias_normativas")) return ficha;
  const referencias = referenciasLegiveisDaFicha(ficha, universo).map(({ texto, papel, ref, path: caminho }) =>
    caminho === undefined ? { texto, papel, ref } : { texto, papel, ref, path: caminho },
  );
  return { ...ficha, referencias_normativas: referencias };
}

/**
 * Marcos normativos (`marcos` de `marcos-normativos.json`, com vigente, substituídas, antecessoras e
 * dispositivos revogados derivados de `base-conhecimento/relacoes.yaml`), ou lista vazia. Com
 * `universo`, as normas vêm por extenso ("Resolução CNE/CP nº 2/2026") em vez do ID.
 */
export function carregarMarcosNormativos(
  caminho = caminhosPadrao().marcosNormativosPath,
  universo?: UniversoReferencias,
): unknown[] {
  if (!existe(caminho)) return [];
  const marcos = carregarMarcos(caminho);
  return universo === undefined ? marcos : marcos.map((marco) => marcoLegivel(marco, universo));
}

/** Contexto do protocolo `verificar-fundamentacao-normativa` para os sub-agentes. */
export function contextoFundamentacaoNormativa(caminhos: CaminhosAnalise = caminhosPadrao()): ObjetoPy {
  const base = caminhos.baseConhecimentoDir;
  const skill = path.join(path.dirname(caminhos.appDir), "verificar-fundamentacao-normativa");
  const seExiste = (caminho: string) => (existe(caminho) ? caminho : null);
  return {
    protocolo: "verificar-fundamentacao-normativa",
    skill_path: seExiste(skill),
    skill_instrucoes: seExiste(path.join(skill, "SKILL.md")),
    skill_relatorio: seExiste(path.join(skill, "references", "relatorio.md")),
    base_path: seExiste(base),
    manifestos: {
      normas: seExiste(path.join(base, "manifest.json")),
      institucional: seExiste(path.join(base, "institucional_manifest.json")),
      catalogos: seExiste(path.join(base, "catalogos_manifest.json")),
      cnct: seExiste(path.join(base, "catalogos", "cnct", "manifest.json")),
    },
    status_permitidos: STATUS_FUNDAMENTACAO_NORMATIVA,
    marcos_normativos: carregarMarcosNormativos(caminhos.marcosNormativosPath, universoOuVazio(caminhos)),
    observacao:
      "Use este contexto quando o PPC citar norma ou fizer afirmação com força normativa. " +
      "Os campos path dentro dos manifestos são relativos a base-conhecimento/. " +
      "Em marcos_normativos estão a norma vigente de cada tema, as normas substituídas e as regras de " +
      "transição; consulte-os antes de julgar a vigência de uma citação do PPC.",
  };
}

/** Grava `validacoes-cruzadas-contexto.json` na rodada. */
export function contextoValidacoesCruzadas(rodada: string, opcoes: OpcoesSkill = {}): ObjetoPy {
  const skill = opcoes.caminhos ?? caminhosPadrao();
  const caminhos = caminhosRodada(rodada);
  const diretorio = opcoes.validacoesDir ?? skill.validacoesCruzadasDir;
  const validacoes = carregarValidacoesCruzadasOrdenadas(diretorio);
  const contexto = {
    total: validacoes.length,
    fonte: resolverCaminho(diretorio),
    prompt: path.join(skill.promptsDir, "sintese-transversal.md"),
    uso:
      "Executar depois da coleta das fichas. Avaliar cada validação cruzada aplicável e, " +
      "quando houver problema transversal, registrar alerta com validacao_id.",
    validacoes,
  };
  escreverJsonPy(caminhos.validacoesCruzadasContexto, contexto);
  return contexto;
}

function preparacaoDocx(preparacao: string): ObjetoPy {
  if (!existe(preparacao)) return {};
  const payload = lerJsonPy(preparacao);
  return ehObjetoPy(payload) ? payload : {};
}

function resolverCaminhoArtefato(valor: unknown): string | null {
  if (!verdadeiro(valor)) return null;
  const caminho = strPy(valor);
  return existe(caminho) ? resolverCaminho(caminho) : null;
}

/** `_valor_inteiro`: inteiro de número inteiro, float inteiro ou dos dígitos de um texto. */
function valorInteiro(valor: unknown): number | null {
  if (typeof valor === "boolean") return null;
  if (ehIntPy(valor)) return numeroPy(valor);
  if (ehFloatPy(valor)) {
    const numero = numeroPy(valor);
    return Number.isInteger(numero) ? numero : null;
  }
  if (typeof valor === "string") {
    const digitos = somenteDigitos(valor);
    if (!digitos) return null;
    const inteiro = inteiroDeTexto(digitos);
    if (inteiro === null) throw new Error(`ValueError: invalid literal for int() with base 10: '${digitos}'`);
    return inteiro;
  }
  return null;
}

function cargaHorariaEfetiva(componente: ObjetoPy): number | null {
  const numericos = ["ch_hora_relogio_cnct", "ch_hora_relogio", "ch_hora_aula", "carga_horaria"]
    .map((campo) => valorInteiro(obter(componente, campo)))
    .filter((valor): valor is number => valor !== null);
  return numericos.length ? Math.max(...numericos) : null;
}

function linhaModeloMatriz(componentes: ObjetoPy[], termos: string[]): ObjetoPy {
  const encontrados: Array<{
    nome: string;
    carga_horaria_efetiva: number | null;
    linha_modelo_sem_obrigatoriedade: boolean;
  }> = [];
  for (const componente of componentes) {
    const nome = textoOuVazioPy(
      ou(obter(componente, "nome"), obter(componente, "componente"), obter(componente, "titulo")),
    );
    const normalizado = casefold(nome);
    if (!nome || !termos.some((termo) => normalizado.includes(termo))) continue;
    const carga = cargaHorariaEfetiva(componente);
    encontrados.push({ nome, carga_horaria_efetiva: carga, linha_modelo_sem_obrigatoriedade: carga === 0 });
  }
  if (!encontrados.length) {
    return { linha_presente_na_matriz: false, interpretacao: "nao_identificada_no_artefato_estruturado" };
  }
  const todasZero = encontrados.every((item) => item.carga_horaria_efetiva === 0);
  return {
    linha_presente_na_matriz: true,
    linhas: encontrados,
    interpretacao: todasZero ? "linha_modelo_sem_obrigatoriedade" : "carga_horaria_informada_requer_conferencia",
  };
}

function resumoMatriz(matriz: ObjetoPy): ObjetoPy {
  const componentes = componentesMatriz(matriz);
  const series = Array.isArray(obter(matriz, "series")) ? obter(matriz, "series") : obter(matriz, "anos");
  return {
    totais: obter(matriz, "totais", {}),
    componentes_total: componentes.length ? componentes.length : null,
    series_total: Array.isArray(series) ? series.length : null,
    convencoes_linhas_modelo: {
      observacao:
        "Linhas de Atividades Complementares ou Estágio Supervisionado com carga horária efetiva zero " +
        "podem ser linhas-padrão do modelo e não indicam obrigatoriedade por si só.",
      atividades_complementares: linhaModeloMatriz(componentes, [
        "atividade complementar",
        "atividades complementares",
      ]),
      estagio_supervisionado: linhaModeloMatriz(componentes, ["estágio supervisionado", "estagio supervisionado"]),
    },
  };
}

function resumoEmentario(ementario: ObjetoPy): ObjetoPy {
  let componentes = obter(ementario, "componentes");
  if (!Array.isArray(componentes)) {
    const ementas = obter(ementario, "ementas");
    componentes = Array.isArray(ementas) ? ementas : [];
  }
  const lista = componentes as unknown[];
  const nomes: string[] = [];
  for (const componente of lista.slice(0, 30)) {
    if (!ehObjetoPy(componente)) continue;
    const nome = ou(obter(componente, "nome"), obter(componente, "componente"), obter(componente, "titulo"));
    if (verdadeiro(nome)) nomes.push(strPy(nome));
  }
  return { componentes_total: lista.length, amostra_componentes: nomes };
}

/** Grava `contexto-estrutural-subagents.json` com o resumo dos artefatos da conversão DOCX. */
export function gerarContextoEstruturalSubagents(rodada: string): ObjetoPy {
  const caminhos = caminhosRodada(rodada);
  const preparacao = preparacaoDocx(caminhos.preparacaoDocx);
  const dados = lerJsonSeExistir(obter(preparacao, "dados"));
  const matriz = lerJsonSeExistir(obter(preparacao, "matriz_curricular"));
  const ementario = lerJsonSeExistir(obter(preparacao, "ementario"));
  const contexto = {
    artefatos: {
      dados: resolverCaminhoArtefato(obter(preparacao, "dados")),
      matriz_curricular: resolverCaminhoArtefato(obter(preparacao, "matriz_curricular")),
      ementario: resolverCaminhoArtefato(obter(preparacao, "ementario")),
      markdown_bruto: resolverCaminhoArtefato(obter(preparacao, "markdown_bruto")),
    },
    identificacao_extraida: obter(dados, "dados_extraidos", dados),
    matriz_curricular: resumoMatriz(matriz),
    ementario: resumoEmentario(ementario),
  };
  escreverJsonPy(caminhos.contextoEstruturalSubagents, contexto);
  return contexto;
}

type AnexoVisual = { ficha_id: string; tipo: string; descricao: string; arquivo: string };

function anexosVisuais(rodada: string): AnexoVisual[] {
  const caminhos = caminhosRodada(rodada);
  const preparacao = preparacaoDocx(caminhos.preparacaoDocx);
  const dados = lerJsonSeExistir(obter(preparacao, "dados"));
  const representacao = obter(dados, "representacao_grafica");
  if (!ehObjetoPy(representacao) || !verdadeiro(obter(representacao, "extraida"))) return [];
  const caminho = obter(representacao, "caminho");
  if (!verdadeiro(caminho)) return [];
  let imagem = strPy(caminho);
  if (!path.isAbsolute(imagem)) {
    const base = path.dirname(resolverCaminho(textoOuVazioPy(obter(preparacao, "dados")) || "."));
    imagem = path.join(base, imagem);
  }
  if (!existe(imagem)) return [];
  return [
    {
      ficha_id: FICHA_REPRESENTACAO_GRAFICA,
      tipo: "imagem",
      descricao: "Representação gráfica do processo formativo extraída do PPC.",
      arquivo: resolverCaminho(imagem),
    },
  ];
}

type Contextos = {
  cnct: ObjetoPy;
  estrutura: ObjetoPy;
  anexos: AnexoVisual[];
  fundamentacao: ObjetoPy;
  /** Marcos com as normas por extenso, por ID. */
  marcosLegiveis: Map<string, ObjetoPy>;
};

/** Taxonomia de seções usada no `PPC.md` da rodada: a skill analisa cursos técnicos. */
export const TAXONOMIA_RODADA = "tecnico";
const PPC_ID_RODADA = "ppc:rodada";
/** Tópico cujas fichas recebem a lista de todas as citações normativas do PPC (`citacoes_do_ppc`). */
const TOPICO_CITACOES_PPC = "referencias_normativas";

/**
 * Contexto do kb para uma rodada: o `kb.sqlite` (recompilado sozinho quando velho) e o banco em
 * memória com o `PPC.md` da rodada segmentado pela taxonomia do índice de seções.
 */
export type ContextoKbRodada = {
  db: Database;
  dbPpc: Database;
  /** Linhas e total de caracteres do `PPC.md`. */
  markdown: string;
  pacote(fichas: ObjetoPy[], escopo: "secoes" | "completo", citacoesPpc: boolean): PacoteAvulso;
  fechar(): void;
};

export function abrirContextoKbRodada(rodada: string, skill: CaminhosAnalise = caminhosPadrao()): ContextoKbRodada {
  const caminhos = caminhosRodada(rodada);
  const raiz = path.dirname(skill.baseConhecimentoDir);
  const db = abrirBanco({ raiz });
  const markdown = lerTexto(caminhos.ppc);
  const lexico = lerSinonimos();
  const dbPpc = bancoDoPpcAvulso(markdown, {
    ppcId: PPC_ID_RODADA,
    path: caminhos.ppc,
    taxonomia: TAXONOMIA_RODADA,
    palavrasCampi: palavrasDeCampi(nomesDeCampiDoBanco(db)),
    raiz,
    sinonimos: lexico,
    todasAsSecoes: true,
    titulosNivel1: true,
  });
  return {
    db,
    dbPpc,
    markdown,
    pacote: (fichas, escopo, citacoesPpc) =>
      pacoteContextoAvulso(db, dbPpc, fichas.map(comoFichaPacote), {
        ppcId: PPC_ID_RODADA,
        escopo,
        citacoesPpc,
        lexico,
      }),
    fechar: () => {
      dbPpc.close();
      db.close();
    },
  };
}

/** Tópicos temáticos das fichas, sem repetição, em ordem. */
function topicosDasFichas(fichas: ObjetoPy[]): string[] {
  return [...new Set(fichas.flatMap((ficha) => iterarPy(obter(ficha, "topicos_tematicos", [])).map(strPy)))].sort(
    compararTexto,
  );
}

/** `contextos.ppc`: o escopo do PPC no grupo e as seções selecionadas (sem o texto, que vai no pacote). */
function contextoPpcDoGrupo(pacote: PacoteAvulso, fichas: ObjetoPy[], kb: ContextoKbRodada, ppc: string): ObjetoPy {
  const secoes = pacote.secoes.map((secao) => ({
    id: secao.id.slice(secao.id.indexOf("#") + 1),
    tipo: secao.tipo,
    titulo: secao.titulo,
    linha_inicio: secao.linha_inicio,
    linha_fim: secao.linha_fim,
    caracteres: secao.texto.length,
    motivo: secao.motivo,
  }));
  return {
    escopo: pacote.escopo,
    ppc_markdown: ppc,
    taxonomia: TAXONOMIA_RODADA,
    topicos: topicosDasFichas(fichas),
    total_secoes: secoes.length,
    caracteres_secoes: secoes.reduce((total, secao) => total + secao.caracteres, 0),
    caracteres_ppc: kb.markdown.length,
    secoes,
  };
}

/**
 * `contextos.fundamentacao_normativa` do grupo: o protocolo e os manifestos, os marcos normativos
 * (por extenso, com as citações do PPC às normas de cada um), o texto dos dispositivos citados pelas
 * fichas (com caput) e as regras de transição aplicáveis.
 */
function fundamentacaoDoGrupo(contextos: Contextos, pacote: PacoteAvulso): ObjetoPy {
  const { marcos_normativos: _todos, observacao: _observacao, ...base } = contextos.fundamentacao;
  // Todos os marcos (são poucos e as fichas remetem a eles); as citações do PPC vêm do pacote do kb.
  const citacoes = new Map(pacote.marcos.map((marco) => [marco.marco, marco.citacoes_no_ppc]));
  const marcos = [...contextos.marcosLegiveis].map(([id, marco]) => ({
    ...marco,
    citacoes_no_ppc: citacoes.get(id) ?? [],
  }));
  return {
    ...base,
    marcos_normativos: marcos,
    data_referencia: pacote.data_referencia,
    normas: pacote.normas,
    transicoes: pacote.transicoes,
    ...(pacote.citacoes_ppc ? { citacoes_do_ppc: pacote.citacoes_ppc } : {}),
    observacao:
      "Use este contexto quando o PPC citar norma ou fizer afirmação com força normativa. " +
      "Em normas está o texto dos dispositivos citados pelas fichas do grupo (com o caput e os subordinados); " +
      "em transicoes, as regras de transição das normas das fichas e das citadas pelo PPC, com a situação em " +
      "data_referencia; em marcos_normativos, a norma vigente de cada tema, as substituídas e " +
      "as citações do PPC a elas (linhas do PPC.md); em citacoes_do_ppc, quando presente, todas as citações " +
      "normativas que o resolvedor do kb identificou no PPC.md, com linha, tipo de seção e papel. " +
      "Consulte-os antes de julgar a vigência de uma citação do PPC. " +
      "Os campos path dos manifestos são relativos a base-conhecimento/; os path das normas e transições, à raiz do repositório.",
  };
}

function adicionarContextosGrupo(grupo: Grupo, contextos: Contextos, kb: ContextoKbRodada, ppc: string): void {
  const escopo = obter(grupo, "escopo_ppc") === "completo" ? "completo" : "secoes";
  // As fichas de referencias_normativas conferem a base normativa citada em qualquer ponto do PPC.
  const pacote = kb.pacote(grupo.fichas, escopo, topicosDasFichas(grupo.fichas).includes(TOPICO_CITACOES_PPC));
  const saida: ObjetoPy = { ppc: contextoPpcDoGrupo(pacote, grupo.fichas, kb, ppc) };
  const requerCnct = grupo.fichas.some(fichaRequerContextoCnct);
  grupo.requer_contexto_cnct = requerCnct;
  if (requerCnct) saida.cnct = contextos.cnct;
  const requerFundamentacao = grupo.fichas.some(fichaRequerFundamentacaoNormativa);
  grupo.requer_fundamentacao_normativa = requerFundamentacao;
  if (requerFundamentacao) saida.fundamentacao_normativa = fundamentacaoDoGrupo(contextos, pacote);
  grupo.requer_contexto_estrutural = true;
  saida.estrutura = contextos.estrutura;
  const anexosGrupo = contextos.anexos.filter((anexo) =>
    grupo.fichas.some((ficha) => obter(ficha, "id") === anexo.ficha_id),
  );
  grupo.requer_anexos_visuais = anexosGrupo.length > 0;
  if (anexosGrupo.length) saida.anexos_visuais = anexosGrupo;
  grupo.contextos = saida;
}

function contextosDaRodada(rodada: string, skill: CaminhosAnalise): Contextos {
  const universo = universoOuVazio(skill);
  return {
    cnct: gerarContextoCnctRodada(rodada, { caminhos: skill }),
    estrutura: gerarContextoEstruturalSubagents(rodada),
    anexos: anexosVisuais(rodada),
    fundamentacao: contextoFundamentacaoNormativa(skill),
    marcosLegiveis: new Map(
      carregarMarcosNormativos(skill.marcosNormativosPath, universo)
        .filter(ehObjetoPy)
        .map((marco) => [strPy(obter(marco, "id")), marco]),
    ),
  };
}

/** Ficha da forma como vai para o sub-agente (referências legíveis), a partir da ficha da base. */
function fichasParaSubagente(fichas: ObjetoPy[], universo: UniversoReferencias): ObjetoPy[] {
  return fichas.map((ficha) => fichaParaSubagente(copiarProfundoPy(ficha), universo));
}

function promptTemplate(skill: CaminhosAnalise): string {
  return path.join(skill.appDir, "prompts", "subagent-lote-fichas.md");
}

/** Regra de agrupamento registrada no payload (para quem lê `grupos-subagents.json`). */
export const REGRA_AGRUPAMENTO =
  "Um grupo por tópico de topicos-fichas.json, na ordem da taxonomia. Cada ficha entra uma vez, no " +
  "tópico principal: o mais específico (menos fichas na taxonomia) dos seus topicos_tematicos; no " +
  "empate, o primeiro na taxonomia. Fichas com tipo_escopo transversal vão no grupo transversal, por " +
  "último, com o PPC completo. Tópico com mais fichas que o tamanho máximo vira partes equilibradas. " +
  "O grupo recebe as seções do PPC.md de todos os tópicos das suas fichas (packages/kb/dados/topicos-secoes.yaml) " +
  "e as que a busca pelas consultas das fichas achar.";

/** `montar_grupos_subagents`: grupos por tópico com contextos, gravados em `grupos-subagents.json`. */
export function montarGruposSubagents(
  rodada: string,
  tamanhoGrupo = TAMANHO_GRUPO_PADRAO,
  opcoes: OpcoesSkill = {},
): ObjetoPy {
  const skill = opcoes.caminhos ?? caminhosPadrao();
  const caminhos = caminhosRodada(rodada);
  if (!existe(caminhos.ppc)) throw new Error(`PPC.md não encontrado: ${caminhos.ppc}`);
  const metadata = existe(caminhos.metadata) ? (lerJsonPy(caminhos.metadata) as ObjetoPy) : {};
  const universo = universoOuVazio(skill);
  const fichas = carregarFichasOrdenadas(opcoes.fichasDir ?? skill.fichasDir);
  const topicos = carregarTopicosFichas(skill.topicosFichasPath);
  const grupos = agruparFichasPorTopico(fichas, topicos, tamanhoGrupo);
  const contextos = contextosDaRodada(rodada, skill);
  const validacoes = contextoValidacoesCruzadas(rodada, opcoes);
  const kb = abrirContextoKbRodada(rodada, skill);
  try {
    for (const grupo of grupos) {
      adicionarContextosGrupo(grupo, contextos, kb, caminhos.ppc);
      grupo.fichas = fichasParaSubagente(grupo.fichas, universo);
    }
  } finally {
    kb.fechar();
  }
  const payload = {
    rodada_dir: caminhos.rodadaDir,
    ppc_markdown: caminhos.ppc,
    grupos_subagents_path: caminhos.gruposSubagents,
    prompt_template: promptTemplate(skill),
    sintese_transversal_template: path.join(skill.appDir, "prompts", "sintese-transversal.md"),
    cnct_contexto_path: caminhos.cnctContexto,
    cnct_contexto: contextos.cnct,
    contexto_estrutural_path: caminhos.contextoEstruturalSubagents,
    contexto_estrutural: contextos.estrutura,
    validacoes_cruzadas_path: caminhos.validacoesCruzadasContexto,
    validacoes_cruzadas: validacoes,
    fundamentacao_normativa: contextos.fundamentacao,
    anexos_visuais: contextos.anexos,
    curso: obter(metadata, "curso", ""),
    total_fichas: fichas.length,
    tamanho_grupo: tamanhoGrupo,
    agrupamento: { criterio: "topico", tamanho_maximo: tamanhoGrupo, regra: REGRA_AGRUPAMENTO },
    grupos,
  };
  escreverJsonPy(caminhos.gruposSubagents, payload);
  return payload;
}

/** `montar_grupo_avulso`: grupo só com as fichas pedidas, gravado em `grupos-avulsos/`, com o pacote de prompt. */
export function montarGrupoAvulso(rodada: string, fichaIds: string[], opcoes: OpcoesSkill = {}): ObjetoPy {
  if (!fichaIds.length) throw new Error("Informe ao menos uma ficha para montar o grupo avulso.");
  const skill = opcoes.caminhos ?? caminhosPadrao();
  const caminhos = caminhosRodada(rodada);
  const fichasPorId = new Map<unknown, ObjetoPy>();
  for (const ficha of carregarFichasOrdenadas(opcoes.fichasDir ?? skill.fichasDir)) {
    fichasPorId.set(obrigatorio(ficha, "id"), ficha);
  }
  const faltantes = fichaIds.filter((fichaId) => !fichasPorId.has(fichaId));
  if (faltantes.length) throw new Error(`Fichas não encontradas: ${faltantes.join(", ")}`);
  const universo = universoOuVazio(skill);
  const selecionadas = fichaIds.map((fichaId) => fichasPorId.get(fichaId)!);
  const topicos = carregarTopicosFichas(skill.topicosFichasPath);
  const transversal = selecionadas.some(
    (ficha) => topicoPrincipal(comoFichaPacote(ficha), topicos) === TOPICO_TRANSVERSAL,
  );
  const grupo: Grupo = {
    grupo_id: `avulso-${sha256JsonPayload({ ficha_ids: fichaIds }).slice(0, 12)}`,
    topico: "avulso",
    topico_titulo: "Reavaliação avulsa",
    parte: 1,
    partes: 1,
    escopo_ppc: transversal ? "completo" : "secoes",
    total_fichas: selecionadas.length,
    fichas: selecionadas,
  };
  const contextos = contextosDaRodada(rodada, skill);
  const kb = abrirContextoKbRodada(rodada, skill);
  try {
    adicionarContextosGrupo(grupo, contextos, kb, caminhos.ppc);
  } finally {
    kb.fechar();
  }
  grupo.fichas = fichasParaSubagente(selecionadas, universo);
  const payload: ObjetoPy = {
    rodada_dir: caminhos.rodadaDir,
    ppc_markdown: caminhos.ppc,
    prompt_template: promptTemplate(skill),
    grupo,
  };
  mkdirSync(caminhos.gruposAvulsosDir, { recursive: true });
  const destino = path.join(caminhos.gruposAvulsosDir, `${grupo.grupo_id}.json`);
  escreverJsonPy(destino, payload);
  const prompt = path.join(caminhos.gruposAvulsosDir, `${grupo.grupo_id}.md`);
  escreverTextoPy(prompt, pacotePromptGrupo(lerTexto(caminhos.ppc), lerTexto(promptTemplate(skill)), grupo));
  payload.grupo_avulso_path = destino;
  payload.prompt_subagent_path = prompt;
  return payload;
}

/** Seções do `PPC.md` listadas em `contextos.ppc.secoes`, cada uma com a linha do título e a origem. */
function secoesDoPpcEmMarkdown(ppc: string, secoes: unknown[]): string {
  return secoes
    .filter(ehObjetoPy)
    .map((secao) => {
      const inicio = numeroPy(obter(secao, "linha_inicio"));
      const fim = numeroPy(obter(secao, "linha_fim"));
      const motivo = iterarPy(obter(secao, "motivo", []))
        .map(strPy)
        .join("; ");
      const cabecalho = `<!-- seção ${strPy(obter(secao, "id"))} · linhas ${inicio}-${fim} · ${motivo} -->`;
      return `${cabecalho}\n${textoDaSecao(ppc, inicio, fim, { incluirTitulo: true })}`;
    })
    .join("\n\n");
}

/** Bloco do PPC no pacote: o `PPC.md` inteiro (escopo `completo`) ou só as seções do grupo. */
function blocoPpc(ppc: string, grupo: unknown): string {
  const contextos = ehObjetoPy(grupo) ? obter(grupo, "contextos", {}) : {};
  const contexto = ehObjetoPy(contextos) ? obter(contextos, "ppc") : undefined;
  if (!ehObjetoPy(contexto) || obter(contexto, "escopo") !== "secoes") {
    return ["## PPC.md", `\`\`\`markdown\n${aparar(ppc)}\n\`\`\``].join("\n\n");
  }
  const secoes = iterarPy(obter(contexto, "secoes", []));
  const topicos = iterarPy(obter(contexto, "topicos", []))
    .map(strPy)
    .join(", ");
  return [
    "## PPC.md: seções do grupo",
    `Este pacote traz ${secoes.length} seções do \`PPC.md\` (${strPy(obter(contexto, "caracteres_secoes"))} de ` +
      `${strPy(obter(contexto, "caracteres_ppc"))} caracteres), escolhidas pelos tópicos das fichas (${topicos}) e ` +
      "pelas consultas das fichas. " +
      `O arquivo completo está em \`${strPy(obter(contexto, "ppc_markdown"))}\`: ` +
      "leia-o antes de concluir que uma informação falta no PPC.",
    `\`\`\`markdown\n${secoesDoPpcEmMarkdown(ppc, secoes)}\n\`\`\``,
  ].join("\n\n");
}

/**
 * Grupo como vai no JSON do pacote: sem a lista `contextos.ppc.secoes`, que já está no bloco do PPC
 * (cada seção com o ID, as linhas e o motivo no comentário de abertura).
 */
function grupoParaPacote(grupo: unknown): unknown {
  if (!ehObjetoPy(grupo)) return grupo;
  const contextos = obter(grupo, "contextos");
  const contextoPpc = ehObjetoPy(contextos) ? obter(contextos, "ppc") : undefined;
  if (!ehObjetoPy(contextoPpc) || obter(contextoPpc, "escopo") !== "secoes") return grupo;
  const { secoes: _secoes, ...resumo } = contextoPpc;
  return { ...grupo, contextos: { ...(contextos as ObjetoPy), ppc: resumo } };
}

function pacotePromptGrupo(ppc: string, template: string, grupo: unknown): string {
  const grupoId = ehObjetoPy(grupo) ? strPy(obter(grupo, "grupo_id")) : "None";
  const topico = ehObjetoPy(grupo) ? obter(grupo, "topico_titulo") : undefined;
  return `${[
    `# Pacote de análise ${grupoId}${verdadeiro(topico) ? ` (${strPy(topico)})` : ""}`,
    "## Prompt de trabalho",
    aparar(template),
    blocoPpc(ppc, grupo),
    "## Grupo e contextos",
    `\`\`\`json\n${dumpsPy(grupoParaPacote(grupo), { indent: 2 })}\n\`\`\``,
    "Retorne somente JSON válido no contrato do prompt de trabalho.",
  ].join("\n\n")}\n`;
}

/** `preparar_prompts_subagents`: um pacote Markdown autocontido por grupo, mais `manifest.json`. */
export function prepararPromptsSubagents(rodada: string, opcoes: OpcoesSkill = {}): ObjetoPy {
  const skill = opcoes.caminhos ?? caminhosPadrao();
  const caminhos = caminhosRodada(rodada);
  const payload = existe(caminhos.gruposSubagents)
    ? (lerJsonPy(caminhos.gruposSubagents) as ObjetoPy)
    : montarGruposSubagents(rodada, TAMANHO_GRUPO_PADRAO, opcoes);
  const grupos = obter(payload, "grupos");
  if (!Array.isArray(grupos)) throw new Error("grupos-subagents.json não contém `grupos[]`.");
  const ppc = lerTexto(caminhos.ppc);
  const templatePath = strPy(
    ou(obter(payload, "prompt_template"), path.join(skill.promptsDir, "subagent-lote-fichas.md")),
  );
  const template = lerTexto(templatePath);
  mkdirSync(caminhos.promptsSubagentsDir, { recursive: true });
  const arquivos: ObjetoPy[] = [];
  for (const grupo of grupos) {
    if (!ehObjetoPy(grupo)) throw new Error("AttributeError: grupo não é objeto JSON");
    const grupoId = strPy(ou(obter(grupo, "grupo_id"), "grupo"));
    const destino = path.join(caminhos.promptsSubagentsDir, `${grupoId}.md`);
    const texto = pacotePromptGrupo(ppc, template, grupo);
    escreverTextoPy(destino, texto);
    arquivos.push({
      grupo_id: grupoId,
      topico: obter(grupo, "topico", null),
      arquivo: destino,
      total_fichas: obter(grupo, "total_fichas", 0),
      caracteres: texto.length,
    });
  }
  const manifest = {
    rodada_dir: caminhos.rodadaDir,
    ppc_markdown: caminhos.ppc,
    prompt_template: templatePath,
    total_pacotes: arquivos.length,
    caracteres_total: arquivos.reduce((total, arquivo) => total + numeroPy(arquivo.caracteres), 0),
    arquivos,
  };
  escreverJsonPy(caminhos.promptsSubagentsManifest, manifest);
  return manifest;
}
