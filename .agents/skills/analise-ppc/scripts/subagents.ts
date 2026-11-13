/**
 * Grupos de fichas, contextos e pacotes de prompt para os sub-agentes, grupo
 * avulso e mescla de reavaliações (porte de `subagents.py`).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
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
  padraoSeAusente,
  strPy,
  textoOuVazioPy,
  tipoPy,
  verdadeiro,
} from "@simplifica-if/kb/python/valores";
import { aparar, compararTexto } from "@simplifica-if/kb/texto";
import { listarArquivos } from "./arquivos.ts";
import { type CaminhosAnalise, caminhosPadrao } from "./caminhos.ts";
import { componentesMatriz, gerarContextoCnctRodada, lerJsonSeExistir } from "./cnct-catalogo.ts";
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

/** Divide as fichas em grupos de `tamanhoGrupo` (`grupo-001`, `grupo-002`…). */
export function agruparFichas(fichas: ObjetoPy[], tamanhoGrupo = TAMANHO_GRUPO_PADRAO): Grupo[] {
  if (tamanhoGrupo <= 0) throw new Error("O tamanho do grupo precisa ser maior que zero.");
  const grupos: Grupo[] = [];
  for (let indice = 0; indice < fichas.length; indice += tamanhoGrupo) {
    const grupoFichas = fichas.slice(indice, indice + tamanhoGrupo);
    grupos.push({
      grupo_id: `grupo-${String(grupos.length + 1).padStart(3, "0")}`,
      intervalo: `${indice + 1}-${indice + grupoFichas.length}`,
      total_fichas: grupoFichas.length,
      fichas: grupoFichas,
    });
  }
  return grupos;
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
  if (Array.isArray(referencias) && referencias.some((item) => aparar(strPy(item)))) return true;
  const texto = casefold(textoDaFicha(ficha));
  return TERMOS_NORMATIVOS.some((termo) => texto.includes(termo));
}

/** Marcos normativos (`marcos` de `marcos-normativos.json`), ou lista vazia. */
export function carregarMarcosNormativos(caminho = caminhosPadrao().marcosNormativosPath): unknown[] {
  if (!existe(caminho)) return [];
  const payload = lerJsonPy(caminho);
  const marcos = ehObjetoPy(payload) ? obter(payload, "marcos") : null;
  return Array.isArray(marcos) ? marcos : [];
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
    marcos_normativos: carregarMarcosNormativos(caminhos.marcosNormativosPath),
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
};

function adicionarContextosGrupo(grupo: Grupo, contextos: Contextos): void {
  const saida: ObjetoPy = {};
  const requerCnct = grupo.fichas.some(fichaRequerContextoCnct);
  grupo.requer_contexto_cnct = requerCnct;
  if (requerCnct) saida.cnct = contextos.cnct;
  const requerFundamentacao = grupo.fichas.some(fichaRequerFundamentacaoNormativa);
  grupo.requer_fundamentacao_normativa = requerFundamentacao;
  if (requerFundamentacao) saida.fundamentacao_normativa = contextos.fundamentacao;
  grupo.requer_contexto_estrutural = true;
  saida.estrutura = contextos.estrutura;
  const anexosGrupo = contextos.anexos.filter((anexo) =>
    grupo.fichas.some((ficha) => obter(ficha, "id") === anexo.ficha_id),
  );
  grupo.requer_anexos_visuais = anexosGrupo.length > 0;
  if (anexosGrupo.length) saida.anexos_visuais = anexosGrupo;
  grupo.contextos = saida;
}

function promptTemplate(skill: CaminhosAnalise): string {
  return path.join(skill.appDir, "prompts", "subagent-lote-fichas.md");
}

/** `montar_grupos_subagents`: grupos com contextos, gravados em `grupos-subagents.json`. */
export function montarGruposSubagents(
  rodada: string,
  tamanhoGrupo = TAMANHO_GRUPO_PADRAO,
  opcoes: OpcoesSkill = {},
): ObjetoPy {
  const skill = opcoes.caminhos ?? caminhosPadrao();
  const caminhos = caminhosRodada(rodada);
  if (!existe(caminhos.ppc)) throw new Error(`PPC.md não encontrado: ${caminhos.ppc}`);
  const metadata = existe(caminhos.metadata) ? (lerJsonPy(caminhos.metadata) as ObjetoPy) : {};
  const fichas = carregarFichasOrdenadas(opcoes.fichasDir ?? skill.fichasDir);
  const grupos = agruparFichas(fichas, tamanhoGrupo);
  const cnct = gerarContextoCnctRodada(rodada, { caminhos: skill });
  const estrutura = gerarContextoEstruturalSubagents(rodada);
  const anexos = anexosVisuais(rodada);
  const fundamentacao = contextoFundamentacaoNormativa(skill);
  const validacoes = contextoValidacoesCruzadas(rodada, opcoes);
  for (const grupo of grupos) adicionarContextosGrupo(grupo, { cnct, estrutura, anexos, fundamentacao });
  const payload = {
    rodada_dir: caminhos.rodadaDir,
    ppc_markdown: caminhos.ppc,
    grupos_subagents_path: caminhos.gruposSubagents,
    prompt_template: promptTemplate(skill),
    sintese_transversal_template: path.join(skill.appDir, "prompts", "sintese-transversal.md"),
    cnct_contexto_path: caminhos.cnctContexto,
    cnct_contexto: cnct,
    contexto_estrutural_path: caminhos.contextoEstruturalSubagents,
    contexto_estrutural: estrutura,
    validacoes_cruzadas_path: caminhos.validacoesCruzadasContexto,
    validacoes_cruzadas: validacoes,
    fundamentacao_normativa: fundamentacao,
    anexos_visuais: anexos,
    curso: obter(metadata, "curso", ""),
    total_fichas: fichas.length,
    tamanho_grupo: tamanhoGrupo,
    grupos,
  };
  escreverJsonPy(caminhos.gruposSubagents, payload);
  return payload;
}

/** `montar_grupo_avulso`: grupo só com as fichas pedidas, gravado em `grupos-avulsos/`. */
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
  const selecionadas = fichaIds.map((fichaId) => copiarProfundoPy(fichasPorId.get(fichaId)!));
  const grupo: Grupo = {
    grupo_id: `avulso-${sha256JsonPayload({ ficha_ids: fichaIds }).slice(0, 12)}`,
    intervalo: "avulso",
    total_fichas: selecionadas.length,
    fichas: selecionadas,
  };
  const cnct = gerarContextoCnctRodada(rodada, { caminhos: skill });
  const estrutura = gerarContextoEstruturalSubagents(rodada);
  const anexos = anexosVisuais(rodada);
  const fundamentacao = contextoFundamentacaoNormativa(skill);
  adicionarContextosGrupo(grupo, { cnct, estrutura, anexos, fundamentacao });
  const payload: ObjetoPy = {
    rodada_dir: caminhos.rodadaDir,
    ppc_markdown: caminhos.ppc,
    prompt_template: promptTemplate(skill),
    grupo,
  };
  mkdirSync(caminhos.gruposAvulsosDir, { recursive: true });
  const destino = path.join(caminhos.gruposAvulsosDir, `${grupo.grupo_id}.json`);
  escreverJsonPy(destino, payload);
  payload.grupo_avulso_path = destino;
  return payload;
}

function pacotePromptGrupo(ppc: string, template: string, grupo: unknown): string {
  const grupoId = ehObjetoPy(grupo) ? strPy(obter(grupo, "grupo_id")) : "None";
  return `${[
    `# Pacote de análise ${grupoId}`,
    "## Prompt de trabalho",
    aparar(template),
    "## PPC.md",
    `\`\`\`markdown\n${aparar(ppc)}\n\`\`\``,
    "## Grupo e contextos",
    `\`\`\`json\n${dumpsPy(grupo, { indent: 2 })}\n\`\`\``,
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
    escreverTextoPy(destino, pacotePromptGrupo(ppc, template, grupo));
    arquivos.push({ grupo_id: grupoId, arquivo: destino, total_fichas: obter(grupo, "total_fichas", 0) });
  }
  const manifest = {
    rodada_dir: caminhos.rodadaDir,
    ppc_markdown: caminhos.ppc,
    prompt_template: templatePath,
    total_pacotes: arquivos.length,
    arquivos,
  };
  escreverJsonPy(caminhos.promptsSubagentsManifest, manifest);
  return manifest;
}

/** Caminho relativo a `arquivos-suporte/` quando não absoluto. */
function noSuporte(caminho: string, suporteDir: string): string {
  return path.isAbsolute(caminho) ? caminho : path.join(suporteDir, caminho);
}

function exigirObjeto(valor: unknown, descricao: string): ObjetoPy {
  if (!ehObjetoPy(valor)) throw new Error(`AttributeError: ${descricao} não é objeto JSON`);
  return valor;
}

/** `mesclar_resultados_avulsos`: substitui no JSON base os resultados das fichas reavaliadas. */
export function mesclarResultadosAvulsos(
  rodada: string,
  resultadosBase: string,
  resultadosAvulsos: string,
  saida?: string,
): ObjetoPy {
  const caminhos = caminhosRodada(rodada);
  const basePath = noSuporte(resultadosBase, caminhos.suporteDir);
  const avulsoPath = noSuporte(resultadosAvulsos, caminhos.suporteDir);
  const saidaResolvida = noSuporte(saida || resultadosBase, caminhos.suporteDir);
  const base = exigirObjeto(lerJsonPy(basePath), "resultados base");
  const avulso = exigirObjeto(lerJsonPy(avulsoPath), "resultado avulso");
  const gruposBase = iterarPy(obter(base, "grupos", []));
  const resultadosNovos: unknown[] = [];
  const gruposAvulso = obter(avulso, "grupos");
  const resultadosAvulso = obter(avulso, "resultados");
  if (Array.isArray(gruposAvulso)) {
    for (const grupo of gruposAvulso) {
      resultadosNovos.push(...iterarPy(obter(exigirObjeto(grupo, "grupo avulso"), "resultados", [])));
    }
  } else if (Array.isArray(resultadosAvulso)) {
    resultadosNovos.push(...resultadosAvulso);
  } else {
    throw new Error("O resultado avulso precisa conter `grupos[]` ou `resultados[]`.");
  }
  const idsAvulsos = new Set(resultadosNovos.map((item) => strPy(obter(exigirObjeto(item, "resultado"), "ficha_id"))));
  const idsOrdenados = [...idsAvulsos].sort(compararTexto);
  const gruposMesclados: ObjetoPy[] = [];
  for (const grupo of gruposBase) {
    const original = exigirObjeto(grupo, "grupo base");
    const copia: ObjetoPy = { ...original };
    copia.resultados = iterarPy(obter(original, "resultados", [])).filter(
      (item) => !idsAvulsos.has(strPy(obter(exigirObjeto(item, "resultado"), "ficha_id"))),
    );
    if ((copia.resultados as unknown[]).length) gruposMesclados.push(copia);
  }
  gruposMesclados.push({
    grupo_id: strPy(ou(obter(avulso, "grupo_id"), `reavaliacao-${sha256JsonPayload(idsOrdenados).slice(0, 12)}`)),
    tipo: "reavaliacao",
    resultados: resultadosNovos,
  });
  const payload: ObjetoPy = { ...base, grupos: gruposMesclados };
  const metadata = padraoSeAusente(payload, "metadata", {});
  if (!ehObjetoPy(metadata)) {
    // Mesma falha do Python ao atribuir em `payload["metadata"][...]`.
    throw new TypeError(
      Array.isArray(metadata)
        ? "list indices must be integers or slices, not str"
        : `'${tipoPy(metadata)}' object does not support item assignment`,
    );
  }
  metadata.reavaliacoes_mescladas = idsOrdenados;
  escreverJsonPy(saidaResolvida, payload);
  return { resultados_path: saidaResolvida, fichas_substituidas: idsOrdenados, total_grupos: gruposMesclados.length };
}
