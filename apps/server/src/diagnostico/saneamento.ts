/**
 * O saneamento do texto que entra no pacote de diagnóstico: funções puras, aplicadas a cada linha de
 * cada arquivo antes do `.zip`.
 *
 * A linha de texto que passa de `LIMITE_LINHA` é cortada **antes** das regras (o rótulo de um segredo
 * cortado no meio ainda casa e esconde o pedaço que ficou), e o texto é normalizado em NFC. Em ordem:
 *
 * 1. **Pastas de tarefa** (`raizesTarefas`: `Documentos/Simplifica IF` e as cópias dos turnos): o que
 *    vem depois da raiz, até as aspas, a quebra de linha ou o fim, vira `<raiz>/[pasta da tarefa]` (o
 *    nome da pasta vem do pedido da pessoa, e o do arquivo, do anexo).
 * 2. **Segredos** → `[segredo omitido]`: o usuário e a senha numa URL (`esquema://[segredo omitido]@host`);
 *    `Authorization: <esquema> <valor>` (fica o esquema) e `Bearer …`/`Basic …` soltos; `Cookie:` e
 *    `Set-Cookie:` até o fim do valor; o valor depois de um rótulo de segredo (`ingresso`, `token…`,
 *    `senha`, `password`, `passwd`, `pwd`, `pass`, `pin`, `secret`, `api_key`, `cookie`), com `=`, `:`
 *    ou `%3D`; e as chaves com formato conhecido (`sk-…`, `sk-ant-…`, `AIza…`, `ya29.…`, `ghp_…`,
 *    `github_pat_…`, `xox…-`, JWT). Um número puro depois do rótulo é segredo (`senha=12345678`, `pin:
 *    123456`), salvo a contagem: depois de `…tokens…` (`input_tokens=1234`) sempre fica, e depois de
 *    `token` fica com menos de 12 dígitos.
 * 3. **E-mails** → `[e-mail omitido]`.
 * 4. **Pasta pessoal** (`os.homedir()`) → `~`: com `\`, `\\` (logfmt e JSON escapados), `/`, as formas de
 *    `encodeURI` e `encodeURIComponent` (`file:///C:/Users/Jos%C3%A9…`), sem diferenciar maiúsculas e
 *    só com fronteira depois (separador ou fim: `/Users/ana` não casa `/Users/anabela`).
 * 5. **Nome de usuário em outro caminho** (`/home/<usuário>`, `C:\Users\<usuário>` quando a pasta
 *    pessoal é outra) → `[usuário]`; o nome solto no texto fica (casaria com palavras comuns, como
 *    "servidor"). A forma curta do Windows (`C:\Users\JOSDAS~1`) vira `~`.
 * 6. **Dados pessoais** da base (`omitirDadosPessoais`: CPF, RG, celular, matrícula, SIAPE), fora dos
 *    identificadores hexadecimais (`traceId`, `spanId`), que poderiam casar com a matrícula por acaso.
 *
 * As expressões são lineares (sem quantificador aninhado ambíguo, com os começos ancorados por
 * lookbehind e as repetições limitadas), e o corte vem antes, então uma linha enorme custa o mesmo que
 * uma de `LIMITE_LINHA`.
 *
 * Uma linha que é JSON (os `.jsonl` do OTLP, um pedido de exportação por linha) é lida e saneada valor a
 * valor, e a linha continua JSON válido: os identificadores (`traceId`, `spanId`, `parentSpanId`), os
 * instantes (`…UnixNano`) e os nomes de atributo (`key`) passam intactos; o valor de texto de uma chave
 * de segredo (inclusive o atributo OTLP `{ key: "…authorization", value: { stringValue } }`) vira o
 * marcador, e o número (`intValue`, `doubleValue`, número JSON) fica; o texto longo é cortado em
 * `LIMITE_LINHA`. Sem mudança, a linha original fica como estava.
 *
 * Limite conhecido: o segredo partido em duas linhas (`Authorization: Bearer` numa, o valor na seguinte)
 * não é reconhecido na segunda.
 */
import { omitirDadosPessoais } from "@simplifica-if/kb/ppcs/dados-pessoais";

export const MARCADOR_SEGREDO = "[segredo omitido]";
export const MARCADOR_EMAIL = "[e-mail omitido]";
export const MARCADOR_USUARIO = "[usuário]";
export const MARCADOR_PASTA_TAREFA = "[pasta da tarefa]";

/** O tamanho máximo de uma linha de texto e de um texto dentro de uma linha JSON. */
export const LIMITE_LINHA = 20_000;

export interface ContextoSaneamento {
  /** A pasta pessoal (`os.homedir()`); vazia, nada se troca. */
  readonly pastaPessoal: string;
  /** O nome de usuário do sistema (`os.userInfo().username`); vazio, nada se troca. */
  readonly usuario: string;
  /** As raízes das pastas de tarefa (`Documentos/Simplifica IF`, as cópias dos turnos). */
  readonly raizesTarefas?: ReadonlyArray<string>;
}

const escapar = (texto: string) => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Um separador de caminho: `\\` (escapado), `\`, `/` ou as formas de `encodeURIComponent`. */
const SEP = String.raw`(?:\\\\|\\|/|%5C|%2F)`;
/** Depois da pasta: um separador, o fim ou um caractere que não continua o nome. */
const FRONTEIRA = String.raw`(?=${SEP}|$|[^\p{L}\p{N}._~%-])`;

/** Um trecho de caminho como pode aparecer no log: cru, `encodeURI` ou `encodeURIComponent`. */
function formasDoTrecho(trecho: string): string {
  const formas = new Set([trecho, encodeURI(trecho), encodeURIComponent(trecho)]);
  return `(?:${[...formas].map(escapar).join("|")})`;
}

/** A expressão de um caminho absoluto em todas as formas de separador e de codificação; `undefined` se curto. */
function padraoDoCaminho(caminho: string): string | undefined {
  const limpo = caminho.normalize("NFC").replace(/[\\/]+$/, "");
  if (limpo.length < 3) return undefined;
  const trechos = limpo.split(/[\\/]+/);
  const inicio = /^[A-Za-z]:$/.test(trechos[0] ?? "") ? String.raw`(?<![\p{L}\p{N}])` : "";
  return inicio + trechos.map((trecho) => (trecho === "" ? "" : formasDoTrecho(trecho))).join(SEP);
}

/**
 * O resto do caminho depois da raiz: até as aspas, a quebra de linha ou o fim. O `\\` (escapado) passa
 * inteiro; um `\` antes de aspas fica (é o escape delas no logfmt).
 */
const RESTO_DO_CAMINHO = String.raw`(?:\\\\|\\(?!["'])|[^"'\x60\r\n\\])+`;

const RE_CREDENCIAL_URL = /\b([a-z][a-z0-9+.-]{0,20}:\/\/)[^\s/@:"'<>]{1,256}:[^\s/@"'<>]{1,256}@/gi;
const RE_AUTORIZACAO_CABECALHO =
  /(?<![\w-])((?:proxy-)?authorization\\?["']?\s*[=:]\s*\\?["']?)(?:([A-Za-z][\w-]{0,30})[ \t]+)?(?!\[)([^\s"',;\\]{1,4096})/gi;
const RE_PORTADOR = /\b(Bearer|Basic)\s+(?!\[)[A-Za-z0-9._~+/=-]{8,4096}/gi;
const RE_COOKIE = /(?<![\w-])((?:set-)?cookie\\?["']?\s*[:=]\s*)(?!\[)(?:\\.|[^\r\n"\\])+/gi;
const RE_ROTULADO = new RegExp(
  String.raw`(?<![\p{L}\d_-])((?:[\w-]{0,40}[_-])?(?:ingresso|senha|password|passwd|pwd|pass|pin|secret|api[_-]?key|apikey|token[\w-]{0,40})\\?["']?\s*(?:[=:]|%3D)\s*\\?["']?)(?!\[)([^\s"'&,;)}\]\\]{4,4096})`,
  "giu",
);
const RES_CHAVES: ReadonlyArray<RegExp> = [
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\bya29\.[0-9A-Za-z_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
];
const RE_EMAIL =
  /(?<![\p{L}\d._%+-])[\p{L}\d._%+-]{1,64}@[\p{L}\d-]{1,63}(?:\.[\p{L}\d-]{1,63}){0,10}\.\p{L}{2,24}(?![\p{L}\d-])/gu;
/** A forma curta 8.3 da pasta pessoal no Windows (`C:\Users\JOSDAS~1`). */
const RE_PASTA_CURTA = new RegExp(
  String.raw`(?<![\p{L}\p{N}])[A-Za-z]:${SEP}(?:Users|Documents and Settings)${SEP}[^\s\\/"'\x60~]{1,8}~\d{1,3}${FRONTEIRA}`,
  "giu",
);
/** Identificadores hexadecimais longos com ao menos uma letra (`traceId`, `spanId`, hashes). */
const RE_HEX = /(?<![0-9A-Za-z])[0-9a-fA-F]{16,}(?![0-9A-Za-z])/g;

/** O valor rotulado que fica: a contagem (`…tokens…`, ou `token` com menos de 12 dígitos). */
function ficaComoContagem(rotulo: string, valor: string): boolean {
  if (!/^\d+$/.test(valor)) return false;
  const nome = rotulo.toLowerCase();
  if (nome.includes("tokens")) return true;
  return nome.includes("token") && valor.length < 12;
}

/** As expressões do contexto, montadas uma vez. */
interface Regras {
  readonly raizes: ReadonlyArray<RegExp>;
  readonly pessoal: RegExp | undefined;
  readonly usuarioEmCaminho: RegExp | undefined;
}

const cache = new WeakMap<ContextoSaneamento, Regras>();

function regras(contexto: ContextoSaneamento): Regras {
  const pronta = cache.get(contexto);
  if (pronta !== undefined) return pronta;
  const raizes = (contexto.raizesTarefas ?? []).flatMap((raiz) => {
    const padrao = padraoDoCaminho(raiz);
    return padrao === undefined ? [] : [new RegExp(`(${padrao})(${SEP})${RESTO_DO_CAMINHO}`, "giu")];
  });
  const padraoPessoal = padraoDoCaminho(contexto.pastaPessoal);
  const usuario = contexto.usuario.normalize("NFC");
  const nova: Regras = {
    raizes,
    pessoal: padraoPessoal === undefined ? undefined : new RegExp(`${padraoPessoal}${FRONTEIRA}`, "giu"),
    usuarioEmCaminho:
      usuario.length < 2
        ? undefined
        : new RegExp(
            String.raw`((?:(?<![\p{L}\p{N}])[A-Za-z]:${SEP}(?:Users|Documents and Settings)|${SEP}(?:Users|home))${SEP})${formasDoTrecho(usuario)}${FRONTEIRA}`,
            "giu",
          ),
  };
  cache.set(contexto, nova);
  return nova;
}

/** Aplica `f` ao texto fora dos identificadores hexadecimais. */
function foraDosIdentificadores(texto: string, f: (trecho: string) => string): string {
  let saida = "";
  let ultimo = 0;
  for (const casado of texto.matchAll(RE_HEX)) {
    if (!/[a-f]/i.test(casado[0])) continue;
    saida += f(texto.slice(ultimo, casado.index)) + casado[0];
    ultimo = casado.index + casado[0].length;
  }
  return saida + f(texto.slice(ultimo));
}

/** As pastas de tarefa sob as raízes viram `<raiz>/[pasta da tarefa]`. */
export function omitirPastasDeTarefa(texto: string, contexto: ContextoSaneamento): string {
  let saida = texto;
  for (const re of regras(contexto).raizes)
    saida = saida.replace(re, (_casado, raiz: string, sep: string) => `${raiz}${sep}${MARCADOR_PASTA_TAREFA}`);
  return saida;
}

/** Os segredos de um texto viram o marcador. */
export function omitirSegredos(texto: string): string {
  let saida = texto.replace(RE_CREDENCIAL_URL, (_casado, esquema: string) => `${esquema}${MARCADOR_SEGREDO}@`);
  saida = saida.replace(
    RE_AUTORIZACAO_CABECALHO,
    (_casado, rotulo: string, esquema: string | undefined) =>
      `${rotulo}${esquema === undefined ? "" : `${esquema} `}${MARCADOR_SEGREDO}`,
  );
  saida = saida.replace(RE_PORTADOR, (_casado, esquema: string) => `${esquema} ${MARCADOR_SEGREDO}`);
  saida = saida.replace(RE_COOKIE, (_casado, rotulo: string) => `${rotulo}${MARCADOR_SEGREDO}`);
  saida = saida.replace(RE_ROTULADO, (casado, rotulo: string, valor: string) =>
    ficaComoContagem(rotulo, valor) ? casado : `${rotulo}${MARCADOR_SEGREDO}`,
  );
  for (const re of RES_CHAVES) saida = saida.replace(re, MARCADOR_SEGREDO);
  return saida;
}

/** As regras 1 a 6 num texto (sem corte). */
export function sanearTexto(texto: string, contexto: ContextoSaneamento): string {
  const r = regras(contexto);
  let saida = omitirPastasDeTarefa(texto.normalize("NFC"), contexto);
  saida = omitirSegredos(saida);
  saida = saida.replace(RE_EMAIL, MARCADOR_EMAIL);
  if (r.pessoal !== undefined) saida = saida.replace(r.pessoal, "~");
  if (r.usuarioEmCaminho !== undefined) saida = saida.replace(r.usuarioEmCaminho, `$1${MARCADOR_USUARIO}`);
  saida = saida.replace(RE_PASTA_CURTA, "~");
  return foraDosIdentificadores(saida, omitirDadosPessoais);
}

/** O texto cortado em `LIMITE_LINHA` antes das regras, com o aviso depois do texto saneado. */
const sanearCortado = (texto: string, contexto: ContextoSaneamento, aviso: string) =>
  texto.length > LIMITE_LINHA
    ? `${sanearTexto(texto.slice(0, LIMITE_LINHA), contexto)}${aviso}`
    : sanearTexto(texto, contexto);

/** As chaves JSON cujo valor passa intacto: identificadores e instantes (e o `key` do atributo OTLP, abaixo). */
const ehChaveIntacta = (chave: string) =>
  chave === "traceId" || chave === "spanId" || chave === "parentSpanId" || chave.endsWith("UnixNano");

/** O último trecho do nome (depois do último `.`) que diz que o valor é segredo. */
const RE_NOME_SEGREDO =
  /(?:^|[_-])(?:token|access_token|refresh_token|id_token|ingresso|senha|password|passwd|pwd|secret|authorization|api[_-]?key|apikey|cookie|credentials?)$/;
/** O nome em camelCase que começa por um rótulo de segredo (`tokenDesktop`, `senhaProxy`). */
const RE_NOME_SEGREDO_CAMEL = /^(?:token|ingresso|senha|password|secret|apiKey|cookie)(?:[A-Z]|$)/;

/** A chave JSON ou o nome de atributo OTLP cujo valor de texto é segredo (`uso.tokens_entrada` não é). */
export function ehNomeDeSegredo(nome: string): boolean {
  const ultimo = nome.slice(nome.lastIndexOf(".") + 1);
  return RE_NOME_SEGREDO.test(ultimo.toLowerCase()) || RE_NOME_SEGREDO_CAMEL.test(ultimo);
}

/** Os campos numéricos do `AnyValue` do OTLP: o número fica mesmo sob um nome de segredo. */
const CAMPOS_NUMERICOS = new Set(["intValue", "doubleValue", "boolValue"]);

/** Cada texto não vazio do valor vira o marcador; números (e os campos numéricos do OTLP) ficam. */
function ocultar(valor: unknown, chave: string | undefined): unknown {
  if (chave !== undefined && CAMPOS_NUMERICOS.has(chave)) return valor;
  if (typeof valor === "string") return valor === "" ? valor : MARCADOR_SEGREDO;
  if (Array.isArray(valor)) return valor.map((item) => ocultar(item, undefined));
  if (valor !== null && typeof valor === "object")
    return Object.fromEntries(Object.entries(valor).map(([nome, item]) => [nome, ocultar(item, nome)]));
  return valor;
}

/** Um valor JSON saneado; o mesmo objeto quando nada muda. */
function sanearValor(valor: unknown, contexto: ContextoSaneamento, chave: string | undefined): unknown {
  if (typeof valor === "string") {
    if (chave !== undefined && ehChaveIntacta(chave)) return valor;
    if (chave !== undefined && ehNomeDeSegredo(chave) && valor !== "") return MARCADOR_SEGREDO;
    const saneado = sanearCortado(valor, contexto, " … [cortado]");
    return saneado === valor ? valor : saneado;
  }
  if (Array.isArray(valor)) {
    const novo = valor.map((item) => sanearValor(item, contexto, undefined));
    return novo.every((item, indice) => item === valor[indice]) ? valor : novo;
  }
  if (valor !== null && typeof valor === "object") {
    const objeto = valor as Record<string, unknown>;
    // O atributo OTLP `{ key, value: { stringValue } }`: o nome diz se o valor é segredo.
    const atributoSegredo = typeof objeto.key === "string" && ehNomeDeSegredo(objeto.key);
    let mudou = false;
    const novo: Record<string, unknown> = {};
    for (const [nome, item] of Object.entries(objeto)) {
      const saneado =
        atributoSegredo && nome === "value"
          ? ocultar(item, undefined)
          : nome === "key" && "value" in objeto
            ? item
            : sanearValor(item, contexto, nome);
      if (saneado !== item) mudou = true;
      novo[nome] = saneado;
    }
    return mudou ? novo : valor;
  }
  return valor;
}

/** Um valor qualquer (o `sistema.json`) saneado como as linhas JSON. */
export function sanearJson<A>(valor: A, contexto: ContextoSaneamento): A {
  return sanearValor(valor, contexto, undefined) as A;
}

/** Uma linha de arquivo: JSON saneado valor a valor (continua JSON válido) ou texto, cortado no limite. */
export function sanearLinha(linha: string, contexto: ContextoSaneamento): string {
  const inicio = linha.trimStart()[0];
  if (inicio === "{" || inicio === "[") {
    let lido: unknown;
    try {
      lido = JSON.parse(linha);
    } catch {
      lido = undefined;
    }
    if (lido !== undefined) {
      const saneado = sanearValor(lido, contexto, undefined);
      return saneado === lido ? linha : JSON.stringify(saneado);
    }
  }
  return sanearCortado(linha, contexto, " … [linha cortada]");
}

/** O tamanho da linha resumida na prévia. */
const LIMITE_RESUMO = 300;

const cortarResumo = (texto: string) =>
  texto.length > LIMITE_RESUMO ? `${texto.slice(0, LIMITE_RESUMO - 1)}…` : texto;

/** Os registros de um pedido OTLP (spans ou logs) numa linha legível. */
function resumoOtlp(lido: unknown): string | undefined {
  if (lido === null || typeof lido !== "object") return undefined;
  const pedido = lido as Record<string, unknown>;
  const listas = (chave: string, interna: string, folha: string): ReadonlyArray<Record<string, unknown>> =>
    Array.isArray(pedido[chave])
      ? (pedido[chave] as ReadonlyArray<Record<string, unknown>>).flatMap((recurso) =>
          Array.isArray(recurso[interna])
            ? (recurso[interna] as ReadonlyArray<Record<string, unknown>>).flatMap((escopo) =>
                Array.isArray(escopo[folha]) ? (escopo[folha] as ReadonlyArray<Record<string, unknown>>) : [],
              )
            : [],
        )
      : [];
  const spans = listas("resourceSpans", "scopeSpans", "spans");
  if (spans.length > 0) {
    const nomes = spans.map((span) => {
      const status = span.status as { readonly code?: unknown } | undefined;
      return `${String(span.name ?? "?")}${status?.code === 2 ? " [erro]" : ""}`;
    });
    return `${spans.length} span(s): ${nomes.join(", ")}`;
  }
  const registros = listas("resourceLogs", "scopeLogs", "logRecords");
  if (registros.length > 0) {
    const textos = registros.map((registro) => {
      const corpo = registro.body as { readonly stringValue?: unknown } | undefined;
      return `${String(registro.severityText ?? "")} ${typeof corpo?.stringValue === "string" ? corpo.stringValue : ""}`.trim();
    });
    return `${registros.length} log(s): ${textos.join(" | ")}`;
  }
  return undefined;
}

/** Uma linha já saneada como vai na prévia: a de JSON resumida numa linha legível (ou cortada). */
export function linhaDaPrevia(linhaSaneada: string): string {
  const inicio = linhaSaneada.trimStart()[0];
  if (inicio === "{" || inicio === "[") {
    try {
      const resumo = resumoOtlp(JSON.parse(linhaSaneada));
      if (resumo !== undefined) return cortarResumo(resumo.replace(/\s+/g, " "));
    } catch {
      // Não é JSON: segue como texto.
    }
  }
  return cortarResumo(linhaSaneada);
}
