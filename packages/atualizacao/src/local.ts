// @effect-diagnostics nodeBuiltinImport:off -- o meta do banco por node:sqlite (síncrono, sem serviço do Effect), caminhos puros por node:path
/**
 * O lado local da atualização: a pasta do app, o estado gravado e a troca na abertura.
 *
 * ```
 * <pasta do app>/
 *   atualizacao.json        estado: canal, pendente, novidades, pedido de voltar
 *   base/kb.sqlite          a base baixada em uso
 *   base/kb.anterior.sqlite a versão anterior, para "voltar"
 *   base/pendente.sqlite    baixada e conferida, entra na próxima abertura
 *   base/baixando.*         temporários de um download em curso
 *   skills/<versao>/<nome>/ as skills baixadas de um manifesto
 *   retiradas.json          as skills retiradas que o app já conhece: só cresce
 *   catalogo/atual.json     o catálogo de tarefas do último manifesto aplicado
 *   catalogo/pendente.json  o do manifesto mais novo, que entra na próxima abertura
 * ```
 *
 * **A troca só acontece com o banco fechado**, na abertura do servidor (`prepararAbertura`), antes de
 * qualquer layer abrir o `kb.sqlite`: no Windows, renomear um arquivo aberto falha, e no macOS o
 * servidor continuaria lendo o arquivo antigo. Cada passo é um `rename` na mesma pasta (atômico). O
 * arquivo pendente já foi conferido (sha256, `quick_check`, esquema e versão) antes de virar pendente.
 *
 * Os arquivos da pasta passam pelo `FileSystem`; só o `meta` do banco (`lerInfoBanco`) e a conferência
 * do banco baixado (`validarBancoNucleo`, que roda num `Worker`) usam o `node:sqlite` direto.
 */
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { VERSAO_ESQUEMA } from "@simplifica-if/kb/db/esquema";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import type * as Types from "effect/Types";
import { FalhaPastaAtualizacao } from "./erros.ts";
import {
  atende,
  Canal,
  DataHora,
  instanteDe,
  maisNova,
  NomeSkill,
  Novidade,
  TarefaDoCanal,
  VersaoBase,
} from "./manifesto.ts";

export const ARQUIVO_ESTADO = "atualizacao.json";

export const EsquemaEstadoGravado = Schema.Struct({
  canal: Schema.optionalKey(Canal),
  ultimaConferencia: Schema.optionalKey(Schema.String),
  /** A base conferida em `base/pendente.sqlite`. */
  pendente: Schema.optionalKey(Schema.Struct({ versao: Schema.String, novidades: Schema.Array(Novidade) })),
  /** Pedido de voltar para a versão anterior, atendido na próxima abertura. */
  voltar: Schema.optionalKey(Schema.Boolean),
  /** A versão de que se voltou: não se baixa de novo; só uma mais nova. */
  recusada: Schema.optionalKey(Schema.String),
  /** As novidades da última base aplicada; `vista` depois do aviso. */
  novidades: Schema.optionalKey(
    Schema.Struct({ versao: Schema.String, itens: Schema.Array(Novidade), vista: Schema.Boolean }),
  ),
  /** O conjunto de skills baixado em uso (`skills/<versao>`) e o que entra na próxima abertura. */
  skills: Schema.optionalKey(Schema.String),
  skillsPendentes: Schema.optionalKey(Schema.String),
  /** A versão do catálogo em `catalogo/pendente.json`, que entra na próxima abertura. */
  catalogoPendente: Schema.optionalKey(Schema.String),
  /**
   * O último manifesto cujas skills e catálogo foram processados: as skills e o catálogo só vêm de um
   * manifesto mais novo que ele (e que a base do instalador). Um manifesto antigo servido de novo não
   * volta as skills nem o catálogo.
   */
  ultimoManifesto: Schema.optionalKey(Schema.String),
  /** O `gerado_em` do último manifesto conferido: mais de 14 dias, e a tela avisa que não confirmou a base. */
  manifestoGeradoEm: Schema.optionalKey(Schema.String),
});
export type EstadoGravado = Types.Mutable<typeof EsquemaEstadoGravado.Type>;

const decodificarEstadoJson = Schema.decodeUnknownResult(Schema.fromJsonString(EsquemaEstadoGravado));

export const caminhos = (pasta: string) => ({
  estado: NodePath.join(pasta, ARQUIVO_ESTADO),
  base: NodePath.join(pasta, "base"),
  atual: NodePath.join(pasta, "base", "kb.sqlite"),
  anterior: NodePath.join(pasta, "base", "kb.anterior.sqlite"),
  pendente: NodePath.join(pasta, "base", "pendente.sqlite"),
  baixando: NodePath.join(pasta, "base", "baixando.sqlite"),
  recusada: NodePath.join(pasta, "base", "kb.recusada.sqlite"),
  skills: NodePath.join(pasta, "skills"),
  retiradas: NodePath.join(pasta, "retiradas.json"),
  catalogo: NodePath.join(pasta, "catalogo"),
  catalogoAtual: NodePath.join(pasta, "catalogo", "atual.json"),
  catalogoPendente: NodePath.join(pasta, "catalogo", "pendente.json"),
});

/**
 * O catálogo como o app o guarda: as tarefas de um manifesto conferido, com a versão, o commit e a data
 * do commit do manifesto, e as skills retiradas que o mesmo manifesto trazia. O arquivo é escrito pelo
 * app, num caminho fixo: nada do canal vira nome de arquivo. A lista que vale das retiradas é a de
 * `retiradas.json`, que só cresce; a daqui a recompõe quando aquele arquivo se perde (`prepararAbertura`).
 */
export const CatalogoBaixado = Schema.Struct({
  versao: VersaoBase,
  commit: Schema.String,
  data_commit: DataHora,
  tarefas: Schema.Array(TarefaDoCanal),
  skills_retiradas: Schema.Array(NomeSkill),
});
export type CatalogoBaixado = typeof CatalogoBaixado.Type;

const CatalogoBaixadoJson = Schema.fromJsonString(CatalogoBaixado);
const decodificarCatalogoJson = Schema.decodeUnknownResult(CatalogoBaixadoJson);
const codificarCatalogoJson = Schema.encodeSync(CatalogoBaixadoJson);

/** Grava o catálogo baixado em `catalogo/pendente.json`, por temporário, `fsync` e `rename`. */
export const gravarCatalogoPendente = Effect.fn("Atualizacao.gravarCatalogoPendente")(function* (
  pasta: string,
  catalogo: CatalogoBaixado,
) {
  yield* escreverAtomico(
    caminhos(pasta).catalogoPendente,
    Buffer.from(`${codificarCatalogoJson(catalogo)}\n`, "utf8"),
    "gravar o catálogo de tarefas",
  );
});

/* ------------------------------------------------------------------ pastas das skills baixadas */

/**
 * A pasta das skills baixadas de um manifesto é `skills/<versao>`; quando o mesmo manifesto é reprocessado
 * (uma skill que passou a ser elegível depois de o app subir de versão), a pasta nova é
 * `skills/<versao>+<n>`, ao lado da em uso, que não se reescreve. A versão do conjunto é a parte antes do `+`.
 */
export const versaoDaPastaSkills = (nome: string): string => nome.split("+")[0] ?? nome;

/* ------------------------------------------------------------------ skills retiradas */

const RetiradasConhecidasJson = Schema.fromJsonString(Schema.Struct({ skills: Schema.Array(NomeSkill) }));
const decodificarRetiradasJson = Schema.decodeUnknownResult(RetiradasConhecidasJson);
const codificarRetiradasJson = Schema.encodeSync(RetiradasConhecidasJson);

/**
 * As skills retiradas que o app já conhece (`retiradas.json`): a união das listas de todos os manifestos
 * conferidos. `ausente` se o arquivo não existe; `invalido` se não se lê (inclusive por erro do disco).
 */
export const lerRetiradasConhecidas = Effect.fn("Atualizacao.lerRetiradasConhecidas")(function* (pasta: string) {
  const fs = yield* FileSystem.FileSystem;
  const texto = yield* fs.readFileString(caminhos(pasta).retiradas).pipe(Effect.result);
  if (Result.isFailure(texto)) {
    return texto.failure.reason._tag === "NotFound" ? ("ausente" as const) : ("invalido" as const);
  }
  const lido = decodificarRetiradasJson(texto.success);
  return Result.isSuccess(lido) ? lido.success.skills : ("invalido" as const);
});

/**
 * Soma `nomes` às retiradas conhecidas e grava a união (por temporário, `fsync` e `rename`); devolve a
 * união. A lista nunca encolhe: o registro da fábrica é só de acréscimos, e um manifesto antigo servido
 * de novo não tira nome nenhum. Um arquivo ilegível recomeça das `nomes` (a lista do manifesto já traz as
 * anteriores). O arquivo é gravado também quando não há retirada nenhuma: depois do primeiro manifesto
 * conferido, `retiradas.json` ausente é perda, e a abertura o trata assim.
 */
export const acrescentarRetiradas = Effect.fn("Atualizacao.acrescentarRetiradas")(function* (
  pasta: string,
  nomes: ReadonlyArray<string>,
) {
  const lidas = yield* lerRetiradasConhecidas(pasta);
  const antes = typeof lidas === "string" ? [] : lidas;
  const uniao = [...new Set([...antes, ...nomes])].sort();
  if (typeof lidas !== "string" && uniao.length === antes.length) return uniao;
  yield* escreverAtomico(
    caminhos(pasta).retiradas,
    Buffer.from(`${codificarRetiradasJson({ skills: uniao })}\n`, "utf8"),
    "gravar as skills retiradas",
  );
  return uniao;
});

/* ------------------------------------------------------------------ catálogo do instalador */

/** O arquivo que o build grava na pasta de tarefas do instalador: o commit de que o catálogo saiu e a data dele. */
export const ARQUIVO_ORIGEM_CATALOGO = "origem.json";

export const OrigemCatalogoJson = Schema.fromJsonString(
  Schema.Struct({ commit: Schema.String, data_commit: DataHora }),
);
const decodificarOrigemJson = Schema.decodeUnknownResult(OrigemCatalogoJson);
export const codificarOrigemCatalogo = Schema.encodeSync(OrigemCatalogoJson);

/**
 * De onde vem o catálogo de tarefas que o app traz:
 *
 * - `checkout`: quem sobe o servidor disse que a pasta de tarefas é a do repositório (`pnpm app:dev`, ou
 *   o servidor rodando do código-fonte): o catálogo local vence sempre o baixado. Não se infere pela
 *   falta do `origem.json`;
 * - `instalador`: o build gravou `origem.json` (o commit e a data dele): vence o de commit mais recente;
 * - `sem-origem`: a pasta do instalador sem `origem.json` legível (`ausente` ou `ilegivel`, com o mesmo
 *   tratamento): sem a data do commit, vale o baixado só se a versão do manifesto dele for mais nova que
 *   a da base empacotada, que saiu do mesmo build que o catálogo;
 * - `sem-pasta`: o servidor sem pasta de tarefas: vale o baixado.
 */
export type OrigemCatalogo =
  | { readonly tipo: "instalador"; readonly commit: string; readonly dataCommit: string }
  | { readonly tipo: "checkout" }
  | { readonly tipo: "sem-origem"; readonly motivo: "ausente" | "ilegivel" }
  | { readonly tipo: "sem-pasta" };

/**
 * A origem do catálogo de uma pasta de tarefas (`undefined`: o servidor sem pasta). `checkout`: quem sobe
 * o servidor sabe que a pasta é a do repositório (o `cli.ts` rodando do código-fonte, ou o desktop em
 * desenvolvimento, por `--tarefas-do-checkout`); aí o `origem.json` nem se lê.
 */
export const lerOrigemCatalogo = Effect.fn("Atualizacao.lerOrigemCatalogo")(function* (
  pastaTarefas: string | undefined,
  opcoes: { readonly checkout?: boolean } = {},
): Effect.fn.Return<OrigemCatalogo, never, FileSystem.FileSystem | Path.Path> {
  if (pastaTarefas === undefined) return { tipo: "sem-pasta" };
  if (opcoes.checkout === true) return { tipo: "checkout" };
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const texto = yield* fs.readFileString(path.join(pastaTarefas, ARQUIVO_ORIGEM_CATALOGO)).pipe(Effect.result);
  if (Result.isFailure(texto)) {
    return { tipo: "sem-origem", motivo: texto.failure.reason._tag === "NotFound" ? "ausente" : "ilegivel" };
  }
  const lido = decodificarOrigemJson(texto.success);
  return Result.isSuccess(lido)
    ? { tipo: "instalador", commit: lido.success.commit, dataCommit: lido.success.data_commit }
    : { tipo: "sem-origem", motivo: "ilegivel" };
});

/** O mesmo commit, com um dos dois abreviado (`git show --format=%h` no build, o curto também na fábrica). */
const mesmoCommit = (a: string, b: string) => a !== "" && b !== "" && (a.startsWith(b) || b.startsWith(a));

/**
 * O catálogo baixado vence o que o app traz? Com o evento do log quando não é óbvio.
 *
 * - do instalador: vence o de commit mais recente. No empate do instante (um segundo, a resolução do
 *   git), o do instalador só se for o mesmo commit; de commits diferentes, o baixado, que a fábrica só
 *   publica descendendo do anterior. Uma data que não dá instante (`NaN`) não decide: cai na regra sem
 *   origem, em vez de deixar o do instalador para sempre;
 * - sem origem: o baixado só se a versão dele for mais nova que a da base empacotada (sem ela, vence).
 */
export function baixadoVence(
  baixado: Pick<CatalogoBaixado, "versao" | "commit" | "data_commit">,
  origem: OrigemCatalogo,
  versaoEmpacotada: string | null,
): { readonly vence: boolean; readonly evento?: string } {
  const pelaVersao = (motivo: string) => {
    const vence = versaoEmpacotada === null || maisNova(baixado.versao, versaoEmpacotada);
    return {
      vence,
      evento: `${motivo}: vale o catálogo baixado só se a versão dele (${baixado.versao}) for mais nova que a da base empacotada (${versaoEmpacotada ?? "ilegível"}); ${vence ? "vale o baixado" : "vale o do instalador"}`,
    };
  };
  switch (origem.tipo) {
    case "checkout":
      return { vence: false, evento: `catálogo de tarefas baixado ${baixado.versao} ignorado: vale o do checkout` };
    case "sem-pasta":
      return { vence: true };
    case "sem-origem":
      return pelaVersao(
        `aviso: a pasta de tarefas do instalador ${origem.motivo === "ausente" ? "não tem" : "tem ilegível o"} ${ARQUIVO_ORIGEM_CATALOGO}`,
      );
    case "instalador": {
      const doBaixado = instanteDe(baixado.data_commit);
      const doInstalador = instanteDe(origem.dataCommit);
      if (Number.isNaN(doBaixado) || Number.isNaN(doInstalador))
        return pelaVersao("aviso: a data do commit do catálogo baixado ou do instalador não se lê");
      const vence =
        doBaixado > doInstalador || (doBaixado === doInstalador && !mesmoCommit(baixado.commit, origem.commit));
      return vence
        ? { vence }
        : {
            vence,
            evento: `catálogo de tarefas baixado ${baixado.versao} (commit de ${baixado.data_commit}) não é mais novo que o do instalador (commit ${origem.commit}, de ${origem.dataCommit}): vale o do instalador`,
          };
    }
  }
}

/** O catálogo de um arquivo da pasta: `ausente` se o arquivo falta, `invalido` se não se lê ou saiu do formato. */
export const lerCatalogo = Effect.fn("Atualizacao.lerCatalogo")(function* (arquivo: string) {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(arquivo).pipe(Effect.orElseSucceed(() => false)))) return "ausente" as const;
  const texto = yield* fs.readFileString(arquivo).pipe(Effect.option);
  if (texto._tag === "None") return "invalido" as const;
  const lido = decodificarCatalogoJson(texto.value);
  return Result.isSuccess(lido) ? lido.success : ("invalido" as const);
});

/** O texto do `atualizacao.json`; `{}` se ele não for um objeto JSON válido. */
export function decodificarEstado(texto: string): EstadoGravado {
  const resultado = decodificarEstadoJson(texto);
  return Result.isSuccess(resultado) ? { ...resultado.success } : {};
}

/** Traduz a falha de arquivo da pasta de atualização, com a operação. */
export const naPasta =
  (operacao: string) =>
  <A, R>(efeito: Effect.Effect<A, PlatformError.PlatformError, R>) =>
    Effect.mapError(efeito, (cause) => new FalhaPastaAtualizacao({ operacao, cause }));

/** O estado gravado; `{}` se o arquivo falta ou não se lê. */
export const lerEstado = Effect.fn("Atualizacao.lerEstado")(function* (pasta: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readFileString(caminhos(pasta).estado).pipe(
    Effect.map(decodificarEstado),
    Effect.orElseSucceed((): EstadoGravado => ({})),
  );
});

/** Escreve por temporário e `rename` na mesma pasta: o destino nunca fica pela metade. */
const escreverPorTemporario = Effect.fn("Atualizacao.escreverPorTemporario")(function* (
  destino: string,
  escrever: (temporario: string) => Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.dirname(destino), { recursive: true });
  const temporario = `${destino}.${process.pid}.tmp`;
  yield* escrever(temporario).pipe(
    Effect.andThen(fs.rename(temporario, destino)),
    Effect.onError(() => fs.remove(temporario, { force: true }).pipe(Effect.ignore)),
  );
});

/** Grava o estado por arquivo temporário e `rename`. */
export const gravarEstado = Effect.fn("Atualizacao.gravarEstado")(function* (pasta: string, estado: EstadoGravado) {
  const fs = yield* FileSystem.FileSystem;
  yield* escreverPorTemporario(caminhos(pasta).estado, (temporario) =>
    fs.writeFileString(temporario, `${JSON.stringify(estado, null, 2)}\n`),
  ).pipe(naPasta("gravar o estado"));
});

/** Escreve um arquivo por temporário + fsync + rename (o destino nunca fica pela metade). */
export const escreverAtomico = Effect.fn("Atualizacao.escreverAtomico")(function* (
  destino: string,
  dados: Uint8Array,
  operacao = "gravar a base baixada",
) {
  const fs = yield* FileSystem.FileSystem;
  yield* escreverPorTemporario(destino, (temporario) =>
    Effect.scoped(
      Effect.gen(function* () {
        const arquivo = yield* fs.open(temporario, { flag: "w" });
        yield* arquivo.writeAll(dados);
        yield* arquivo.sync;
      }),
    ),
  ).pipe(naPasta(operacao));
});

/* ------------------------------------------------------------------ trava */

export const ARQUIVO_TRAVA = "atualizacao.trava";

const vivo = (pid: number) => {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (erro) {
    // EPERM: o processo existe, de outro usuário.
    return (erro as NodeJS.ErrnoException).code === "EPERM";
  }
};

const tomarTrava = Effect.fn("Atualizacao.tomarTrava")(function* (arquivo: string) {
  const fs = yield* FileSystem.FileSystem;
  for (let tentativa = 0; tentativa < 2; tentativa += 1) {
    const criada = yield* fs.writeFileString(arquivo, String(process.pid), { flag: "wx" }).pipe(
      Effect.as(true),
      Effect.catchIf(
        (erro) => erro.reason._tag === "AlreadyExists",
        () => Effect.succeed(false),
      ),
    );
    if (criada) return true;
    // sumiu entre o open e a leitura: tenta de novo
    const dono = yield* fs.readFileString(arquivo).pipe(
      Effect.map((texto) => Number.parseInt(texto, 10)),
      Effect.orElseSucceed(() => Number.NaN),
    );
    if (vivo(dono)) return false;
    yield* fs.remove(arquivo, { force: true });
  }
  return false;
});

/**
 * A trava da pasta (`atualizacao.trava`, criada com `wx` e o pid dentro), para dois processos não
 * mexerem na mesma pasta ao mesmo tempo, solta quando o escopo fecha. Uma trava de processo que já
 * morreu (ou deste mesmo pid, sobra de uma execução anterior) é velha e se retoma. Dá `false` se outro
 * processo vivo a tem. O app e o `simplifica-mcp` usam pastas próprias; a trava é a rede de proteção.
 */
export const trava = (
  pasta: string,
): Effect.Effect<boolean, FalhaPastaAtualizacao, FileSystem.FileSystem | Path.Path | Scope.Scope> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const arquivo = path.join(pasta, ARQUIVO_TRAVA);
    return yield* Effect.acquireRelease(
      fs.makeDirectory(pasta, { recursive: true }).pipe(Effect.andThen(tomarTrava(arquivo)), naPasta("tomar a trava")),
      (tomada) => (tomada ? fs.remove(arquivo, { force: true }).pipe(Effect.ignore) : Effect.void),
    );
  });

/* ------------------------------------------------------------------ o banco */

export interface InfoBanco {
  readonly versao: string;
  readonly dataReferencia: string | null;
  readonly commit: string | null;
  /** `meta.fontes_sha256`: o hash das fontes; duas versões com o mesmo têm o mesmo conteúdo. */
  readonly fontesSha256: string | null;
  /** `meta.versao_esquema`; `null` se o banco não o grava. */
  readonly versaoEsquema: number | null;
}

function esquemaDoMeta(meta: ReadonlyMap<string, string>): number | null {
  const valor = Number(meta.get("versao_esquema"));
  return Number.isInteger(valor) ? valor : null;
}

/**
 * A versão de um `kb.sqlite` pelo `meta`: a `versao` da fábrica ou, no banco compilado sem ela, a de
 * desenvolvimento (`dev-` e 8 caracteres de `fontes_sha256`, como no envelope do simplifica-mcp);
 * `null` se não existir ou não abrir.
 */
export function lerInfoBanco(caminho: string): InfoBanco | null {
  try {
    const db = new NodeSqlite.DatabaseSync(caminho, { readOnly: true });
    try {
      const meta = new Map(
        db
          .prepare("SELECT chave, valor FROM meta")
          .all()
          .map((linha) => [String(linha["chave"]), String(linha["valor"])]),
      );
      const fontes = meta.get("fontes_sha256");
      const versao = meta.get("versao") ?? (fontes === undefined ? null : `dev-${fontes.slice(0, 8)}`);
      if (versao === null) return null;
      return {
        versao,
        dataReferencia: meta.get("data_referencia") ?? null,
        commit: meta.get("commit") ?? null,
        fontesSha256: fontes ?? null,
        versaoEsquema: esquemaDoMeta(meta),
      };
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/**
 * Confere um banco baixado antes de ele virar pendente: abre, `quick_check`, versão do esquema igual à
 * deste app, versão e data de referência iguais às do manifesto. Lança com o motivo em português (o
 * erro do SQLite, quando há, vai em `cause`).
 *
 * Só usa os parâmetros e globais: o `Worker` (`validarBancoEmWorker`) roda o texto desta função.
 */
export function validarBancoNucleo(
  sqlite: typeof NodeSqlite,
  versaoEsquema: number,
  caminho: string,
  esperado: { versao: string; dataReferencia: string },
): InfoBanco {
  let db: NodeSqlite.DatabaseSync;
  try {
    db = new sqlite.DatabaseSync(caminho, { readOnly: true });
  } catch (erro) {
    throw new Error("a base baixada não abre", { cause: erro });
  }
  try {
    const checagem = db.prepare("PRAGMA quick_check").all();
    const resultado = checagem.map((linha) => String(Object.values(linha)[0])).join("; ");
    if (resultado !== "ok") throw new Error(`a base baixada está corrompida (${resultado.slice(0, 200)})`);
    const meta = new Map(
      db
        .prepare("SELECT chave, valor FROM meta")
        .all()
        .map((linha) => [String(linha["chave"]), String(linha["valor"])]),
    );
    if (meta.get("versao_esquema") !== String(versaoEsquema)) {
      throw new Error(
        `a base baixada é de outro esquema (${meta.get("versao_esquema") ?? "sem versão"}; este app lê o ${versaoEsquema})`,
      );
    }
    if (meta.get("versao") !== esperado.versao) {
      throw new Error(
        `a base baixada diz ser a versão ${meta.get("versao") ?? "?"}, e o manifesto, ${esperado.versao}`,
      );
    }
    if (meta.get("data_referencia") !== esperado.dataReferencia) {
      throw new Error("a data de referência da base baixada não é a do manifesto");
    }
    return {
      versao: esperado.versao,
      dataReferencia: meta.get("data_referencia") ?? null,
      commit: meta.get("commit") ?? null,
      fontesSha256: meta.get("fontes_sha256") ?? null,
      versaoEsquema,
    };
  } catch (erro) {
    if (erro instanceof Error && erro.message.startsWith("a base baixada")) throw erro;
    throw new Error("a base baixada não pôde ser lida", { cause: erro });
  } finally {
    db.close();
  }
}

/** Sobras de uma execução que caiu: `*.tmp` da pasta, de `base/` e de `catalogo/`, `baixando.sqlite` e `skills/*.baixando`. */
export const limparSobras = Effect.fn("Atualizacao.limparSobras")(function* (pasta: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const c = caminhos(pasta);
  const sobras: string[] = [];
  const varrer = Effect.fn(function* (dir: string, teste: (nome: string) => boolean) {
    if (!(yield* fs.exists(dir))) return;
    for (const nome of yield* fs.readDirectory(dir)) {
      if (!teste(nome)) continue;
      yield* fs.remove(path.join(dir, nome), { recursive: true, force: true });
      sobras.push(path.relative(pasta, path.join(dir, nome)));
    }
  });
  yield* varrer(pasta, (nome) => nome.endsWith(".tmp"));
  yield* varrer(c.base, (nome) => nome.endsWith(".tmp") || nome === "baixando.sqlite");
  yield* varrer(c.skills, (nome) => nome.endsWith(".baixando"));
  yield* varrer(c.catalogo, (nome) => nome.endsWith(".tmp"));
  return sobras;
});

/* ------------------------------------------------------------------ abertura */

export interface Abertura {
  /** O `kb.sqlite` que o servidor abre. */
  readonly banco: string;
  readonly origem: "empacotada" | "baixada";
  readonly info: InfoBanco | null;
  /** Pastas de skills baixadas, além das empacotadas (o `CatalogoSkills` escolhe a versão maior de cada). */
  readonly pastasSkills: ReadonlyArray<string>;
  /**
   * O catálogo de tarefas baixado, quando ele vence o do app (`OrigemCatalogo`): substitui o empacotado
   * inteiro. `null`: vale o do app.
   */
  readonly catalogo: Pick<CatalogoBaixado, "versao" | "tarefas"> | null;
  /**
   * A versão da base empacotada (`null` se não se lê). As skills e o catálogo do instalador saíram do
   * mesmo build: um manifesto que não é mais novo que ela não traz skills nem catálogo.
   */
  readonly versaoEmpacotada: string | null;
  /**
   * De onde vem o catálogo de tarefas do app nesta execução: a conferência não grava o catálogo baixado
   * que a abertura descartaria por ele (`baixadoVence`).
   */
  readonly origemCatalogo: OrigemCatalogo;
  /**
   * As skills retiradas que os manifestos conferidos trouxeram (`retiradas.json`, só cresce, somado às do
   * catálogo baixado), venha ou não o catálogo baixado: o servidor as soma às do instalador.
   */
  readonly skillsRetiradas: ReadonlyArray<string>;
  /** O que aconteceu, para o log. */
  readonly eventos: ReadonlyArray<string>;
}

/**
 * Na abertura do servidor, antes de abrir a base: atende o pedido de voltar, põe a pendente no lugar
 * (guardando a atual como anterior), passa as skills e o catálogo pendentes a atuais e escolhe a base
 * mais nova entre a baixada e a empacotada (um app novo pode trazer uma base mais nova que a baixada).
 *
 * O catálogo de tarefas pendente só passa a atual se for legível e de versão do canal mais nova que a
 * do atual; senão, é descartado e o atual fica. Entre o baixado e o do app, a regra de `OrigemCatalogo`
 * (`catalogoEmpacotado`): o de commit mais recente contra o do instalador, a versão contra a base
 * empacotada sem `origem.json`, e o do checkout vence sempre. Tarefa não tem versão própria: o catálogo
 * troca inteiro.
 *
 * As skills retiradas são as de `retiradas.json` e as do catálogo baixado; sem nenhum dos dois legível,
 * a pasta de skills baixadas não entra nesta abertura.
 *
 * Só concorre a base baixada do esquema que este app lê (`versaoEsquema`, padrão `VERSAO_ESQUEMA`): o
 * app novo, de esquema novo, pode achar na pasta uma base baixada pelo app antigo, de versão mais nova
 * mas de outro esquema, que o servidor recusaria inteira; o mesmo depois de "voltar" para uma anterior
 * de outro esquema. Nesses casos abre a empacotada.
 */
export const prepararAbertura = Effect.fn("Atualizacao.prepararAbertura")(function* (opcoes: {
  readonly pasta: string;
  readonly bancoEmpacotado: string;
  readonly versaoEsquema?: number;
  /** De onde vem o catálogo de tarefas do app (`lerOrigemCatalogo`); padrão: `sem-pasta` (vale o baixado). */
  readonly catalogoEmpacotado?: OrigemCatalogo;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const esquema = opcoes.versaoEsquema ?? VERSAO_ESQUEMA;
  const c = caminhos(opcoes.pasta);
  // O estado se lê dentro da trava da pasta: lido antes, uma conferência de outro processo poderia
  // regravá-lo no intervalo, e a gravação daqui a desfaria.
  let estado: EstadoGravado = {};
  const eventos: string[] = [];
  const existe = (caminho: string) => fs.exists(caminho);
  const remover = (caminho: string) => fs.remove(caminho, { force: true, recursive: true });
  yield* fs.makeDirectory(c.base, { recursive: true }).pipe(naPasta("criar a pasta da base"));

  const trocar = Effect.gen(function* () {
    for (const sobra of yield* limparSobras(opcoes.pasta)) eventos.push(`sobra apagada: ${sobra}`);

    if (estado.voltar === true) {
      const saindo = lerInfoBanco(c.atual);
      if (yield* existe(c.anterior)) {
        yield* remover(c.recusada);
        if (yield* existe(c.atual)) yield* fs.rename(c.atual, c.recusada);
        yield* fs.rename(c.anterior, c.atual);
        if (yield* existe(c.recusada)) yield* fs.rename(c.recusada, c.anterior);
      } else if (yield* existe(c.atual)) {
        // Sem anterior baixada: volta para a empacotada, guardando a que sai.
        yield* fs.rename(c.atual, c.anterior);
      }
      if (saindo !== null) estado.recusada = saindo.versao;
      delete estado.voltar;
      delete estado.novidades;
      if (estado.pendente !== undefined) {
        yield* remover(c.pendente);
        delete estado.pendente;
      }
      eventos.push(`voltou da base ${saindo?.versao ?? "?"} para a anterior`);
    } else if (estado.pendente !== undefined) {
      const pendente = estado.pendente;
      if (yield* existe(c.pendente)) {
        if (yield* existe(c.atual)) yield* fs.rename(c.atual, c.anterior);
        yield* fs.rename(c.pendente, c.atual);
        estado.novidades = { versao: pendente.versao, itens: pendente.novidades, vista: false };
        eventos.push(`base ${pendente.versao} aplicada`);
      } else {
        yield* remover(c.pendente);
        eventos.push(`base pendente ${pendente.versao} descartada (arquivo ausente)`);
      }
      delete estado.pendente;
    }

    if (estado.skillsPendentes !== undefined) {
      const anterior = estado.skills;
      estado.skills = estado.skillsPendentes;
      delete estado.skillsPendentes;
      eventos.push(`skills ${estado.skills} aplicadas`);
      if (yield* existe(c.skills)) {
        for (const pasta of yield* fs.readDirectory(c.skills)) {
          if (pasta !== estado.skills && pasta !== anterior) yield* remover(path.join(c.skills, pasta));
        }
      }
    }

    if (estado.catalogoPendente !== undefined) {
      const versao = estado.catalogoPendente;
      delete estado.catalogoPendente;
      const pendente = yield* lerCatalogo(c.catalogoPendente);
      const atual = yield* lerCatalogo(c.catalogoAtual);
      if (pendente === "ausente") {
        eventos.push(`catálogo de tarefas pendente ${versao} descartado (arquivo ausente)`);
      } else if (pendente === "invalido") {
        yield* remover(c.catalogoPendente);
        eventos.push(`catálogo de tarefas pendente ${versao} descartado (não se lê); fica o atual`);
      } else if (typeof atual === "object" && !maisNova(pendente.versao, atual.versao)) {
        yield* remover(c.catalogoPendente);
        eventos.push(
          `catálogo de tarefas pendente ${pendente.versao} descartado (não é mais novo que o atual, ${atual.versao})`,
        );
      } else {
        // O `rename` troca o catálogo inteiro: nada do anterior fica.
        yield* fs.rename(c.catalogoPendente, c.catalogoAtual);
        eventos.push(`catálogo de tarefas ${pendente.versao} aplicado`);
      }
    }
  }).pipe(naPasta("trocar a base"));

  // A troca só com a trava: outro processo baixando na mesma pasta não vê os arquivos mudando de nome.
  yield* Effect.scoped(
    Effect.gen(function* () {
      if (!(yield* trava(opcoes.pasta))) {
        // Sem a trava, nada se grava: o estado lido só diz que skills estão em uso.
        estado = yield* lerEstado(opcoes.pasta);
        eventos.push("outro processo usa esta pasta de atualização; a troca fica para a próxima abertura");
        return;
      }
      estado = yield* lerEstado(opcoes.pasta);
      yield* trocar;
      yield* gravarEstado(opcoes.pasta, estado);
    }),
  );

  const lida = lerInfoBanco(c.atual);
  const baixada = lida !== null && lida.versaoEsquema === esquema ? lida : null;
  if (lida !== null && baixada === null) {
    eventos.push(
      `base baixada ${lida.versao} é do esquema ${lida.versaoEsquema ?? "?"}, e este app lê o ${esquema}: abre a empacotada`,
    );
  }
  const empacotada = lerInfoBanco(opcoes.bancoEmpacotado);
  // No empate, a baixada; a versão fora do padrão não vence a empacotada.
  const usarBaixada = baixada !== null && (empacotada === null || atende(empacotada.versao, baixada.versao));
  const pastaSkills = estado.skills === undefined ? undefined : path.join(c.skills, estado.skills);
  const temSkillsBaixadas = pastaSkills !== undefined && (yield* existe(pastaSkills).pipe(naPasta("ler as skills")));
  const origemCatalogo = opcoes.catalogoEmpacotado ?? { tipo: "sem-pasta" };
  const lido = yield* lerCatalogo(c.catalogoAtual);
  if (lido === "invalido") eventos.push("catálogo de tarefas baixado não se lê: vale o do app");
  const catalogoBaixado = lido === "ausente" || lido === "invalido" ? null : lido;
  const decisao =
    catalogoBaixado === null ? undefined : baixadoVence(catalogoBaixado, origemCatalogo, empacotada?.versao ?? null);
  if (decisao?.evento !== undefined) eventos.push(decisao.evento);

  // As retiradas: as de `retiradas.json` somadas às do catálogo baixado, que veio de um manifesto assinado.
  // Sem `retiradas.json` legível, as do catálogo bastam; sem nenhum dos dois, as skills baixadas ficam de
  // fora nesta abertura (uma retirada entre elas voltaria), e a conferência seguinte regrava o arquivo.
  const gravadas = yield* lerRetiradasConhecidas(opcoes.pasta);
  const doCatalogo = catalogoBaixado?.skills_retiradas ?? [];
  let usarSkillsBaixadas = temSkillsBaixadas;
  if (typeof gravadas === "string" && temSkillsBaixadas) {
    const arquivo = gravadas === "ausente" ? "ausente" : "ilegível";
    if (catalogoBaixado !== null) {
      eventos.push(`lista de skills retiradas baixada ${arquivo}: recomposta da do catálogo baixado`);
    } else {
      usarSkillsBaixadas = false;
      eventos.push(
        `lista de skills retiradas baixada ${arquivo}, sem catálogo baixado que a recomponha: as skills baixadas ficam de fora nesta abertura`,
      );
    }
  } else if (gravadas === "invalido") {
    eventos.push("lista de skills retiradas baixada não se lê: valem as do instalador e as do catálogo baixado");
  }
  const retiradas = [...new Set([...(typeof gravadas === "string" ? [] : gravadas), ...doCatalogo])].sort();
  const abertura: Abertura = {
    banco: usarBaixada ? c.atual : opcoes.bancoEmpacotado,
    origem: usarBaixada ? "baixada" : "empacotada",
    info: usarBaixada ? baixada : empacotada,
    pastasSkills: pastaSkills !== undefined && usarSkillsBaixadas ? [pastaSkills] : [],
    catalogo:
      catalogoBaixado !== null && decisao?.vence === true
        ? { versao: catalogoBaixado.versao, tarefas: catalogoBaixado.tarefas }
        : null,
    versaoEmpacotada: empacotada?.versao ?? null,
    origemCatalogo,
    skillsRetiradas: retiradas,
    eventos,
  };
  return abertura;
});
