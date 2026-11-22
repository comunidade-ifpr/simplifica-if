/**
 * A "caixa-preta" dos traces no app empacotado: o que o `OtlpTracer` e o `OtlpLogger` exportam fica em
 * memória, por `traceId`, e só vai ao arquivo o que interessa a quem investiga um problema relatado:
 *
 * - **Raiz com erro** (status OTLP 2: falha ou defeito, nunca interrupção): o trace inteiro, com os logs.
 *   Um erro recuperado num filho, com o raiz ok, não basta.
 * - **Raiz lento, sem erro**: um resumo, o raiz e os spans de `RESUMO_SPAN_MS` ou mais, sem os logs
 *   abaixo de Warn. O span do RPC envolve o stream inteiro: um turno de conversa ou uma revisão passa
 *   sempre do limiar, e o trace inteiro de cada turno encheria o arquivo.
 * - **Raiz que nunca chega**: quando o trace passa da idade, grava inteiro se algum span teve erro e se
 *   descarta se não.
 *
 * O resto se descarta quando o raiz termina. Funções puras sobre o OTLP/JSON que os exportadores
 * produzem; quem grava é o `ArquivoOtlp.ts`. O relógio vem de quem chama.
 *
 * **Raiz.** Um span sem pai ou de tipo servidor (2): o handler do RPC é filho do span da chamada na
 * interface, que não chega aqui, e o trace dele acaba quando ele acaba.
 *
 * **Logs.** Sem trace, vão os de nível Info ou acima (a partida, a atualização: contexto barato). Com
 * trace, seguem o trace: guardados com ele e gravados se ele for gravado inteiro; Warn ou acima vão na
 * hora, porque costumam ser a falha que o trace vai mostrar, e não podem se perder se o trace se
 * descartar.
 *
 * **Memória.** Contagens (traces, spans e logs por trace) e um teto de bytes estimados (o tamanho do
 * JSON de cada span e log). Passando um deles, sai o trace de atividade mais antiga (LRU). Os traces
 * descartados (raiz ok, resumo, despejo, idade) se lembram num conjunto limitado: o que chega depois
 * para eles se ignora, sem abrir entrada nova.
 */

/** Os limites da memória da caixa-preta. */
export interface Limites {
  /** Traces em curso guardados; passando, sai o de atividade mais antiga. */
  readonly traces: number;
  /** Spans guardados por trace; passando, saem os mais antigos (os do fim explicam a falha). */
  readonly spansPorTrace: number;
  /** Logs guardados por trace; passando, saem os mais antigos. */
  readonly logsPorTrace: number;
  /** Bytes estimados (o JSON dos spans e logs) de todos os traces em curso; passando, sai o de atividade mais antiga. */
  readonly bytes: number;
  /** Idade máxima de um trace em curso: um raiz que nunca termina (um stream aberto) não segura memória. */
  readonly idadeMs: number;
  /** Duração do raiz a partir da qual um trace sem erro grava o resumo. */
  readonly lentoMs: number;
  /** Quantos traces já gravados se lembram, para gravar na hora os spans e logs que chegam depois. */
  readonly gravadosLembrados: number;
  /** Quantos traces descartados se lembram, para ignorar o que chega depois para eles. */
  readonly descartadosLembrados: number;
}

export const LIMITES: Limites = {
  // Uma pessoa abre poucas conversas ao mesmo tempo; 200 traces em curso sobram.
  traces: 200,
  // Um turno longo de conversa gera centenas de spans (SQL, MCP); 500 guardam o fim dele.
  spansPorTrace: 500,
  logsPorTrace: 200,
  // 20 MB: o teto real da memória, porque 200 traces × 500 spans de uns KB passariam de 100 MB.
  bytes: 20 * 1024 * 1024,
  // 15 min: mais que um turno longo; depois disso o trace em curso grava (se teve erro) ou se descarta.
  idadeMs: 15 * 60 * 1000,
  // 10 s: uma chamada de leitura ou de pasta leva milissegundos; 10 s é lentidão que a pessoa sente.
  lentoMs: 10_000,
  gravadosLembrados: 1000,
  descartadosLembrados: 1000,
};

/**
 * No resumo de um trace lento, os spans de 1 s ou mais além do raiz: mostram onde o tempo foi (o
 * provider, a leitura do DOCX, uma consulta lenta) sem as centenas de spans curtos de SQL e MCP.
 */
export const RESUMO_SPAN_MS = 1000;

/** Status OTLP de erro (`StatusCode.Error`). */
const STATUS_ERRO = 2;
/** Tipo OTLP de span de servidor (`SpanKind.server`). */
const TIPO_SERVIDOR = 2;
/** Severidade OTLP de Info e de Warn (`SeverityNumber`). */
const SEVERIDADE_INFO = 9;
const SEVERIDADE_WARN = 13;

/** O pedaço de um span OTLP/JSON que a caixa-preta lê; o resto passa como veio. */
export interface SpanOtlp {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string | undefined;
  readonly kind?: number | undefined;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly status?: { readonly code?: number | undefined } | undefined;
}

/** O pedaço de um registro de log OTLP/JSON que a caixa-preta lê. */
export interface LogOtlp {
  readonly traceId?: string | Uint8Array | undefined;
  readonly severityNumber?: number | undefined;
}

/** Um `ExportTraceServiceRequest` em JSON: `resourceSpans` → `scopeSpans` → `spans`. */
export interface PedidoTraces {
  readonly resourceSpans: ReadonlyArray<{
    readonly resource?: unknown;
    readonly scopeSpans: ReadonlyArray<{ readonly scope?: unknown; readonly spans: ReadonlyArray<SpanOtlp> }>;
  }>;
}

/** Um `ExportLogsServiceRequest` em JSON: `resourceLogs` → `scopeLogs` → `logRecords`. */
export interface PedidoLogs {
  readonly resourceLogs: ReadonlyArray<{
    readonly resource?: unknown;
    readonly scopeLogs: ReadonlyArray<{ readonly scope?: unknown; readonly logRecords?: ReadonlyArray<LogOtlp> }>;
  }>;
}

/** O que gravar depois de um pedido: um pedido de traces e um de logs, cada um só se houver o que gravar. */
export interface AGravar {
  readonly traces: PedidoTraces | undefined;
  readonly logs: PedidoLogs | undefined;
}

interface Guardado<A> {
  readonly valor: A;
  readonly bytes: number;
}

interface EmCurso {
  readonly criadoEm: number;
  readonly spans: Array<Guardado<SpanOtlp>>;
  readonly logs: Array<Guardado<LogOtlp>>;
  /** Algum span do trace teve erro (mesmo um que já saiu da lista pelo limite). */
  temErro: boolean;
  bytes: number;
}

const ehRaiz = (span: SpanOtlp): boolean =>
  span.parentSpanId === undefined || span.parentSpanId === "" || span.kind === TIPO_SERVIDOR;

const duracaoMs = (span: SpanOtlp): number => {
  try {
    return Number((BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano)) / 1_000_000n);
  } catch {
    return 0;
  }
};

/**
 * O `traceId` de um log, ou `""` sem trace. O log de um fiber sem tracing (o do próprio exportador) traz
 * o `traceId` do span "noop", que não é hexadecimal: conta como sem trace.
 */
const traceIdDoLog = (log: LogOtlp): string =>
  typeof log.traceId === "string" && /^[0-9a-f]{32}$/iu.test(log.traceId) ? log.traceId : "";

/** O tamanho estimado de um span ou log: o do JSON dele (caracteres, perto dos bytes). */
const estimarBytes = (valor: unknown): number => {
  try {
    return JSON.stringify(valor).length;
  } catch {
    return 0;
  }
};

/** Um conjunto que esquece os mais antigos passando do limite. */
const lembrarEm = (conjunto: Set<string>, traceId: string, limite: number): void => {
  conjunto.add(traceId);
  if (conjunto.size > limite) {
    const maisAntigo = conjunto.values().next();
    if (maisAntigo.done !== true) conjunto.delete(maisAntigo.value);
  }
};

/**
 * O estado da caixa-preta: os traces em curso (num `Map` em ordem de última atividade), os já gravados
 * e os descartados. Um por processo, atrás do `HttpClient` de arquivo; os dois exportadores (traces e
 * logs) o compartilham.
 */
export class CaixaPreta {
  private readonly emCurso = new Map<string, EmCurso>();
  private readonly gravados = new Set<string>();
  private readonly descartados = new Set<string>();
  private bytes = 0;
  // O envelope (resource e scope) do último pedido de cada sinal, para remontar o pedido a gravar.
  private envelopeSpans: { readonly resource?: unknown; readonly scope?: unknown } = {};
  private envelopeLogs: { readonly resource?: unknown; readonly scope?: unknown } = {};

  private readonly limites: Limites;

  constructor(limites: Limites = LIMITES) {
    this.limites = limites;
  }

  /** Recebe um lote de spans e diz o que gravar agora. */
  spans(pedido: PedidoTraces, agoraMs: number): AGravar {
    const spans: Array<SpanOtlp> = [];
    const logs: Array<LogOtlp> = [];
    this.expirar(agoraMs, spans, logs);
    for (const recurso of pedido.resourceSpans) {
      for (const escopo of recurso.scopeSpans) {
        this.envelopeSpans = { resource: recurso.resource, scope: escopo.scope };
        for (const span of escopo.spans) this.receberSpan(span, agoraMs, spans, logs);
      }
    }
    return { traces: this.pedidoTraces(spans), logs: this.pedidoLogs(logs) };
  }

  /** Recebe um lote de logs e diz o que gravar agora (a idade pode soltar um trace com erro). */
  logs(pedido: PedidoLogs, agoraMs: number): AGravar {
    const spans: Array<SpanOtlp> = [];
    const logs: Array<LogOtlp> = [];
    this.expirar(agoraMs, spans, logs);
    for (const recurso of pedido.resourceLogs) {
      for (const escopo of recurso.scopeLogs) {
        this.envelopeLogs = { resource: recurso.resource, scope: escopo.scope };
        for (const log of escopo.logRecords ?? []) {
          const severidade = log.severityNumber ?? 0;
          const traceId = traceIdDoLog(log);
          if (traceId === "") {
            if (severidade >= SEVERIDADE_INFO) logs.push(log);
          } else if (this.gravados.has(traceId) || severidade >= SEVERIDADE_WARN) {
            logs.push(log);
          } else if (!this.descartados.has(traceId)) {
            const trace = this.tocar(traceId, agoraMs);
            this.guardar(trace, trace.logs, log, this.limites.logsPorTrace);
            this.conterBytes();
          }
        }
      }
    }
    return { traces: this.pedidoTraces(spans), logs: this.pedidoLogs(logs) };
  }

  /** Quantos traces estão em curso (para os testes dos limites). */
  get tracesEmCurso(): number {
    return this.emCurso.size;
  }

  /** Os bytes estimados guardados (para os testes dos limites). */
  get bytesEmCurso(): number {
    return this.bytes;
  }

  private receberSpan(span: SpanOtlp, agoraMs: number, spans: Array<SpanOtlp>, logs: Array<LogOtlp>): void {
    const traceId = span.traceId;
    if (this.gravados.has(traceId)) {
      spans.push(span);
      return;
    }
    if (this.descartados.has(traceId)) return;
    const trace = this.tocar(traceId, agoraMs);
    this.guardar(trace, trace.spans, span, this.limites.spansPorTrace);
    if (span.status?.code === STATUS_ERRO) trace.temErro = true;
    if (ehRaiz(span)) {
      this.retirar(traceId);
      if (span.status?.code === STATUS_ERRO) {
        this.gravarInteiro(traceId, trace, spans, logs);
      } else {
        if (duracaoMs(span) >= this.limites.lentoMs) {
          for (const { valor } of trace.spans) {
            if (valor === span || duracaoMs(valor) >= RESUMO_SPAN_MS) spans.push(valor);
          }
        }
        lembrarEm(this.descartados, traceId, this.limites.descartadosLembrados);
      }
      return;
    }
    this.conterBytes();
  }

  /** O trace em curso, criado se preciso, passado para o fim da ordem de atividade. */
  private tocar(traceId: string, agoraMs: number): EmCurso {
    const existente = this.emCurso.get(traceId);
    if (existente !== undefined) {
      this.emCurso.delete(traceId);
      this.emCurso.set(traceId, existente);
      return existente;
    }
    if (this.emCurso.size >= this.limites.traces) this.despejarMaisAntigo();
    const novo: EmCurso = { criadoEm: agoraMs, spans: [], logs: [], temErro: false, bytes: 0 };
    this.emCurso.set(traceId, novo);
    return novo;
  }

  private guardar<A>(trace: EmCurso, lista: Array<Guardado<A>>, valor: A, limite: number): void {
    const bytes = estimarBytes(valor);
    lista.push({ valor, bytes });
    trace.bytes += bytes;
    this.bytes += bytes;
    if (lista.length > limite) {
      const saiu = lista.shift();
      if (saiu !== undefined) {
        trace.bytes -= saiu.bytes;
        this.bytes -= saiu.bytes;
      }
    }
  }

  /** Passando do teto de bytes, despeja os traces de atividade mais antiga. */
  private conterBytes(): void {
    while (this.bytes > this.limites.bytes && this.emCurso.size > 0) this.despejarMaisAntigo();
  }

  private despejarMaisAntigo(): void {
    const maisAntigo = this.emCurso.keys().next();
    if (maisAntigo.done === true) return;
    this.retirar(maisAntigo.value);
    lembrarEm(this.descartados, maisAntigo.value, this.limites.descartadosLembrados);
  }

  private retirar(traceId: string): void {
    const trace = this.emCurso.get(traceId);
    if (trace === undefined) return;
    this.emCurso.delete(traceId);
    this.bytes -= trace.bytes;
  }

  private gravarInteiro(traceId: string, trace: EmCurso, spans: Array<SpanOtlp>, logs: Array<LogOtlp>): void {
    for (const { valor } of trace.spans) spans.push(valor);
    for (const { valor } of trace.logs) logs.push(valor);
    lembrarEm(this.gravados, traceId, this.limites.gravadosLembrados);
  }

  /** Os traces em curso mais velhos que o limite: gravados inteiros se tiveram erro, descartados se não. */
  private expirar(agoraMs: number, spans: Array<SpanOtlp>, logs: Array<LogOtlp>): void {
    for (const [traceId, trace] of this.emCurso) {
      if (agoraMs - trace.criadoEm < this.limites.idadeMs) continue;
      this.retirar(traceId);
      if (trace.temErro) this.gravarInteiro(traceId, trace, spans, logs);
      else lembrarEm(this.descartados, traceId, this.limites.descartadosLembrados);
    }
  }

  private pedidoTraces(spans: ReadonlyArray<SpanOtlp>): PedidoTraces | undefined {
    return spans.length === 0
      ? undefined
      : {
          resourceSpans: [
            { resource: this.envelopeSpans.resource, scopeSpans: [{ scope: this.envelopeSpans.scope, spans }] },
          ],
        };
  }

  private pedidoLogs(logs: ReadonlyArray<LogOtlp>): PedidoLogs | undefined {
    return logs.length === 0
      ? undefined
      : {
          resourceLogs: [
            { resource: this.envelopeLogs.resource, scopeLogs: [{ scope: this.envelopeLogs.scope, logRecords: logs }] },
          ],
        };
  }
}
