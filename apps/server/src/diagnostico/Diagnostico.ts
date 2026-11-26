// @effect-diagnostics nodeBuiltinImport:off -- a versão do sistema operacional vem do `node:os`
/**
 * "Gerar diagnóstico" (Configurações › Diagnóstico): o pacote `.zip` que a pessoa anexa ao relato de um
 * problema, para quem mantém o app depurar.
 *
 * - `preparar`: a prévia, arquivo por arquivo, com o tamanho já saneado, as últimas linhas de cada log
 *   (saneadas; as de JSON resumidas numa linha) e o `sistema.json` como vai sair.
 * - `gerar`: o mesmo conteúdo num `.zip` (`fflate`, como a cópia comentada do `packages/docx`), gravado
 *   em `Documentos/Simplifica IF/Diagnósticos/diagnostico-AAAA-MM-DD-HHMMSS.zip` pelas `PastasTrabalho`.
 *   Nada sai do computador: a pessoa anexa o arquivo, se quiser. O pacote é montado (e saneado) de novo
 *   na hora: pode trazer linhas registradas depois da prévia.
 *
 * O pacote leva, da pasta de logs (`--pasta-logs`), o `simplifica-if.log`, o `traces.jsonl` e o
 * `logs-otlp.jsonl` e os `.1` deles (os que existirem); o `sistema.json` (versões do app, da base e das
 * skills, os `id` das tarefas do catálogo e das que ficaram fora dele, cada IA instalada e com login e a
 * versão da CLI, sem conta, o sistema, o Node e o Electron, o fuso, o idioma, o modo dos traces, o
 * primeiro uso, as IAs desligadas, que não são detectadas, e quantas conversas há); e um `LEIA-ME.txt`.
 * Não leva conversas, anexos, pastas de tarefa, o perfil, tokens nem a base. Todo texto passa por
 * `saneamento.ts`, linha a linha, em pedaços que cedem a vez a outros fibers.
 *
 * O limite (`LIMITE_BYTES`, descomprimido) conta o `sistema.json` e o `LEIA-ME.txt`. Um log maior que o
 * que sobra entra só pela cauda (os últimos bytes, a partir da primeira linha inteira), e a descrição dele
 * diz isso; se ainda passar, os `.1` saem primeiro, depois os maiores. Nada some em silêncio: o que sai
 * pelo limite, o que não é arquivo comum e o que não se lê (depois de uma nova tentativa, pelo giro do
 * registro) vai em `foraDoPacote` e no `LEIA-ME.txt`, com o motivo. Sem pasta de logs (servidor à mão,
 * testes), o pacote leva só o `sistema.json` e o `LEIA-ME.txt`.
 */
import * as NodeOS from "node:os";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import { zipSync } from "fflate";
import {
  type DiagnosticoGerado,
  FalhaDiagnostico,
  type ItemDiagnostico,
  type ItemForaDiagnostico,
  type PreviaDiagnostico,
  type Provider,
} from "@simplifica-if/contratos-app";
import * as Motor from "@simplifica-if/motor";
import * as HostProcess from "@simplifica-if/motor/t3/HostProcess";
import * as Atualizador from "../Atualizador.ts";
import * as CatalogoSkills from "../CatalogoSkills.ts";
import * as CatalogoTarefas from "../CatalogoTarefas.ts";
import * as PastasTrabalho from "../PastasTrabalho.ts";
import * as Historico from "../persistencia/Historico.ts";
import * as Preferencias from "../persistencia/Preferencias.ts";
import { ARQUIVO_LOGS, ARQUIVO_TRACES } from "../observabilidade/ArquivoOtlp.ts";
import { type ContextoSaneamento, linhaDaPrevia, sanearJson, sanearLinha } from "./saneamento.ts";

/** O log do desktop (`apps/desktop/src/registro.ts`, `NOME_LOG`). */
export const ARQUIVO_LOG_APP = "simplifica-if.log";
export const ARQUIVO_SISTEMA = "sistema.json";
export const ARQUIVO_LEIA_ME = "LEIA-ME.txt";

/** O tamanho máximo do pacote, descomprimido. */
export const LIMITE_BYTES = 50 * 1024 * 1024;

/** Quantas linhas se saneiam antes de ceder a vez a outros fibers (um log de 5 MB não trava o servidor). */
const LINHAS_POR_PEDACO = 500;

/** Quantas linhas do fim de cada log a prévia mostra. */
export const LINHAS_DA_PREVIA = 30;

const PROVIDERS: ReadonlyArray<Provider> = ["claude", "codex", "antigravity"];

/** Os arquivos da pasta de logs que entram, na ordem do pacote, com o que são. */
const ARQUIVOS_LOG: ReadonlyArray<{ readonly nome: string; readonly descricao: string }> = [
  { nome: ARQUIVO_LOG_APP, descricao: "O registro do app: o que a janela, o app e a tela anotaram." },
  { nome: `${ARQUIVO_LOG_APP}.1`, descricao: "O registro anterior do app." },
  { nome: ARQUIVO_TRACES, descricao: "O caminho de cada pedido dentro do app, com tempos e erros." },
  { nome: `${ARQUIVO_TRACES}.1`, descricao: "O caminho dos pedidos anteriores." },
  { nome: ARQUIVO_LOGS, descricao: "As anotações ligadas a cada pedido." },
  { nome: `${ARQUIVO_LOGS}.1`, descricao: "As anotações dos pedidos anteriores." },
];

const DESCRICAO_SISTEMA =
  "As versões do app, da base e das tarefas, as IAs (instalada, conectada e versão, sem a conta) e o sistema do computador.";
const DESCRICAO_LEIA_ME = "Explica o pacote e o que não está nele.";

export const MOTIVO_LIMITE = "O pacote passaria do limite de tamanho.";
export const MOTIVO_ILEGIVEL = "Não foi possível ler o arquivo (ele pode ter sido trocado pelo giro do registro).";
export const MOTIVO_NAO_ARQUIVO = "Não é um arquivo comum.";

/** O ambiente do computador que o `sistema.json` registra e o saneamento usa. */
export interface Ambiente {
  readonly pastaPessoal: string;
  readonly usuario: string;
  readonly plataforma: string;
  readonly versaoSistema: string;
  readonly arquitetura: string;
  readonly node: string;
  /** Com `ELECTRON_RUN_AS_NODE`, no app empacotado; `null` com o Node. */
  readonly electron: string | null;
  readonly fuso: string;
  readonly idioma: string;
}

/** O ambiente do processo: as referências do `HostProcess`, a versão do sistema (`node:os`) e o `Intl`. */
export const ambienteDoProcesso = Effect.gen(function* () {
  const formato = Intl.DateTimeFormat().resolvedOptions();
  return {
    pastaPessoal: yield* HostProcess.HomeDirectory,
    usuario: (yield* HostProcess.Username) ?? "",
    plataforma: yield* HostProcess.Platform,
    versaoSistema: NodeOS.release(),
    arquitetura: yield* HostProcess.Architecture,
    node: process.versions.node,
    electron: process.versions.electron ?? null,
    fuso: formato.timeZone,
    idioma: formato.locale,
  } satisfies Ambiente;
});

export interface OpcoesDiagnostico {
  /** A pasta de logs do app (`--pasta-logs`); sem ela, o pacote sai sem logs. */
  readonly pastaLogs?: string;
  /** O modo dos traces (`--traces`), para o `sistema.json`. */
  readonly modoTraces?: string;
  /** O tamanho máximo do pacote, descomprimido (padrão `LIMITE_BYTES`). */
  readonly limiteBytes?: number;
  /** Quanto esperar pela detecção de cada IA (sem resposta, o `sistema.json` diz que ela não respondeu). */
  readonly prazoDeteccao?: Duration.Duration;
  /** O ambiente do computador; os testes o trocam. */
  readonly ambiente?: Ambiente;
}

export class Diagnostico extends Context.Service<
  Diagnostico,
  {
    readonly preparar: Effect.Effect<PreviaDiagnostico, FalhaDiagnostico>;
    readonly gerar: Effect.Effect<DiagnosticoGerado, FalhaDiagnostico>;
  }
>()("@simplifica-if/server/diagnostico/Diagnostico") {}

interface Lido {
  readonly nome: string;
  readonly descricao: string;
  readonly conteudo: Uint8Array;
  /** As últimas linhas, já saneadas e resumidas, para a prévia (só os logs). */
  readonly trecho?: string;
}

const codificador = new TextEncoder();
const decodificador = new TextDecoder("utf-8");

/**
 * Tira os logs que passam do limite: primeiro os `.1`, depois os maiores. `fixos` são os bytes que
 * sempre vão (o `sistema.json` e o `LEIA-ME.txt`) e contam no limite. Devolve os que ficam, na ordem de
 * entrada, e os que saíram.
 */
export function aplicarLimite(
  lidos: ReadonlyArray<Lido>,
  limite: number,
  fixos = 0,
): { readonly ficam: ReadonlyArray<Lido>; readonly fora: ReadonlyArray<ItemForaDiagnostico> } {
  let total = fixos + lidos.reduce((soma, lido) => soma + lido.conteudo.byteLength, 0);
  const candidatos = [...lidos].sort(
    (a, b) =>
      Number(b.nome.endsWith(".1")) - Number(a.nome.endsWith(".1")) || b.conteudo.byteLength - a.conteudo.byteLength,
  );
  const saem = new Set<string>();
  for (const lido of candidatos) {
    if (total <= limite) break;
    saem.add(lido.nome);
    total -= lido.conteudo.byteLength;
  }
  return {
    ficam: lidos.filter((lido) => !saem.has(lido.nome)),
    fora: lidos.filter((lido) => saem.has(lido.nome)).map((lido) => ({ nome: lido.nome, motivo: MOTIVO_LIMITE })),
  };
}

/** `n` bytes em MB, com uma casa quando é menos de 10. */
const emMb = (n: number) => {
  const mb = n / 1024 / 1024;
  return mb < 10 ? mb.toFixed(1).replace(".", ",") : String(Math.round(mb));
};

/** O `LEIA-ME.txt`: o que é o pacote, o que tem, o que não tem e como ler. */
export function leiaMe(entrada: {
  readonly geradoEm: string;
  readonly itens: ReadonlyArray<{ readonly nome: string; readonly descricao: string }>;
  readonly fora: ReadonlyArray<ItemForaDiagnostico>;
  readonly temLogs: boolean;
}): string {
  const linhas = [
    "Diagnóstico do Simplifica IF",
    `Gerado em ${entrada.geradoEm}.`,
    "",
    "Este pacote ajuda quem mantém o app a entender um problema que você relatou. Ele foi gerado no seu",
    "computador e só sai dele se você o anexar a um e-mail ou a um relato. Ele é montado na hora de gerar:",
    "pode trazer registros feitos depois da prévia que você viu.",
    "",
    "O que está aqui:",
    ...entrada.itens.map((item) => `- ${item.nome}: ${item.descricao}`),
    "",
    "O que NÃO está aqui: o conteúdo das conversas, os arquivos anexados, as pastas das tarefas, o seu",
    "perfil (campus, cargo e função), senhas, chaves e tokens de acesso, e a base de conhecimento.",
    "",
    "Antes de entrar no pacote, todo texto foi saneado: o nome da pasta de cada tarefa (e o que vem depois",
    "dele, como o nome de um anexo) virou [pasta da tarefa], a pasta pessoal virou ~, o nome de usuário",
    "num caminho virou [usuário], e-mails viraram [e-mail omitido], senhas, tokens e chaves viraram",
    "[segredo omitido], e CPF, RG, celular, matrícula e SIAPE viraram os marcadores da base. Linhas muito",
    "longas foram cortadas.",
  ];
  if (!entrada.temLogs) {
    linhas.push("", "Não havia registros do app neste computador: o pacote leva só o sistema.json.");
  }
  if (entrada.fora.length > 0) {
    linhas.push(
      "",
      "Ficaram de fora (quando o pacote passaria do limite de tamanho, os registros mais antigos saem primeiro):",
      ...entrada.fora.map((item) => `- ${item.nome}: ${item.motivo}`),
    );
  }
  linhas.push(
    "",
    "Para quem vai analisar: descompacte o pacote numa pasta e rode, no repositório do app,",
    "  pnpm traces --pasta <pasta descompactada> --codigo <código do erro>",
    'O código do erro é o que a pessoa vê em "Detalhes técnicos" (o codigo= do simplifica-if.log).',
    "",
  );
  return linhas.join("\n");
}

/** O `sistema.json` como texto (JSON com recuo). */
const textoSistema = (sistema: unknown): string => `${JSON.stringify(sistema, null, 2)}\n`;

/** `diagnostico-AAAA-MM-DD-HHMMSS.zip`, na hora local. */
export function nomeDoPacote(data: Date): string {
  const dois = (n: number) => String(n).padStart(2, "0");
  const dia = `${data.getFullYear()}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}`;
  const hora = `${dois(data.getHours())}${dois(data.getMinutes())}${dois(data.getSeconds())}`;
  return `diagnostico-${dia}-${hora}.zip`;
}

/** O fim de `bytes` a partir da primeira quebra de linha (a primeira linha da cauda sai pela metade). */
export function cortarNaPrimeiraLinha(bytes: Uint8Array): Uint8Array {
  const quebra = bytes.indexOf(0x0a);
  return quebra < 0 ? bytes : bytes.subarray(quebra + 1);
}

/** As linhas saneadas, em pedaços de `LINHAS_POR_PEDACO`, cedendo a vez entre eles. */
export const sanearLinhas = Effect.fn("Diagnostico.sanearLinhas")(function* (
  linhas: ReadonlyArray<string>,
  contexto: ContextoSaneamento,
) {
  const saida: Array<string> = [];
  for (let inicio = 0; inicio < linhas.length; inicio += LINHAS_POR_PEDACO) {
    for (const linha of linhas.slice(inicio, inicio + LINHAS_POR_PEDACO)) saida.push(sanearLinha(linha, contexto));
    yield* Effect.yieldNow;
  }
  return saida;
});

/** As últimas `LINHAS_DA_PREVIA` linhas não vazias, já saneadas, como vão na prévia. */
export const trechoDaPrevia = (linhas: ReadonlyArray<string>): string =>
  linhas
    .filter((linha) => linha.trim() !== "")
    .slice(-LINHAS_DA_PREVIA)
    .map(linhaDaPrevia)
    .join("\n");

type Leitura =
  | { readonly tipo: "ausente" }
  | { readonly tipo: "fora"; readonly motivo: string }
  | { readonly tipo: "lido"; readonly bytes: Uint8Array; readonly cauda: boolean };

export const make = Effect.fn("Diagnostico.make")(function* (opcoes: OpcoesDiagnostico = {}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const atualizador = yield* Atualizador.Atualizador;
  const catalogo = yield* CatalogoSkills.CatalogoSkills;
  const catalogoTarefas = yield* CatalogoTarefas.CatalogoTarefas;
  const motor = yield* Motor.Motor;
  const preferencias = yield* Preferencias.Preferencias;
  const historico = yield* Historico.Historico;
  const pastas = yield* PastasTrabalho.PastasTrabalho;
  const ambiente = opcoes.ambiente ?? (yield* ambienteDoProcesso);
  const contexto: ContextoSaneamento = {
    pastaPessoal: ambiente.pastaPessoal,
    usuario: ambiente.usuario,
    raizesTarefas: [pastas.raiz, pastas.copias].filter((raiz) => raiz !== ""),
  };
  const limite = opcoes.limiteBytes ?? LIMITE_BYTES;
  const prazo = opcoes.prazoDeteccao ?? Duration.seconds(4);

  /** Um arquivo, inteiro ou (acima de `maximo`) só a cauda; o que não existe fica `ausente`. */
  const lerUmaVez = Effect.fn("Diagnostico.lerArquivo")(function* (
    caminho: string,
    maximo: number,
  ): Effect.fn.Return<Leitura, PlatformError.PlatformError> {
    const info = yield* fs.stat(caminho);
    if (info.type !== "File") return { tipo: "fora", motivo: MOTIVO_NAO_ARQUIVO } as const;
    const tamanho = Number(info.size);
    if (tamanho <= maximo) return { tipo: "lido", bytes: yield* fs.readFile(caminho), cauda: false } as const;
    const fim = yield* Effect.scoped(
      Effect.gen(function* () {
        const arquivo = yield* fs.open(caminho, { flag: "r" });
        yield* arquivo.seek(BigInt(tamanho - maximo), "start");
        return yield* arquivo.readAlloc(maximo);
      }),
    );
    const bytes = Option.getOrElse(fim, () => new Uint8Array());
    return { tipo: "lido", bytes: cortarNaPrimeiraLinha(bytes), cauda: true } as const;
  });

  /** A leitura com uma nova tentativa (o giro do registro pode trocar o arquivo no meio). */
  const ler = (caminho: string, maximo: number): Effect.Effect<Leitura> =>
    lerUmaVez(caminho, maximo).pipe(
      Effect.retry({ times: 1 }),
      Effect.catch((erro) =>
        Effect.succeed<Leitura>(
          erro.reason._tag === "NotFound" ? { tipo: "ausente" } : { tipo: "fora", motivo: MOTIVO_ILEGIVEL },
        ),
      ),
    );

  /**
   * Os logs da pasta, saneados, cada um com no máximo `maximo` bytes lidos (acima disso, a cauda), e os
   * que ficaram de fora por não se lerem. O que não existe não entra nem aparece.
   */
  const lerLogs = Effect.fn("Diagnostico.lerLogs")(function* (maximo: number) {
    const lidos: Array<Lido> = [];
    const fora: Array<ItemForaDiagnostico> = [];
    if (opcoes.pastaLogs === undefined) return { lidos, fora };
    for (const arquivo of ARQUIVOS_LOG) {
      const leitura = yield* ler(path.join(opcoes.pastaLogs, arquivo.nome), maximo);
      if (leitura.tipo === "ausente") continue;
      if (leitura.tipo === "fora") {
        fora.push({ nome: arquivo.nome, motivo: leitura.motivo });
        continue;
      }
      const linhas = yield* sanearLinhas(decodificador.decode(leitura.bytes).split("\n"), contexto);
      lidos.push({
        nome: arquivo.nome,
        descricao: leitura.cauda
          ? `${arquivo.descricao} Só o fim do arquivo (os últimos ${emMb(maximo)} MB), porque ele inteiro passaria do limite.`
          : arquivo.descricao,
        conteudo: codificador.encode(linhas.join("\n")),
        trecho: trechoDaPrevia(linhas),
      });
    }
    return { lidos, fora };
  });

  /** Os logs que existem (sem ler): o `sistema.json` diz se há registros. */
  const haLogs = Effect.fn("Diagnostico.haLogs")(function* () {
    if (opcoes.pastaLogs === undefined) return false;
    const pasta = opcoes.pastaLogs;
    const existem = yield* Effect.forEach(ARQUIVOS_LOG, (arquivo) =>
      fs.exists(path.join(pasta, arquivo.nome)).pipe(Effect.orElseSucceed(() => false)),
    );
    return existem.some(Boolean);
  });

  /** Uma IA: instalada, com login e a versão da CLI; sem a conta, a mensagem nem os modelos. */
  const detectar = (provider: Provider) =>
    motor.detectar(provider).pipe(
      Effect.timeoutOption(prazo),
      Effect.map(
        Option.match({
          onNone: () => ({ respondeu: false }),
          onSome: (estado) => ({
            respondeu: true,
            instalada: estado.instalado,
            conectada: estado.autenticado,
            versao: estado.versao ?? null,
            origem: estado.origem ?? null,
          }),
        }),
      ),
    );

  const montarSistema = Effect.fn("Diagnostico.sistema")(function* (geradoEm: string, temLogs: boolean) {
    const estado = yield* atualizador.estado;
    const tarefas = catalogoTarefas.listar(estado.canal);
    const lidas = yield* preferencias.ler;
    const conversas = yield* historico.listar;
    // A IA desligada no app não é detectada (nenhum processo dela se abre): o `sistema.json` só diz isso.
    const ias = yield* Effect.forEach(
      PROVIDERS,
      (provider): Effect.Effect<Readonly<Record<string, string | boolean | null>>> =>
        lidas.iasDesligadas.includes(provider) ? Effect.succeed({ estado: "desligada no app" }) : detectar(provider),
      { concurrency: "unbounded" },
    );
    return sanearJson(
      {
        gerado_em: geradoEm,
        app: { versao: estado.versaoApp },
        base: {
          versao: estado.base.versao,
          data: estado.base.dataReferencia,
          commit: estado.base.commit,
          origem: estado.base.origem,
          pendente: estado.pendente,
        },
        skills: {
          conjunto: estado.skills,
          lista: [...catalogo.versoes].map(([nome, versao]) => ({ nome, versao })),
        },
        // Só os `id`: os que o app mostra no canal em uso e os que ficaram de fora (o motivo está no log).
        tarefas: {
          catalogo: tarefas.tarefas.map((tarefa) => tarefa.id),
          fora_do_catalogo: tarefas.retiradas.map((tarefa) => tarefa.id),
        },
        ias: Object.fromEntries(
          PROVIDERS.map((provider, indice) => [
            provider,
            { ...ias[indice], usada_no_app: !lidas.iasDesligadas.includes(provider) },
          ]),
        ),
        sistema: {
          plataforma: ambiente.plataforma,
          versao: ambiente.versaoSistema,
          arquitetura: ambiente.arquitetura,
          node: ambiente.node,
          electron: ambiente.electron,
          fuso: ambiente.fuso,
          idioma: ambiente.idioma,
        },
        uso: {
          modo_traces: opcoes.modoTraces ?? null,
          registros_do_app: temLogs,
          aviso_de_uso_aceito: lidas.avisoAceitoEm !== undefined,
          boas_vindas_feitas: lidas.boasVindasEm !== undefined,
          ias_desligadas: lidas.iasDesligadas,
          conversas: conversas.length,
        },
      },
      contexto,
    );
  });

  /**
   * O conteúdo do pacote, saneado: os arquivos na ordem, o que ficou de fora e o `sistema.json`. O
   * `sistema.json` e o `LEIA-ME.txt` (no tamanho máximo, com todos os logs fora) contam no limite, e cada
   * log lê no máximo o que sobra; acima disso, vai a cauda dele.
   */
  const montar = Effect.fn("Diagnostico.montar")(function* () {
    const agora = DateTime.toDateUtc(yield* DateTime.now);
    const temLogs = yield* haLogs();
    const sistema = textoSistema(yield* montarSistema(agora.toISOString(), temLogs));
    const descricaoSistema = { nome: ARQUIVO_SISTEMA, descricao: DESCRICAO_SISTEMA };
    const descricaoLeiaMe = { nome: ARQUIVO_LEIA_ME, descricao: DESCRICAO_LEIA_ME };
    const leiaMeMaximo = leiaMe({
      geradoEm: agora.toISOString(),
      itens: [...ARQUIVOS_LOG, descricaoSistema, descricaoLeiaMe].map((item) => ({
        ...item,
        descricao: `${item.descricao} Só o fim do arquivo (os últimos 0000 MB), porque ele inteiro passaria do limite.`,
      })),
      fora: ARQUIVOS_LOG.map((arquivo) => ({ nome: arquivo.nome, motivo: MOTIVO_ILEGIVEL })),
      temLogs,
    });
    const fixos = codificador.encode(sistema).byteLength + codificador.encode(leiaMeMaximo).byteLength;
    const { lidos, fora: ilegiveis } = yield* lerLogs(Math.max(0, limite - fixos));
    const { ficam, fora: grandes } = aplicarLimite(lidos, limite, fixos);
    const fora = [...ilegiveis, ...grandes];
    const itensSemLeiaMe: ReadonlyArray<Lido> = [
      ...ficam,
      { ...descricaoSistema, conteudo: codificador.encode(sistema) },
    ];
    const leia = leiaMe({
      geradoEm: agora.toISOString(),
      itens: [...itensSemLeiaMe, descricaoLeiaMe],
      fora,
      temLogs: lidos.length > 0 || ilegiveis.length > 0,
    });
    const arquivos: ReadonlyArray<Lido> = [
      ...itensSemLeiaMe,
      { ...descricaoLeiaMe, conteudo: codificador.encode(leia) },
    ];
    return { agora, arquivos, fora, sistema, temLogs };
  });

  // A prévia e o pacote saneiam cada um a sua leitura: o pacote é montado na hora de gerar e pode trazer
  // linhas registradas depois da prévia (a interface e o LEIA-ME dizem isso).
  const preparar = Effect.gen(function* () {
    const { arquivos, fora, sistema, temLogs } = yield* montar();
    return {
      itens: arquivos.map((arquivo): ItemDiagnostico => ({
        nome: arquivo.nome,
        descricao: arquivo.descricao,
        bytes: arquivo.conteudo.byteLength,
        ...(arquivo.trecho === undefined ? {} : { trecho: arquivo.trecho }),
      })),
      foraDoPacote: [...fora],
      sistema,
      temLogs,
      podeGerar: pastas.raiz !== "",
    } satisfies PreviaDiagnostico;
  }).pipe(Effect.withSpan("Diagnostico.preparar"));

  const gerar = Effect.gen(function* () {
    const { agora, arquivos } = yield* montar();
    const zip = zipSync(Object.fromEntries(arquivos.map((arquivo) => [arquivo.nome, arquivo.conteudo])), {
      level: 6,
      mtime: agora,
    });
    const arquivo = yield* pastas
      .gravarDiagnostico(nomeDoPacote(agora), zip)
      .pipe(Effect.mapError((erro) => new FalhaDiagnostico({ motivo: erro.motivo, cause: erro })));
    return { arquivo, bytes: zip.byteLength } satisfies DiagnosticoGerado;
  }).pipe(Effect.withSpan("Diagnostico.gerar"));

  return Diagnostico.of({ preparar, gerar });
});

/**
 * Pede o `Atualizador`, o `CatalogoSkills`, o `CatalogoTarefas`, o `Motor`, as `Preferencias`, o `Historico`, as
 * `PastasTrabalho`, o `FileSystem` e o `Path`.
 */
export const layer = (opcoes: OpcoesDiagnostico = {}) => Layer.effect(Diagnostico, make(opcoes));
