// @effect-diagnostics nodeBuiltinImport:off -- conversão síncrona de um arquivo local em artefatos da rodada
/**
 * Conversão de um PPC `.docx` nos artefatos que a skill consome: `PPC.md` normalizado, Markdown
 * bruto, `_dados.json`, matriz curricular, ementário e a figura da representação gráfica.
 *
 * Substitui a conversão em Python (`conversao_docx/`, sobre `python-docx`), removida na trilha T3
 * do `PLANO-ARQUITETURA.md`. A saída é a mesma, salvo as diferenças documentadas no README da
 * skill; `scripts/dev/diferencial-docx.ts` compara as duas.
 *
 * Camadas, de baixo para cima:
 * - `ooxml/`: o DOCX como modelo intermediário (pacote ZIP, XML, parágrafos, tabelas, figuras);
 * - `elementos.ts`, `secoes.ts`, `tabelas.ts`: os elementos e as seções do PPC;
 * - `matriz.ts`, `ementario.ts`, `identificacao-tabelas.ts`, `figura.ts`: os dados extraídos;
 * - `markdown.ts` e este módulo: o Markdown e os arquivos.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { dumpsPy } from "@simplifica-if/kb/python/json";
import { ORDEM_CHAVES, type ObjetoPy } from "@simplifica-if/kb/python/valores";
import { normalizarMarkdown } from "../normalizador-markdown.ts";
import { type Elemento, elementosDoDocumento } from "./elementos.ts";
import { type ComponenteDoEmentario, extrairComponenteDoEmentario } from "./ementario.ts";
import { inserirBlocoNaSecao, type RepresentacaoGrafica, resolverRepresentacaoGrafica } from "./figura.ts";
import { extrairDadosDeIdentificacao } from "./identificacao-tabelas.ts";
import { escreverMarkdown } from "./markdown.ts";
import {
  extrairMatrizGenerica,
  extrairMatrizPpc,
  type Matriz,
  type MatrizGenerica,
  mesclarMatrizes,
  pontuarMatriz,
  substituirMatrizNoMarkdown,
} from "./matriz.ts";
import { ErroDocx } from "@simplifica-if/docx/erro";
import { type Fidelidade, lerPacote } from "@simplifica-if/docx/leitor";
import type { PropriedadesOoxml } from "@simplifica-if/docx/modelo";
import { type LimitesDoPacote, PacoteOoxml } from "@simplifica-if/docx/pacote";
import { REGRAS_DO_DOCUMENTO, REGRAS_DO_PYTHON, type Regras } from "./regras.ts";
import { detectarSecoes, dicasDeIdentificacao, listarSecoes, type Secao } from "./secoes.ts";
import { colunasDaTabela, normalizarTabela } from "./tabelas.ts";

export type OpcoesConversao = {
  /** Instante da conversão (`data_conversao`); quem chama passa o relógio da rodada. */
  agora: Date;
  /**
   * `documento` (padrão) converte com todas as regras de `regras.ts`; `python-docx` reproduz a
   * conversão antiga, para o diferencial.
   */
  fidelidade?: Fidelidade;
  /** Liga ou desliga regras uma a uma, sobre as da `fidelidade`. Só o diferencial usa. */
  regras?: Partial<Regras>;
  /** Limites de leitura do pacote; padrão: os de `@simplifica-if/docx/pacote`. */
  limites?: Partial<LimitesDoPacote>;
};

/** Tamanho máximo de um `.docx` aceito, conferido antes de ler o arquivo. */
export const TAMANHO_MAXIMO_DO_ARQUIVO = 100 * 1024 * 1024;

/** Resultado da conversão em memória, antes de gravar. */
export type Conversao = {
  elementos: Elemento[];
  secoes: Secao[];
  markdown: string;
  markdownBruto: string;
  /** Conteúdo do `_dados.json`, sem os nomes dos arquivos relacionados. */
  dados: ObjetoPy;
  matriz: ObjetoPy | null;
  ementario: ObjetoPy | null;
  /** Resumos da matriz e do ementário que vão para o `_dados.json`. */
  resumos: { matriz: ObjetoPy | null; ementario: ObjetoPy | null };
  representacaoGrafica: RepresentacaoGrafica | null;
};

/** Caminhos dos artefatos gravados; `null` para o que o PPC não tem. */
export type ArtefatosDocx = {
  output_dir: string;
  markdown: string;
  markdown_bruto: string;
  dados: string;
  matriz_curricular: string | null;
  ementario: string | null;
};

// ---------------------------------------------------------------- JSON

/**
 * Objeto JSON com as chaves na ordem do mapa. As chaves vêm do documento (nomes de campo das
 * tabelas, cabeçalhos da matriz) e podem ser numéricas, que o JavaScript reordenaria.
 */
function objetoOrdenado(mapa: Map<string, unknown>): ObjetoPy {
  const objeto: ObjetoPy = {};
  for (const [chave, valor] of mapa) {
    Object.defineProperty(objeto, chave, { value: valor, enumerable: true, writable: true, configurable: true });
  }
  Object.defineProperty(objeto, ORDEM_CHAVES, { value: [...mapa.keys()], enumerable: false });
  return objeto;
}

function matrizEmJson(matriz: Matriz): ObjetoPy {
  if (matriz.tipo === "matriz_curricular_ppc") return { ...matriz };
  return {
    ...matriz,
    componentes: matriz.componentes.map((componente) => ({ ...componente, cargas: objetoOrdenado(componente.cargas) })),
  };
}

const dois = (numero: number) => String(numero).padStart(2, "0");

/** Data e hora locais sem fuso, com microssegundos quando há fração (o `datetime.now().isoformat()` de antes). */
function dataHoraLocal(data: Date): string {
  const fracao = data.getMilliseconds() ? `.${String(data.getMilliseconds()).padStart(3, "0")}000` : "";
  return (
    `${String(data.getFullYear()).padStart(4, "0")}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}` +
    `T${dois(data.getHours())}:${dois(data.getMinutes())}:${dois(data.getSeconds())}${fracao}`
  );
}

function metadadosDoDocumento(propriedades: PropriedadesOoxml): ObjetoPy {
  const campos: Array<[string, string | null]> = [
    ["title", propriedades.titulo],
    ["author", propriedades.autor],
    ["subject", propriedades.assunto],
    ["keywords", propriedades.palavrasChave],
    ["created", propriedades.criadoEm],
    ["modified", propriedades.modificadoEm],
    ["last_modified_by", propriedades.modificadoPor],
  ];
  return Object.fromEntries(campos.filter(([, valor]) => valor));
}

// ---------------------------------------------------------------- dados extraídos

type DadosExtraidos = {
  identificacao: Map<string, string>;
  matriz: Matriz | null;
  ementario: ComponenteDoEmentario[];
};

function extrairDados(elementos: Elemento[], secoes: Secao[], regras: Regras): DadosExtraidos {
  const identificacao = dicasDeIdentificacao(secoes);
  const ementario: ComponenteDoEmentario[] = [];
  let matriz: Matriz | null = null;
  const genericas: MatrizGenerica[] = [];
  for (const elemento of elementos) {
    if (elemento.tipo !== "tabela") continue;
    const tabela = normalizarTabela(elemento);
    const componente = extrairComponenteDoEmentario(tabela);
    if (componente) {
      ementario.push(componente);
      continue;
    }
    if (colunasDaTabela(tabela) <= 2) {
      for (const [campo, valor] of extrairDadosDeIdentificacao(tabela)) identificacao.set(campo, valor);
    }
    const matrizPpc = extrairMatrizPpc(tabela);
    if (matrizPpc) matriz = mesclarMatrizes(matriz, matrizPpc, regras.totaisDaMatriz);
    else if (!matriz) {
      const generica = extrairMatrizGenerica(tabela);
      if (generica) genericas.push(generica);
    }
  }
  // Sem matriz nos formatos de PPC, fica a genérica de maior pontuação (a primeira, no empate).
  if (!matriz) {
    for (const generica of genericas) {
      if (!matriz || pontuarMatriz(generica) > pontuarMatriz(matriz)) matriz = generica;
    }
  }
  return { identificacao, matriz, ementario };
}

function ementarioEmJson(componentes: ComponenteDoEmentario[]): ObjetoPy | null {
  if (!componentes.length) return null;
  const porAno = new Map<string, string[]>();
  for (const componente of componentes) {
    // Componente sem período identificado fica na chave `null` do JSON.
    const ano = componente.periodo_letivo ?? "null";
    porAno.set(ano, [...(porAno.get(ano) ?? []), componente.nome]);
  }
  const contar = (campo: "bibliografia_basica" | "bibliografia_complementar") =>
    componentes.reduce((soma, componente) => soma + componente[campo].length, 0);
  return {
    tipo: "ementario_ppc",
    componentes,
    por_ano: objetoOrdenado(porAno),
    total_componentes: componentes.length,
    estatisticas: {
      total_por_ano: objetoOrdenado(new Map([...porAno].map(([ano, nomes]) => [ano, nomes.length]))),
      total_referencias_basicas: contar("bibliografia_basica"),
      total_referencias_complementares: contar("bibliografia_complementar"),
    },
  };
}

/**
 * Resumo da matriz no `_dados.json`. `total_ha` e `total_hr` são a soma das cargas em hora-aula e
 * em hora-relógio dos componentes (sem as linhas de atividades complementares e estágio); os
 * totais que o PPC declara estão em `totais`. Sem a regra `totaisDaMatriz`, os dois saem zerados,
 * como na conversão em Python, que somava campos que os anos da matriz não têm.
 */
function resumoDaMatriz(matriz: Matriz, regras: Regras): ObjetoPy {
  if (matriz.tipo !== "matriz_curricular_ppc") return {};
  const componentes = matriz.anos.flatMap((ano) => ano.componentes);
  const somar = (campo: "ch_hora_aula" | "ch_hora_relogio_cnct") =>
    regras.totaisDaMatriz ? componentes.reduce((soma, item) => soma + Number(item[campo] ?? 0), 0) : 0;
  return {
    total_anos: matriz.anos.length,
    total_componentes: componentes.length,
    total_ha: somar("ch_hora_aula"),
    total_hr: somar("ch_hora_relogio_cnct"),
    totais: matriz.totais,
  };
}

function resumoDoEmentario(ementario: ObjetoPy): ObjetoPy {
  const estatisticas = ementario.estatisticas as ObjetoPy;
  return {
    total_componentes: ementario.total_componentes,
    total_referencias_basicas: estatisticas.total_referencias_basicas,
    total_referencias_complementares: estatisticas.total_referencias_complementares,
    total_por_ano: estatisticas.total_por_ano,
  };
}

// ---------------------------------------------------------------- conversão

function temTexto(elemento: Elemento): boolean {
  if (elemento.tipo === "titulo" || elemento.tipo === "paragrafo") return true;
  return elemento.tipo === "tabela" && elemento.linhas.some((linha) => linha.some((celula) => celula.texto));
}

/**
 * Converte os bytes de um `.docx`, em memória; `nomeDoArquivo` vai para `arquivo_origem`. Lança
 * `ErroDocx` quando o arquivo não é um DOCX legível ou passa dos limites.
 */
export function converterPpc(bytes: Uint8Array, nomeDoArquivo: string, opcoes: OpcoesConversao): Conversao {
  const regras: Regras = {
    ...(opcoes.fidelidade === "python-docx" ? REGRAS_DO_PYTHON : REGRAS_DO_DOCUMENTO),
    ...opcoes.regras,
  };
  const pacote = new PacoteOoxml(bytes, opcoes.limites);
  const documento = lerPacote(pacote, { fidelidade: regras.leitura });
  const elementos = elementosDoDocumento(documento, regras);
  // Documento sem nenhum texto: vazio, ou digitalizado como imagem. Um `PPC.md` em branco seria
  // revisado como se fosse o PPC.
  if (!elementos.some(temTexto)) {
    throw new ErroDocx(
      "O documento não tem texto: o arquivo está vazio ou traz o PPC só como imagem (digitalizado). " +
        "A revisão precisa do documento de texto original.",
    );
  }
  const secoes = detectarSecoes(elementos);
  const extraidos = extrairDados(elementos, secoes, regras);
  const representacaoGrafica = resolverRepresentacaoGrafica(secoes, pacote);

  const normalizar = (bruto: string) => {
    const resultado = normalizarMarkdown(bruto);
    const markdown = extraidos.matriz
      ? substituirMatrizNoMarkdown(resultado.markdownNormalizado, extraidos.matriz)
      : resultado.markdownNormalizado;
    return { markdownBruto: resultado.markdownBruto, markdown };
  };
  let textos = normalizar(escreverMarkdown(elementos, secoes, regras));
  // A imagem (ou o aviso) entra no Markdown bruto já limpo, e a normalização é refeita.
  if (representacaoGrafica) textos = normalizar(inserirBlocoNaSecao(textos.markdownBruto, representacaoGrafica));

  const matriz = extraidos.matriz ? matrizEmJson(extraidos.matriz) : null;
  const ementario = ementarioEmJson(extraidos.ementario);
  const dados: ObjetoPy = {
    arquivo_origem: nomeDoArquivo,
    data_conversao: dataHoraLocal(opcoes.agora),
    metadata_documento: metadadosDoDocumento(documento.propriedades),
    dados_extraidos: objetoOrdenado(extraidos.identificacao),
    estrutura: {
      secoes_detectadas: listarSecoes(secoes),
      total_elementos: elementos.length,
      total_tabelas: elementos.filter((elemento) => elemento.tipo === "tabela").length,
    },
  };
  const resumos = {
    matriz: extraidos.matriz ? resumoDaMatriz(extraidos.matriz, regras) : null,
    ementario: ementario ? resumoDoEmentario(ementario) : null,
  };
  return { elementos, secoes, ...textos, dados, matriz, ementario, resumos, representacaoGrafica };
}

/** `Path.stem`: nome sem a última extensão. */
function radical(arquivo: string): string {
  const nome = NodePath.basename(arquivo);
  const ponto = nome.lastIndexOf(".");
  return ponto > 0 && ponto < nome.length - 1 ? nome.slice(0, ponto) : nome;
}

function gravarJson(caminho: string, valor: unknown): void {
  NodeFS.writeFileSync(caminho, dumpsPy(valor, { indent: 2 }), "utf-8");
}

/** Monta o `_dados.json`: os dados da conversão, os arquivos relacionados e os resumos. */
function dadosPrincipais(
  conversao: Conversao,
  nomes: Record<"markdown" | "bruto" | "matriz" | "ementario", string>,
): ObjetoPy {
  const grafica = conversao.representacaoGrafica;
  const imagem = grafica?.metodo === "bitmap" ? grafica.arquivo!.caminho : null;
  const principais: ObjetoPy = {
    ...conversao.dados,
    arquivos_relacionados: {
      markdown_normalizado: nomes.markdown,
      markdown_bruto: nomes.bruto,
      ...(conversao.matriz ? { matriz_curricular: nomes.matriz } : {}),
      ...(conversao.ementario ? { ementario: nomes.ementario } : {}),
      ...(imagem ? { representacao_grafica: imagem } : {}),
    },
  };
  if (grafica) {
    principais.representacao_grafica = {
      encontrada: true,
      secao: grafica.secao,
      tem_bitmap: grafica.temBitmap,
      tem_desenhos_vetoriais: grafica.temDesenhosVetoriais,
      // Só a imagem exibível conta como extraída: é ela que vai de anexo para os sub-agentes.
      extraida: imagem !== null,
      metodo: grafica.metodo,
      caminho: imagem,
      ...(grafica.metodo === "vetorial_arquivo_cru" ? { arquivo_vetorial: grafica.arquivo!.caminho } : {}),
    };
  }
  if (conversao.resumos.matriz) principais.resumo_matriz_curricular = conversao.resumos.matriz;
  if (conversao.resumos.ementario) principais.resumo_ementario = conversao.resumos.ementario;
  return principais;
}

/**
 * Lê um `.docx` do disco para a conversão. O tamanho é conferido antes da leitura: um arquivo de
 * gigabytes não chega à memória.
 */
export function lerArquivoDocx(arquivoDocx: string): Uint8Array {
  const arquivo = NodePath.resolve(arquivoDocx);
  if (!NodeFS.existsSync(arquivo)) throw new Error(`Arquivo não encontrado: ${arquivo}`);
  if (NodePath.extname(arquivo).toLowerCase() !== ".docx") throw new Error(`O arquivo deve ser .docx: ${arquivo}`);
  const tamanho = NodeFS.statSync(arquivo).size;
  if (tamanho > TAMANHO_MAXIMO_DO_ARQUIVO) {
    throw new ErroDocx(
      `O arquivo DOCX é grande demais (${Math.round(tamanho / (1024 * 1024))} MB; o limite é de ` +
        `${TAMANHO_MAXIMO_DO_ARQUIVO / (1024 * 1024)} MB).`,
    );
  }
  return NodeFS.readFileSync(arquivo);
}

/**
 * Grava em `saida` os artefatos de uma conversão, com o nome do DOCX como base: `<nome>.md`,
 * `<nome>-bruto.md`, `<nome>_dados.json`, `<nome>_matriz_curricular.json`,
 * `<nome>_ementario.json` e `imagens/representacao_grafica.<ext>`.
 */
export function gravarArtefatos(conversao: Conversao, arquivoDocx: string, saida: string): ArtefatosDocx {
  const destino = NodePath.resolve(saida);
  NodeFS.mkdirSync(destino, { recursive: true });
  const base = radical(arquivoDocx);
  // Os JSONs de matriz e ementário levam o radical do `_dados.json` sem `_dados`. A conversão em
  // Python tirava todo `_dados` do nome, não só o sufixo: `PPC_dados v2.docx` dá
  // `PPC v2_matriz_curricular.json`. Ficou assim para os nomes não mudarem; quem consome os
  // arquivos usa os caminhos devolvidos aqui, não o nome.
  const baseDosDados = `${base}_dados`.replaceAll("_dados", "");
  const nomes = {
    markdown: `${base}.md`,
    bruto: `${base}-bruto.md`,
    matriz: `${baseDosDados}_matriz_curricular.json`,
    ementario: `${baseDosDados}_ementario.json`,
  };
  const caminho = (nome: string) => NodePath.join(destino, nome);

  const figura = conversao.representacaoGrafica?.arquivo;
  if (figura) {
    NodeFS.mkdirSync(NodePath.dirname(caminho(figura.caminho)), { recursive: true });
    NodeFS.writeFileSync(caminho(figura.caminho), figura.bytes);
  }
  NodeFS.writeFileSync(caminho(nomes.markdown), conversao.markdown, "utf-8");
  NodeFS.writeFileSync(caminho(nomes.bruto), conversao.markdownBruto, "utf-8");
  gravarJson(caminho(`${base}_dados.json`), dadosPrincipais(conversao, nomes));
  if (conversao.matriz) gravarJson(caminho(nomes.matriz), conversao.matriz);
  if (conversao.ementario) gravarJson(caminho(nomes.ementario), conversao.ementario);

  return {
    output_dir: destino,
    markdown: caminho(nomes.markdown),
    markdown_bruto: caminho(nomes.bruto),
    dados: caminho(`${base}_dados.json`),
    matriz_curricular: conversao.matriz ? caminho(nomes.matriz) : null,
    ementario: conversao.ementario ? caminho(nomes.ementario) : null,
  };
}

/** Converte `arquivoDocx` e grava os artefatos em `saida`. Nada é gravado se a conversão falha. */
export function converterDocx(arquivoDocx: string, saida: string, opcoes: OpcoesConversao): ArtefatosDocx {
  const conversao = converterPpc(lerArquivoDocx(arquivoDocx), NodePath.basename(arquivoDocx), opcoes);
  return gravarArtefatos(conversao, arquivoDocx, saida);
}
