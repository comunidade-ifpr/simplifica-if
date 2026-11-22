#!/usr/bin/env node
/**
 * Lê os traces do servidor local (`traces.jsonl` e `logs-otlp.jsonl` da pasta de logs, mais os `.1` do
 * giro) e responde as perguntas de quem depura: a árvore do trace de um código de erro, os traces com
 * erro, os lentos, os últimos. Os arquivos são OTLP/JSON, um pedido de exportação por linha (o formato do
 * file exporter do OpenTelemetry Collector), gravados por `apps/server/src/observabilidade/`.
 *
 *   pnpm traces --codigo ABCD1234      # a árvore do trace (spans, duração, status, erro) e os logs dele
 *   pnpm traces --erros                # os traces com erro, os mais recentes primeiro
 *   pnpm traces --lentos 2000          # os traces de 2 s ou mais
 *   pnpm traces --ultimos 5            # os 5 traces mais recentes (padrão: 20)
 *   pnpm traces --logs                 # os logs sem trace gravado (a partida, os avisos de gravação)
 *   pnpm traces --erros --json         # JSON achatado, para agentes
 *   pnpm traces --pasta <dir>          # outra pasta de logs (padrão: a do app em desenvolvimento)
 *   pnpm traces --arquivo <traces.jsonl>  # só esse arquivo, sem os logs
 *
 * O código é o de "Detalhes técnicos" na interface e o `codigo=` do `simplifica-if.log`: os 8 primeiros
 * caracteres do `traceId`, em maiúsculas (`codigoDoErro`). Na caixa-preta, um trace descartado pode ter
 * deixado só os logs de Warn: o `--codigo` mostra esses logs mesmo sem spans.
 */
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import { codigoDoErro } from "@simplifica-if/contratos-app/ponte";
import * as HostProcess from "@simplifica-if/motor/t3/HostProcess";
import { executarPrincipal } from "./principal.ts";

export const ARQUIVO_TRACES = "traces.jsonl";
export const ARQUIVO_LOGS = "logs-otlp.jsonl";

/** O tamanho máximo do texto de erro de um span na saída. */
const LIMITE_ERRO = 2000;
/** O tamanho máximo de um atributo na linha do span, na árvore de texto. */
const LIMITE_ATRIBUTO = 120;

export interface SpanPlano {
  readonly traceId: string;
  readonly codigo: string;
  readonly spanId: string;
  readonly paiId: string | null;
  readonly nome: string;
  readonly tipo: string;
  readonly inicio: string;
  readonly duracaoMs: number;
  readonly status: "ok" | "erro" | "interrompido";
  readonly erro: string | null;
  /** O `exception.type` do primeiro evento `exception`, se houver. */
  readonly tipoErro: string | null;
  readonly atributos: Readonly<Record<string, unknown>>;
  /** O início em nanossegundos (para ordenar), em texto como no OTLP. */
  readonly inicioNs: string;
  readonly fimNs: string;
}

export interface LogPlano {
  readonly traceId: string | null;
  readonly spanId: string | null;
  readonly em: string;
  readonly nivel: string;
  readonly mensagem: string;
  readonly atributos: Readonly<Record<string, unknown>>;
  readonly emNs: string;
}

export interface TracePlano {
  readonly traceId: string;
  readonly codigo: string;
  readonly inicio: string;
  readonly duracaoMs: number;
  readonly raiz: string;
  readonly status: "ok" | "erro" | "interrompido";
  readonly erro: string | null;
  readonly spans: ReadonlyArray<SpanPlano>;
  readonly logs: ReadonlyArray<LogPlano>;
}

/* ------------------------------------------------------------------ leitura do OTLP/JSON */

interface ValorOtlp {
  readonly stringValue?: string | null;
  readonly boolValue?: boolean | null;
  readonly intValue?: string | number | null;
  readonly doubleValue?: number | null;
  readonly arrayValue?: { readonly values?: ReadonlyArray<ValorOtlp> };
  readonly kvlistValue?: { readonly values?: ReadonlyArray<ChaveValorOtlp> };
  readonly bytesValue?: unknown;
}

interface ChaveValorOtlp {
  readonly key: string;
  readonly value?: ValorOtlp;
}

interface SpanOtlp {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind?: number;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly attributes?: ReadonlyArray<ChaveValorOtlp>;
  readonly events?: ReadonlyArray<{ readonly name: string; readonly attributes?: ReadonlyArray<ChaveValorOtlp> }>;
  readonly status?: { readonly code?: number; readonly message?: string };
}

interface LogOtlp {
  readonly traceId?: string;
  readonly spanId?: string;
  readonly timeUnixNano: string;
  readonly severityText?: string;
  readonly body?: ValorOtlp;
  readonly attributes?: ReadonlyArray<ChaveValorOtlp>;
}

const TIPOS = ["não especificado", "interno", "servidor", "cliente", "produtor", "consumidor"];

/** Um `AnyValue` do OTLP como valor JSON comum. */
export const valorOtlp = (valor: ValorOtlp | undefined): unknown => {
  if (valor === undefined) return null;
  if (valor.stringValue !== undefined && valor.stringValue !== null) return valor.stringValue;
  if (valor.boolValue !== undefined && valor.boolValue !== null) return valor.boolValue;
  if (valor.intValue !== undefined && valor.intValue !== null) return Number(valor.intValue);
  if (valor.doubleValue !== undefined && valor.doubleValue !== null) return valor.doubleValue;
  if (valor.arrayValue !== undefined) return (valor.arrayValue.values ?? []).map(valorOtlp);
  if (valor.kvlistValue !== undefined) return atributosOtlp(valor.kvlistValue.values ?? []);
  return null;
};

export const atributosOtlp = (lista: ReadonlyArray<ChaveValorOtlp>): Record<string, unknown> =>
  Object.fromEntries(lista.map((kv) => [kv.key, valorOtlp(kv.value)]));

const iso = (nanos: string): string => {
  try {
    return DateTime.formatIso(DateTime.makeUnsafe(Number(BigInt(nanos) / 1_000_000n)));
  } catch {
    return nanos;
  }
};

const ms = (de: string, ate: string): number => {
  try {
    return Number(BigInt(ate) - BigInt(de)) / 1_000_000;
  } catch {
    return 0;
  }
};

const cortar = (texto: string): string =>
  texto.length > LIMITE_ERRO ? `${texto.slice(0, LIMITE_ERRO)}… (cortado)` : texto;

/** Quantas linhas não eram JSON (uma gravação cortada, um arquivo estranho): a saída avisa. */
export interface Contagem {
  ilegiveis: number;
}

const linhasJson = (texto: string, contagem?: Contagem): Array<unknown> =>
  texto.split("\n").flatMap((linha) => {
    if (linha.trim() === "") return [];
    try {
      return [JSON.parse(linha)];
    } catch {
      if (contagem !== undefined) contagem.ilegiveis++;
      return [];
    }
  });

const atributosDaExcecao = (span: SpanOtlp): Record<string, unknown> => {
  const excecao = span.events?.find((evento) => evento.name === "exception");
  return excecao === undefined ? {} : atributosOtlp(excecao.attributes ?? []);
};

/** O texto do erro de um span: a mensagem do status e a pilha do primeiro evento `exception`. */
const erroDoSpan = (span: SpanOtlp): string | null => {
  if (span.status?.code !== 2) return null;
  const pilha = atributosDaExcecao(span)["exception.stacktrace"];
  const mensagem = span.status.message ?? "erro";
  return cortar(typeof pilha === "string" && pilha.trim() !== "" ? pilha : mensagem);
};

const planoDoSpan = (span: SpanOtlp): SpanPlano => {
  const atributos = atributosOtlp(span.attributes ?? []);
  const erro = erroDoSpan(span);
  const tipoErro = atributosDaExcecao(span)["exception.type"];
  return {
    traceId: span.traceId,
    codigo: codigoDoErro(span.traceId),
    spanId: span.spanId,
    paiId: span.parentSpanId === undefined || span.parentSpanId === "" ? null : span.parentSpanId,
    nome: span.name,
    tipo: TIPOS[span.kind ?? 0] ?? String(span.kind),
    inicio: iso(span.startTimeUnixNano),
    duracaoMs: ms(span.startTimeUnixNano, span.endTimeUnixNano),
    status: erro !== null ? "erro" : atributos["effect.fiber.interrupted"] === true ? "interrompido" : "ok",
    erro,
    tipoErro: typeof tipoErro === "string" && tipoErro !== "" ? tipoErro : null,
    atributos,
    inicioNs: span.startTimeUnixNano,
    fimNs: span.endTimeUnixNano,
  };
};

/** Os spans de um `traces.jsonl` (um `ExportTraceServiceRequest` por linha), achatados. */
export const lerSpans = (texto: string, contagem?: Contagem): Array<SpanPlano> =>
  linhasJson(texto, contagem).flatMap((pedido) =>
    ((pedido as { resourceSpans?: Array<{ scopeSpans?: Array<{ spans?: Array<SpanOtlp> }> }> }).resourceSpans ?? [])
      .flatMap((recurso) => recurso.scopeSpans ?? [])
      .flatMap((escopo) => escopo.spans ?? [])
      .map(planoDoSpan),
  );

/**
 * Um `traceId` de verdade (32 hexadecimais); o log de um fiber sem tracing (o do exportador) traz o do
 * span "noop", que conta como sem trace.
 */
const traceIdValido = (traceId: string | undefined): string | null =>
  traceId !== undefined && /^[0-9a-f]{32}$/iu.test(traceId) ? traceId : null;

/**
 * O texto de um log: o corpo e, se o log traz uma causa (`Effect.logError(causa)`, com o corpo vazio), o
 * tipo e a mensagem do erro.
 */
const mensagemDoLog = (corpo: unknown, atributos: Readonly<Record<string, unknown>>): string => {
  const texto = Array.isArray(corpo)
    ? corpo.map((parte) => (typeof parte === "string" ? parte : JSON.stringify(parte))).join(" ")
    : typeof corpo === "string"
      ? corpo
      : JSON.stringify(corpo);
  const mensagemErro = atributos["exception.message"];
  if (typeof mensagemErro !== "string") return texto;
  const tipo = atributos["exception.type"];
  const erro = typeof tipo === "string" ? `${tipo}: ${mensagemErro}` : mensagemErro;
  return texto === "" ? erro : `${texto} (${erro})`;
};

/** Os logs de um `logs-otlp.jsonl` (um `ExportLogsServiceRequest` por linha), achatados. */
export const lerLogs = (texto: string, contagem?: Contagem): Array<LogPlano> =>
  linhasJson(texto, contagem).flatMap((pedido) =>
    ((pedido as { resourceLogs?: Array<{ scopeLogs?: Array<{ logRecords?: Array<LogOtlp> }> }> }).resourceLogs ?? [])
      .flatMap((recurso) => recurso.scopeLogs ?? [])
      .flatMap((escopo) => escopo.logRecords ?? [])
      .map((log) => {
        const corpo = valorOtlp(log.body);
        const atributos = atributosOtlp(log.attributes ?? []);
        return {
          traceId: traceIdValido(log.traceId),
          spanId: log.spanId === undefined || log.spanId === "" ? null : log.spanId,
          em: iso(log.timeUnixNano),
          nivel: (log.severityText ?? "").toUpperCase(),
          mensagem: mensagemDoLog(corpo, atributos),
          atributos,
          emNs: log.timeUnixNano,
        };
      }),
  );

const porNs = (a: string, b: string): number => {
  const diferenca = BigInt(a) - BigInt(b);
  return diferenca < 0n ? -1 : diferenca > 0n ? 1 : 0;
};

const NIVEIS_DE_ERRO = new Set(["ERROR", "FATAL"]);

/** O trace de que só os logs ficaram (a caixa-preta descartou os spans e gravou os logs de Warn). */
const traceSoDeLogs = (traceId: string, logs: ReadonlyArray<LogPlano>): TracePlano => {
  const ordenados = logs.toSorted((a, b) => porNs(a.emNs, b.emNs));
  const comErro = ordenados.find((log) => NIVEIS_DE_ERRO.has(log.nivel));
  return {
    traceId,
    codigo: codigoDoErro(traceId),
    inicio: ordenados[0]?.em ?? "",
    duracaoMs: 0,
    raiz: "",
    status: comErro === undefined ? "ok" : "erro",
    erro: comErro?.mensagem ?? null,
    spans: [],
    logs: ordenados,
  };
};

/**
 * Junta spans e logs por trace, em ordem de início (do mais antigo ao mais novo). Um trace só de logs
 * (sem span gravado) entra no fim, com `spans` vazio.
 */
export const agrupar = (spans: ReadonlyArray<SpanPlano>, logs: ReadonlyArray<LogPlano>): Array<TracePlano> => {
  const porTrace = new Map<string, Array<SpanPlano>>();
  const vistos = new Set<string>();
  for (const span of spans) {
    // O mesmo span pode vir duas vezes (o arquivo e o `.1` do giro): fica o primeiro.
    const chave = `${span.traceId}/${span.spanId}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const lista = porTrace.get(span.traceId);
    if (lista === undefined) porTrace.set(span.traceId, [span]);
    else lista.push(span);
  }
  const logsPorTrace = new Map<string, Array<LogPlano>>();
  for (const log of logs) {
    if (log.traceId === null) continue;
    const lista = logsPorTrace.get(log.traceId);
    if (lista === undefined) logsPorTrace.set(log.traceId, [log]);
    else lista.push(log);
  }
  const soDeLogs = [...logsPorTrace.entries()]
    .filter(([traceId]) => !porTrace.has(traceId))
    .map(([traceId, lista]) => traceSoDeLogs(traceId, lista));
  const traces = [...porTrace.entries()].map(([traceId, lista]): TracePlano => {
    const ordenados = lista.toSorted((a, b) => porNs(a.inicioNs, b.inicioNs));
    const ids = new Set(ordenados.map((s) => s.spanId));
    const raiz = ordenados.find((s) => s.paiId === null || !ids.has(s.paiId)) ?? ordenados[0];
    const inicioNs = ordenados[0]?.inicioNs ?? "0";
    const fimNs = ordenados.map((s) => s.fimNs).reduce((a, b) => (porNs(a, b) >= 0 ? a : b), inicioNs);
    const comErro = ordenados.find((s) => s.status === "erro");
    return {
      traceId,
      codigo: codigoDoErro(traceId),
      inicio: iso(inicioNs),
      duracaoMs: ms(inicioNs, fimNs),
      raiz: raiz?.nome ?? "",
      status: comErro !== undefined ? "erro" : raiz?.status === "interrompido" ? "interrompido" : "ok",
      erro: comErro?.erro ?? null,
      spans: ordenados,
      logs: (logsPorTrace.get(traceId) ?? []).toSorted((a, b) => porNs(a.emNs, b.emNs)),
    };
  });
  return [
    ...traces.toSorted((a, b) => porNs(a.spans[0]?.inicioNs ?? "0", b.spans[0]?.inicioNs ?? "0")),
    ...soDeLogs.toSorted((a, b) => porNs(a.logs[0]?.emNs ?? "0", b.logs[0]?.emNs ?? "0")),
  ];
};

/** Os logs sem trace gravado (sem `traceId`, ou de um trace sem spans), os mais recentes primeiro. */
export const logsSoltos = (
  spans: ReadonlyArray<SpanPlano>,
  logs: ReadonlyArray<LogPlano>,
  ultimos: number,
): Array<LogPlano> => {
  const comSpans = new Set(spans.map((span) => span.traceId));
  return logs
    .filter((log) => log.traceId === null || !comSpans.has(log.traceId))
    .toSorted((a, b) => porNs(b.emNs, a.emNs))
    .slice(0, ultimos);
};

/* ------------------------------------------------------------------ consultas e saída */

export interface Consulta {
  readonly codigo?: string | undefined;
  /** Os logs sem trace gravado, no lugar dos traces. */
  readonly logs?: boolean | undefined;
  readonly erros?: boolean | undefined;
  readonly lentosMs?: number | undefined;
  readonly ultimos: number;
}

/** Os traces que respondem à consulta: os do código, ou os filtrados, mais recentes primeiro. */
export const consultar = (traces: ReadonlyArray<TracePlano>, consulta: Consulta): Array<TracePlano> => {
  if (consulta.codigo !== undefined) {
    const procurado = consulta.codigo.trim().toUpperCase();
    return traces.filter((trace) => trace.traceId.toUpperCase().startsWith(procurado));
  }
  return traces
    .filter((trace) => trace.spans.length > 0)
    .filter((trace) => consulta.erros !== true || trace.status === "erro")
    .filter((trace) => consulta.lentosMs === undefined || trace.duracaoMs >= consulta.lentosMs)
    .toReversed()
    .slice(0, consulta.ultimos);
};

const duracao = (valor: number): string =>
  valor >= 1000 ? `${(valor / 1000).toFixed(2)} s` : `${valor.toFixed(1)} ms`;

const indentar = (texto: string, prefixo: string): string =>
  texto
    .split("\n")
    .map((linha) => `${prefixo}${linha}`)
    .join("\n");

const cortarAtributo = (texto: string): string => {
  const umaLinha = texto.replace(/\s+/gu, " ").trim();
  return umaLinha.length > LIMITE_ATRIBUTO ? `${umaLinha.slice(0, LIMITE_ATRIBUTO)}…` : umaLinha;
};

/** Os atributos que ajudam a ler a árvore, curtos, na linha do span. */
const atributosUteis = (span: SpanPlano): string => {
  const partes: Array<string> = [];
  const metodo = span.atributos["rpc.method"];
  if (typeof metodo === "string" && metodo !== span.nome) partes.push(`rpc.method=${metodo}`);
  for (const chave of ["http.request.method", "url.path", "http.response.status_code"]) {
    const valor = span.atributos[chave];
    if (typeof valor === "string" || typeof valor === "number") partes.push(`${chave}=${valor}`);
  }
  if (span.tipoErro !== null) partes.push(`exception.type=${span.tipoErro}`);
  const consulta = span.atributos["db.query.text"];
  if (typeof consulta === "string") partes.push(`db.query.text=${cortarAtributo(consulta)}`);
  return partes.length === 0 ? "" : `  ${partes.join(" ")}`;
};

/** A árvore de um trace em texto: cada span com duração e status, o erro embaixo, e os logs do trace. */
export const arvore = (trace: TracePlano): string => {
  const filhos = new Map<string | null, Array<SpanPlano>>();
  const ids = new Set(trace.spans.map((s) => s.spanId));
  for (const span of trace.spans) {
    const pai = span.paiId !== null && ids.has(span.paiId) ? span.paiId : null;
    const lista = filhos.get(pai);
    if (lista === undefined) filhos.set(pai, [span]);
    else lista.push(span);
  }
  const linhas = [
    `trace ${trace.traceId} (código ${trace.codigo}) ${trace.inicio} ${duracao(trace.duracaoMs)} ${trace.status}`,
  ];
  if (trace.spans.length === 0) linhas.push("  (nenhum span gravado: só os logs)");
  const descer = (pai: string | null, nivel: number): void => {
    for (const span of filhos.get(pai) ?? []) {
      const marca = span.status === "erro" ? "ERRO" : span.status;
      linhas.push(
        `${"  ".repeat(nivel + 1)}${span.nome} [${span.tipo}] ${duracao(span.duracaoMs)} ${marca}${atributosUteis(span)}`,
      );
      if (span.erro !== null) linhas.push(indentar(span.erro, `${"  ".repeat(nivel + 2)}| `));
      descer(span.spanId, nivel + 1);
    }
  };
  descer(null, 0);
  if (trace.logs.length > 0) {
    linhas.push("  logs:");
    for (const log of trace.logs) linhas.push(`    ${log.em} ${log.nivel} ${log.mensagem}`);
  }
  return linhas.join("\n");
};

/** Uma linha por log solto: o momento, o nível, o código do trace (se houver) e a mensagem. */
export const linhaDeLog = (log: LogPlano): string =>
  [log.em, log.nivel.padEnd(5), log.traceId === null ? "" : codigoDoErro(log.traceId), log.mensagem]
    .filter((parte) => parte !== "")
    .join("  ");

/** Uma linha por trace, para as listas. */
export const resumo = (trace: TracePlano): string =>
  [
    trace.codigo,
    trace.inicio,
    duracao(trace.duracaoMs).padStart(10),
    trace.status.padEnd(12),
    trace.raiz,
    trace.erro === null ? "" : `— ${trace.erro.split("\n")[0] ?? ""}`,
  ]
    .join("  ")
    .trimEnd();

/** O JSON para máquinas: sem os campos de ordenação internos. */
export const paraJson = (traces: ReadonlyArray<TracePlano>, completo: boolean): unknown =>
  traces.map((trace) => ({
    traceId: trace.traceId,
    codigo: trace.codigo,
    inicio: trace.inicio,
    duracaoMs: trace.duracaoMs,
    raiz: trace.raiz,
    status: trace.status,
    erro: trace.erro,
    ...(completo
      ? {
          spans: trace.spans.map(({ inicioNs: _i, fimNs: _f, ...span }) => span),
          logs: trace.logs.map(({ emNs: _e, ...log }) => log),
        }
      : { spans: trace.spans.length }),
  }));

const emJson = (traces: ReadonlyArray<TracePlano>, completo: boolean): string =>
  JSON.stringify(paraJson(traces, completo), null, 2);

const logsEmJson = (logs: ReadonlyArray<LogPlano>): string =>
  JSON.stringify(
    logs.map(({ emNs: _e, ...log }) => log),
    null,
    2,
  );

/** A pasta de logs do app em desenvolvimento (`<userData>/logs`, com o nome "Simplifica IF (dev)"). */
export const pastaPadrao = (plataforma: string, home: string, appData: string | undefined, path: Path.Path) => {
  const nome = "Simplifica IF (dev)";
  if (plataforma === "darwin") return path.join(home, "Library", "Application Support", nome, "logs");
  if (plataforma === "win32") return path.join(appData ?? path.join(home, "AppData", "Roaming"), nome, "logs");
  return path.join(home, ".config", nome, "logs");
};

/** Lê os arquivos (o `.1` antes do atual) e devolve o texto da resposta. */
export const executar = Effect.fn("traces.executar")(function* (opcoes: {
  readonly pasta: string | undefined;
  readonly arquivo: string | undefined;
  readonly consulta: Consulta;
  readonly json: boolean;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const ler = (caminho: string) =>
    fs.exists(caminho).pipe(
      Effect.flatMap((existe) => (existe ? fs.readFileString(caminho) : Effect.succeed(""))),
      Effect.orElseSucceed(() => ""),
    );
  const pasta =
    opcoes.pasta ??
    pastaPadrao(
      yield* HostProcess.Platform,
      yield* HostProcess.HomeDirectory,
      Option.getOrUndefined(yield* Config.option(Config.String("APPDATA"))),
      path,
    );
  const arquivosTraces =
    opcoes.arquivo === undefined
      ? [path.join(pasta, `${ARQUIVO_TRACES}.1`), path.join(pasta, ARQUIVO_TRACES)]
      : [opcoes.arquivo];
  const arquivosLogs =
    opcoes.arquivo === undefined ? [path.join(pasta, `${ARQUIVO_LOGS}.1`), path.join(pasta, ARQUIVO_LOGS)] : [];
  const textosTraces = yield* Effect.forEach(arquivosTraces, ler);
  const textosLogs = yield* Effect.forEach(arquivosLogs, ler);
  if (textosTraces.every((texto) => texto === "") && textosLogs.every((texto) => texto === "")) {
    return `nenhum trace em ${arquivosTraces.join(" nem ")}`;
  }
  const contagem: Contagem = { ilegiveis: 0 };
  const spans = textosTraces.flatMap((texto) => lerSpans(texto, contagem));
  const logs = textosLogs.flatMap((texto) => lerLogs(texto, contagem));
  const aviso =
    contagem.ilegiveis === 0
      ? undefined
      : `${contagem.ilegiveis} ${contagem.ilegiveis === 1 ? "linha ilegível ignorada" : "linhas ilegíveis ignoradas"}`;
  // No JSON, o aviso vai ao stderr: o stdout fica só com o JSON.
  if (opcoes.json && aviso !== undefined) yield* Console.error(aviso);
  const comAviso = (texto: string) => (aviso === undefined ? texto : `${texto}\n\n${aviso}`);

  if (opcoes.consulta.logs === true) {
    const soltos = logsSoltos(spans, logs, opcoes.consulta.ultimos);
    if (opcoes.json) return logsEmJson(soltos);
    return comAviso(soltos.length === 0 ? "nenhum log sem trace" : soltos.map(linhaDeLog).join("\n"));
  }
  const traces = consultar(agrupar(spans, logs), opcoes.consulta);
  const porCodigo = opcoes.consulta.codigo !== undefined;
  if (opcoes.json) return emJson(traces, porCodigo);
  if (traces.length === 0)
    return comAviso(porCodigo ? `nenhum trace com o código ${opcoes.consulta.codigo}` : "nenhum trace");
  return comAviso(porCodigo ? traces.map(arvore).join("\n\n") : traces.map(resumo).join("\n"));
});

const comando = Command.make(
  "traces",
  {
    pasta: Flag.String("pasta").pipe(
      Flag.withDescription("a pasta de logs (padrão: a do app em desenvolvimento)"),
      Flag.optional,
    ),
    arquivo: Flag.String("arquivo").pipe(Flag.withDescription("um traces.jsonl só, sem os logs"), Flag.optional),
    codigo: Flag.String("codigo").pipe(
      Flag.withDescription("o código do erro (8 caracteres) ou o traceId: mostra a árvore do trace"),
      Flag.optional,
    ),
    erros: Flag.Boolean("erros").pipe(Flag.withDescription("só os traces com erro"), Flag.withDefault(false)),
    lentos: Flag.Int("lentos").pipe(Flag.withDescription("só os traces de N ms ou mais"), Flag.optional),
    ultimos: Flag.Int("ultimos").pipe(Flag.withDescription("quantos traces (ou logs) listar"), Flag.withDefault(20)),
    logs: Flag.Boolean("logs").pipe(
      Flag.withDescription("os logs sem trace gravado (a partida, os avisos de gravação), os mais recentes primeiro"),
      Flag.withDefault(false),
    ),
    json: Flag.Boolean("json").pipe(Flag.withDescription("saída em JSON achatado"), Flag.withDefault(false)),
  },
  (opcoes) =>
    Effect.gen(function* () {
      const saida = yield* executar({
        pasta: Option.getOrUndefined(opcoes.pasta),
        arquivo: Option.getOrUndefined(opcoes.arquivo),
        consulta: {
          codigo: Option.getOrUndefined(opcoes.codigo),
          erros: opcoes.erros,
          lentosMs: Option.getOrUndefined(opcoes.lentos),
          ultimos: opcoes.ultimos,
          logs: opcoes.logs,
        },
        json: opcoes.json,
      });
      yield* Console.log(saida);
    }),
).pipe(
  Command.withDescription("Lê traces.jsonl e logs-otlp.jsonl do servidor local: árvore por código, erros, lentos."),
);

if (import.meta.main) {
  executarPrincipal("traces", Command.run(comando, { version: "1.0.0" }));
}
