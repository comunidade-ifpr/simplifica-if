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
 * - **Desfazer:** no fim de cada turno, um retrato da pasta (`fim.json`) separa o que mudou dentro do
 *   turno do que a pessoa mudou depois. O Desfazer volta só os arquivos que o turno mais recente mudou;
 *   os que mudaram de novo fora da conversa ficam como estão, salvo se a pessoa escolher incluí-los. As
 *   pastas que o turno criou e ficaram vazias saem. A restauração não segue links (`gravarSemSeguirLinks`).
 *   Depois, as cópias desse turno em diante saem, e o próximo Desfazer volta mais um turno. Arquivos e pastas que
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
import { type ArquivoPasta, FalhaPasta, type PastaConversa, type PrevisaoDesfazer } from "@simplifica-if/contratos-app";
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
    /** O retrato do fim do turno, ao lado da cópia; nunca falha. */
    readonly fecharTurno: (conversa: string, turno: number, pasta: string) => Effect.Effect<void>;
    readonly desfazer: (
      conversa: string,
      pasta: string,
      incluirForaDaConversa: boolean,
    ) => Effect.Effect<PastaConversa, FalhaPasta>;
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

interface Varredura {
  /** Os arquivos comuns, até `maximo + 1`. */
  readonly arquivos: ReadonlyArray<Entrada>;
  /** Os links simbólicos (nunca copiados nem seguidos; no retrato, para o Desfazer vê-los). */
  readonly links: ReadonlyArray<string>;
  /** As subpastas (comuns, não links). */
  readonly pastas: ReadonlyArray<string>;
}

/** A pasta sem os nomes que começam com `.`, sem seguir links. */
async function varrer(pasta: string, maximo: number): Promise<Varredura> {
  const arquivos: Array<Entrada> = [];
  const links: Array<string> = [];
  const pastas: Array<string> = [];
  const visitar = async (relativo: string): Promise<void> => {
    const entradas = await NodeFSP.readdir(NodePath.join(pasta, relativo), { withFileTypes: true });
    entradas.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    for (const entrada of entradas) {
      if (arquivos.length > maximo) return;
      if (entrada.name.startsWith(".")) continue;
      const rel = relativo === "" ? entrada.name : `${relativo}/${entrada.name}`;
      if (entrada.isSymbolicLink()) links.push(rel);
      else if (entrada.isDirectory()) {
        pastas.push(rel);
        await visitar(rel);
      } else if (entrada.isFile()) {
        const info = await NodeFSP.lstat(NodePath.join(pasta, rel));
        arquivos.push({ nome: rel, tamanho: info.size, alteradoEm: info.mtime });
      }
    }
  };
  await visitar("");
  return { arquivos, links, pastas };
}

/** Os arquivos comuns da pasta, até `maximo + 1`. */
const listarArvore = async (pasta: string, maximo: number) => (await varrer(pasta, maximo)).arquivos;

async function sha256(arquivo: string): Promise<string> {
  const hash = NodeCrypto.createHash("sha256");
  for await (const pedaco of NodeFS.createReadStream(arquivo)) hash.update(pedaco as Buffer);
  return hash.digest("hex");
}

/** Arquivo → `tamanho:sha256`; link simbólico → `link`. */
type Retrato = Record<string, string>;

/** O valor de um link no retrato: o Desfazer o remove, nunca o segue nem o restaura. */
const LINK = "link";

interface Manifesto {
  readonly turno: number;
  readonly criadaEm: string;
  /** Ausente quando a pasta passou dos limites e o turno ficou sem cópia. */
  readonly arquivos?: Retrato;
  /** As subpastas de antes do turno. */
  readonly pastas?: ReadonlyArray<string>;
  readonly aviso?: string;
  /** O retrato do fim do turno (`fim.json`); ausente se o turno não fechou (o app caiu no meio). */
  readonly fim?: RetratoFim;
}

/** A pasta no fim do turno: o que separa o que a IA fez do que mudou depois, fora da conversa. */
interface RetratoFim {
  readonly arquivos: Retrato;
  readonly pastas: ReadonlyArray<string>;
}

async function retratar(pasta: string, varredura: Pick<Varredura, "arquivos" | "links">): Promise<Retrato> {
  const retrato: Retrato = {};
  for (const arquivo of varredura.arquivos) {
    retrato[arquivo.nome] = `${arquivo.tamanho}:${await sha256(NodePath.join(pasta, arquivo.nome))}`;
  }
  for (const link of varredura.links) retrato[link] = LINK;
  return retrato;
}

/** Um caminho relativo vindo do manifesto, resolvido sem sair de `pasta`. */
function dentro(pasta: string, relativo: string): string {
  const alvo = NodePath.resolve(pasta, relativo);
  if (!alvo.startsWith(pasta + NodePath.sep)) throw new Error(`caminho fora da pasta: ${relativo}`);
  return alvo;
}

/* ------------------------------------------------------------------ escrita sem seguir links */

/** O prefixo do temporário da restauração (começa com `.`: fica fora das listas e das cópias). */
const PREFIXO_TEMPORARIO = ".simplifica-desfazer-";

/** As partes de um caminho relativo do manifesto; recusa vazio, `.`, `..`, `\\` e NUL. */
function partesSeguras(relativo: string): Array<string> {
  const partes = relativo.split("/");
  if (partes.some((parte) => parte === "" || parte === "." || parte === ".." || /[\\\0]/.test(parte)))
    throw new Error(`caminho inválido no manifesto: ${relativo}`);
  return partes;
}

/** O caminho real de `alvo` está em `real` (ou é `real`)? */
async function realDentro(real: string, alvo: string): Promise<void> {
  const caminho = await NodeFSP.realpath(alvo);
  if (caminho !== real && !caminho.startsWith(real + NodePath.sep)) throw new Error(`fora da pasta: ${alvo}`);
}

/**
 * A pasta `partes` dentro de `real`, percorrida componente a componente com `lstat`, sem seguir link:
 * um link no caminho é removido (nunca existiu numa cópia, que só tem arquivos e pastas comuns); com
 * `criar`, a pasta que falta é criada (e anotada em `criadas`) e o link é trocado por uma pasta comum.
 * Sem `criar`, devolve `undefined` quando a pasta não existe (ou era um link). Um arquivo comum no lugar
 * de uma pasta é recusado.
 */
async function pastaSemLinks(
  real: string,
  partes: ReadonlyArray<string>,
  criar: boolean,
  criadas?: Array<string>,
): Promise<string | undefined> {
  let atual = real;
  for (const parte of partes) {
    const proximo = NodePath.join(atual, parte);
    const info = await NodeFSP.lstat(proximo).catch(() => undefined);
    if (info?.isSymbolicLink()) await NodeFSP.unlink(proximo);
    if (info === undefined || info.isSymbolicLink()) {
      if (!criar) return undefined;
      await NodeFSP.mkdir(proximo);
      criadas?.push(NodePath.relative(real, proximo).split(NodePath.sep).join("/"));
    } else if (!info.isDirectory()) {
      throw new Error(`um arquivo ocupa o lugar da pasta: ${NodePath.relative(real, proximo)}`);
    }
    atual = proximo;
  }
  await realDentro(real, atual);
  return atual;
}

/** `O_NOFOLLOW` não existe no Windows. */
const ABRIR_TEMPORARIO =
  NodeFS.constants.O_WRONLY | NodeFS.constants.O_CREAT | NodeFS.constants.O_EXCL | (NodeFS.constants.O_NOFOLLOW ?? 0);

/**
 * Grava `conteudo` em `real/relativo` sem seguir link: as pastas do caminho conferidas por
 * `pastaSemLinks`, um temporário novo na mesma pasta (`O_EXCL`, `O_NOFOLLOW`) e o `rename` sobre o
 * alvo, que troca o próprio link (ou arquivo) de uma vez. O caminho real da pasta é conferido antes do
 * `rename`.
 */
export async function gravarSemSeguirLinks(
  real: string,
  relativo: string,
  conteudo: Uint8Array,
  criadas?: Array<string>,
): Promise<void> {
  const partes = partesSeguras(relativo);
  const nome = partes.pop()!;
  const pasta = (await pastaSemLinks(real, partes, true, criadas))!;
  const temporario = NodePath.join(pasta, `${PREFIXO_TEMPORARIO}${NodeCrypto.randomUUID()}`);
  const arquivo = await NodeFSP.open(temporario, ABRIR_TEMPORARIO, 0o644);
  try {
    await arquivo.writeFile(conteudo);
  } finally {
    await arquivo.close();
  }
  try {
    await realDentro(real, pasta);
    await NodeFSP.rename(temporario, NodePath.join(pasta, nome));
  } catch (erro) {
    await NodeFSP.rm(temporario, { force: true });
    throw erro;
  }
}

/** Remove `real/relativo` se for arquivo ou link (o link em si, nunca o alvo); pastas no caminho, sem seguir links. */
export async function removerSemSeguirLinks(real: string, relativo: string): Promise<void> {
  const partes = partesSeguras(relativo);
  const nome = partes.pop()!;
  const pasta = await pastaSemLinks(real, partes, false);
  if (pasta === undefined) return;
  const alvo = NodePath.join(pasta, nome);
  const info = await NodeFSP.lstat(alvo).catch(() => undefined);
  if (info !== undefined && (info.isFile() || info.isSymbolicLink())) await NodeFSP.unlink(alvo);
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
      const manifesto = JSON.parse(
        await NodeFSP.readFile(NodePath.join(pastaCopias, nome, "manifesto.json"), "utf8"),
      ) as Manifesto;
      const fim = await NodeFSP.readFile(NodePath.join(pastaCopias, nome, "fim.json"), "utf8").then(
        (texto) => JSON.parse(texto) as RetratoFim,
        () => undefined,
      );
      manifestos.push(fim === undefined ? manifesto : { ...manifesto, fim });
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
  const varredura = await varrer(real, limites.arquivos);
  const arquivos = varredura.arquivos;
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
    manifesto = { turno, criadaEm, arquivos: await retratar(real, varredura), pastas: varredura.pastas };
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

/** Grava o retrato do fim do turno ao lado da cópia de antes dele (se houver cópia completa). */
async function retratarFim(real: string, copias: string, turno: number, limites: Limites) {
  const destino = NodePath.join(copias, String(turno));
  const manifesto = await NodeFSP.readFile(NodePath.join(destino, "manifesto.json"), "utf8").then(
    (texto) => JSON.parse(texto) as Manifesto,
    () => undefined,
  );
  if (manifesto?.arquivos === undefined) return;
  const varredura = await varrer(real, limites.arquivos);
  if (varredura.arquivos.length > limites.arquivos) return;
  const fim: RetratoFim = { arquivos: await retratar(real, varredura), pastas: varredura.pastas };
  await NodeFSP.writeFile(NodePath.join(destino, "fim.json"), JSON.stringify(fim));
}

const SEM_DESFAZER: PrevisaoDesfazer = {
  disponivel: false,
  criados: [],
  alterados: [],
  apagados: [],
  foraDaConversa: [],
};

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

  /**
   * O turno a desfazer: o mais recente cuja pasta mudou **dentro** dele (o retrato de antes × o do fim
   * do turno). Sem o retrato do fim (o app caiu no meio do turno), vale o de antes do turno seguinte ou,
   * no último, a pasta agora. Os arquivos mudados no turno que mudaram de novo depois (fora da conversa)
   * vão em `foraDaConversa`.
   */
  const prever = async (conversa: string, real: string) => {
    const manifestos = await lerManifestos(pastaCopias(conversa));
    const aviso = manifestos[0]?.aviso;
    // Sem a cópia do turno mais recente, voltar a uma mais antiga desfaria também o que veio depois dela.
    if (aviso !== undefined) return { previsao: { ...SEM_DESFAZER, aviso } };
    const varredura = await varrer(real, limites.arquivos);
    if (varredura.arquivos.length > limites.arquivos) return { previsao: SEM_DESFAZER };
    const agora: RetratoFim = { arquivos: await retratar(real, varredura), pastas: varredura.pastas };
    for (const [indice, manifesto] of manifestos.entries()) {
      if (manifesto.arquivos === undefined) break;
      const seguinte = manifestos[indice - 1];
      const fim =
        manifesto.fim ??
        (seguinte?.arquivos === undefined ? agora : { arquivos: seguinte.arquivos, pastas: seguinte.pastas ?? [] });
      const mudancas = diferenca(manifesto.arquivos, fim.arquivos);
      const mudados = [...mudancas.criados, ...mudancas.alterados, ...mudancas.apagados];
      if (mudados.length === 0) continue;
      const previsao: PrevisaoDesfazer = {
        disponivel: true,
        turno: manifesto.turno,
        copiaEm: manifesto.criadaEm,
        ...mudancas,
        foraDaConversa: mudados.filter((nome) => agora.arquivos[nome] !== fim.arquivos[nome]),
      };
      return { previsao, manifesto, fim };
    }
    return { previsao: SEM_DESFAZER };
  };

  const listar = async (real: string, anexos: ReadonlySet<string>) =>
    (await listarArvore(real, limites.arquivos)).slice(0, limites.arquivos).map((entrada): ArquivoPasta => ({
      nome: entrada.nome,
      caminho: NodePath.join(real, entrada.nome),
      tamanho: entrada.tamanho,
      alteradoEm: entrada.alteradoEm.toISOString(),
      origem: anexos.has(entrada.nome) ? "anexado" : "pasta",
    }));

  const ver = Effect.fn("PastasTrabalho.ver")(function* (conversa: string, pasta: string) {
    const real = yield* Effect.promise(() => gerida(pasta));
    if (real === undefined)
      return { pasta, gerida: false, arquivos: [], desfazer: SEM_DESFAZER } satisfies PastaConversa;
    const anexos = yield* historico.anexos(real);
    const [arquivos, { previsao }] = yield* tentar(
      () => Promise.all([listar(real, anexos), prever(conversa, real)]),
      "Não foi possível ler a pasta da tarefa.",
    );
    return { pasta: real, gerida: true, arquivos, desfazer: previsao } satisfies PastaConversa;
  });

  const guardarCopia = Effect.fn("PastasTrabalho.guardarCopia")(function* (
    conversa: string,
    turno: number,
    pasta: string,
  ) {
    const criadaEm = DateTime.formatIso(yield* DateTime.now);
    yield* Effect.tryPromise({
      try: async () => {
        const real = await gerida(pasta);
        if (real !== undefined) await copiarTurno(real, pastaCopias(conversa), turno, criadaEm, limites);
      },
      catch: (erro) => new FalhaPasta({ motivo: String(erro) }),
    }).pipe(
      Effect.catch((erro) => Effect.logWarning(`conversa ${conversa}: sem cópia da pasta no turno ${turno}`, erro)),
    );
  });

  const fecharTurno = Effect.fn("PastasTrabalho.fecharTurno")(function* (
    conversa: string,
    turno: number,
    pasta: string,
  ) {
    yield* Effect.tryPromise({
      try: async () => {
        const real = await gerida(pasta);
        if (real !== undefined) await retratarFim(real, pastaCopias(conversa), turno, limites);
      },
      catch: (erro) => new FalhaPasta({ motivo: String(erro) }),
    }).pipe(
      Effect.catch((erro) => Effect.logWarning(`conversa ${conversa}: sem retrato do fim do turno ${turno}`, erro)),
    );
  });

  const desfazer = Effect.fn("PastasTrabalho.desfazer")(function* (
    conversa: string,
    pasta: string,
    incluirForaDaConversa: boolean,
  ) {
    const real = yield* Effect.promise(() => gerida(pasta));
    if (real === undefined) return yield* falha("Esta conversa não tem uma pasta de tarefa do app.");
    yield* tentar(async () => {
      const { previsao, manifesto, fim } = await prever(conversa, real);
      if (!previsao.disponivel || manifesto === undefined || fim === undefined) return;
      const copia = NodePath.join(pastaCopias(conversa), String(manifesto.turno), "arquivos");
      const antes = manifesto.arquivos ?? {};
      const pular = new Set(incluirForaDaConversa ? [] : previsao.foraDaConversa);
      for (const nome of previsao.criados) if (!pular.has(nome)) await removerSemSeguirLinks(real, nome);
      // As pastas que o turno criou e ficaram vazias saem também (as mais fundas primeiro).
      const pastasAntes = new Set(manifesto.pastas ?? []);
      const criadasNoTurno = fim.pastas
        .filter((nome) => !pastasAntes.has(nome))
        .sort((a, b) => b.split("/").length - a.split("/").length);
      for (const nome of criadasNoTurno) {
        const caminho = await pastaSemLinks(real, partesSeguras(nome), false).catch(() => undefined);
        if (caminho !== undefined && (await NodeFSP.readdir(caminho)).length === 0) await NodeFSP.rmdir(caminho);
      }
      for (const nome of [...previsao.alterados, ...previsao.apagados].filter((nome) => !pular.has(nome))) {
        // Um link de antes do turno não se restaura (a cópia não o tem); o que está no lugar sai.
        if (antes[nome] === LINK) await removerSemSeguirLinks(real, nome);
        else await gravarSemSeguirLinks(real, nome, await NodeFSP.readFile(dentro(copia, nome)));
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

  return PastasTrabalho.of({ raiz, criar, anexar, ver, guardarCopia, fecharTurno, desfazer });
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
      return yield* Effect.succeed({
        pasta,
        gerida: false,
        arquivos: [],
        desfazer: SEM_DESFAZER,
      } satisfies PastaConversa);
    }),
    guardarCopia: Effect.fn("PastasTrabalho.guardarCopia")(function* () {
      yield* Effect.void;
    }),
    fecharTurno: Effect.fn("PastasTrabalho.fecharTurno")(function* () {
      yield* Effect.void;
    }),
    desfazer: recusa,
  });
});

/** Pede o `Historico` e a `AnalisePpc` (a liberação dos arquivos escolhidos no desktop). */
export const layer = (opcoes: OpcoesPastas) => Layer.effect(PastasTrabalho, make(opcoes));
