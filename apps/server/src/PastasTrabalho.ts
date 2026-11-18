/**
 * A pasta de trabalho das tarefas (M1.9, Modo Servidor) e o "Desfazer o que a IA fez nesta pasta".
 *
 * - **Onde:** cada tarefa ganha uma pasta em `<raiz>/<título>`, a raiz sendo `Documentos/Simplifica IF`
 *   (o desktop passa `--pasta-trabalhos`). O nome é seguro em macOS e Windows (`nomeSeguro`) e não
 *   colide: ` (2)`, ` (3)`… A pasta é *gerida* quando o caminho real dela é filho direto da raiz real;
 *   só as geridas têm arquivos listados, anexos e cópias.
 * - **Anexar:** o servidor copia para a pasta o arquivo que o processo principal do desktop liberou
 *   depois do diálogo (a mesma liberação da revisão prévia); o nome repetido ganha ` (2)`.
 * - **Relato (M1.12):** `gravarRelato` grava o `.md` de "Isto está errado" em `<raiz>/Relatos de erro/`
 *   (`PASTA_RELATOS`), fora da pasta de qualquer tarefa: a política nega à IA a leitura fora da pasta da
 *   conversa, e o relato (que pode ter o que a pessoa não quer mandar de volta à IA) não entra nos
 *   próximos turnos. Nenhuma tarefa ganha esse nome (`criar` o pula), e nada se sobrescreve.
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
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {
  type ArquivoPasta,
  ehExtensaoDocumento,
  FalhaPasta,
  type PastaConversa,
  type PrevisaoDesfazer,
} from "@simplifica-if/contratos-app";
import * as ArquivosLiberados from "./ArquivosLiberados.ts";
import { comNumero, criarSemColisao } from "./nome-livre.ts";
import * as PastasNode from "./pastas-node.ts";
import * as Historico from "./persistencia/Historico.ts";

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

/** Onde "Salvar o relato" grava, dentro da raiz e fora da pasta de qualquer tarefa (M1.12). */
export const PASTA_RELATOS = "Relatos de erro";

export interface OpcoesPastas {
  /** `Documentos/Simplifica IF`; criada no primeiro `criar`. */
  readonly raiz: string;
  /** Onde ficam as cópias dos turnos (na pasta de estado do app). */
  readonly copias: string;
  readonly limites?: Partial<Limites>;
}

/**
 * Um caminho que as pastas recusam: vindo do manifesto com `..` ou `\`, fora da pasta depois de
 * resolvido, com um arquivo no lugar de uma pasta, ou um id de conversa inesperado.
 */
export class CaminhoRecusado extends Schema.TaggedError<CaminhoRecusado>()("CaminhoRecusado", {
  caminho: Schema.String,
  regra: Schema.Literals(["invalido", "fora-da-pasta", "arquivo-no-lugar-da-pasta", "nao-e-pasta", "id-de-conversa"]),
}) {
  override get message(): string {
    switch (this.regra) {
      case "invalido":
        return `caminho inválido no manifesto: ${this.caminho}`;
      case "fora-da-pasta":
        return `fora da pasta: ${this.caminho}`;
      case "arquivo-no-lugar-da-pasta":
        return `um arquivo ocupa o lugar da pasta: ${this.caminho}`;
      case "nao-e-pasta":
        return `não é uma pasta: ${this.caminho}`;
      case "id-de-conversa":
        return `id de conversa inesperado: ${this.caminho}`;
    }
  }
}

export class PastasTrabalho extends Context.Service<
  PastasTrabalho,
  {
    readonly raiz: string;
    /** Cria a pasta da tarefa e devolve o caminho real. */
    readonly criar: (titulo: string) => Effect.Effect<string, FalhaPasta>;
    readonly anexar: (pasta: string, arquivo: string) => Effect.Effect<ArquivoPasta, FalhaPasta>;
    /**
     * Grava o relato `nome` (um `.md`) em `<raiz>/Relatos de erro/`, fora do alcance da IA, sem
     * sobrescrever (` (2)`…), e devolve o caminho.
     */
    readonly gravarRelato: (nome: string, conteudo: string) => Effect.Effect<string, FalhaPasta>;
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
    /** Um Desfazer, uma cópia ou um retrato está em andamento? (a troca da base espera, M1.10) */
    readonly emAndamento: Effect.Effect<boolean>;
  }
>()("@simplifica-if/server/PastasTrabalho") {}

/* ================================================================== funções puras e de arquivo */

/** Os nomes que o Windows reserva, com ou sem extensão (`CON.txt`, `nul.x`, `COM¹`). */
const RESERVADOS_WINDOWS = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

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

interface Entrada {
  readonly nome: string;
  readonly tamanho: number;
  /** ISO 8601. */
  readonly alteradoEm: string;
}

interface Varredura {
  /** Os arquivos comuns, até `maximo + 1`. */
  readonly arquivos: ReadonlyArray<Entrada>;
  /** Os links simbólicos (nunca copiados nem seguidos; no retrato, para o Desfazer vê-los). */
  readonly links: ReadonlyArray<string>;
  /** As subpastas (comuns, não links). */
  readonly pastas: ReadonlyArray<string>;
}

/** A data de modificação em ISO 8601 (o Node sempre a informa; a época, se faltar). */
const alteradoEm = (info: FileSystem.File.Info): string =>
  Option.match(info.mtime, { onNone: () => "1970-01-01T00:00:00.000Z", onSome: (data) => data.toISOString() });

/** A pasta sem os nomes que começam com `.`, sem seguir links. */
const varrer = Effect.fn("PastasTrabalho.varrer")(function* (pasta: string, maximo: number) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const arquivos: Array<Entrada> = [];
  const links: Array<string> = [];
  const pastas: Array<string> = [];
  // Uma chamada por subpasta, dentro do span de `varrer`.
  const visitar: (relativo: string) => Effect.Effect<void, PlatformError.PlatformError> = Effect.fnUntraced(function* (
    relativo: string,
  ) {
    const entradas = [...(yield* fs.readDirectoryEntries(path.join(pasta, relativo)))].sort((a, b) =>
      a.name.localeCompare(b.name, "pt-BR"),
    );
    for (const entrada of entradas) {
      if (arquivos.length > maximo) return;
      if (entrada.name.startsWith(".")) continue;
      const rel = relativo === "" ? entrada.name : `${relativo}/${entrada.name}`;
      if (entrada.type === "SymbolicLink") links.push(rel);
      else if (entrada.type === "Directory") {
        pastas.push(rel);
        yield* visitar(rel);
      } else if (entrada.type === "File") {
        const info = yield* fs.lstat(path.join(pasta, rel));
        arquivos.push({ nome: rel, tamanho: Number(info.size), alteradoEm: alteradoEm(info) });
      }
    }
  });
  yield* visitar("");
  return { arquivos, links, pastas } satisfies Varredura;
});

const sha256 = Effect.fn("PastasTrabalho.sha256")(function* (arquivo: string) {
  const fs = yield* FileSystem.FileSystem;
  const hash = PastasNode.novoSha256();
  yield* fs.stream(arquivo).pipe(Stream.runForEach((pedaco) => Effect.sync(() => hash.atualizar(pedaco))));
  return hash.hex();
});

/** Arquivo → `tamanho:sha256`; link simbólico → `link`. */
const Retrato = Schema.Record(Schema.String, Schema.String);
type Retrato = typeof Retrato.Type;

/** O valor de um link no retrato: o Desfazer o remove, nunca o segue nem o restaura. */
const LINK = "link";

/** A pasta no fim do turno (`fim.json`): o que separa o que a IA fez do que mudou depois, fora da conversa. */
const RetratoFim = Schema.Struct({ arquivos: Retrato, pastas: Schema.Array(Schema.String) });
type RetratoFim = typeof RetratoFim.Type;

/** O `manifesto.json` da cópia de antes do turno. */
const ManifestoGravado = Schema.Struct({
  turno: Schema.Number,
  criadaEm: Schema.String,
  /** Ausente quando a pasta passou dos limites e o turno ficou sem cópia. */
  arquivos: Schema.optional(Retrato),
  /** As subpastas de antes do turno. */
  pastas: Schema.optional(Schema.Array(Schema.String)),
  aviso: Schema.optional(Schema.String),
});

interface Manifesto extends Schema.Schema.Type<typeof ManifestoGravado> {
  /** O retrato do fim do turno; ausente se o turno não fechou (o app caiu no meio). */
  readonly fim?: RetratoFim;
}

const ManifestoJson = Schema.fromJsonString(ManifestoGravado);
const RetratoFimJson = Schema.fromJsonString(RetratoFim);
const lerManifesto = Schema.decodeUnknownEffect(ManifestoJson);
const lerRetratoFim = Schema.decodeUnknownEffect(RetratoFimJson);
const codificarManifesto = Schema.encodeEffect(ManifestoJson);
const codificarRetratoFim = Schema.encodeEffect(RetratoFimJson);

const retratar = Effect.fn("PastasTrabalho.retratar")(function* (
  pasta: string,
  varredura: Pick<Varredura, "arquivos" | "links">,
) {
  const path = yield* Path.Path;
  const retrato: Record<string, string> = {};
  for (const arquivo of varredura.arquivos) {
    retrato[arquivo.nome] = `${arquivo.tamanho}:${yield* sha256(path.join(pasta, arquivo.nome))}`;
  }
  for (const link of varredura.links) retrato[link] = LINK;
  return retrato satisfies Retrato;
});

/** Um caminho relativo vindo do manifesto, resolvido sem sair de `pasta`. */
// Por arquivo, dentro do span da operação.
const dentro = Effect.fnUntraced(function* (pasta: string, relativo: string) {
  const path = yield* Path.Path;
  const alvo = path.resolve(pasta, relativo);
  if (!alvo.startsWith(pasta + path.sep))
    return yield* new CaminhoRecusado({ caminho: relativo, regra: "fora-da-pasta" });
  return alvo;
});

/* ------------------------------------------------------------------ escrita sem seguir links */

/** O prefixo do temporário da restauração (começa com `.`: fica fora das listas e das cópias). */
const PREFIXO_TEMPORARIO = ".simplifica-desfazer-";

/** As partes de um caminho relativo do manifesto; recusa vazio, `.`, `..`, `\\` e NUL. */
const partesSeguras = (relativo: string): Effect.Effect<Array<string>, CaminhoRecusado> => {
  const partes = relativo.split("/");
  return partes.some((parte) => parte === "" || parte === "." || parte === ".." || /[\\\0]/.test(parte))
    ? Effect.fail(new CaminhoRecusado({ caminho: relativo, regra: "invalido" }))
    : Effect.succeed(partes);
};

/** O caminho real de `alvo` está em `real` (ou é `real`)? */
// Por arquivo, dentro do span da operação.
const realDentro = Effect.fnUntraced(function* (real: string, alvo: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const caminho = yield* fs.realPath(alvo);
  if (caminho !== real && !caminho.startsWith(real + path.sep))
    return yield* new CaminhoRecusado({ caminho: alvo, regra: "fora-da-pasta" });
});

/**
 * A pasta `partes` dentro de `real`, percorrida componente a componente com `lstat`, sem seguir link:
 * um link no caminho é removido (nunca existiu numa cópia, que só tem arquivos e pastas comuns); com
 * `criar`, a pasta que falta é criada e o link é trocado por uma pasta comum. Sem `criar`, devolve
 * `undefined` quando a pasta não existe (ou era um link). Um arquivo comum no lugar de uma pasta é
 * recusado.
 */
// Por arquivo, dentro do span da operação.
const pastaSemLinks = Effect.fnUntraced(function* (real: string, partes: ReadonlyArray<string>, criar: boolean) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  let atual = real;
  for (const parte of partes) {
    const proximo = path.join(atual, parte);
    const tipo = Option.map(yield* Effect.option(fs.lstat(proximo)), (info) => info.type);
    if (Option.contains(tipo, "SymbolicLink")) yield* fs.remove(proximo);
    if (Option.isNone(tipo) || tipo.value === "SymbolicLink") {
      if (!criar) return undefined;
      yield* fs.makeDirectory(proximo);
    } else if (tipo.value !== "Directory") {
      return yield* new CaminhoRecusado({ caminho: path.relative(real, proximo), regra: "arquivo-no-lugar-da-pasta" });
    }
    atual = proximo;
  }
  yield* realDentro(real, atual);
  return atual;
});

/**
 * Grava `conteudo` em `real/relativo` sem seguir link: as pastas do caminho conferidas por
 * `pastaSemLinks`, um temporário novo na mesma pasta (`PastasNode.gravarTemporario`, com `O_EXCL` e
 * `O_NOFOLLOW`) e o `rename` sobre o alvo, que troca o próprio link (ou arquivo) de uma vez. O caminho
 * real da pasta é conferido antes do `rename`; se ele falhar, o temporário sai.
 */
export const gravarSemSeguirLinks = Effect.fn("PastasTrabalho.gravarSemSeguirLinks")(function* (
  real: string,
  relativo: string,
  conteudo: Uint8Array,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const partes = yield* partesSeguras(relativo);
  const nome = partes.pop()!;
  const pasta = (yield* pastaSemLinks(real, partes, true))!;
  const temporario = yield* PastasNode.gravarTemporario(pasta, PREFIXO_TEMPORARIO, conteudo);
  yield* realDentro(real, pasta).pipe(
    Effect.andThen(fs.rename(temporario, path.join(pasta, nome))),
    Effect.onError(() => Effect.ignore(fs.remove(temporario, { force: true }))),
  );
});

/** Remove `real/relativo` se for arquivo ou link (o link em si, nunca o alvo); pastas no caminho, sem seguir links. */
export const removerSemSeguirLinks = Effect.fn("PastasTrabalho.removerSemSeguirLinks")(function* (
  real: string,
  relativo: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const partes = yield* partesSeguras(relativo);
  const nome = partes.pop()!;
  const pasta = yield* pastaSemLinks(real, partes, false);
  if (pasta === undefined) return;
  const alvo = path.join(pasta, nome);
  const tipo = Option.map(yield* Effect.option(fs.lstat(alvo)), (info) => info.type);
  if (Option.contains(tipo, "File") || Option.contains(tipo, "SymbolicLink")) yield* fs.remove(alvo);
});

/**
 * Copia `origem` para `destino` sem sobrescrever: o destino é aberto com `wx` antes de ler a origem
 * (`AlreadyExists` se o nome está ocupado, sem tocá-lo), e a escrita vai pelo descritor aberto, sem
 * seguir um link plantado depois. A cópia pela metade sai.
 */
const copiarSemSobrescrever = Effect.fn("PastasTrabalho.copiarSemSobrescrever")(function* (
  origem: string,
  destino: string,
) {
  const fs = yield* FileSystem.FileSystem;
  let criado = false;
  yield* Effect.scoped(
    Effect.gen(function* () {
      const saida = yield* fs.open(destino, { flag: "wx" });
      criado = true;
      yield* fs.stream(origem).pipe(Stream.runForEach((pedaco) => saida.writeAll(pedaco)));
    }),
  ).pipe(Effect.onError(() => (criado ? Effect.ignore(fs.remove(destino, { force: true })) : Effect.void)));
});

const lerManifestos = Effect.fn("PastasTrabalho.lerManifestos")(function* (pastaCopias: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const nomes = yield* fs.readDirectory(pastaCopias).pipe(Effect.orElseSucceed((): Array<string> => []));
  const manifestos: Array<Manifesto> = [];
  for (const nome of nomes) {
    if (!/^\d+$/.test(nome)) continue;
    const manifesto = yield* Effect.option(
      fs.readFileString(path.join(pastaCopias, nome, "manifesto.json")).pipe(Effect.flatMap(lerManifesto)),
    );
    // Cópia pela metade (o app fechou no meio): não conta.
    if (Option.isNone(manifesto)) continue;
    const fim = yield* Effect.option(
      fs.readFileString(path.join(pastaCopias, nome, "fim.json")).pipe(Effect.flatMap(lerRetratoFim)),
    );
    manifestos.push(Option.isNone(fim) ? manifesto.value : { ...manifesto.value, fim: fim.value });
  }
  return manifestos.sort((a, b) => b.turno - a.turno);
});

function diferenca(antes: Retrato, agora: Retrato) {
  const criados = Object.keys(agora).filter((nome) => antes[nome] === undefined);
  const alterados = Object.keys(agora).filter((nome) => antes[nome] !== undefined && antes[nome] !== agora[nome]);
  const apagados = Object.keys(antes).filter((nome) => agora[nome] === undefined);
  return { criados, alterados, apagados };
}

/** Copia a pasta para `<copias>/<turno>/` e mantém só as `limites.copias` mais recentes. */
const copiarTurno = Effect.fn("PastasTrabalho.copiarTurno")(function* (
  real: string,
  copias: string,
  turno: number,
  criadaEm: string,
  limites: Limites,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const destino = path.join(copias, String(turno));
  yield* fs.remove(destino, { recursive: true, force: true });
  yield* fs.makeDirectory(destino, { recursive: true });
  const varredura = yield* varrer(real, limites.arquivos);
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
      const alvo = yield* dentro(path.join(destino, "arquivos"), arquivo.nome);
      yield* fs.makeDirectory(path.dirname(alvo), { recursive: true });
      yield* fs.copyFile(path.join(real, arquivo.nome), alvo);
    }
    manifesto = { turno, criadaEm, arquivos: yield* retratar(real, varredura), pastas: varredura.pastas };
  }
  // O manifesto por último: sem ele, a cópia pela metade não conta.
  yield* fs.writeFileString(path.join(destino, "manifesto.json"), yield* codificarManifesto(manifesto));
  const turnos = (yield* fs.readDirectory(copias))
    .filter((nome) => /^\d+$/.test(nome))
    .map(Number)
    .sort((a, b) => b - a);
  for (const antigo of turnos.slice(limites.copias)) {
    yield* fs.remove(path.join(copias, String(antigo)), { recursive: true, force: true });
  }
});

/** Grava o retrato do fim do turno ao lado da cópia de antes dele (se houver cópia completa). */
const retratarFim = Effect.fn("PastasTrabalho.retratarFim")(function* (
  real: string,
  copias: string,
  turno: number,
  limites: Limites,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const destino = path.join(copias, String(turno));
  const manifesto = yield* Effect.option(
    fs.readFileString(path.join(destino, "manifesto.json")).pipe(Effect.flatMap(lerManifesto)),
  );
  if (Option.isNone(manifesto) || manifesto.value.arquivos === undefined) return;
  const varredura = yield* varrer(real, limites.arquivos);
  if (varredura.arquivos.length > limites.arquivos) return;
  const fim: RetratoFim = { arquivos: yield* retratar(real, varredura), pastas: varredura.pastas };
  yield* fs.writeFileString(path.join(destino, "fim.json"), yield* codificarRetratoFim(fim));
});

const SEM_DESFAZER: PrevisaoDesfazer = {
  disponivel: false,
  criados: [],
  alterados: [],
  apagados: [],
  foraDaConversa: [],
};

/* ================================================================== serviço */

/**
 * Um contador de operações em andamento: `contando` marca o efeito enquanto ele roda (também se falhar
 * ou for interrompido), e `emAndamento` diz se há alguma. O `ocupado` da atualização (M1.10) o lê.
 */
export const contadorDeAndamento = Effect.gen(function* () {
  const rodando = yield* Ref.make(0);
  const contando = <A, E, R>(efeito: Effect.Effect<A, E, R>) =>
    Effect.acquireUseRelease(
      Ref.update(rodando, (n) => n + 1),
      () => efeito,
      () => Ref.update(rodando, (n) => n - 1),
    );
  return { contando, emAndamento: Ref.get(rodando).pipe(Effect.map((n) => n > 0)) };
});

/** A falha de arquivo vira a frase para a pessoa, com a falha em `cause`. */
const comMotivo = (motivo: string) => Effect.mapError((cause: unknown) => new FalhaPasta({ motivo, cause }));

export const make = Effect.fn("PastasTrabalho.make")(function* (opcoes: OpcoesPastas) {
  const limites = { ...LIMITES, ...opcoes.limites };
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const historico = yield* Historico.Historico;
  const liberacao = yield* ArquivosLiberados.ArquivosLiberados;
  // O `FileSystem` e o `Path` das funções de arquivo deste módulo.
  const comArquivos = Effect.provideContext(yield* Effect.context<FileSystem.FileSystem | Path.Path>());
  const raiz = path.resolve(opcoes.raiz);

  const falha = (motivo: string) => new FalhaPasta({ motivo });

  /** O caminho real da pasta, se ela é gerida (filho direto da raiz); senão, `undefined`. */
  const gerida = Effect.fn("PastasTrabalho.gerida")(function* (pasta: string) {
    if (!path.isAbsolute(pasta)) return undefined;
    return yield* Effect.all([fs.realPath(pasta), fs.realPath(raiz)], { concurrency: 2 }).pipe(
      Effect.flatMap(([real, raizReal]) =>
        path.dirname(real) === raizReal
          ? fs.lstat(real).pipe(Effect.map((info) => (info.type === "Directory" ? real : undefined)))
          : Effect.undefined,
      ),
      // A pasta que não existe ou não se lê não é gerida: fica sem lista, anexos e cópias.
      Effect.orElseSucceed(() => undefined),
    );
  });

  const pastaCopias = (conversa: string): Effect.Effect<string, CaminhoRecusado> =>
    /^[A-Za-z0-9-]+$/.test(conversa)
      ? Effect.succeed(path.join(opcoes.copias, conversa))
      : Effect.fail(new CaminhoRecusado({ caminho: conversa, regra: "id-de-conversa" }));

  const criar = Effect.fn("PastasTrabalho.criar")(function* (titulo: string) {
    yield* fs.makeDirectory(raiz, { recursive: true });
    const nome = nomeSeguro(titulo);
    return yield* criarSemColisao(
      {
        pasta: raiz,
        nomes: (n) => (n === 1 ? nome : `${nome} (${n})`),
        // A pasta dos relatos não é de tarefa: o título igual a ela começa em " (2)".
        de: nome.toLowerCase() === PASTA_RELATOS.toLowerCase() ? 2 : 1,
        ate: 999,
      },
      (candidato) =>
        fs.makeDirectory(path.join(raiz, candidato)).pipe(Effect.andThen(fs.realPath(path.join(raiz, candidato)))),
    );
  }, comMotivo("Não foi possível criar a pasta da tarefa em Documentos/Simplifica IF."));

  const anexar = Effect.fn("PastasTrabalho.anexar")(function* (pasta: string, arquivo: string) {
    const real = yield* gerida(pasta);
    if (real === undefined) return yield* falha("Só é possível anexar na pasta de uma tarefa do app.");
    if (!path.isAbsolute(arquivo) || !(yield* liberacao.liberado(arquivo)))
      return yield* falha('Escolha o arquivo pelo botão "Anexar arquivo…" do app.');
    // A mesma lista do diálogo do desktop, também quando o servidor não exige a liberação (web, dev).
    if (!ehExtensaoDocumento(path.basename(arquivo)))
      return yield* falha("Anexe um documento (Word, PDF, texto, planilha, apresentação ou imagem).");
    const info = yield* fs.lstat(arquivo).pipe(comMotivo("O arquivo não foi encontrado ou não pode ser lido."));
    if (info.type !== "File") return yield* falha("Escolha um arquivo (não uma pasta nem um atalho).");
    if (Number(info.size) > limites.anexoBytes)
      return yield* falha(`O arquivo passa de ${Math.round(limites.anexoBytes / 1024 / 1024)} MB.`);
    const original = path.basename(arquivo);
    const nome = yield* criarSemColisao({ pasta: real, nomes: (n) => comNumero(original, n), ate: 999 }, (candidato) =>
      copiarSemSobrescrever(arquivo, path.join(real, candidato)).pipe(Effect.as(candidato), comArquivos),
    ).pipe(comMotivo("Não foi possível copiar o arquivo para a pasta da tarefa."));
    yield* historico.registrarAnexo(real, nome);
    const copiado = yield* fs.stat(path.join(real, nome)).pipe(comMotivo("O arquivo copiado sumiu."));
    return {
      nome,
      caminho: path.join(real, nome),
      tamanho: Number(copiado.size),
      alteradoEm: alteradoEm(copiado),
      origem: "anexado",
    } satisfies ArquivoPasta;
  });

  const gravarRelato = Effect.fn("PastasTrabalho.gravarRelato")(function* (nome: string, conteudo: string) {
    const pasta = path.join(raiz, PASTA_RELATOS);
    yield* fs.makeDirectory(pasta, { recursive: true });
    // Um link no lugar da pasta levaria o relato para fora de Documentos/Simplifica IF.
    if ((yield* fs.lstat(pasta)).type !== "Directory")
      return yield* new CaminhoRecusado({ caminho: pasta, regra: "nao-e-pasta" });
    const seguro = `${nomeSeguro(path.basename(nome, ".md"))}.md`;
    return yield* criarSemColisao({ pasta, nomes: (n) => comNumero(seguro, n), ate: 999 }, (candidato) => {
      const destino = path.join(pasta, candidato);
      return fs.writeFileString(destino, conteudo, { flag: "wx" }).pipe(Effect.as(destino));
    });
  }, comMotivo("Não foi possível gravar o relato em Documentos/Simplifica IF/Relatos de erro."));

  /**
   * O turno a desfazer: o mais recente cuja pasta mudou **dentro** dele (o retrato de antes × o do fim
   * do turno). Sem o retrato do fim (o app caiu no meio do turno), vale o de antes do turno seguinte ou,
   * no último, a pasta agora. Os arquivos mudados no turno que mudaram de novo depois (fora da conversa)
   * vão em `foraDaConversa`.
   */
  const prever = Effect.fn("PastasTrabalho.prever")(function* (
    conversa: string,
    real: string,
  ): Effect.fn.Return<
    { readonly previsao: PrevisaoDesfazer; readonly manifesto?: Manifesto; readonly fim?: RetratoFim },
    PlatformError.PlatformError | CaminhoRecusado,
    FileSystem.FileSystem | Path.Path
  > {
    const manifestos = yield* lerManifestos(yield* pastaCopias(conversa));
    const aviso = manifestos[0]?.aviso;
    // Sem a cópia do turno mais recente, voltar a uma mais antiga desfaria também o que veio depois dela.
    if (aviso !== undefined) return { previsao: { ...SEM_DESFAZER, aviso } };
    const varredura = yield* varrer(real, limites.arquivos);
    if (varredura.arquivos.length > limites.arquivos) return { previsao: SEM_DESFAZER };
    const agora: RetratoFim = { arquivos: yield* retratar(real, varredura), pastas: varredura.pastas };
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
  });

  const listar = Effect.fn("PastasTrabalho.listar")(function* (real: string, anexos: ReadonlySet<string>) {
    const varredura = yield* varrer(real, limites.arquivos);
    return varredura.arquivos.slice(0, limites.arquivos).map((entrada): ArquivoPasta => ({
      nome: entrada.nome,
      caminho: path.join(real, entrada.nome),
      tamanho: entrada.tamanho,
      alteradoEm: entrada.alteradoEm,
      origem: anexos.has(entrada.nome) ? "anexado" : "pasta",
    }));
  });

  const ver = Effect.fn("PastasTrabalho.ver")(function* (conversa: string, pasta: string) {
    const real = yield* gerida(pasta);
    if (real === undefined)
      return { pasta, gerida: false, arquivos: [], desfazer: SEM_DESFAZER } satisfies PastaConversa;
    const anexos = yield* historico.anexos(real);
    const [arquivos, { previsao }] = yield* Effect.all([listar(real, anexos), prever(conversa, real)], {
      concurrency: 2,
    }).pipe(comArquivos, comMotivo("Não foi possível ler a pasta da tarefa."));
    return { pasta: real, gerida: true, arquivos, desfazer: previsao } satisfies PastaConversa;
  });

  const guardarCopia = Effect.fn("PastasTrabalho.guardarCopia")(function* (
    conversa: string,
    turno: number,
    pasta: string,
  ) {
    const criadaEm = DateTime.formatIso(yield* DateTime.now);
    yield* Effect.gen(function* () {
      const real = yield* gerida(pasta);
      if (real !== undefined) yield* copiarTurno(real, yield* pastaCopias(conversa), turno, criadaEm, limites);
    }).pipe(
      comArquivos,
      Effect.catch((erro) => Effect.logWarning(`conversa ${conversa}: sem cópia da pasta no turno ${turno}`, erro)),
    );
  });

  const fecharTurno = Effect.fn("PastasTrabalho.fecharTurno")(function* (
    conversa: string,
    turno: number,
    pasta: string,
  ) {
    yield* Effect.gen(function* () {
      const real = yield* gerida(pasta);
      if (real !== undefined) yield* retratarFim(real, yield* pastaCopias(conversa), turno, limites);
    }).pipe(
      comArquivos,
      Effect.catch((erro) => Effect.logWarning(`conversa ${conversa}: sem retrato do fim do turno ${turno}`, erro)),
    );
  });

  /** Volta a pasta ao que era antes do turno que `prever` aponta, e apaga as cópias dele em diante. */
  const restaurar = Effect.fn("PastasTrabalho.restaurar")(function* (
    conversa: string,
    real: string,
    incluirForaDaConversa: boolean,
  ) {
    const { previsao, manifesto, fim } = yield* prever(conversa, real);
    if (!previsao.disponivel || manifesto === undefined || fim === undefined) return;
    const copias = yield* pastaCopias(conversa);
    const copia = path.join(copias, String(manifesto.turno), "arquivos");
    const antes = manifesto.arquivos ?? {};
    const pular = new Set(incluirForaDaConversa ? [] : previsao.foraDaConversa);
    for (const nome of previsao.criados) if (!pular.has(nome)) yield* removerSemSeguirLinks(real, nome);
    // As pastas que o turno criou e ficaram vazias saem também (as mais fundas primeiro).
    const pastasAntes = new Set(manifesto.pastas ?? []);
    const criadasNoTurno = fim.pastas
      .filter((nome) => !pastasAntes.has(nome))
      .sort((a, b) => b.split("/").length - a.split("/").length);
    for (const nome of criadasNoTurno) {
      const partes = yield* partesSeguras(nome);
      const caminho = yield* pastaSemLinks(real, partes, false).pipe(Effect.orElseSucceed(() => undefined));
      if (caminho !== undefined && (yield* fs.readDirectory(caminho)).length === 0)
        yield* PastasNode.removerPastaVazia(caminho);
    }
    for (const nome of [...previsao.alterados, ...previsao.apagados].filter((nome) => !pular.has(nome))) {
      // Um link de antes do turno não se restaura (a cópia não o tem); o que está no lugar sai.
      if (antes[nome] === LINK) yield* removerSemSeguirLinks(real, nome);
      else yield* gravarSemSeguirLinks(real, nome, yield* fs.readFile(yield* dentro(copia, nome)));
    }
    // As cópias deste turno em diante já não valem: o próximo Desfazer volta mais um turno.
    for (const nome of yield* fs.readDirectory(copias)) {
      if (/^\d+$/.test(nome) && Number(nome) >= manifesto.turno) {
        yield* fs.remove(path.join(copias, nome), { recursive: true, force: true });
      }
    }
  });

  const desfazer = Effect.fn("PastasTrabalho.desfazer")(function* (
    conversa: string,
    pasta: string,
    incluirForaDaConversa: boolean,
  ) {
    const real = yield* gerida(pasta);
    if (real === undefined) return yield* falha("Esta conversa não tem uma pasta de tarefa do app.");
    yield* restaurar(conversa, real, incluirForaDaConversa).pipe(
      comArquivos,
      comMotivo("Não foi possível restaurar a pasta. Confira se algum arquivo está aberto em outro programa."),
    );
    return yield* ver(conversa, real);
  });

  // Quantas operações sobre as pastas estão rodando: a troca da base (M1.10) não reinicia o servidor no meio delas.
  const { contando, emAndamento } = yield* contadorDeAndamento;
  return PastasTrabalho.of({
    raiz,
    criar,
    anexar,
    gravarRelato,
    ver,
    guardarCopia: Effect.fn("PastasTrabalho.contandoCopia")(function* (conversa: string, turno: number, pasta: string) {
      return yield* contando(guardarCopia(conversa, turno, pasta));
    }),
    fecharTurno: Effect.fn("PastasTrabalho.contandoRetrato")(function* (
      conversa: string,
      turno: number,
      pasta: string,
    ) {
      return yield* contando(fecharTurno(conversa, turno, pasta));
    }),
    desfazer: Effect.fn("PastasTrabalho.contandoDesfazer")(function* (
      conversa: string,
      pasta: string,
      incluir: boolean,
    ) {
      return yield* contando(desfazer(conversa, pasta, incluir));
    }),
    emAndamento,
  });
});

/**
 * Sem pastas de tarefa: nada é listado nem copiado (os testes do ciclo da conversa, que não usam a
 * pasta de trabalho do app).
 */
export const layerSemPastas = Layer.sync(PastasTrabalho, () => {
  const recusa = Effect.fn("PastasTrabalho.recusa")(() =>
    Effect.fail(new FalhaPasta({ motivo: "Sem pastas de tarefa neste servidor." })),
  );
  return PastasTrabalho.of({
    raiz: "",
    criar: recusa,
    anexar: recusa,
    gravarRelato: recusa,
    ver: Effect.fn("PastasTrabalho.ver")((_conversa: string, pasta: string) =>
      Effect.succeed({ pasta, gerida: false, arquivos: [], desfazer: SEM_DESFAZER } satisfies PastaConversa),
    ),
    guardarCopia: Effect.fn("PastasTrabalho.guardarCopia")(() => Effect.void),
    fecharTurno: Effect.fn("PastasTrabalho.fecharTurno")(() => Effect.void),
    desfazer: recusa,
    emAndamento: Effect.succeed(false),
  });
});

/** Pede o `Historico`, os `ArquivosLiberados` (a liberação dos arquivos escolhidos no desktop), o `FileSystem` e o `Path`. */
export const layer = (opcoes: OpcoesPastas) => Layer.effect(PastasTrabalho, make(opcoes));
