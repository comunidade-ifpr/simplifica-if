/**
 * Conversão de um PPC `.docx` nos artefatos da revisão: `PPC.md` normalizado, Markdown bruto,
 * `_dados.json`, matriz curricular, ementário e a figura da representação gráfica.
 *
 * As regras de leitura e de conversão estão no README do pacote ("Conversão do DOCX").
 *
 * Camadas, de baixo para cima:
 * - `@simplifica-if/docx`: o DOCX como modelo intermediário (pacote ZIP, XML, parágrafos, tabelas,
 *   figuras), com os limites contra arquivo hostil, e a camada genérica de texto: elementos
 *   (`elementos.ts`), tabelas em grade (`tabelas.ts`), escrita do Markdown (`markdown.ts`) e
 *   orçamento de texto (`orcamento.ts`);
 * - `secoes.ts`: as seções do PPC;
 * - `matriz.ts`, `ementario.ts`, `identificacao-tabelas.ts`, `figura.ts`: os dados extraídos;
 * - `markdown.ts` e este módulo: o Markdown e os artefatos.
 *
 * Tudo aqui é puro e trabalha em memória: quem chama lê o DOCX (depois de `conferirArquivoDocx`) e
 * grava os artefatos (`artefatosDaConversao`). `converterPpc` é síncrona; quem a chama num servidor
 * deve rodá-la fora do laço de eventos, com limite de memória e de tempo.
 */
import { serializarJsonTipado } from "@simplifica-if/kb/primitivas/json-tipado";
import { ORDEM_CHAVES, type Dicionario } from "@simplifica-if/kb/primitivas/valores";
import { normalizarMarkdown } from "../normalizador-markdown.ts";
import { type Elemento, elementosDoDocumento, type Tabela, temTexto } from "@simplifica-if/docx/elementos";
import { type ComponenteDoEmentario, extrairComponenteDoEmentario } from "./ementario.ts";
import { inserirBlocoNaSecao, type RepresentacaoGrafica, resolverRepresentacaoGrafica } from "./figura.ts";
import { extrairDadosDeIdentificacao } from "./identificacao-tabelas.ts";
import type { NormalizarTabela } from "@simplifica-if/docx/markdown";
import { type LimitesDeTexto, Orcamento } from "@simplifica-if/docx/orcamento";
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
import { lerPacote } from "@simplifica-if/docx/leitor";
import type { PropriedadesOoxml } from "@simplifica-if/docx/modelo";
import { LIMITES_PADRAO, type LimitesDoPacote, PacoteOoxml } from "@simplifica-if/docx/pacote";
import { detectarSecoes, dicasDeIdentificacao, listarSecoes, type Secao } from "./secoes.ts";
import { colunasDaTabela, normalizarTabela, type TabelaNormalizada } from "@simplifica-if/docx/tabelas";

export type OpcoesConversao = {
  /** Instante da conversão (`data_conversao`); quem chama passa o relógio da rodada. */
  agora: Date;
  /** Limites de leitura do pacote; padrão: `LIMITES_PADRAO` de `@simplifica-if/docx/pacote`. */
  limites?: Partial<LimitesDoPacote>;
  /** Orçamento de texto do documento; padrão: `LIMITES_DE_TEXTO` de `@simplifica-if/docx/orcamento`. */
  limitesDeTexto?: Partial<LimitesDeTexto>;
};

/** Resultado da conversão em memória, antes de gravar. */
export type Conversao = {
  elementos: Elemento[];
  secoes: Secao[];
  markdown: string;
  markdownBruto: string;
  /** Conteúdo do `_dados.json`, sem os nomes dos arquivos relacionados. */
  dados: Dicionario;
  matriz: Dicionario | null;
  ementario: Dicionario | null;
  /** Resumos da matriz e do ementário que vão para o `_dados.json`. */
  resumos: { matriz: Dicionario | null; ementario: Dicionario | null };
  representacaoGrafica: RepresentacaoGrafica | null;
};

/** Um arquivo da conversão: o caminho relativo à pasta de saída e o conteúdo (texto em UTF-8). */
export type ArtefatoConversao = { caminho: string; conteudo: string | Uint8Array };

/** Os nomes dos artefatos principais, relativos à pasta de saída; `null` para o que o PPC não tem. */
export type NomesArtefatos = {
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
function objetoOrdenado(mapa: Map<string, unknown>): Dicionario {
  const objeto: Dicionario = {};
  for (const [chave, valor] of mapa) {
    Object.defineProperty(objeto, chave, { value: valor, enumerable: true, writable: true, configurable: true });
  }
  Object.defineProperty(objeto, ORDEM_CHAVES, { value: [...mapa.keys()], enumerable: false });
  return objeto;
}

function matrizEmJson(matriz: Matriz): Dicionario {
  if (matriz.tipo === "matriz_curricular_ppc") return { ...matriz };
  return {
    ...matriz,
    componentes: matriz.componentes.map((componente) => ({ ...componente, cargas: objetoOrdenado(componente.cargas) })),
  };
}

const dois = (numero: number) => String(numero).padStart(2, "0");

/** Data e hora locais sem fuso, com microssegundos quando há fração. */
function dataHoraLocal(data: Date): string {
  const fracao = data.getMilliseconds() ? `.${String(data.getMilliseconds()).padStart(3, "0")}000` : "";
  return (
    `${String(data.getFullYear()).padStart(4, "0")}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}` +
    `T${dois(data.getHours())}:${dois(data.getMinutes())}:${dois(data.getSeconds())}${fracao}`
  );
}

function metadadosDoDocumento(propriedades: PropriedadesOoxml): Dicionario {
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

function extrairDados(elementos: Elemento[], secoes: Secao[], normalizar: NormalizarTabela): DadosExtraidos {
  const identificacao = dicasDeIdentificacao(secoes);
  const ementario: ComponenteDoEmentario[] = [];
  let matriz: Matriz | null = null;
  const genericas: MatrizGenerica[] = [];
  for (const elemento of elementos) {
    if (elemento.tipo !== "tabela") continue;
    const tabela = normalizar(elemento);
    const componente = extrairComponenteDoEmentario(tabela);
    if (componente) {
      ementario.push(componente);
      continue;
    }
    if (colunasDaTabela(tabela) <= 2) {
      for (const [campo, valor] of extrairDadosDeIdentificacao(tabela)) identificacao.set(campo, valor);
    }
    const matrizPpc = extrairMatrizPpc(tabela);
    if (matrizPpc) matriz = mesclarMatrizes(matriz, matrizPpc);
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

function ementarioEmJson(componentes: ComponenteDoEmentario[]): Dicionario | null {
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
 * totais que o PPC declara estão em `totais`.
 */
function resumoDaMatriz(matriz: Matriz): Dicionario {
  if (matriz.tipo !== "matriz_curricular_ppc") return {};
  const componentes = matriz.anos.flatMap((ano) => ano.componentes);
  const somar = (campo: "ch_hora_aula" | "ch_hora_relogio_cnct") =>
    componentes.reduce((soma, item) => soma + Number(item[campo] ?? 0), 0);
  return {
    total_anos: matriz.anos.length,
    total_componentes: componentes.length,
    total_ha: somar("ch_hora_aula"),
    total_hr: somar("ch_hora_relogio_cnct"),
    totais: matriz.totais,
  };
}

function resumoDoEmentario(ementario: Dicionario): Dicionario {
  const estatisticas = ementario.estatisticas as Dicionario;
  return {
    total_componentes: ementario.total_componentes,
    total_referencias_basicas: estatisticas.total_referencias_basicas,
    total_referencias_complementares: estatisticas.total_referencias_complementares,
    total_por_ano: estatisticas.total_por_ano,
  };
}

// ---------------------------------------------------------------- conversão

/**
 * Converte os bytes de um `.docx`, em memória; `nomeDoArquivo` vai para `arquivo_origem`. Lança
 * `ErroDocx` quando o arquivo não é um DOCX legível ou passa dos limites.
 */
export function converterPpc(bytes: Uint8Array, nomeDoArquivo: string, opcoes: OpcoesConversao): Conversao {
  const pacote = new PacoteOoxml(bytes, opcoes.limites);
  const documento = lerPacote(pacote);
  const elementos = elementosDoDocumento(documento);
  // Documento sem nenhum texto: vazio, ou digitalizado como imagem. Um `PPC.md` em branco seria
  // revisado como se fosse o PPC.
  if (!elementos.some(temTexto)) {
    throw new ErroDocx({ motivo: "sem-texto" });
  }
  const orcamento = new Orcamento(opcoes.limitesDeTexto);
  orcamento.conferirElementos(elementos);
  // Cada tabela é normalizada uma vez (a extração dos dados e o Markdown usam a mesma grade), e o
  // texto dela, com as repetições das mesclas, sai do orçamento do documento.
  const normalizadas = new Map<Tabela, TabelaNormalizada>();
  const normalizarTabelaUmaVez: NormalizarTabela = (tabela) => {
    let normalizada = normalizadas.get(tabela);
    if (!normalizada) {
      normalizadas.set(tabela, (normalizada = normalizarTabela(tabela, (caracteres) => orcamento.gastar(caracteres))));
    }
    return normalizada;
  };
  const secoes = detectarSecoes(elementos);
  const extraidos = extrairDados(elementos, secoes, normalizarTabelaUmaVez);
  const representacaoGrafica = resolverRepresentacaoGrafica(secoes, pacote);

  const normalizar = (bruto: string) => {
    const resultado = normalizarMarkdown(bruto);
    const markdown = extraidos.matriz
      ? substituirMatrizNoMarkdown(resultado.markdownNormalizado, extraidos.matriz)
      : resultado.markdownNormalizado;
    return { markdownBruto: resultado.markdownBruto, markdown };
  };
  const bruto = escreverMarkdown(elementos, secoes, normalizarTabelaUmaVez);
  // O Markdown gerado também sai do orçamento, antes de ser normalizado.
  new Orcamento(opcoes.limitesDeTexto).gastar(bruto.length);
  let textos = normalizar(bruto);
  // A imagem (ou o aviso) entra no Markdown bruto já limpo, e a normalização é refeita.
  if (representacaoGrafica) textos = normalizar(inserirBlocoNaSecao(textos.markdownBruto, representacaoGrafica));

  const matriz = extraidos.matriz ? matrizEmJson(extraidos.matriz) : null;
  const ementario = ementarioEmJson(extraidos.ementario);
  const dados: Dicionario = {
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
    matriz: extraidos.matriz ? resumoDaMatriz(extraidos.matriz) : null,
    ementario: ementario ? resumoDoEmentario(ementario) : null,
  };
  return { elementos, secoes, ...textos, dados, matriz, ementario, resumos, representacaoGrafica };
}

/** O nome do arquivo sem a pasta e sem a última extensão. */
function radical(arquivo: string): string {
  const nome = arquivo.slice(arquivo.lastIndexOf("/") + 1);
  const ponto = nome.lastIndexOf(".");
  return ponto > 0 && ponto < nome.length - 1 ? nome.slice(0, ponto) : nome;
}

const json = (valor: unknown) => serializarJsonTipado(valor, { indent: 2 });

/** Monta o `_dados.json`: os dados da conversão, os arquivos relacionados e os resumos. */
function dadosPrincipais(conversao: Conversao, nomes: NomesArtefatos): Dicionario {
  const grafica = conversao.representacaoGrafica;
  const imagem = grafica?.metodo === "bitmap" ? grafica.arquivo!.caminho : null;
  const principais: Dicionario = {
    ...conversao.dados,
    arquivos_relacionados: {
      markdown_normalizado: nomes.markdown,
      markdown_bruto: nomes.markdown_bruto,
      ...(nomes.matriz_curricular ? { matriz_curricular: nomes.matriz_curricular } : {}),
      ...(nomes.ementario ? { ementario: nomes.ementario } : {}),
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
 * Confere um `.docx` antes de lê-lo: a extensão e o tamanho, que o chamador tira do disco sem ler o
 * arquivo (um arquivo de gigabytes não chega à memória).
 */
export function conferirArquivoDocx(arquivo: string, tamanho: number, limite = LIMITES_PADRAO.bytesDoArquivo): void {
  if (!/[^/\\]\.docx$/i.test(arquivo)) throw new Error(`O arquivo deve ser .docx: ${arquivo}`);
  // A mesma recusa do `PacoteOoxml`, antes de ler o arquivo.
  if (tamanho > limite) throw new ErroDocx({ motivo: "arquivo-grande-demais", tamanho, limite });
}

/**
 * Os artefatos de uma conversão, com o nome do DOCX como base: `<nome>.md`, `<nome>-bruto.md`,
 * `<nome>_dados.json`, `<nome>_matriz_curricular.json`, `<nome>_ementario.json` e
 * `imagens/representacao_grafica.<ext>`. Quem chama grava os `arquivos` na pasta de saída.
 */
export function artefatosDaConversao(
  conversao: Conversao,
  nomeDocx: string,
): { arquivos: ArtefatoConversao[]; nomes: NomesArtefatos } {
  const base = radical(nomeDocx);
  // Os JSONs de matriz e ementário levam o radical do `_dados.json` sem `_dados`, e sai todo
  // `_dados` do nome, não só o sufixo: `PPC_dados v2.docx` dá `PPC v2_matriz_curricular.json`.
  // Quem consome os arquivos usa os nomes devolvidos aqui, não o nome.
  const baseDosDados = `${base}_dados`.replaceAll("_dados", "");
  const nomes: NomesArtefatos = {
    markdown: `${base}.md`,
    markdown_bruto: `${base}-bruto.md`,
    dados: `${base}_dados.json`,
    matriz_curricular: conversao.matriz ? `${baseDosDados}_matriz_curricular.json` : null,
    ementario: conversao.ementario ? `${baseDosDados}_ementario.json` : null,
  };
  const figura = conversao.representacaoGrafica?.arquivo;
  const arquivos: ArtefatoConversao[] = [
    ...(figura ? [{ caminho: figura.caminho, conteudo: figura.bytes }] : []),
    { caminho: nomes.markdown, conteudo: conversao.markdown },
    { caminho: nomes.markdown_bruto, conteudo: conversao.markdownBruto },
    { caminho: nomes.dados, conteudo: json(dadosPrincipais(conversao, nomes)) },
    ...(nomes.matriz_curricular ? [{ caminho: nomes.matriz_curricular, conteudo: json(conversao.matriz) }] : []),
    ...(nomes.ementario ? [{ caminho: nomes.ementario, conteudo: json(conversao.ementario) }] : []),
  ];
  return { arquivos, nomes };
}
