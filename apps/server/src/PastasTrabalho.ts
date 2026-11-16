// @effect-diagnostics nodeBuiltinImport:off -- cópia e restauração de árvores de arquivos com fs/promises
/**
 * A pasta de trabalho das tarefas (M1.9, Modo Servidor) e o "Desfazer o que a IA fez nesta pasta".
 *
 * - **Onde:** cada tarefa ganha uma pasta em `<raiz>/<título>`, a raiz sendo `Documentos/Simplifica IF`
 *   (o desktop passa `--pasta-trabalhos`). O nome é seguro em macOS e Windows (`nomeSeguro`) e não
 *   colide: ` (2)`, ` (3)`… A pasta é *gerida* quando o caminho real dela é filho direto da raiz real;
 *   só as geridas têm arquivos listados, anexos e cópias.
 * - **Anexar:** o servidor copia para a pasta o arquivo que o processo principal do desktop liberou
 *   depois do diálogo (a mesma liberação da revisão prévia); o nome repetido ganha ` (2)`.
 * - **Cópias (Desfazer):** antes de cada turno, uma cópia simples da pasta vai para
 *   `<copias>/<conversa>/<turno>/`, fora da pasta de trabalho (a IA não a vê nem a altera), com um
 *   `manifesto.json` (tamanho e SHA-256 de cada arquivo). Escolha: **cópia simples, não git oculto**.
 *   A pasta de uma tarefa é pequena (o PPC, um parecer), o git não vem instalado nos computadores
 *   institucionais com Windows (e levá-lo no app pesa dezenas de MB), e restaurar é copiar de volta,
 *   sem estado escondido dentro da pasta da pessoa. Limites: pasta de até `LIMITES.bytes` e
 *   `LIMITES.arquivos` (acima disso o turno fica sem cópia, com aviso), e as `LIMITES.copias` mais
 *   recentes por conversa.
 * - **Desfazer:** restaura a cópia mais recente que difere da pasta agora (o estado de antes do turno
 *   que mudou a pasta), apaga as cópias desse turno em diante e devolve a pasta. Arquivos e pastas que
 *   começam com `.` (o `.simplifica/` das skills) e links simbólicos ficam de fora de tudo.
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  type ArquivoPasta,
  FalhaPasta,
  type PastaConversa,
  type PrevisaoDesfazer,
} from "@simplifica-if/contratos-app";
import { Historico } from "./persistencia/Historico.ts";
import { AnalisePpc } from "./revisao-ppc/AnalisePpc.ts";

export interface Limites {
  /** O tamanho máximo da pasta para guardar a cópia de um turno. */
  readonly bytes: number;
  /** O número máximo de arquivos da pasta para guardar a cópia de um turno (e para listar). */
  readonly arquivos: number;
  /** Quantas cópias se guardam por conversa (as mais recentes). */
  readonly copias: number;
  /** O tamanho máximo de um arquivo anexado. */
  readonly anexoBytes: number;
}

export const LIMITES: Limites = {
  bytes: 50 * 1024 * 1024,
  arquivos: 500,
  copias: 10,
  anexoBytes: 50 * 1024 * 1024,
};

export interface OpcoesPastas {
  /** `Documentos/Simplifica IF`; criada no primeiro `criar`. */
  readonly raiz: string;
  /** Onde ficam as cópias dos turnos (na pasta de estado do app). */
  readonly copias: string;
  readonly limites?: Partial<Limites>;
}

export class PastasTrabalho extends Context.Service<
  PastasTrabalho,
  {
    readonly raiz: string;
    /** Cria a pasta da tarefa e devolve o caminho real. */
    readonly criar: (titulo: string) => Effect.Effect<string, FalhaPasta>;
    readonly anexar: (pasta: string, arquivo: string) => Effect.Effect<ArquivoPasta, FalhaPasta>;
    /** Os arquivos da pasta da conversa e a previsão do Desfazer. */
    readonly ver: (conversa: string, pasta: string) => Effect.Effect<PastaConversa, FalhaPasta>;
    /** A cópia de antes do turno; nunca falha (o erro vai para o log, e o turno segue sem cópia). */
    readonly guardarCopia: (conversa: string, turno: number, pasta: string) => Effect.Effect<void>;
    readonly desfazer: (conversa: string, pasta: string) => Effect.Effect<PastaConversa, FalhaPasta>;
  }
>()("@simplifica-if/server/PastasTrabalho") {}

/* ================================================================== funções puras e de arquivo */

const RESERVADOS_WINDOWS = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** Um nome de pasta seguro no macOS e no Windows, a partir do título da tarefa. */
export function nomeSeguro(titulo: string): string {
  let nome = titulo
    .normalize("NFC")
    // biome-ignore lint: caracteres de controle são exatamente o que se quer tirar
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, "");
  if (nome.length > 60) nome = nome.slice(0, 60).replace(/[.\s]+$/, "");
  if (nome === "" || RESERVADOS_WINDOWS.test(nome)) nome = "Tarefa";
  return nome;
}

/** `nome (n).ext`, para o n-ésimo nome repetido (n ≥ 2). */
export function comNumero(nome: string, n: number): string {
  if (n < 2) return nome;
  const ext = NodePath.extname(nome);
  const base = ext === "" || ext === nome ? nome : nome.slice(0, -ext.length);
  return `${base} (${n})${ext === nome ? "" : ext}`;
}

interface Entrada {
  readonly nome: string;
  readonly tamanho: number;
  readonly alteradoEm: Date;
}

/** Os arquivos comuns da pasta (sem os que começam com `.` nem links), até `maximo + 1`. */
async function listarArvore(pasta: string, maximo: number): Promise<Array<Entrada>> {
  const saida: Array<Entrada> = [];
  const visitar = async (relativo: string): Promise<void> => {
    const entradas = await NodeFSP.readdir(NodePath.join(pasta, relativo), { withFileTypes: true });
    entradas.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    for (const entrada of entradas) {
      if (saida.length > maximo) return;
      if (entrada.name.startsWith(".")) continue;
      const rel = relativo === "" ? entrada.name : `${relativo}/${entrada.name}`;
      if (entrada.isDirectory()) await visitar(rel);
      else if (entrada.isFile()) {
        const info = await NodeFSP.lstat(NodePath.join(pasta, rel));
        saida.push({ nome: rel, tamanho: info.size, alteradoEm: info.mtime });
      }
    }
  };
  await visitar("");
  return saida;
}

async function sha256(arquivo: string): Promise<string> {
  const hash = NodeCrypto.createHash("sha256");
  for await (const pedaco of NodeFS.createReadStream(arquivo)) hash.update(pedaco as Buffer);
  return hash.digest("hex");
}

/** Arquivo → `tamanho:sha256`. */
type Retrato = Record<string, string>;

interface Manifesto {
  readonly turno: number;
  readonly criadaEm: string;
  /** Ausente quando a pasta passou dos limites e o turno ficou sem cópia. */
  readonly arquivos?: Retrato;
  readonly aviso?: string;
}

async function retratar(pasta: string, arquivos: ReadonlyArray<Entrada>): Promise<Retrato> {
  const retrato: Retrato = {};
  for (const arquivo of arquivos) {
    retrato[arquivo.nome] = `${arquivo.tamanho}:${await sha256(NodePath.join(pasta, arquivo.nome))}`;
  }
  return retrato;
}

/** Um caminho relativo vindo do manifesto, resolvido sem sair de `pasta`. */
function dentro(pasta: string, relativo: string): string {
  const alvo = NodePath.resolve(pasta, relativo);
  if (!alvo.startsWith(pasta + NodePath.sep)) throw new Error(`caminho fora da pasta: ${relativo}`);
  return alvo;
}

async function lerManifestos(pastaCopias: string): Promise<Array<Manifesto>> {
  let nomes: Array<string>;
  try {
    nomes = await NodeFSP.readdir(pastaCopias);
  } catch {
    return [];
  }
  const manifestos: Array<Manifesto> = [];
  for (const nome of nomes) {
    if (!/^\d+$/.test(nome)) continue;
    try {
      manifestos.push(JSON.parse(await NodeFSP.readFile(NodePath.join(pastaCopias, nome, "manifesto.json"), "utf8")));
    } catch {
      // Cópia pela metade (o app fechou no meio): não conta.
    }
  }
  return manifestos.sort((a, b) => b.turno - a.turno);
}

function diferenca(antes: Retrato, agora: Retrato) {
  const criados = Object.keys(agora).filter((nome) => antes[nome] === undefined);
  const alterados = Object.keys(agora).filter((nome) => antes[nome] !== undefined && antes[nome] !== agora[nome]);
  const apagados = Object.keys(antes).filter((nome) => agora[nome] === undefined);
  return { criados, alterados, apagados };
}

/** Copia a pasta para `<copias>/<turno>/` e mantém só as `limites.copias` mais recentes. */
async function copiarTurno(real: string, copias: string, turno: number, criadaEm: string, limites: Limites) {
  const destino = NodePath.join(copias, String(turno));
  await NodeFSP.rm(destino, { recursive: true, force: true });
  await NodeFSP.mkdir(destino, { recursive: true });
  const arquivos = await listarArvore(real, limites.arquivos);
  const total = arquivos.reduce((soma, arquivo) => soma + arquivo.tamanho, 0);
  let manifesto: Manifesto;
  if (arquivos.length > limites.arquivos || total > limites.bytes) {
    manifesto = {
      turno,
      criadaEm,
      aviso: `A pasta passou de ${Math.round(limites.bytes / 1024 / 1024)} MB ou de ${limites.arquivos} arquivos, e o app não guardou a cópia de antes da última mensagem.`,
    };
  } else {
    for (const arquivo of arquivos) {
      const alvo = dentro(NodePath.join(destino, "arquivos"), arquivo.nome);
      await NodeFSP.mkdir(NodePath.dirname(alvo), { recursive: true });
      await NodeFSP.copyFile(NodePath.join(real, arquivo.nome), alvo);
    }
    manifesto = { turno, criadaEm, arquivos: await retratar(real, arquivos) };
  }
  // O manifesto por último: sem ele, a cópia pela metade não conta.
  await NodeFSP.writeFile(NodePath.join(destino, "manifesto.json"), JSON.stringify(manifesto));
  const turnos = (await NodeFSP.readdir(copias))
    .filter((nome) => /^\d+$/.test(nome))
    .map(Number)
    .sort((a, b) => b - a);
  for (const antigo of turnos.slice(limites.copias)) {
    await NodeFSP.rm(NodePath.join(copias, String(antigo)), { recursive: true, force: true });
  }
}

const SEM_DESFAZER: PrevisaoDesfazer = { disponivel: false, criados: [], alterados: [], apagados: [] };

/* ================================================================== serviço */

export const make = Effect.fn("PastasTrabalho.make")(function* (opcoes: OpcoesPastas) {
  const limites = { ...LIMITES, ...opcoes.limites };
  const historico = yield* Historico;
  const analise = yield* AnalisePpc;
  const raiz = NodePath.resolve(opcoes.raiz);

  const falha = (motivo: string) => new FalhaPasta({ motivo });
  const tentar = <A>(fazer: () => Promise<A>, motivo: string) =>
    Effect.tryPromise({ try: fazer, catch: () => falha(motivo) });

  /** O caminho real da pasta, se ela é gerida (filho direto da raiz); senão, `undefined`. */
  const gerida = async (pasta: string): Promise<string | undefined> => {
    if (!NodePath.isAbsolute(pasta)) return undefined;
    try {
      const [real, raizReal] = await Promise.all([NodeFSP.realpath(pasta), NodeFSP.realpath(raiz)]);
      return NodePath.dirname(real) === raizReal && (await NodeFSP.lstat(real)).isDirectory() ? real : undefined;
    } catch {
      return undefined;
    }
  };

  const pastaCopias = (conversa: string) => {
    if (!/^[A-Za-z0-9-]+$/.test(conversa)) throw new Error(`id de conversa inesperado: ${conversa}`);
    return NodePath.join(opcoes.copias, conversa);
  };

  const criar = (titulo: string) =>
    tentar(async () => {
      await NodeFSP.mkdir(raiz, { recursive: true });
      const nome = nomeSeguro(titulo);
      for (let n = 1; n < 1000; n++) {
        const pasta = NodePath.join(raiz, n === 1 ? nome : `${nome} (${n})`);
        try {
          await NodeFSP.mkdir(pasta);
          return await NodeFSP.realpath(pasta);
        } catch (erro) {
          if ((erro as NodeJS.ErrnoException).code !== "EEXIST") throw erro;
        }
      }
      throw new Error("nomes esgotados");
    }, "Não foi possível criar a pasta da tarefa em Documentos/Simplifica IF.").pipe(
      Effect.withSpan("PastasTrabalho.criar"),
    );

  const anexar = Effect.fn("PastasTrabalho.anexar")(function* (pasta: string, arquivo: string) {
    const real = yield* Effect.promise(() => gerida(pasta));
    if (real === undefined) return yield* falha("Só é possível anexar na pasta de uma tarefa do app.");
    if (!NodePath.isAbsolute(arquivo) || !(yield* analise.liberado(arquivo)))
      return yield* falha('Escolha o arquivo pelo botão "Anexar arquivo…" do app.');
    const info = yield* tentar(() => NodeFSP.lstat(arquivo), "O arquivo não foi encontrado ou não pode ser lido.");
    if (!info.isFile()) return yield* falha("Escolha um arquivo (não uma pasta nem um atalho).");
    if (info.size > limites.anexoBytes)
      return yield* falha(`O arquivo passa de ${Math.round(limites.anexoBytes / 1024 / 1024)} MB.`);
    const nome = yield* tentar(async () => {
      const original = NodePath.basename(arquivo);
      for (let n = 1; n < 1000; n++) {
        const candidato = comNumero(original, n);
        try {
          await NodeFSP.copyFile(arquivo, NodePath.join(real, candidato), NodeFS.constants.COPYFILE_EXCL);
          return candidato;
        } catch (erro) {
          if ((erro as NodeJS.ErrnoException).code !== "EEXIST") throw erro;
        }
      }
      throw new Error("nomes esgotados");
    }, "Não foi possível copiar o arquivo para a pasta da tarefa.");
    yield* historico.registrarAnexo(real, nome);
    const copiado = yield* tentar(() => NodeFSP.stat(NodePath.join(real, nome)), "O arquivo copiado sumiu.");
    return {
      nome,
      caminho: NodePath.join(real, nome),
      tamanho: copiado.size,
      alteradoEm: copiado.mtime.toISOString(),
      origem: "anexado",
    } satisfies ArquivoPasta;
  });

  /** A cópia a restaurar e a diferença para a pasta agora. */
  const prever = async (conversa: string, real: string) => {
    const manifestos = await lerManifestos(pastaCopias(conversa));
    const aviso = manifestos[0]?.aviso;
    // Sem a cópia do turno mais recente, voltar a uma mais antiga desfaria também o que veio depois dela.
    if (aviso !== undefined) return { previsao: { ...SEM_DESFAZER, aviso } };
    const agora = await listarArvore(real, limites.arquivos);
    if (agora.length > limites.arquivos) return { previsao: { ...SEM_DESFAZER, ...(aviso ? { aviso } : {}) } };
    const retrato = await retratar(real, agora);
    for (const manifesto of manifestos) {
      if (manifesto.arquivos === undefined) continue;
      const mudancas = diferenca(manifesto.arquivos, retrato);
      if (mudancas.criados.length + mudancas.alterados.length + mudancas.apagados.length === 0) continue;
      const previsao: PrevisaoDesfazer = {
        disponivel: true,
        turno: manifesto.turno,
        copiaEm: manifesto.criadaEm,
        ...mudancas,
        ...(aviso ? { aviso } : {}),
      };
      return { previsao, manifesto };
    }
    return { previsao: { ...SEM_DESFAZER, ...(aviso ? { aviso } : {}) } };
  };

  const listar = async (real: string, anexos: ReadonlySet<string>) =>
    (await listarArvore(real, limites.arquivos)).slice(0, limites.arquivos).map(
      (entrada): ArquivoPasta => ({
        nome: entrada.nome,
        caminho: NodePath.join(real, entrada.nome),
        tamanho: entrada.tamanho,
        alteradoEm: entrada.alteradoEm.toISOString(),
        origem: anexos.has(entrada.nome) ? "anexado" : "pasta",
      }),
    );

  const ver = Effect.fn("PastasTrabalho.ver")(function* (conversa: string, pasta: string) {
    const real = yield* Effect.promise(() => gerida(pasta));
    if (real === undefined) return { pasta, gerida: false, arquivos: [], desfazer: SEM_DESFAZER } satisfies PastaConversa;
    const anexos = yield* historico.anexos(real);
    const [arquivos, { previsao }] = yield* tentar(
      () => Promise.all([listar(real, anexos), prever(conversa, real)]),
      "Não foi possível ler a pasta da tarefa.",
    );
    return { pasta: real, gerida: true, arquivos, desfazer: previsao } satisfies PastaConversa;
  });

  const guardarCopia = (conversa: string, turno: number, pasta: string) =>
    Effect.gen(function* () {
      const criadaEm = DateTime.formatIso(yield* DateTime.now);
      yield* Effect.tryPromise({
        try: async () => {
          const real = await gerida(pasta);
          if (real !== undefined) await copiarTurno(real, pastaCopias(conversa), turno, criadaEm, limites);
        },
        catch: (erro) => new FalhaPasta({ motivo: String(erro) }),
      });
    }).pipe(
      Effect.catch((erro) => Effect.logWarning(`conversa ${conversa}: sem cópia da pasta no turno ${turno}`, erro)),
      Effect.withSpan("PastasTrabalho.guardarCopia"),
    );

  const desfazer = Effect.fn("PastasTrabalho.desfazer")(function* (conversa: string, pasta: string) {
    const real = yield* Effect.promise(() => gerida(pasta));
    if (real === undefined) return yield* falha("Esta conversa não tem uma pasta de tarefa do app.");
    yield* tentar(async () => {
      const { previsao, manifesto } = await prever(conversa, real);
      if (!previsao.disponivel || manifesto === undefined) return;
      const copia = NodePath.join(pastaCopias(conversa), String(manifesto.turno), "arquivos");
      for (const nome of previsao.criados) {
        const alvo = dentro(real, nome);
        if ((await NodeFSP.lstat(alvo)).isFile()) await NodeFSP.unlink(alvo);
      }
      for (const nome of [...previsao.alterados, ...previsao.apagados]) {
        const alvo = dentro(real, nome);
        await NodeFSP.mkdir(NodePath.dirname(alvo), { recursive: true });
        await NodeFSP.copyFile(dentro(copia, nome), alvo);
      }
      // As cópias deste turno em diante já não valem: o próximo Desfazer volta mais um turno.
      for (const nome of await NodeFSP.readdir(pastaCopias(conversa))) {
        if (/^\d+$/.test(nome) && Number(nome) >= manifesto.turno) {
          await NodeFSP.rm(NodePath.join(pastaCopias(conversa), nome), { recursive: true, force: true });
        }
      }
    }, "Não foi possível restaurar a pasta. Confira se algum arquivo está aberto em outro programa.");
    return yield* ver(conversa, real);
  });

  return PastasTrabalho.of({ raiz, criar, anexar, ver, guardarCopia, desfazer });
});

/**
 * Sem pastas de tarefa: nada é listado nem copiado (os testes do ciclo da conversa, que não usam a
 * pasta de trabalho do app).
 */
export const layerSemPastas = Layer.sync(PastasTrabalho, () => {
  const recusa = Effect.fn("PastasTrabalho.recusa")(function* () {
    return yield* new FalhaPasta({ motivo: "Sem pastas de tarefa neste servidor." });
  });
  return PastasTrabalho.of({
    raiz: "",
    criar: recusa,
    anexar: recusa,
    ver: Effect.fn("PastasTrabalho.ver")(function* (_conversa: string, pasta: string) {
      return { pasta, gerida: false, arquivos: [], desfazer: SEM_DESFAZER } satisfies PastaConversa;
    }),
    guardarCopia: Effect.fn("PastasTrabalho.guardarCopia")(function* () {}),
    desfazer: recusa,
  });
});

/** Pede o `Historico` e a `AnalisePpc` (a liberação dos arquivos escolhidos no desktop). */
export const layer = (opcoes: OpcoesPastas) => Layer.effect(PastasTrabalho, make(opcoes));
