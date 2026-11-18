/**
 * O lado remoto: conferir o manifesto do canal e baixar a base e as skills.
 *
 * Ordem das conferências, nesta ordem e sem atalho:
 *
 * 1. manifesto e `.minisig` baixados; a assinatura confere com a chave pública da política;
 * 2. o manifesto é do canal pedido e de uma versão mais nova que a em uso (nem a recusada): um
 *    manifesto antigo e bem assinado, servido de novo, não faz o app voltar;
 * 3. `app_minimo` não passa da versão do app; se passar, nada se baixa e o aviso pede o app novo;
 * 4. cada arquivo baixado tem o tamanho e o sha256 do manifesto; o patch aplicado e o pacote inteiro
 *    descomprimido têm o `sha256_banco`;
 * 5. o banco abre, passa no `quick_check` e tem o esquema deste app e a versão do manifesto.
 *
 * Só então ele vira `base/pendente.sqlite`. Uma falha em qualquer passo apaga os temporários e deixa
 * a base em uso como estava.
 *
 * Sem a API do GitHub: só GET em URLs diretas (`releases/download/...`), que não contam no limite de
 * 60 consultas por hora por IP.
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/http/HttpClient";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { EnvHttpProxyAgent } from "undici";
import {
  FalhaDownload,
  FalhaPastaAtualizacao,
  hostDe,
  ManifestoRecusado,
  OutroProcessoAtualizando,
  PacoteInvalido,
} from "./erros.ts";
import { caminhos, escreverAtomico, gravarEstado, type InfoBanco, lerEstado, tomarTrava } from "./local.ts";
import {
  arquivoManifesto,
  type Canal,
  compararVersoes,
  decodificarManifesto,
  type Manifesto,
  SUFIXO_ASSINATURA,
  urlDoArquivo,
} from "./manifesto.ts";
import { type ChavePublica, verificar } from "./minisign.ts";
import { desempacotarSkill } from "./pacote-skill.ts";
import { aplicarPatch, descomprimir, sha256, validarBancoEmWorker } from "./pesado.ts";

/** Limite de um manifesto (1 MB) e da base descomprimida (2 GB). */
const LIMITE_MANIFESTO = 1024 * 1024;
const LIMITE_BANCO = 2 * 1024 * 1024 * 1024;

/** Prazo de cada download (o manifesto, a base inteira, um patch, uma skill). */
export const PRAZO_DOWNLOAD = Duration.minutes(10);

/**
 * A proxy da rede (institucional): `HTTP_PROXY`, `HTTPS_PROXY` e `NO_PROXY` do ambiente, ou estes, quando
 * dados. No app, o desktop passa ao servidor a proxy que o Electron resolve para o feed
 * (`session.resolveProxy`, que segue a configuração do sistema e o PAC).
 */
export interface OpcoesProxy {
  readonly httpProxy?: string;
  readonly httpsProxy?: string;
  readonly noProxy?: string;
}

/**
 * O `HttpClient` do download: o do `undici` (a mesma versão que o servidor já leva) com o
 * `EnvHttpProxyAgent` como dispatcher, fechado com a layer. O `fetch` global do Node não usa a proxy do
 * ambiente sem `NODE_USE_ENV_PROXY`, que precisa estar no ambiente desde a partida do processo.
 */
export const layerHttp = (proxy: OpcoesProxy = {}): Layer.Layer<HttpClient.HttpClient> =>
  NodeHttpClient.layerUndiciNoDispatcher.pipe(
    Layer.provide(
      Layer.effect(
        NodeHttpClient.Dispatcher,
        Effect.acquireRelease(
          Effect.sync(() => new EnvHttpProxyAgent(proxy)),
          (agente) => Effect.promise(() => agente.close()),
        ),
      ),
    ),
  );

/** GET com prazo, limite de tamanho e redirecionamentos (os links do GitHub vão para o CDN). */
export const baixar = Effect.fn("Atualizacao.baixar")(function* (
  url: string,
  limite: number,
  prazo: Duration.Input = PRAZO_DOWNLOAD,
) {
  const host = hostDe(url);
  const cliente = HttpClient.followRedirects(yield* HttpClient.HttpClient);
  const corpo = Effect.gen(function* () {
    const resposta = yield* cliente
      .get(url)
      .pipe(Effect.mapError((cause) => new FalhaDownload({ host, categoria: "sem-conexao", cause })));
    if (resposta.status < 200 || resposta.status >= 300) {
      return yield* new FalhaDownload({ host, categoria: "status", status: resposta.status });
    }
    const declarado = Number(resposta.headers["content-length"] ?? "0");
    if (declarado > limite) return yield* new FalhaDownload({ host, categoria: "grande-demais" });
    const partes: Uint8Array[] = [];
    let total = 0;
    yield* resposta.stream.pipe(
      Stream.mapError((cause) => new FalhaDownload({ host, categoria: "caiu-no-meio", cause })),
      Stream.runForEach((parte) => {
        total += parte.byteLength;
        if (total > limite) return Effect.fail(new FalhaDownload({ host, categoria: "grande-demais" }));
        partes.push(parte);
        return Effect.void;
      }),
    );
    return Buffer.concat(partes);
  });
  return yield* corpo.pipe(
    Effect.timeout(prazo),
    Effect.catchTags({
      TimeoutError: (cause) => Effect.fail(new FalhaDownload({ host, categoria: "prazo", cause })),
    }),
  );
});

/** Traduz a falha de arquivo da pasta de atualização, com a operação. */
const naPasta =
  (operacao: string) =>
  <A, R>(efeito: Effect.Effect<A, PlatformError.PlatformError, R>) =>
    Effect.mapError(efeito, (cause) => new FalhaPastaAtualizacao({ operacao, cause }));

/** As funções síncronas de `local.ts`, com a falha traduzida. */
const local = <A>(operacao: string, f: () => A) =>
  Effect.try({ try: f, catch: (cause) => new FalhaPastaAtualizacao({ operacao, cause }) });

const conferirHash = Effect.fn("Atualizacao.conferirHash")(function* (
  dados: Uint8Array,
  esperado: { sha256: string; bytes?: number },
  pacote: string,
) {
  if (esperado.bytes !== undefined && dados.byteLength !== esperado.bytes) {
    return yield* new PacoteInvalido({ pacote, motivo: "tamanho diferente do manifesto" });
  }
  if ((yield* sha256(dados)) !== esperado.sha256) {
    return yield* new PacoteInvalido({ pacote, motivo: "sha256 diferente do manifesto" });
  }
});

/** Baixa e confere o manifesto do canal (assinatura e canal). */
export const conferirManifesto = Effect.fn("Atualizacao.conferirManifesto")(function* (opcoes: {
  readonly urlManifesto: string;
  readonly canal: Canal;
  readonly chave: ChavePublica;
  readonly prazo?: Duration.Input;
}) {
  const dados = yield* baixar(opcoes.urlManifesto, LIMITE_MANIFESTO, opcoes.prazo);
  const assinatura = yield* baixar(`${opcoes.urlManifesto}${SUFIXO_ASSINATURA}`, 64 * 1024, opcoes.prazo);
  yield* Effect.try({
    try: () => verificar(dados, Buffer.from(assinatura).toString("utf8"), opcoes.chave),
    catch: (cause) => new ManifestoRecusado({ motivo: (cause as Error).message, cause }),
  });
  const manifesto = yield* Effect.try({
    try: () => decodificarManifesto(Buffer.from(dados).toString("utf8")),
    catch: (cause) => new ManifestoRecusado({ motivo: "assinado, mas fora do formato", cause }),
  });
  if (manifesto.canal !== opcoes.canal) {
    return yield* new ManifestoRecusado({
      motivo: `é do canal ${manifesto.canal}, e o pedido foi ${opcoes.canal}`,
    });
  }
  return manifesto;
});

/** A URL do manifesto de um canal, a partir do feed da política (com `{canal}`) ou de uma pasta. */
export function urlManifesto(feed: string, canal: Canal): string {
  const comCanal = feed.replaceAll("{canal}", canal);
  return new URL(arquivoManifesto(canal), comCanal.endsWith("/") ? comCanal : `${comCanal}/`).href;
}

export interface Contexto {
  readonly pasta: string;
  readonly versaoApp: string;
  /** A base em uso (o arquivo e a versão). */
  readonly baseEmUso: { readonly caminho: string; readonly info: InfoBanco | null };
  /** As versões das skills já disponíveis (empacotadas ou baixadas), por nome. */
  readonly versoesSkills: Readonly<Record<string, string>>;
  /** Baixar também as skills (padrão: sim; o `simplifica-mcp` fora do app só quer a base). */
  readonly comSkills?: boolean;
  /** Prazo de cada download (padrão: `PRAZO_DOWNLOAD`). */
  readonly prazo?: Duration.Input;
}

export type Resultado =
  | { readonly tipo: "em-dia" }
  | { readonly tipo: "app-desatualizado"; readonly appMinimo: string; readonly versao: string }
  | {
      readonly tipo: "baixada";
      readonly versao: string;
      readonly via: "patch" | "inteiro" | "nenhum";
      readonly skills: number;
    };

/**
 * Com o manifesto conferido: decide, baixa e deixa pendentes a base e as skills mais novas.
 */
export const baixarAtualizacao = Effect.fn("Atualizacao.baixarAtualizacao")(function* (
  manifesto: Manifesto,
  urlDoManifesto: string,
  ctx: Contexto,
): Effect.fn.Return<
  Resultado,
  FalhaDownload | PacoteInvalido | FalhaPastaAtualizacao,
  HttpClient.HttpClient | FileSystem.FileSystem | Path.Path
> {
  if (compararVersoes(manifesto.app_minimo, ctx.versaoApp) > 0) {
    return { tipo: "app-desatualizado", appMinimo: manifesto.app_minimo, versao: manifesto.versao };
  }
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const c = caminhos(ctx.pasta);
  const estado = yield* local("ler o estado", () => lerEstado(ctx.pasta));
  const versaoEmUso = ctx.baseEmUso.info?.versao;
  const jaTem = (versao: string) =>
    (versaoEmUso !== undefined && compararVersoes(versao, versaoEmUso) <= 0) ||
    (estado.pendente !== undefined && compararVersoes(versao, estado.pendente.versao) <= 0) ||
    estado.recusada === versao;

  let via: "patch" | "inteiro" | "nenhum" = "nenhum";
  let versaoBase = versaoEmUso ?? manifesto.versao;
  if (!jaTem(manifesto.versao)) {
    via = yield* baixarBase(manifesto, urlDoManifesto, ctx);
    versaoBase = manifesto.versao;
  }

  // Skills: as elegíveis (app e base mínimos) e mais novas que as disponíveis.
  const novas = (ctx.comSkills === false ? [] : manifesto.skills).filter(
    (skill) =>
      compararVersoes(skill.app_minimo, ctx.versaoApp) <= 0 &&
      compararVersoes(skill.base_minima, versaoBase) <= 0 &&
      compararVersoes(skill.versao, ctx.versoesSkills[skill.nome] ?? "0.0.0") > 0,
  );
  let skills = 0;
  const lido = yield* local("ler o estado", () => lerEstado(ctx.pasta));
  const jaPendentes = lido.skillsPendentes ?? lido.skills;
  if (novas.length > 0 && jaPendentes !== manifesto.versao) {
    const destino = path.join(c.skills, manifesto.versao);
    const temporario = `${destino}.baixando`;
    const remover = (alvo: string) => fs.remove(alvo, { recursive: true, force: true });
    const montar = Effect.gen(function* () {
      yield* remover(temporario).pipe(naPasta("limpar as skills"));
      // As skills baixadas antes que o manifesto ainda lista e que não chegam agora continuam: a pasta
      // nova substitui a atual inteira na próxima abertura.
      const atual = jaPendentes === undefined ? undefined : path.join(c.skills, jaPendentes);
      const continuam = manifesto.skills
        .map((skill) => skill.nome)
        .filter((nome) => !novas.some((nova) => nova.nome === nome));
      for (const nome of continuam) {
        if (atual === undefined) continue;
        const origem = path.join(atual, nome);
        if (!(yield* fs.exists(origem).pipe(naPasta("copiar as skills")))) continue;
        yield* fs.copy(origem, path.join(temporario, nome)).pipe(naPasta("copiar as skills"));
      }
      for (const skill of novas) {
        const pacote = `skill ${skill.nome}`;
        const dados = yield* baixar(urlDoArquivo(skill, urlDoManifesto), 50 * 1024 * 1024, ctx.prazo);
        yield* conferirHash(dados, skill, pacote);
        const desempacotada = yield* Effect.try({
          try: () => desempacotarSkill(dados),
          catch: (cause) => new PacoteInvalido({ pacote, motivo: "o pacote não se lê", cause }),
        });
        if (desempacotada.nome !== skill.nome || desempacotada.versao !== skill.versao) {
          return yield* new PacoteInvalido({ pacote, motivo: "o pacote não é o do manifesto" });
        }
        for (const arquivo of desempacotada.arquivos) {
          const alvo = path.join(temporario, desempacotada.nome, ...arquivo.caminho.split("/"));
          yield* fs.makeDirectory(path.dirname(alvo), { recursive: true }).pipe(naPasta("gravar as skills"));
          yield* fs.writeFile(alvo, arquivo.conteudo).pipe(naPasta("gravar as skills"));
        }
      }
      yield* remover(destino).pipe(naPasta("trocar as skills"));
      yield* fs.rename(temporario, destino).pipe(naPasta("trocar as skills"));
    });
    yield* montar.pipe(Effect.onError(() => remover(temporario).pipe(Effect.ignore)));
    const atual = yield* local("ler o estado", () => lerEstado(ctx.pasta));
    yield* local("gravar o estado", () => gravarEstado(ctx.pasta, { ...atual, skillsPendentes: manifesto.versao }));
    skills = novas.length;
  }
  if (via === "nenhum" && skills === 0) return { tipo: "em-dia" };
  return { tipo: "baixada", versao: manifesto.versao, via, skills };
});

const baixarBase = Effect.fn("Atualizacao.baixarBase")(function* (
  manifesto: Manifesto,
  urlDoManifesto: string,
  ctx: Contexto,
) {
  const fs = yield* FileSystem.FileSystem;
  const c = caminhos(ctx.pasta);
  const base = manifesto.base;
  const patch = ctx.baseEmUso.info === null ? undefined : base.patches.find((p) => p.de === ctx.baseEmUso.info?.versao);

  /** O banco pelo patch, se ele aplica e dá o `sha256_banco`; senão, `undefined` (cai no pacote inteiro). */
  const pelPatch = Effect.fn("Atualizacao.baixarPatch")(function* (p: NonNullable<typeof patch>) {
    const dados = yield* baixar(urlDoArquivo(p, urlDoManifesto), p.bytes ?? 256 * 1024 * 1024, ctx.prazo);
    yield* conferirHash(dados, p, "patch da base");
    // patch que não aplica (base local diferente): cai no pacote inteiro
    const aplicado = yield* fs.readFile(ctx.baseEmUso.caminho).pipe(
      Effect.flatMap((anterior) => aplicarPatch(anterior, dados, LIMITE_BANCO)),
      Effect.option,
    );
    if (aplicado._tag === "None") return undefined;
    return (yield* sha256(aplicado.value)) === base.sha256_banco ? aplicado.value : undefined;
  });

  const pacoteInteiro = Effect.gen(function* () {
    const pacote = "pacote da base";
    const dados = yield* baixar(urlDoArquivo(base, urlDoManifesto), base.bytes, ctx.prazo);
    yield* conferirHash(dados, base, pacote);
    const banco = yield* descomprimir(pacote, dados, LIMITE_BANCO);
    if ((yield* sha256(banco)) !== base.sha256_banco) {
      return yield* new PacoteInvalido({
        pacote,
        motivo: "o banco descomprimido não tem o sha256 do manifesto",
      });
    }
    return banco;
  });

  const trazer = Effect.gen(function* () {
    const pelo = patch === undefined ? undefined : yield* pelPatch(patch);
    const banco = pelo ?? (yield* pacoteInteiro);
    yield* local("gravar a base baixada", () => escreverAtomico(c.baixando, banco));
    yield* validarBancoEmWorker(c.baixando, {
      versao: manifesto.versao,
      ...(base.data_referencia === undefined ? {} : { dataReferencia: base.data_referencia }),
    });
    yield* fs.rename(c.baixando, c.pendente).pipe(naPasta("guardar a base baixada"));
    return pelo === undefined ? ("inteiro" as const) : ("patch" as const);
  });
  const via = yield* trazer.pipe(Effect.onError(() => fs.remove(c.baixando, { force: true }).pipe(Effect.ignore)));
  const estado = yield* local("ler o estado", () => lerEstado(ctx.pasta));
  yield* local("gravar o estado", () =>
    gravarEstado(ctx.pasta, {
      ...estado,
      pendente: { versao: manifesto.versao, sha256: base.sha256_banco, novidades: manifesto.novidades ?? [] },
    }),
  );
  return via;
});

/**
 * Confere o manifesto e baixa o que for novo, uma vez, gravando a hora da conferência. O `Atualizador`
 * do servidor e o `simplifica-mcp` fora do app usam o mesmo caminho.
 */
export const atualizarUmaVez = Effect.fn("Atualizacao.atualizarUmaVez")(function* (opcoes: {
  readonly feed: string;
  readonly canal: Canal;
  readonly chave: ChavePublica;
  readonly agora: string;
  readonly contexto: Contexto;
}) {
  const pasta = opcoes.contexto.pasta;
  const soltar = yield* local("tomar a trava", () => tomarTrava(pasta));
  if (soltar === null) return yield* new OutroProcessoAtualizando();
  return yield* Effect.gen(function* () {
    const url = urlManifesto(opcoes.feed, opcoes.canal);
    const manifesto = yield* conferirManifesto({
      urlManifesto: url,
      canal: opcoes.canal,
      chave: opcoes.chave,
      ...(opcoes.contexto.prazo === undefined ? {} : { prazo: opcoes.contexto.prazo }),
    });
    const estado = yield* local("ler o estado", () => lerEstado(pasta));
    yield* local("gravar o estado", () =>
      gravarEstado(pasta, {
        ...estado,
        ultimaConferencia: opcoes.agora,
        ...(manifesto.gerado_em === undefined ? {} : { manifestoGeradoEm: manifesto.gerado_em }),
      }),
    );
    return yield* baixarAtualizacao(manifesto, url, opcoes.contexto);
  }).pipe(Effect.ensuring(Effect.sync(soltar)));
});
