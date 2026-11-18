// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- `node:crypto` faz os hashes sobre bytes já lidos e `node:path` monta os caminhos de uma rodada já resolvida (funções puras); `interpretarAgora` monta a data de REVISAR_PPC_AGORA
/**
 * Rodada de análise: o serviço `Rodada`, que lê e grava os arquivos da rodada e os da base de
 * análise que ela consome (fichas, validações, tópicos, catálogo do CNCT) pelo `FileSystem` e pelo
 * `Path`, mais o relógio, os hashes e os caminhos. A identificação do curso fica em
 * `identificacao.ts`.
 *
 * Os arquivos da rodada saem sempre iguais: JSON tipado
 * (`@simplifica-if/kb/primitivas/json-tipado`), datas no fuso local com
 * deslocamento (`2026-11-13T10:00:00-03:00`) e caminhos absolutos resolvidos.
 */
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { TAMANHO_MAXIMO_GRUPO } from "@simplifica-if/kb/db/pacote-contexto";
import {
  analisarJsonTipado,
  jsonTipadoIndentado,
  serializarJsonTipado,
} from "@simplifica-if/kb/primitivas/json-tipado";
import { type Dicionario, textoDoValor } from "@simplifica-if/kb/primitivas/valores";
import { compararTexto, ordenarTextos } from "@simplifica-if/kb/texto";
import { type CaminhosAnalise, caminhosPadrao } from "./caminhos.ts";

// ---------------------------------------------------------------- erros

/** Arquivo que a rodada esperava e não existe. */
export class ArquivoDaRodadaAusente extends Schema.TaggedError<ArquivoDaRodadaAusente>()("ArquivoDaRodadaAusente", {
  arquivo: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Arquivo não encontrado: ${this.arquivo}`;
  }
}

/** Arquivo da rodada que não está em UTF-8. */
export class TextoDaRodadaInvalido extends Schema.TaggedError<TextoDaRodadaInvalido>()("TextoDaRodadaInvalido", {
  arquivo: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `${this.arquivo} não é um texto em UTF-8.`;
  }
}

/** Um arquivo da rodada com outra forma que a esperada (JSON quebrado ou fora do contrato). */
export class JsonDaRodadaInvalido extends Schema.TaggedError<JsonDaRodadaInvalido>()("JsonDaRodadaInvalido", {
  arquivo: Schema.String,
  esperado: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `${this.arquivo} precisa ser ${this.esperado}.`;
  }
}

/** Falhas de leitura de um texto da rodada. */
export type ErroLeitura = ArquivoDaRodadaAusente | TextoDaRodadaInvalido | PlatformError.PlatformError;

/** Tamanho máximo de um grupo de sub-agente (fichas); tópicos maiores viram partes. */
export const TAMANHO_GRUPO_PADRAO = TAMANHO_MAXIMO_GRUPO;

// ---------------------------------------------------------------- relógio

/** Fonte da data e hora atuais; injetável para testes e diferenciais. */
export type Relogio = () => Date;

/**
 * Formato aceito em `REVISAR_PPC_AGORA`:
 * `AAAA-MM-DD`, ou `AAAA-MM-DDTHH:MM[:SS[.ffffff]]` com fuso opcional (`Z` ou `±HH:MM`).
 */
const RE_AGORA = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * Instante de `REVISAR_PPC_AGORA` (data ISO 8601, veja `RE_AGORA`), que o ponto de entrada lê para
 * fixar o relógio em testes. Data sem hora é meia-noite local e data-hora sem fuso é hora local;
 * o resto (inclusive dia que não existe no calendário) dá `undefined`.
 */
export function interpretarAgora(texto: string): Date | undefined {
  const m = RE_AGORA.exec(texto);
  if (!m) return undefined;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Dia que existe no calendário (`new Date` aceitaria 2026-02-30 como 2 de março).
  const calendario = new Date(Date.UTC(ano, mes - 1, dia));
  if (calendario.getUTCMonth() !== mes - 1 || calendario.getUTCDate() !== dia) return undefined;
  // `new Date("AAAA-MM-DD")` seria meia-noite UTC; a data sem hora é meia-noite local.
  const data = texto.length === 10 ? new Date(ano, mes - 1, dia) : new Date(texto);
  return Number.isNaN(data.getTime()) ? undefined : data;
}

const dois = (n: number) => String(n).padStart(2, "0");

/** Hora local com deslocamento, até os segundos (`2026-11-13T10:00:00-03:00`). */
export function agoraIso(relogio: Relogio): string {
  const data = relogio();
  const deslocamento = -data.getTimezoneOffset();
  const sinal = deslocamento < 0 ? "-" : "+";
  const absoluto = Math.abs(deslocamento);
  return (
    `${String(data.getFullYear()).padStart(4, "0")}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}` +
    `T${dois(data.getHours())}:${dois(data.getMinutes())}:${dois(data.getSeconds())}` +
    `${sinal}${dois(Math.floor(absoluto / 60))}:${dois(absoluto % 60)}`
  );
}

/** Hora local para nome de pasta (`2026-11-13t10-00-00`). */
export function timestampSlug(relogio: Relogio): string {
  const data = relogio();
  return (
    `${String(data.getFullYear()).padStart(4, "0")}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}` +
    `t${dois(data.getHours())}-${dois(data.getMinutes())}-${dois(data.getSeconds())}`
  );
}

// ---------------------------------------------------------------- hashes e textos (puros)

export function sha256Texto(texto: string): string {
  return NodeCrypto.createHash("sha256").update(texto, "utf8").digest("hex");
}

/** Hash do JSON compacto com chaves ordenadas por code point. */
export function sha256JsonPayload(valor: unknown): string {
  return sha256Texto(serializarJsonTipado(valor, { ordenarChaves: true, separadores: [",", ":"] }));
}

/** Itens ordenados pelo texto do `id` (code point); sem `id`, o texto vazio. */
export function ordenarPorId<T extends Dicionario>(itens: T[]): T[] {
  return [...itens].sort((a, b) => compararTexto(textoDoValor(a.id ?? ""), textoDoValor(b.id ?? "")));
}

const decodificadorUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// ---------------------------------------------------------------- caminhos da rodada

export type CaminhosRodada = {
  rodadaDir: string;
  suporteDir: string;
  artefatosConversaoDir: string;
  ppc: string;
  ppcBruto: string;
  metadata: string;
  manifesto: string;
  preparacaoDocx: string;
  cnctContexto: string;
  contextoEstruturalSubagents: string;
  validacoesCruzadasContexto: string;
  gruposAvulsosDir: string;
  promptsSubagentsDir: string;
  promptsSubagentsManifest: string;
  resultadosSubagents: string;
  gruposSubagents: string;
  relatorioHtml: string;
};

/**
 * Arquivos de uma rodada cujo diretório já está resolvido (absoluto, com symlinks resolvidos):
 * o relatório na raiz e o resto em `arquivos-suporte/`. `Rodada.caminhos` resolve antes.
 */
export function caminhosRodada(rodadaDir: string): CaminhosRodada {
  const base = NodePath.join(rodadaDir, "arquivos-suporte");
  return {
    rodadaDir,
    suporteDir: base,
    artefatosConversaoDir: NodePath.join(base, "artefatos-conversao"),
    ppc: NodePath.join(base, "PPC.md"),
    ppcBruto: NodePath.join(base, "PPC-bruto.md"),
    metadata: NodePath.join(base, "metadata.json"),
    manifesto: NodePath.join(base, "manifesto-rodada.json"),
    preparacaoDocx: NodePath.join(base, "preparacao-docx.json"),
    cnctContexto: NodePath.join(base, "cnct-contexto.json"),
    contextoEstruturalSubagents: NodePath.join(base, "contexto-estrutural-subagents.json"),
    validacoesCruzadasContexto: NodePath.join(base, "validacoes-cruzadas-contexto.json"),
    gruposAvulsosDir: NodePath.join(base, "grupos-avulsos"),
    promptsSubagentsDir: NodePath.join(base, "prompts-subagents"),
    promptsSubagentsManifest: NodePath.join(base, "prompts-subagents", "manifest.json"),
    resultadosSubagents: NodePath.join(base, "resultados-subagents.json"),
    gruposSubagents: NodePath.join(base, "grupos-subagents.json"),
    relatorioHtml: NodePath.join(rodadaDir, "relatorio-revisao.html"),
  };
}

// ---------------------------------------------------------------- serviço

/** `stat` que falhou porque o caminho (ou uma pasta dele) não existe. */
function naoExiste(erro: PlatformError.PlatformError): boolean {
  const motivo = erro.reason;
  if (motivo._tag === "NotFound") return true;
  // `ENOTDIR`: um arquivo no lugar de uma pasta do caminho, que `existsSync` também dava como ausente.
  return Predicate.hasProperty(motivo.cause, "code") && motivo.cause.code === "ENOTDIR";
}

export class Rodada extends Context.Service<
  Rodada,
  {
    /** Caminho absoluto, com symlinks resolvidos na parte que existe. */
    readonly resolverCaminho: (caminho: string) => Effect.Effect<string, PlatformError.PlatformError>;
    /** Os arquivos da rodada em `rodada`, resolvida antes. */
    readonly caminhos: (rodada: string) => Effect.Effect<CaminhosRodada, PlatformError.PlatformError>;
    readonly existe: (caminho: string) => Effect.Effect<boolean, PlatformError.PlatformError>;
    readonly ehDiretorio: (caminho: string) => Effect.Effect<boolean, PlatformError.PlatformError>;
    /** Tamanho do arquivo em bytes. */
    readonly tamanho: (caminho: string) => Effect.Effect<number, ArquivoDaRodadaAusente | PlatformError.PlatformError>;
    readonly lerBytes: (
      caminho: string,
    ) => Effect.Effect<Uint8Array, ArquivoDaRodadaAusente | PlatformError.PlatformError>;
    /** Texto em UTF-8 estrito, com quebras de linha universais. */
    readonly lerTexto: (caminho: string) => Effect.Effect<string, ErroLeitura>;
    /** JSON da rodada (fracionários preservados). */
    readonly lerJson: (caminho: string) => Effect.Effect<unknown, ErroLeitura | JsonDaRodadaInvalido>;
    /** Grava um texto em UTF-8, criando a pasta. */
    readonly escreverTexto: (caminho: string, texto: string) => Effect.Effect<void, PlatformError.PlatformError>;
    /** Grava bytes ou texto, criando a pasta. */
    readonly escreverArquivo: (
      caminho: string,
      conteudo: string | Uint8Array,
    ) => Effect.Effect<void, PlatformError.PlatformError>;
    /** Grava um JSON da rodada, indentado e com `\n` final. */
    readonly escreverJson: (caminho: string, valor: unknown) => Effect.Effect<void, PlatformError.PlatformError>;
    readonly criarDiretorio: (caminho: string) => Effect.Effect<void, PlatformError.PlatformError>;
    /** Copia o arquivo, criando a pasta; com `preservarDatas`, copia também as datas de acesso e modificação. */
    readonly copiarArquivo: (
      origem: string,
      destino: string,
      opcoes?: { readonly preservarDatas?: boolean },
    ) => Effect.Effect<void, PlatformError.PlatformError>;
    /** Arquivos de `diretorio` cujo nome termina em `sufixo`, por nome (code point); diretório ausente dá lista vazia. */
    readonly listarArquivos: (
      diretorio: string,
      sufixo: string,
    ) => Effect.Effect<string[], PlatformError.PlatformError>;
    readonly sha256Arquivo: (
      caminho: string,
    ) => Effect.Effect<string, ArquivoDaRodadaAusente | PlatformError.PlatformError>;
    /** Hash de nome e conteúdo dos `*.json` do diretório, em ordem de nome. */
    readonly sha256CatalogoJson: (
      diretorio: string,
    ) => Effect.Effect<string, ArquivoDaRodadaAusente | PlatformError.PlatformError>;
  }
>()("simplifica-if/.agents/skills/revisar-ppc/scripts/rodada") {}

export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const existe = Effect.fn("Rodada.existe")(function* (caminho: string) {
    return yield* fs.stat(caminho).pipe(
      Effect.as(true),
      Effect.catchIf(naoExiste, () => Effect.succeed(false)),
    );
  });

  const ehDiretorio = Effect.fn("Rodada.ehDiretorio")(function* (caminho: string) {
    return yield* fs.stat(caminho).pipe(
      Effect.map((info) => info.type === "Directory"),
      Effect.catchIf(naoExiste, () => Effect.succeed(false)),
    );
  });

  const resolverCaminho = Effect.fn("Rodada.resolverCaminho")(function* (caminho: string) {
    const absoluto = path.resolve(caminho);
    let existente = absoluto;
    const resto: string[] = [];
    while (!(yield* existe(existente))) {
      const pai = path.dirname(existente);
      if (pai === existente) return absoluto;
      resto.unshift(path.basename(existente));
      existente = pai;
    }
    return path.join(yield* fs.realPath(existente), ...resto);
  });

  const caminhos = Effect.fn("Rodada.caminhos")(function* (rodada: string) {
    return caminhosRodada(yield* resolverCaminho(rodada));
  });

  /** A falha de leitura vira `ArquivoDaRodadaAusente` quando o arquivo não existe. */
  const ausenteSeNaoExiste =
    (arquivo: string) =>
    <A, R>(efeito: Effect.Effect<A, PlatformError.PlatformError, R>) =>
      efeito.pipe(Effect.catchIf(naoExiste, (cause) => Effect.fail(new ArquivoDaRodadaAusente({ arquivo, cause }))));

  const tamanho = Effect.fn("Rodada.tamanho")(function* (caminho: string) {
    const info = yield* fs.stat(caminho).pipe(ausenteSeNaoExiste(caminho));
    return Number(info.size);
  });

  const lerBytes = Effect.fn("Rodada.lerBytes")(function* (caminho: string) {
    return yield* fs.readFile(caminho).pipe(ausenteSeNaoExiste(caminho));
  });

  const lerTexto = Effect.fn("Rodada.lerTexto")(function* (caminho: string) {
    const bytes = yield* lerBytes(caminho);
    const texto = yield* Effect.try({
      try: () => decodificadorUtf8.decode(bytes),
      catch: (cause) => new TextoDaRodadaInvalido({ arquivo: caminho, cause }),
    });
    return texto.replace(/\r\n?/g, "\n");
  });

  const lerJson = Effect.fn("Rodada.lerJson")(function* (caminho: string) {
    const texto = yield* lerTexto(caminho);
    return yield* Effect.try({
      try: () => analisarJsonTipado(texto),
      catch: (cause) => new JsonDaRodadaInvalido({ arquivo: caminho, esperado: "um JSON válido", cause }),
    });
  });

  const criarDiretorio = Effect.fn("Rodada.criarDiretorio")(function* (caminho: string) {
    yield* fs.makeDirectory(caminho, { recursive: true });
  });

  const escreverArquivo = Effect.fn("Rodada.escreverArquivo")(function* (
    caminho: string,
    conteudo: string | Uint8Array,
  ) {
    yield* criarDiretorio(path.dirname(caminho));
    if (typeof conteudo === "string") yield* fs.writeFileString(caminho, conteudo);
    else yield* fs.writeFile(caminho, conteudo);
  });

  const escreverTexto = Effect.fn("Rodada.escreverTexto")(function* (caminho: string, texto: string) {
    yield* escreverArquivo(caminho, texto);
  });

  const escreverJson = Effect.fn("Rodada.escreverJson")(function* (caminho: string, valor: unknown) {
    yield* escreverArquivo(caminho, jsonTipadoIndentado(valor));
  });

  const copiarArquivo = Effect.fn("Rodada.copiarArquivo")(function* (
    origem: string,
    destino: string,
    opcoes: { readonly preservarDatas?: boolean } = {},
  ) {
    yield* criarDiretorio(path.dirname(destino));
    yield* fs.copyFile(origem, destino);
    if (!opcoes.preservarDatas) return;
    const info = yield* fs.stat(origem);
    if (Option.isSome(info.atime) && Option.isSome(info.mtime)) {
      yield* fs.utimes(destino, info.atime.value, info.mtime.value);
    }
  });

  const listarArquivos = Effect.fn("Rodada.listarArquivos")(function* (diretorio: string, sufixo: string) {
    if (!(yield* ehDiretorio(diretorio))) return [];
    const nomes = (yield* fs.readDirectory(diretorio)).filter((nome) => nome.endsWith(sufixo));
    return ordenarTextos(nomes).map((nome) => path.join(diretorio, nome));
  });

  const sha256Arquivo = Effect.fn("Rodada.sha256Arquivo")(function* (caminho: string) {
    return NodeCrypto.createHash("sha256")
      .update(yield* lerBytes(caminho))
      .digest("hex");
  });

  const sha256CatalogoJson = Effect.fn("Rodada.sha256CatalogoJson")(function* (diretorio: string) {
    const arquivos = yield* listarArquivos(diretorio, ".json");
    if (!arquivos.length) return sha256Texto("[]");
    const hash = NodeCrypto.createHash("sha256");
    for (const arquivo of arquivos) {
      hash.update(Buffer.from(path.basename(arquivo), "utf8"));
      hash.update(Buffer.from([0]));
      hash.update(yield* lerBytes(arquivo));
      hash.update(Buffer.from([0]));
    }
    return hash.digest("hex");
  });

  return Rodada.of({
    resolverCaminho,
    caminhos,
    existe,
    ehDiretorio,
    tamanho,
    lerBytes,
    lerTexto,
    lerJson,
    escreverTexto,
    escreverArquivo,
    escreverJson,
    criarDiretorio,
    copiarArquivo,
    listarArquivos,
    sha256Arquivo,
    sha256CatalogoJson,
  });
});

export const layer = Layer.effect(Rodada, make);

// ---------------------------------------------------------------- operações sobre o serviço

/** Fichas na ordem dos nomes de arquivo. */
export const carregarFichas = Effect.fn("Rodada.carregarFichas")(function* (fichasDir: string) {
  const rodada = yield* Rodada;
  const fichas: Dicionario[] = [];
  for (const arquivo of yield* rodada.listarArquivos(fichasDir, ".json")) {
    fichas.push((yield* rodada.lerJson(arquivo)) as Dicionario);
  }
  return fichas;
});

/** Caminho relativo a `base` quando dentro dela; senão, absoluto. */
export const caminhoRelativoSeguro = Effect.fn("Rodada.caminhoRelativoSeguro")(function* (
  caminho: string,
  base: string,
) {
  const rodada = yield* Rodada;
  const alvo = yield* rodada.resolverCaminho(caminho);
  const raiz = yield* rodada.resolverCaminho(base);
  if (alvo === raiz) return ".";
  const prefixo = raiz.endsWith(NodePath.sep) ? raiz : raiz + NodePath.sep;
  return alvo.startsWith(prefixo) ? alvo.slice(prefixo.length) : alvo;
});

/** Grava `manifesto-rodada.json` com os hashes de PPC, fichas, validações e prompts. */
export const atualizarManifestoBase = Effect.fn("Rodada.atualizarManifestoBase")(function* (
  rodadaDir: string,
  opcoes: { caminhos?: CaminhosAnalise; relogio: Relogio },
) {
  const rodada = yield* Rodada;
  const skill = opcoes.caminhos ?? caminhosPadrao();
  const caminhos = yield* rodada.caminhos(rodadaDir);
  const promptSubagent = NodePath.join(skill.promptsDir, "subagent-lote-fichas.md");
  const promptSintese = NodePath.join(skill.promptsDir, "sintese-transversal.md");
  const hashSeExiste = (arquivo: string) =>
    Effect.flatMap(rodada.existe(arquivo), (existe) => (existe ? rodada.sha256Arquivo(arquivo) : Effect.succeed("")));
  const manifesto: Dicionario = {
    rodada_id: NodePath.basename(rodadaDir),
    rodada_dir: caminhos.rodadaDir,
    ppc_sha256: yield* rodada.sha256Arquivo(caminhos.ppc),
    fichas_sha256: yield* rodada.sha256CatalogoJson(skill.fichasDir),
    validacoes_cruzadas_sha256: yield* rodada.sha256CatalogoJson(skill.validacoesCruzadasDir),
    prompt_subagent_sha256: yield* hashSeExiste(promptSubagent),
    prompt_sintese_transversal_sha256: yield* hashSeExiste(promptSintese),
    execucao: "subagents-na-conversa",
    criado_em: agoraIso(opcoes.relogio),
  };
  yield* rodada.escreverJson(caminhos.manifesto, manifesto);
  return manifesto;
});
