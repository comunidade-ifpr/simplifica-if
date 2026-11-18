// @effect-diagnostics nodeBuiltinImport:off -- o meta do banco por node:sqlite (síncrono, sem serviço do Effect), o sha256 por node:crypto e caminhos puros por node:path
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
 * ```
 *
 * **A troca só acontece com o banco fechado**, na abertura do servidor (`prepararAbertura`), antes de
 * qualquer layer abrir o `kb.sqlite`: no Windows, renomear um arquivo aberto falha, e no macOS o
 * servidor continuaria lendo o arquivo antigo. Cada passo é um `rename` na mesma pasta (atômico), e o
 * arquivo pendente é conferido de novo (sha256) antes de entrar.
 *
 * Os arquivos da pasta passam pelo `FileSystem`; só o `meta` do banco (`lerInfoBanco`) e a conferência
 * do banco baixado (`validarBancoNucleo`, que roda num `Worker`) usam o `node:sqlite` direto.
 */
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { VERSAO_ESQUEMA } from "@simplifica-if/kb/db/esquema";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { FalhaPastaAtualizacao } from "./erros.ts";
import { type Canal, compararVersoes, type Novidade, versaoDeData } from "./manifesto.ts";

export const ARQUIVO_ESTADO = "atualizacao.json";

export interface EstadoGravado {
  canal?: Canal;
  ultimaConferencia?: string;
  /** A base conferida em `base/pendente.sqlite`. */
  pendente?: { versao: string; sha256: string; novidades: ReadonlyArray<Novidade> };
  /** Pedido de voltar para a versão anterior, atendido na próxima abertura. */
  voltar?: boolean;
  /** A versão de que se voltou: não se baixa de novo; só uma mais nova. */
  recusada?: string;
  /** As novidades da última base aplicada; `vista` depois do aviso. */
  novidades?: { versao: string; itens: ReadonlyArray<Novidade>; vista: boolean };
  /** O conjunto de skills baixado em uso (`skills/<versao>`) e o que entra na próxima abertura. */
  skills?: string;
  skillsPendentes?: string;
  /** O `gerado_em` do último manifesto conferido: mais de 14 dias, e a tela avisa que não confirmou a base. */
  manifestoGeradoEm?: string;
}

export const caminhos = (pasta: string) => ({
  estado: NodePath.join(pasta, ARQUIVO_ESTADO),
  base: NodePath.join(pasta, "base"),
  atual: NodePath.join(pasta, "base", "kb.sqlite"),
  anterior: NodePath.join(pasta, "base", "kb.anterior.sqlite"),
  pendente: NodePath.join(pasta, "base", "pendente.sqlite"),
  baixando: NodePath.join(pasta, "base", "baixando.sqlite"),
  recusada: NodePath.join(pasta, "base", "kb.recusada.sqlite"),
  skills: NodePath.join(pasta, "skills"),
});

/** O texto do `atualizacao.json`; `{}` se ele não for um objeto JSON. */
export function decodificarEstado(texto: string): EstadoGravado {
  try {
    const lido: unknown = JSON.parse(texto);
    return typeof lido === "object" && lido !== null ? (lido as EstadoGravado) : {};
  } catch {
    return {};
  }
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
export const escreverAtomico = Effect.fn("Atualizacao.escreverAtomico")(function* (destino: string, dados: Uint8Array) {
  const fs = yield* FileSystem.FileSystem;
  yield* escreverPorTemporario(destino, (temporario) =>
    Effect.scoped(
      Effect.gen(function* () {
        const arquivo = yield* fs.open(temporario, { flag: "w" });
        yield* arquivo.writeAll(dados);
        yield* arquivo.sync;
      }),
    ),
  ).pipe(naPasta("gravar a base baixada"));
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
  /** `meta.versao_esquema`; `null` se o banco não o grava. */
  readonly versaoEsquema: number | null;
}

function esquemaDoMeta(meta: ReadonlyMap<string, string>): number | null {
  const valor = Number(meta.get("versao_esquema"));
  return Number.isInteger(valor) ? valor : null;
}

/** A versão de um `kb.sqlite` pelo `meta` (`versao`, ou a data de referência); `null` se não existir ou não abrir. */
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
      const data = meta.get("data_referencia") ?? null;
      const versao = meta.get("versao") ?? (data === null ? null : versaoDeData(data));
      if (versao === null) return null;
      return { versao, dataReferencia: data, commit: meta.get("commit") ?? null, versaoEsquema: esquemaDoMeta(meta) };
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
  esperado: { versao: string; dataReferencia?: string },
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
    if (esperado.dataReferencia !== undefined && meta.get("data_referencia") !== esperado.dataReferencia) {
      throw new Error("a data de referência da base baixada não é a do manifesto");
    }
    return {
      versao: esperado.versao,
      dataReferencia: meta.get("data_referencia") ?? null,
      commit: meta.get("commit") ?? null,
      versaoEsquema,
    };
  } catch (erro) {
    if (erro instanceof Error && erro.message.startsWith("a base baixada")) throw erro;
    throw new Error("a base baixada não pôde ser lida", { cause: erro });
  } finally {
    db.close();
  }
}

export const sha256Arquivo = Effect.fn("Atualizacao.sha256Arquivo")(function* (caminho: string) {
  const fs = yield* FileSystem.FileSystem;
  const hash = NodeCrypto.createHash("sha256");
  yield* fs
    .stream(caminho, { chunkSize: 4 * 1024 * 1024 })
    .pipe(Stream.runForEach((bloco) => Effect.sync(() => hash.update(bloco))));
  return hash.digest("hex");
});

/** Sobras de uma execução que caiu: `*.tmp` da pasta e de `base/`, `baixando.sqlite` e `skills/*.baixando`. */
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
  /** O que aconteceu, para o log. */
  readonly eventos: ReadonlyArray<string>;
}

/**
 * Na abertura do servidor, antes de abrir a base: atende o pedido de voltar, põe a pendente no lugar
 * (guardando a atual como anterior), passa as skills pendentes a atuais e escolhe a base mais nova
 * entre a baixada e a empacotada (um app novo pode trazer uma base mais nova que a baixada).
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
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const esquema = opcoes.versaoEsquema ?? VERSAO_ESQUEMA;
  const c = caminhos(opcoes.pasta);
  const estado = yield* lerEstado(opcoes.pasta);
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
      if ((yield* existe(c.pendente)) && (yield* sha256Arquivo(c.pendente)) === pendente.sha256) {
        if (yield* existe(c.atual)) yield* fs.rename(c.atual, c.anterior);
        yield* fs.rename(c.pendente, c.atual);
        estado.novidades = { versao: pendente.versao, itens: pendente.novidades, vista: false };
        eventos.push(`base ${pendente.versao} aplicada`);
      } else {
        yield* remover(c.pendente);
        eventos.push(`base pendente ${pendente.versao} descartada (arquivo ausente ou alterado)`);
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
  }).pipe(naPasta("trocar a base"));

  // A troca só com a trava: outro processo baixando na mesma pasta não vê os arquivos mudando de nome.
  yield* Effect.scoped(
    Effect.gen(function* () {
      if (!(yield* trava(opcoes.pasta))) {
        eventos.push("outro processo usa esta pasta de atualização; a troca fica para a próxima abertura");
        return;
      }
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
  const usarBaixada =
    baixada !== null && (empacotada === null || compararVersoes(baixada.versao, empacotada.versao) >= 0);
  const pastaSkills = estado.skills === undefined ? undefined : path.join(c.skills, estado.skills);
  const abertura: Abertura = {
    banco: usarBaixada ? c.atual : opcoes.bancoEmpacotado,
    origem: usarBaixada ? "baixada" : "empacotada",
    info: usarBaixada ? baixada : empacotada,
    pastasSkills:
      pastaSkills !== undefined && (yield* existe(pastaSkills).pipe(naPasta("ler as skills"))) ? [pastaSkills] : [],
    eventos,
  };
  return abertura;
});
