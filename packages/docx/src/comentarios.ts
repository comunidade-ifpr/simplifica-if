/**
 * Comentários do Word ancorados em trechos de um DOCX existente (prova de conceito do M1.11, proposta C).
 *
 * A revisão prévia devolve o próprio arquivo da pessoa, com cada pendência como comentário no trecho a
 * que se refere: é o formato em que a coordenação já edita e em que o PPC circula na PROENS. O documento
 * não é regravado a partir de um modelo: as marcas (`w:commentRangeStart`, `w:commentRangeEnd` e o run
 * com `w:commentReference`) são inseridas por posição no texto do `document.xml`, e todo o resto da
 * parte, inclusive o que o leitor não entende, fica byte a byte como estava. Só o run em que o trecho
 * começa ou termina no meio é dividido em dois, com as mesmas propriedades (`w:rPr`).
 *
 * O trecho é procurado dentro de um parágrafo, com espaços, maiúsculas e aspas normalizados. Um trecho
 * que atravessa parágrafos, ou que não está no arquivo (o PPC mudou depois da análise, ou a IA citou
 * mal), não é ancorado em lugar errado: volta em `naoAncoradas`, e quem chama decide (por exemplo, um
 * comentário no início do documento ou só a lista de pendências).
 */
import type { Element } from "domhandler";
import { strToU8, zipSync } from "fflate";
import { ErroDocx } from "./erro.ts";
import { PacoteOoxml, RELACAO_DOCUMENTO } from "./pacote.ts";
import { analisarXml, atributo, decodificarXml, filho, filhosElementos, textoInicial } from "./xml.ts";

export type Anotacao = {
  /** Trechos literais do PPC, tentados em ordem; o primeiro encontrado ancora o comentário. */
  trechos: readonly string[];
  /** Texto do comentário; linha em branco separa parágrafos. */
  texto: string;
  /** Sem trecho encontrado, ancora no primeiro parágrafo com texto (pendência de seção ausente). */
  noInicioSeAusente?: boolean;
};

export type OpcoesComentarios = {
  autor?: string;
  iniciais?: string;
  /** Data dos comentários (ISO 8601): quem chama passa o relógio da rodada, como na conversão. */
  data: string;
};

export type ResultadoComentarios = {
  docx: Uint8Array;
  /** Índices (em `anotacoes`) ancorados num trecho, com o texto do parágrafo encontrado. */
  ancoradas: { indice: number; paragrafo: string; noInicio: boolean }[];
  naoAncoradas: { indice: number; motivo: string }[];
};

const TIPO_COMENTARIOS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";
const CONTEUDO_COMENTARIOS = "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml";
const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const escapar = (texto: string) =>
  texto.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** Caracteres de controle que o XML 1.0 não aceita (vêm, por exemplo, de texto colado pela IA). */
const semControle = (texto: string) => texto.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "");

/** Forma de comparação de um caractere: espaços viram um espaço, aspas e travessões viram ASCII. */
function normalizarCaractere(c: string): string {
  if (/\s| /.test(c)) return " ";
  if ("“”„«»".includes(c)) return '"';
  if ("‘’‚".includes(c)) return "'";
  if ("–—‐‑".includes(c)) return "-";
  const minuscula = c.toLowerCase();
  return minuscula.length === 1 ? minuscula : c;
}

function normalizar(texto: string): string {
  let saida = "";
  for (const c of texto.normalize("NFC")) {
    const n = normalizarCaractere(c);
    if (n === " " && (saida === "" || saida.endsWith(" "))) continue;
    saida += n;
  }
  return saida.trimEnd();
}

/**
 * `envoltorio`: o filho do parágrafo que contém o run, quando o run não é filho direto (inserção do
 * controle de alterações, hiperlink, campo, controle de conteúdo). As marcas do comentário ficam
 * sempre como filhas diretas do parágrafo, por fora dele: dentro de um `w:ins`, rejeitar as alterações
 * apagaria a referência e deixaria o comentário órfão.
 */
type RunLido = { elemento: Element; texto: string; simples: boolean; envoltorio: Element | null };
type ParagrafoLido = { elemento: Element; runs: RunLido[]; texto: string };

const IGNORADOS = new Set(["w:del", "w:moveFrom", "mc:Fallback", "w:txbxContent"]);

/** Runs do parágrafo (inclusive dentro de hiperlinks, campos e inserções), sem os de parágrafos aninhados. */
function runsDoParagrafo(paragrafo: Element): RunLido[] {
  const saida: RunLido[] = [];
  const visitar = (no: Element, envoltorio: Element | null) => {
    for (const item of filhosElementos(no)) {
      if (IGNORADOS.has(item.name) || item.name === "w:p") continue;
      if (item.name !== "w:r") {
        visitar(item, envoltorio ?? item);
        continue;
      }
      let texto = "";
      for (const parte of filhosElementos(item)) {
        if (parte.name === "w:t") texto += textoInicial(parte);
        else if (parte.name === "w:tab") texto += "\t";
        else if (parte.name === "w:br" || parte.name === "w:cr") texto += "\n";
        else if (parte.name === "w:noBreakHyphen") texto += "-";
      }
      const partes = filhosElementos(item).filter((parte) => parte.name !== "w:rPr");
      saida.push({
        elemento: item,
        texto,
        simples: envoltorio === null && partes.length === 1 && partes[0]!.name === "w:t",
        envoltorio,
      });
    }
  };
  visitar(paragrafo, null);
  return saida;
}

function paragrafosDoCorpo(raiz: Element): ParagrafoLido[] {
  const corpo = filho(raiz, "w:body");
  if (!corpo) throw new ErroDocx("O DOCX não tem corpo de documento (w:body).");
  const saida: ParagrafoLido[] = [];
  const visitar = (no: Element) => {
    for (const item of filhosElementos(no)) {
      if (IGNORADOS.has(item.name)) continue;
      if (item.name === "w:p") {
        const runs = runsDoParagrafo(item);
        saida.push({ elemento: item, runs, texto: runs.map((run) => run.texto).join("") });
      } else if (item.name !== "w:r") visitar(item);
    }
  };
  visitar(corpo);
  return saida;
}

type Local = { run: number; deslocamento: number };

/** Procura o trecho normalizado no parágrafo; devolve o primeiro e o último caractere (inclusive) nos runs. */
function localizar(paragrafo: ParagrafoLido, trecho: string): { inicio: Local; fim: Local } | null {
  const alvo = normalizar(trecho);
  if (!alvo) return null;
  // Texto normalizado do parágrafo, com a origem (run, deslocamento) de cada caractere.
  let texto = "";
  const origem: Local[] = [];
  paragrafo.runs.forEach((run, indiceRun) => {
    let deslocamento = 0;
    for (const c of run.texto) {
      const n = normalizarCaractere(c.normalize("NFC"));
      if (!(n === " " && (texto === "" || texto.endsWith(" ")))) {
        texto += n;
        origem.push({ run: indiceRun, deslocamento });
      }
      deslocamento += c.length;
    }
  });
  const posicao = texto.indexOf(alvo);
  if (posicao < 0) return null;
  return { inicio: origem[posicao]!, fim: origem[posicao + alvo.length - 1]! };
}

/** Abertura do elemento como está no arquivo (`<w:r w:rsidR="…">`). */
const abertura = (xml: string, elemento: Element) =>
  xml.slice(elemento.startIndex!, xml.indexOf(">", elemento.startIndex!) + 1);
const trechoXml = (xml: string, elemento: Element) => xml.slice(elemento.startIndex!, elemento.endIndex! + 1);

/** Run com o mesmo início e as mesmas propriedades, com outro texto. */
function runCom(xml: string, run: Element, texto: string): string {
  if (!texto) return "";
  const propriedades = filho(run, "w:rPr");
  return `${abertura(xml, run)}${propriedades ? trechoXml(xml, propriedades) : ""}<w:t xml:space="preserve">${escapar(texto)}</w:t></w:r>`;
}

type Edicao = { inicio: number; fim: number; texto: string };

/** Insere as marcas do comentário `id` em volta do trecho; `null` quando o arquivo não usa o prefixo `w:`. */
function marcar(xml: string, paragrafo: ParagrafoLido, inicio: Local, fim: Local, id: number): Edicao[] | null {
  const marcaInicio = `<w:commentRangeStart w:id="${id}"/>`;
  const marcaFim = `<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>`;
  const runInicio = paragrafo.runs[inicio.run]!;
  const runFim = paragrafo.runs[fim.run]!;
  for (const run of [runInicio, runFim]) if (!abertura(xml, run.elemento).startsWith("<w:r")) return null;

  // Run que não é só texto (tem tabulação, quebra, campo) não é dividido: a marca vai na borda dele.
  // Run dentro de um invólucro (`w:ins`, hiperlink…) também não: a marca vai na borda do invólucro.
  const corteInicio = runInicio.simples ? inicio.deslocamento : 0;
  const corteFim = runFim.simples ? fim.deslocamento + 1 : runFim.texto.length;
  const elementoDe = (run: RunLido) => run.envoltorio ?? run.elemento;
  const intervalo = (run: RunLido) => ({ inicio: elementoDe(run).startIndex!, fim: elementoDe(run).endIndex! + 1 });
  const inteiro = (run: RunLido) => trechoXml(xml, elementoDe(run));

  if (elementoDe(runInicio) === elementoDe(runFim)) {
    const run = runInicio;
    const corpo =
      run === runFim && run.simples
        ? runCom(xml, run.elemento, run.texto.slice(0, corteInicio)) +
          marcaInicio +
          runCom(xml, run.elemento, run.texto.slice(corteInicio, corteFim)) +
          marcaFim +
          runCom(xml, run.elemento, run.texto.slice(corteFim))
        : marcaInicio + inteiro(run) + marcaFim;
    return [{ ...intervalo(run), texto: corpo }];
  }
  const primeiro = runInicio.simples
    ? runCom(xml, runInicio.elemento, runInicio.texto.slice(0, corteInicio)) +
      marcaInicio +
      runCom(xml, runInicio.elemento, runInicio.texto.slice(corteInicio))
    : marcaInicio + inteiro(runInicio);
  const ultimo = runFim.simples
    ? runCom(xml, runFim.elemento, runFim.texto.slice(0, corteFim)) +
      marcaFim +
      runCom(xml, runFim.elemento, runFim.texto.slice(corteFim))
    : inteiro(runFim) + marcaFim;
  return [
    { ...intervalo(runInicio), texto: primeiro },
    { ...intervalo(runFim), texto: ultimo },
  ];
}

function aplicar(xml: string, edicoes: Edicao[]): string {
  let saida = xml;
  for (const edicao of [...edicoes].sort((a, b) => b.inicio - a.inicio))
    saida = saida.slice(0, edicao.inicio) + edicao.texto + saida.slice(edicao.fim);
  return saida;
}

function xmlDoComentario(id: number, anotacao: Anotacao, opcoes: Required<OpcoesComentarios>): string {
  const paragrafos = semControle(anotacao.texto)
    .split(/\n\s*\n/)
    .map((paragrafo, indice) => {
      const linhas = paragrafo
        .split("\n")
        .map((linha) => `<w:t xml:space="preserve">${escapar(linha)}</w:t>`)
        .join("<w:br/>");
      const referencia = indice === 0 ? "<w:r><w:annotationRef/></w:r>" : "";
      return `<w:p>${referencia}<w:r>${linhas}</w:r></w:p>`;
    })
    .join("");
  return (
    `<w:comment w:id="${id}" w:author="${escapar(opcoes.autor)}" w:date="${opcoes.data}" ` +
    `w:initials="${escapar(opcoes.iniciais)}">${paragrafos}</w:comment>`
  );
}

const DECLARACAO = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/**
 * Devolve o DOCX com um comentário por anotação ancorada. O arquivo de entrada passa pelos mesmos
 * limites da leitura (`PacoteOoxml`): é o mesmo arquivo que a conversão já aceitou.
 */
export function comentarDocx(
  bytes: Uint8Array,
  anotacoes: readonly Anotacao[],
  opcoes: OpcoesComentarios,
): ResultadoComentarios {
  const completas: Required<OpcoesComentarios> = {
    autor: opcoes.autor ?? "Simplifica IF (revisão prévia)",
    iniciais: opcoes.iniciais ?? "SIF",
    data: opcoes.data.replace(/\.\d+Z$/, "Z"),
  };
  const pacote = new PacoteOoxml(bytes);
  let parteDocumento: string | null = null;
  for (const relacao of pacote.relacoes("").values())
    if (RELACAO_DOCUMENTO.includes(relacao.tipo) && relacao.parte) parteDocumento = relacao.parte;
  if (!parteDocumento) throw new ErroDocx("O arquivo não tem documento principal do Word.");
  const bytesDocumento = pacote.binario(parteDocumento);
  if (!bytesDocumento) throw new ErroDocx("O documento principal do Word não está no arquivo.");
  if (bytesDocumento[0] === 0xff || bytesDocumento[0] === 0xfe)
    throw new ErroDocx("Documento em UTF-16: os comentários ainda não são gravados nesse caso.");
  let documento = decodificarXml(bytesDocumento);
  const raizInicial = analisarXml(documento, parteDocumento, pacote.limites);
  if (atributo(raizInicial!, "xmlns:w") !== NS_W)
    throw new ErroDocx("Documento sem o prefixo w: convencional: os comentários ainda não são gravados nesse caso.");

  // Comentários que já existem no arquivo continuam; os novos vêm depois, com ids livres.
  const relacoesDocumento = pacote.relacoes(parteDocumento);
  const relacaoExistente = [...relacoesDocumento.values()].find((relacao) => relacao.tipo === TIPO_COMENTARIOS);
  const parteComentarios = relacaoExistente?.parte ?? "word/comments.xml";
  const comentariosExistentes = relacaoExistente?.parte ? pacote.binario(relacaoExistente.parte) : null;
  let proximoId = 0;
  for (const encontrado of documento.matchAll(/<w:(?:comment|commentRangeStart|commentReference)\b[^>]*w:id="(\d+)"/g))
    proximoId = Math.max(proximoId, Number(encontrado[1]) + 1);
  const textoExistente = comentariosExistentes ? decodificarXml(comentariosExistentes) : null;
  for (const encontrado of textoExistente?.matchAll(/<w:comment\b[^>]*w:id="(\d+)"/g) ?? [])
    proximoId = Math.max(proximoId, Number(encontrado[1]) + 1);

  const resultado: ResultadoComentarios = { docx: bytes, ancoradas: [], naoAncoradas: [] };
  const novos: string[] = [];
  anotacoes.forEach((anotacao, indice) => {
    // Cada anotação relê o XML: as anteriores dividiram runs e mudaram as posições.
    const paragrafos = paragrafosDoCorpo(analisarXml(documento, parteDocumento, pacote.limites, { indices: true })!);
    let achado: { paragrafo: ParagrafoLido; inicio: Local; fim: Local } | null = null;
    for (const trecho of anotacao.trechos) {
      for (const paragrafo of paragrafos) {
        const local = localizar(paragrafo, trecho);
        if (local) {
          achado = { paragrafo, ...local };
          break;
        }
      }
      if (achado) break;
    }
    let noInicio = false;
    if (!achado && anotacao.noInicioSeAusente) {
      const primeiro = paragrafos.find((paragrafo) => paragrafo.texto.trim());
      if (primeiro) {
        const ultimo = primeiro.runs.length - 1;
        achado = {
          paragrafo: primeiro,
          inicio: { run: 0, deslocamento: 0 },
          fim: { run: ultimo, deslocamento: Math.max(0, primeiro.runs[ultimo]!.texto.length - 1) },
        };
        noInicio = true;
      }
    }
    if (!achado) {
      resultado.naoAncoradas.push({ indice, motivo: "trecho não encontrado num só parágrafo do arquivo" });
      return;
    }
    const id = proximoId;
    const edicoes = marcar(documento, achado.paragrafo, achado.inicio, achado.fim, id);
    if (!edicoes) {
      resultado.naoAncoradas.push({ indice, motivo: "run com prefixo XML incomum" });
      return;
    }
    documento = aplicar(documento, edicoes);
    novos.push(xmlDoComentario(id, anotacao, completas));
    proximoId += 1;
    resultado.ancoradas.push({ indice, paragrafo: achado.paragrafo.texto, noInicio });
  });
  if (novos.length === 0) return resultado;

  // Partes alteradas: documento, comentários e, quando a parte de comentários é nova, relações e tipos.
  const alteradas = new Map<string, Uint8Array>();
  alteradas.set(parteDocumento, strToU8(documento));
  if (textoExistente) {
    const fecho = textoExistente.lastIndexOf("</w:comments>");
    if (fecho < 0) throw new ErroDocx("A parte de comentários do arquivo está corrompida.");
    alteradas.set(
      parteComentarios,
      strToU8(textoExistente.slice(0, fecho) + novos.join("") + textoExistente.slice(fecho)),
    );
  } else {
    alteradas.set(
      parteComentarios,
      strToU8(`${DECLARACAO}<w:comments xmlns:w="${NS_W}">${novos.join("")}</w:comments>`),
    );
    const corte = parteDocumento.lastIndexOf("/");
    const parteRelacoes = `${parteDocumento.slice(0, corte + 1)}_rels/${parteDocumento.slice(corte + 1)}.rels`;
    const relacoesBrutas = pacote.binario(parteRelacoes);
    let idRelacao = 1;
    while (relacoesDocumento.has(`rId${idRelacao}`)) idRelacao += 1;
    const alvo = parteComentarios.slice(corte + 1);
    const novaRelacao = `<Relationship Id="rId${idRelacao}" Type="${TIPO_COMENTARIOS}" Target="${alvo}"/>`;
    const textoRelacoes = relacoesBrutas
      ? decodificarXml(relacoesBrutas)
      : `${DECLARACAO}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
    const fechoRelacoes = textoRelacoes.lastIndexOf("</Relationships>");
    if (fechoRelacoes < 0) throw new ErroDocx("As relações do documento estão corrompidas.");
    alteradas.set(
      parteRelacoes,
      strToU8(textoRelacoes.slice(0, fechoRelacoes) + novaRelacao + textoRelacoes.slice(fechoRelacoes)),
    );
    const tipos = decodificarXml(pacote.binario("[Content_Types].xml") ?? new Uint8Array());
    const fechoTipos = tipos.lastIndexOf("</Types>");
    if (fechoTipos < 0) throw new ErroDocx("O arquivo não declara os tipos de conteúdo.");
    alteradas.set(
      "[Content_Types].xml",
      strToU8(
        tipos.slice(0, fechoTipos) +
          `<Override PartName="/${parteComentarios}" ContentType="${CONTEUDO_COMENTARIOS}"/>` +
          tipos.slice(fechoTipos),
      ),
    );
  }

  // O ZIP é remontado com as partes na ordem original ([Content_Types].xml costuma ser a primeira).
  const arquivos: Record<string, Uint8Array> = {};
  for (const nome of pacote.nomes()) {
    if (nome.endsWith("/")) continue;
    arquivos[nome] = alteradas.get(nome) ?? pacote.binario(nome)!;
  }
  for (const [nome, conteudo] of alteradas) arquivos[nome] ??= conteudo;
  resultado.docx = zipSync(arquivos, { level: 6 });
  return resultado;
}
