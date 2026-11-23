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
 * - **Diagnóstico:** `gravarDiagnostico` grava o `.zip` de "Gerar diagnóstico" em `<raiz>/Diagnósticos/`
 *   (`PASTA_DIAGNOSTICOS`), com as mesmas regras do relato.
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
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
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
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import {
  type ArquivoMudado,
  type ArquivoPasta,
  ehExtensaoDocumento,
  FalhaPasta,
  type MudancasPasta,
  type PastaConversa,
  type PrevisaoDesfazer,
} from "@simplifica-if/contratos-app";
import { ehPastaDoApp, PASTA_DIAGNOSTICOS, PASTA_RELATOS } from "@simplifica-if/contratos-app/ponte";
import * as ArquivosLiberados from "./ArquivosLiberados.ts";
import { comNumero, criarSemColisao } from "./nome-livre.ts";
import * as PastasNode from "./pastas-node.ts";
import * as Historico from "./persistencia/Historico.ts";
import * as TextosAnexos from "./textos-anexos/TextosAnexos.ts";
import { resumoDaFalha } from "./observabilidade/resumoDaFalha.ts";

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

/** Quantos documentos ganham a versão em texto no começo de um turno, e por quanto tempo (cada um pode levar até 30 s). */
const TEXTOS_POR_TURNO = 10;
const TEMPO_DE_TEXTOS_MS = 60_000;

/** O índice dos textos da pasta: de cada documento, a impressão do conteúdo convertido e se o texto saiu. */
const INDICE_TEXTOS = `${TextosAnexos.PASTA_TEXTOS}/indice.json`;
const IndiceTextos = Schema.Record(
  Schema.String,
  Schema.Struct({
    origem: Schema.String,
    texto: Schema.Boolean,
    /**
     * Ainda não avisado à IA: `anexado` pelo app (`anexar`), ou `novo`/`mudado` convertido no começo de um
     * turno que parou no preparo.
     */
    pendente: Schema.optionalKey(Schema.Literals(["anexado", "novo", "mudado"])),
    /** Por que não saiu texto, para repetir no aviso pendente. */
    semTexto: Schema.optionalKey(Schema.String),
  }),
);
type IndiceTextos = { [nome: string]: (typeof IndiceTextos.Type)[string] };
const lerIndiceJson = Schema.decodeUnknownEffect(Schema.fromJsonString(IndiceTextos));
const codificarIndiceJson = Schema.encodeEffect(Schema.fromJsonString(IndiceTextos));

/**
 * Onde "Salvar o relato" grava (M1.12) e onde "Gerar diagnóstico" grava o pacote: dentro da raiz e fora
 * da pasta de qualquer tarefa. Ficam na ponte para o desktop recusá-las ao mandar uma pasta à Lixeira.
 */
export { PASTA_DIAGNOSTICOS, PASTA_RELATOS };

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
    /** Onde ficam as cópias dos turnos (o diagnóstico omite o que vem depois dela, como da raiz). */
    readonly copias: string;
    /** Cria a pasta da tarefa e devolve o caminho real. */
    readonly criar: (titulo: string) => Effect.Effect<string, FalhaPasta>;
    /**
     * Copia o arquivo liberado para a pasta, grava a versão em texto dele, quando o formato pede, e o deixa
     * pendente: o próximo turno o avisa à IA.
     */
    readonly anexar: (pasta: string, arquivo: string) => Effect.Effect<ArquivoPasta, FalhaPasta>;
    /**
     * Grava o relato `nome` (um `.md`) em `<raiz>/Relatos de erro/`, fora do alcance da IA, sem
     * sobrescrever (` (2)`…), e devolve o caminho.
     */
    readonly gravarRelato: (nome: string, conteudo: string) => Effect.Effect<string, FalhaPasta>;
    /**
     * Grava o pacote de diagnóstico `nome` (um `.zip`) em `<raiz>/Diagnósticos/`, sem sobrescrever, e
     * devolve o caminho.
     */
    readonly gravarDiagnostico: (nome: string, conteudo: Uint8Array) => Effect.Effect<string, FalhaPasta>;
    /** Os arquivos da pasta da conversa e a previsão do Desfazer. */
    readonly ver: (conversa: string, pasta: string) => Effect.Effect<PastaConversa, FalhaPasta>;
    /**
     * Abre o turno na pasta: guarda a cópia de antes dele (o Desfazer) e devolve o que a pessoa mexeu na
     * pasta desde o fim do último turno que chegou à IA, fora da conversa (com a versão em texto dos
     * documentos novos ou mudados), e os anexos ainda não avisados; `undefined` sem nada a avisar. Nunca
     * falha: o erro vai para o log, e o turno segue sem cópia.
     */
    readonly abrirTurno: (conversa: string, turno: number, pasta: string) => Effect.Effect<MudancasPasta | undefined>;
    /**
     * Fecha o turno na pasta, uma vez por turno. Se a mensagem chegou à IA, o que `abrirTurno` avisou deixa
     * de estar pendente e o retrato do fim fica ao lado da cópia; se não chegou, a cópia sai (ela não tem o
     * que desfazer, e o turno seguinte compara a pasta com a do último que chegou à IA). Nunca falha.
     */
    readonly fecharTurno: (
      conversa: string,
      turno: number,
      pasta: string,
      opcoes: { readonly chegouAIA: boolean },
    ) => Effect.Effect<void>;
    readonly desfazer: (
      conversa: string,
      pasta: string,
      incluirForaDaConversa: boolean,
    ) => Effect.Effect<PastaConversa, FalhaPasta>;
    /**
     * Apaga as cópias do Desfazer da conversa (ao apagá-la); a pasta da tarefa fica. Devolve se deu certo
     * (sem cópias também conta); nunca falha: o erro vai para o log.
     */
    readonly esquecer: (conversa: string) => Effect.Effect<boolean>;
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

const EPOCA = "1970-01-01T00:00:00.000Z";

/**
 * A data de modificação em ISO 8601; a época se faltar ou estiver fora do intervalo do `Date` (um
 * `mtime` absurdo faria o `toISOString` lançar `RangeError`).
 */
const alteradoEm = (info: FileSystem.File.Info): string =>
  Option.match(info.mtime, {
    onNone: () => EPOCA,
    onSome: (data) => (Number.isNaN(data.getTime()) ? EPOCA : data.toISOString()),
  });

/**
 * A cópia e o retrato do turno não podem impedir a conversa de seguir: a falha e o defeito ficam no
 * log, pelo resumo (`resumoDaFalha`: sem o caminho, que traz o nome da pasta da tarefa e o dos arquivos);
 * a interrupção passa.
 */
const soNoLog =
  (mensagem: string) =>
  <A, E, R>(efeito: Effect.Effect<A, E, R>): Effect.Effect<A | void, never, R> =>
    efeito.pipe(
      Effect.catchCause((causa) =>
        Cause.hasInterruptsOnly(causa)
          ? Effect.interrupt
          : Effect.logWarning(`${mensagem}: ${resumoDaFalha(Cause.squash(causa))}`),
      ),
    );

/** A trava do Word com o documento aberto (`~$Minuta.docx`) e o temporário dele ao salvar (`~WRL0001.tmp`). */
const ehTemporarioDoWord = (nome: string) => nome.startsWith("~$") || /^~WRL\d+\.tmp$/i.test(nome);

/** A pasta sem os nomes que começam com `.` nem os temporários do Word, sem seguir links. */
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
      if (entrada.name.startsWith(".") || ehTemporarioDoWord(entrada.name)) continue;
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
    if (Option.contains(tipo, "SymbolicLink")) yield* PastasNode.removerArquivo(proximo);
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
  if (Option.contains(tipo, "File") || Option.contains(tipo, "SymbolicLink")) yield* PastasNode.removerArquivo(alvo);
});

/**
 * A falha de arquivo vira a frase para a pessoa, com o resumo da falha em `cause` (`resumoDaFalha`): o
 * erro original traz o caminho, que o evento `exception` do span gravaria no trace.
 */
const resumida = (motivo: string) => (falha: unknown) => new FalhaPasta({ motivo, cause: resumoDaFalha(falha) });
const comMotivo = (motivo: string) => Effect.mapError(resumida(motivo));

/**
 * Copia `origem` para `destino` sem sobrescrever: o destino é aberto com `wx` antes de ler a origem
 * (`AlreadyExists` se o nome está ocupado, sem tocá-lo), e a escrita vai pelo descritor aberto, sem
 * seguir um link plantado depois. A cópia pela metade sai. A falha de leitura da origem (o anexo, fora
 * das pastas do app) sai resumida, já neste span: o `PlatformError` dela traz o caminho do original.
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
      yield* fs.stream(origem).pipe(
        Stream.mapError(resumida("Não foi possível ler o arquivo original.")),
        Stream.runForEach((pedaco) => saida.writeAll(pedaco)),
      );
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
  return manifesto;
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

export const make = Effect.fn("PastasTrabalho.make")(function* (opcoes: OpcoesPastas) {
  const limites = { ...LIMITES, ...opcoes.limites };
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const historico = yield* Historico.Historico;
  const liberacao = yield* ArquivosLiberados.ArquivosLiberados;
  const textos = yield* TextosAnexos.TextosAnexos;
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
        // As pastas dos relatos e dos diagnósticos não são de tarefa: o título igual começa em " (2)".
        de: ehPastaDoApp(nome) ? 2 : 1,
        ate: 999,
      },
      (candidato) =>
        fs.makeDirectory(path.join(raiz, candidato)).pipe(Effect.andThen(fs.realPath(path.join(raiz, candidato)))),
    );
  }, comMotivo("Não foi possível criar a pasta da tarefa em Documentos/Simplifica IF."));

  /* ---------------------------------------------------------------- versão em texto */

  /** Os índices de texto (`indice.json`) são lidos e regravados um de cada vez. */
  const travaTextos = yield* Semaphore.make(1);

  /** O índice dos textos da pasta; vazio se não existe, se é link ou se não se lê. */
  const lerIndice = Effect.fn("PastasTrabalho.lerIndice")(function* (real: string) {
    const caminho = path.join(real, ...INDICE_TEXTOS.split("/"));
    const lido = yield* Effect.option(
      Effect.gen(function* () {
        yield* realDentro(real, path.dirname(caminho));
        if ((yield* fs.lstat(caminho)).type !== "File") return {};
        return yield* lerIndiceJson(yield* fs.readFileString(caminho));
      }).pipe(comArquivos),
    );
    // Uma cópia que se pode mudar: o turno e o anexo a atualizam e a regravam.
    const indice: IndiceTextos = { ...Option.getOrElse(lido, () => ({})) };
    return indice;
  });

  const gravarIndice = (real: string, indice: IndiceTextos) =>
    codificarIndiceJson(indice).pipe(
      Effect.flatMap((json) => gravarSemSeguirLinks(real, INDICE_TEXTOS, new TextEncoder().encode(json))),
      comArquivos,
      soNoLog("texto do anexo: não foi possível gravar o índice"),
    );

  /** Sem texto, com o motivo para a nota: o de uma versão anterior sai, para a IA não o ler como atual. */
  const semTextoNaPasta = (real: string, nome: string, motivo: string) =>
    Effect.ignore(removerSemSeguirLinks(real, TextosAnexos.caminhoDoTexto(nome)).pipe(comArquivos)).pipe(
      Effect.as({ semTexto: motivo }),
    );

  /**
   * A versão em texto de `nome` em `.simplifica/textos/` (`TextosAnexos`), convertida de `bytes`. A
   * gravação não segue link (a IA escreve na pasta e poderia pôr um no lugar de `.simplifica`); se a
   * conversão não dá certo, o texto de uma versão anterior sai. Nunca falha.
   */
  const gravarTexto = Effect.fn("PastasTrabalho.gravarTexto")(function* (
    real: string,
    nome: string,
    bytes: Uint8Array,
  ) {
    const resultado = yield* textos.converter(bytes, nome);
    const texto = TextosAnexos.caminhoDoTexto(nome);
    switch (resultado.tipo) {
      case "nao-converte":
        return {};
      case "sem-texto":
        return yield* semTextoNaPasta(real, nome, resultado.motivo);
      case "texto":
        return yield* gravarSemSeguirLinks(real, texto, new TextEncoder().encode(resultado.markdown)).pipe(
          comArquivos,
          Effect.as({ texto }),
          Effect.catch((erro) =>
            Effect.logError(`texto do anexo: não foi possível gravar: ${resumoDaFalha(erro)}`).pipe(
              Effect.andThen(semTextoNaPasta(real, nome, "Não foi possível gravar a versão em texto na pasta.")),
            ),
          ),
        );
    }
  });

  /**
   * Lê o documento `nome` da pasta sem seguir link (`PastasNode.lerSemSeguirLinks`, até o limite do
   * `TextosAnexos`) e grava o texto dele. Devolve o resultado para a nota, a impressão (`tamanho:sha256`)
   * dos bytes convertidos, quando houve leitura, e se o índice deve guardar o resultado: a recusa por troca
   * (link, pasta, fora da pasta, trocado durante a leitura) não entra, e o turno seguinte vê o que ficou.
   * Nunca falha.
   */
  const textoDoDocumento = Effect.fn("PastasTrabalho.textoDoDocumento")(function* (
    real: string,
    nome: string,
  ): Effect.fn.Return<{
    readonly resultado: { readonly texto?: string; readonly semTexto?: string };
    /** A impressão dos bytes lidos; sem leitura, quem chama usa a do retrato. */
    readonly impressao?: string;
    /** O resultado vai para o índice (a troca não vai: o próximo turno tenta de novo). */
    readonly registrar: boolean;
  }> {
    return yield* PastasNode.lerSemSeguirLinks(real, nome, textos.bytesDoArquivo).pipe(
      Effect.flatMap((bytes) =>
        Effect.gen(function* () {
          const hash = PastasNode.novoSha256();
          hash.atualizar(bytes);
          const impressao = `${bytes.length}:${hash.hex()}`;
          return { resultado: yield* gravarTexto(real, nome, bytes), impressao, registrar: true };
        }),
      ),
      Effect.catchTags({
        // O tamanho e o erro de E/S ficam no índice: o mesmo arquivo não se tenta de novo a cada turno.
        ArquivoGrandeDemais: () =>
          semTextoNaPasta(real, nome, `O arquivo passa de ${Math.round(textos.bytesDoArquivo / 1024 / 1024)} MB.`).pipe(
            Effect.map((resultado) => ({ resultado, registrar: true })),
          ),
        LeituraNaoFeita: (erro) =>
          Effect.logError(`texto do anexo: não foi possível ler o arquivo: ${resumoDaFalha(erro)}`).pipe(
            Effect.andThen(semTextoNaPasta(real, nome, "O arquivo não pôde ser lido.")),
            Effect.map((resultado) => ({ resultado, registrar: true })),
          ),
        // A troca (link, pasta, fora, removido): o texto da versão anterior sai, para a IA não o ler como
        // atual, mas o índice não registra: o próximo turno vê o que ficou e tenta de novo.
        LeituraRecusada: (erro) =>
          Effect.logWarning(`texto do anexo: o arquivo mudou antes da leitura: ${resumoDaFalha(erro)}`).pipe(
            Effect.andThen(semTextoNaPasta(real, nome, "O arquivo mudou de novo e não pôde ser lido.")),
            Effect.map((resultado) => ({ resultado, registrar: false })),
          ),
      }),
    );
  });

  /**
   * O resultado de `gravarTexto` no índice, com a impressão (`tamanho:sha256`) do arquivo convertido, e o
   * aviso pendente. A impressão vazia faz o próximo turno converter de novo.
   */
  const noIndice = (
    indice: IndiceTextos,
    nome: string,
    impressao: string,
    resultado: { texto?: string; semTexto?: string },
    pendente: "anexado" | "novo" | "mudado",
  ) => {
    // O que era anexado ou novo e ainda não foi avisado continua assim para a IA, mesmo que tenha mudado.
    const anterior = indice[nome]?.pendente;
    const aviso = pendente === "anexado" || anterior === undefined || anterior === "mudado" ? pendente : anterior;
    indice[nome] = {
      origem: impressao,
      texto: resultado.texto !== undefined,
      pendente: aviso,
      ...(resultado.semTexto === undefined ? {} : { semTexto: resultado.semTexto }),
    };
  };

  /** O texto de `nome` pelo índice, para o aviso: o caminho, o motivo de não haver, ou nada. */
  const textoNoIndice = (indice: IndiceTextos, nome: string): Omit<ArquivoMudado, "nome"> => {
    const entrada = indice[nome];
    if (entrada === undefined) return {};
    if (entrada.texto) return { texto: TextosAnexos.caminhoDoTexto(nome) };
    return entrada.semTexto === undefined ? {} : { semTexto: entrada.semTexto };
  };

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
    // O anexo fica pendente no índice, de qualquer formato: o próximo turno o avisa à IA (`abrirTurno`). O
    // texto se converte da cópia na pasta, lida sem seguir link: a impressão no índice é a dos bytes
    // convertidos, a que o retrato do começo do turno vai ver.
    yield* travaTextos.withPermits(1)(
      Effect.gen(function* () {
        const indice = yield* lerIndice(real);
        if (!TextosAnexos.EXTENSOES_CONVERTIDAS.includes(path.extname(nome).toLowerCase())) {
          noIndice(indice, nome, "", {}, "anexado");
          return yield* gravarIndice(real, indice);
        }
        const { resultado, impressao, registrar } = yield* textoDoDocumento(real, nome);
        // Sem leitura (grande demais, erro de E/S), a impressão vem da cópia, sem guardar o conteúdo; a troca
        // durante a leitura (`registrar` falso) fica sem impressão, e o próximo turno converte de novo.
        const registrada = !registrar
          ? ""
          : (impressao ??
            `${Number(copiado.size)}:${yield* sha256(path.join(real, nome)).pipe(
              comArquivos,
              Effect.orElseSucceed(() => ""),
            )}`);
        noIndice(indice, nome, registrada, resultado, "anexado");
        yield* gravarIndice(real, indice);
      }),
    );
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

  const gravarDiagnostico = Effect.fn("PastasTrabalho.gravarDiagnostico")(function* (
    nome: string,
    conteudo: Uint8Array,
  ) {
    const pasta = path.join(raiz, PASTA_DIAGNOSTICOS);
    yield* fs.makeDirectory(pasta, { recursive: true });
    // Um link no lugar da pasta levaria o pacote para fora de Documentos/Simplifica IF.
    if ((yield* fs.lstat(pasta)).type !== "Directory")
      return yield* new CaminhoRecusado({ caminho: pasta, regra: "nao-e-pasta" });
    const seguro = `${nomeSeguro(path.basename(nome, ".zip"))}.zip`;
    return yield* criarSemColisao({ pasta, nomes: (n) => comNumero(seguro, n), ate: 999 }, (candidato) => {
      const destino = path.join(pasta, candidato);
      return fs.writeFile(destino, conteudo, { flag: "wx" }).pipe(Effect.as(destino));
    });
  }, comMotivo("Não foi possível gravar o diagnóstico em Documentos/Simplifica IF/Diagnósticos."));

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

  /**
   * Põe em dia os textos da pasta pelo índice, no começo do turno: o texto de quem saiu da pasta sai
   * primeiro (assim um arquivo renomeado só na caixa das letras não perde o texto novo), e os documentos
   * cujo texto não é do conteúdo de `agora` (novos, mudados na pasta durante o turno, antes do primeiro,
   * ou voltados por um Desfazer) são convertidos: os de `primeiro` antes, até `TEXTOS_POR_TURNO` e
   * `TEMPO_DE_TEXTOS_MS`; os que sobram ficam para o próximo turno.
   */
  const atualizarTextos = Effect.fn("PastasTrabalho.atualizarTextos")(function* (
    real: string,
    agora: Retrato,
    primeiro: ReadonlyArray<string>,
  ) {
    const indice = yield* lerIndice(real);
    const conhecidos = new Set(Object.keys(indice));
    const removidos: Array<string> = [];
    for (const nome of Object.keys(indice)) {
      if (agora[nome] !== undefined && agora[nome] !== LINK) continue;
      yield* Effect.ignore(removerSemSeguirLinks(real, TextosAnexos.caminhoDoTexto(nome)).pipe(comArquivos));
      delete indice[nome];
      removidos.push(nome);
    }
    // O índice se grava a cada passo: um "Parar" no meio das conversões não joga fora o que já saiu.
    if (removidos.length > 0) yield* gravarIndice(real, indice);
    const converte = (nome: string) =>
      agora[nome] !== LINK && TextosAnexos.EXTENSOES_CONVERTIDAS.includes(path.extname(nome).toLowerCase());
    const pendentes = Object.keys(agora)
      .filter((nome) => converte(nome) && indice[nome]?.origem !== agora[nome])
      .sort((a, b) => Number(!primeiro.includes(a)) - Number(!primeiro.includes(b)) || a.localeCompare(b, "pt-BR"));
    const resultados = new Map<string, Omit<ArquivoMudado, "nome">>();
    const inicio = yield* Clock.currentTimeMillis;
    for (const [posicao, nome] of pendentes.entries()) {
      if (posicao >= TEXTOS_POR_TURNO || (yield* Clock.currentTimeMillis) - inicio > TEMPO_DE_TEXTOS_MS) {
        resultados.set(nome, {
          semTexto: "O app converte poucos documentos por mensagem; a versão em texto deste sai na próxima.",
        });
        continue;
      }
      // O retrato viu um arquivo comum dentro da pasta; o que virou link (ou foi para fora) não é lido.
      const { resultado, impressao, registrar } = yield* textoDoDocumento(real, nome);
      if (registrar) {
        noIndice(indice, nome, impressao ?? agora[nome]!, resultado, conhecidos.has(nome) ? "mudado" : "novo");
        yield* gravarIndice(real, indice);
      }
      resultados.set(nome, resultado);
    }
    return { resultados, removidos, conhecidos, indice };
  });

  /**
   * O que entrou ou mudou na pasta sem a IA saber, com os textos postos em dia: os anexos do app ainda
   * pendentes no índice, e o que a pessoa mexeu desde o fim do turno anterior (`antes`, quando há) até
   * `agora`. Os links ficam de fora de tudo; os nomes de trava do Word já ficaram fora do retrato. O que o
   * índice achou fora dessa janela (mudado durante o turno, antes do primeiro, depois de um Desfazer)
   * entra também, porque o texto dele mudou.
   */
  const mudancasForaDaConversa = Effect.fn("PastasTrabalho.mudancasForaDaConversa")(function* (
    real: string,
    antes: Retrato | undefined,
    agora: Retrato,
  ) {
    const { criados, alterados, apagados } =
      antes === undefined ? { criados: [], alterados: [], apagados: [] } : diferenca(antes, agora);
    const arquivo = (nome: string) => agora[nome] !== LINK;
    const novosNomes = new Set(criados.filter(arquivo));
    const mudadosNomes = new Set(alterados.filter(arquivo));
    const removidosNomes = new Set(apagados.filter((nome) => antes?.[nome] !== LINK));
    const { resultados, removidos, conhecidos, indice } = yield* atualizarTextos(real, agora, [...mudadosNomes]);
    for (const nome of resultados.keys()) {
      if (novosNomes.has(nome) || mudadosNomes.has(nome)) continue;
      (conhecidos.has(nome) ? mudadosNomes : novosNomes).add(nome);
    }
    // Os anexos ainda não avisados, num grupo só deles, e o que um turno parado no preparo converteu e
    // não chegou a avisar.
    const anexadosNomes = new Set<string>();
    for (const [nome, entrada] of Object.entries(indice)) {
      if (entrada.pendente === "anexado") {
        if (agora[nome] === undefined || agora[nome] === LINK) continue;
        anexadosNomes.add(nome);
        novosNomes.delete(nome);
        mudadosNomes.delete(nome);
        continue;
      }
      if (entrada.pendente === undefined || novosNomes.has(nome) || mudadosNomes.has(nome)) continue;
      (entrada.pendente === "novo" ? novosNomes : mudadosNomes).add(nome);
    }
    for (const nome of removidos) removidosNomes.add(nome);
    // O texto deste turno ou, convertido antes (num turno parado), o do índice.
    const comTexto = (nome: string): ArquivoMudado => ({
      nome,
      ...(resultados.get(nome) ?? textoNoIndice(indice, nome)),
    });
    const ordem = (nomes: Set<string>) => [...nomes].sort((a, b) => a.localeCompare(b, "pt-BR"));
    const mudancas: MudancasPasta = {
      _tag: "MudancasPasta",
      anexados: ordem(anexadosNomes).map(comTexto),
      novos: ordem(novosNomes).map(comTexto),
      mudados: ordem(mudadosNomes).map(comTexto),
      removidos: ordem(removidosNomes),
    };
    const total =
      mudancas.anexados.length + mudancas.novos.length + mudancas.mudados.length + mudancas.removidos.length;
    return total === 0 ? undefined : mudancas;
  });

  /** O que `abrirTurno` avisou, por turno aberto (`<conversa>/<turno>`), para `fecharTurno` confirmar só isso. */
  const avisados = new Map<string, ReadonlyArray<string>>();

  const abrirTurno = Effect.fn("PastasTrabalho.abrirTurno")(function* (conversa: string, turno: number, pasta: string) {
    const criadaEm = DateTime.formatIso(yield* DateTime.now);
    const mudancas = yield* Effect.gen(function* () {
      const real = yield* gerida(pasta);
      if (real === undefined) return undefined;
      const copias = yield* pastaCopias(conversa);
      // A cópia mais recente: a do último turno que chegou à IA (a do turno que não chegou sai em
      // `fecharTurno`; um Desfazer apaga as do turno desfeito em diante). Se esse turno não fechou (o app
      // caiu), não há retrato do fim, nem aviso: o que a IA fez nele pareceria da pessoa.
      const anterior = (yield* lerManifestos(copias)).find((manifesto) => manifesto.turno < turno);
      const manifesto = yield* copiarTurno(real, copias, turno, criadaEm, limites);
      // Pasta grande demais para a cópia: sem retrato, sem textos nem aviso.
      if (manifesto.arquivos === undefined) return undefined;
      const agora = manifesto.arquivos;
      return yield* travaTextos.withPermits(1)(mudancasForaDaConversa(real, anterior?.fim?.arquivos, agora));
    }).pipe(comArquivos, soNoLog(`conversa ${conversa}: sem cópia da pasta no turno ${turno}`));
    if (mudancas === undefined || mudancas === null) return undefined;
    avisados.set(
      `${conversa}/${turno}`,
      [...mudancas.anexados, ...mudancas.novos, ...mudancas.mudados].map((arquivo) => arquivo.nome),
    );
    return mudancas;
  });

  /** Apaga a cópia do turno que não chegou à IA. */
  const descartarCopia = Effect.fn("PastasTrabalho.descartarCopia")(function* (conversa: string, turno: number) {
    const copias = yield* pastaCopias(conversa);
    const copia = path.join(copias, String(turno));
    if (Option.isNone(yield* Effect.option(fs.stat(copia)))) return;
    // Primeiro o nome não numérico, de uma vez (`lerManifestos` o ignora); depois a remoção, que pode
    // parar no meio sem deixar uma cópia pela metade valendo.
    const descartada = path.join(copias, `descartada-${turno}-${DateTime.toEpochMillis(yield* DateTime.now)}`);
    yield* fs.rename(copia, descartada);
    yield* fs.remove(descartada, { recursive: true, force: true });
  });

  /**
   * Os nomes avisados à IA deixam de estar pendentes no índice. Só eles: um anexo que chegou durante o
   * turno continua pendente até o aviso do próximo.
   */
  const confirmarAviso = Effect.fn("PastasTrabalho.confirmarAviso")(function* (
    real: string,
    nomes: ReadonlyArray<string>,
  ) {
    yield* travaTextos.withPermits(1)(
      Effect.gen(function* () {
        const indice = yield* lerIndice(real);
        const pendentes = nomes.filter((nome) => indice[nome]?.pendente !== undefined);
        if (pendentes.length === 0) return;
        for (const nome of pendentes) {
          const { pendente: _, ...resto } = indice[nome]!;
          indice[nome] = resto;
        }
        yield* gravarIndice(real, indice);
      }),
    );
  });

  const fecharTurno = Effect.fn("PastasTrabalho.fecharTurno")(function* (
    conversa: string,
    turno: number,
    pasta: string,
    opcoes: { readonly chegouAIA: boolean },
  ) {
    const chave = `${conversa}/${turno}`;
    const nomes = avisados.get(chave) ?? [];
    avisados.delete(chave);
    if (!opcoes.chegouAIA) {
      yield* descartarCopia(conversa, turno).pipe(
        comArquivos,
        soNoLog(`conversa ${conversa}: a cópia do turno ${turno}, que não chegou à IA, não saiu`),
      );
      return;
    }
    // Dois passos independentes: o retrato sai mesmo que a confirmação morra.
    yield* Effect.gen(function* () {
      const real = yield* gerida(pasta);
      if (real === undefined) return;
      yield* confirmarAviso(real, nomes).pipe(
        comArquivos,
        soNoLog("texto do anexo: o aviso não ficou confirmado no índice"),
      );
      yield* retratarFim(real, yield* pastaCopias(conversa), turno, limites).pipe(
        comArquivos,
        soNoLog(`conversa ${conversa}: sem retrato do fim do turno ${turno}`),
      );
    }).pipe(soNoLog(`conversa ${conversa}: sem retrato do fim do turno ${turno}`));
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
    // Daqui em diante, sem interrupção: o Desfazer pela metade deixaria a pasta entre dois turnos e as
    // cópias apagadas ou não conforme o ponto do corte.
    yield* Effect.uninterruptible(
      Effect.gen(function* () {
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
      }),
    );
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

  const esquecer = Effect.fn("PastasTrabalho.esquecer")(
    function* (conversa: string) {
      const copias = yield* pastaCopias(conversa);
      yield* fs.remove(copias, { recursive: true, force: true });
      return true;
    },
    soNoLog("apagar a conversa: não foi possível remover as cópias do Desfazer"),
    Effect.map((ok) => ok === true),
  );

  // Quantas operações sobre as pastas estão rodando: a troca da base (M1.10) não reinicia o servidor no meio delas.
  const { contando, emAndamento } = yield* contadorDeAndamento;
  return PastasTrabalho.of({
    raiz,
    copias: path.resolve(opcoes.copias),
    criar,
    anexar,
    gravarRelato,
    gravarDiagnostico,
    ver,
    abrirTurno: Effect.fn("PastasTrabalho.contandoAbertura")(function* (
      conversa: string,
      turno: number,
      pasta: string,
    ) {
      return yield* contando(abrirTurno(conversa, turno, pasta));
    }),
    fecharTurno: Effect.fn("PastasTrabalho.contandoFechamento")(function* (
      conversa: string,
      turno: number,
      pasta: string,
      opcoes: { readonly chegouAIA: boolean },
    ) {
      return yield* contando(fecharTurno(conversa, turno, pasta, opcoes));
    }),
    desfazer: Effect.fn("PastasTrabalho.contandoDesfazer")(function* (
      conversa: string,
      pasta: string,
      incluir: boolean,
    ) {
      return yield* contando(desfazer(conversa, pasta, incluir));
    }),
    esquecer: Effect.fn("PastasTrabalho.contandoEsquecer")(function* (conversa: string) {
      return yield* contando(esquecer(conversa));
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
    copias: "",
    criar: recusa,
    anexar: recusa,
    gravarRelato: recusa,
    gravarDiagnostico: recusa,
    ver: Effect.fn("PastasTrabalho.ver")((_conversa: string, pasta: string) =>
      Effect.succeed({ pasta, gerida: false, arquivos: [], desfazer: SEM_DESFAZER } satisfies PastaConversa),
    ),
    abrirTurno: Effect.fn("PastasTrabalho.abrirTurno")(() => Effect.undefined),
    fecharTurno: Effect.fn("PastasTrabalho.fecharTurno")(() => Effect.void),
    desfazer: recusa,
    esquecer: Effect.fn("PastasTrabalho.esquecer")(() => Effect.succeed(true)),
    emAndamento: Effect.succeed(false),
  });
});

/**
 * Pede o `Historico`, os `ArquivosLiberados` (a liberação dos arquivos escolhidos no desktop), os
 * `TextosAnexos`, o `FileSystem` e o `Path`.
 */
export const layer = (opcoes: OpcoesPastas) => Layer.effect(PastasTrabalho, make(opcoes));
