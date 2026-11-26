/**
 * O lado remoto: conferir o manifesto do canal, baixar a base e as skills e guardar o catálogo de tarefas
 * que o manifesto traz.
 *
 * Ordem das conferências, nesta ordem e sem atalho:
 *
 * 1. manifesto e `.minisig` baixados; a assinatura confere com a chave pública da política;
 * 2. o manifesto é do canal pedido e de uma versão mais nova que a em uso (nem a recusada): um
 *    manifesto antigo e bem assinado, servido de novo, não faz o app voltar;
 * 3. as skills retiradas do manifesto entram em `retiradas.json` (só cresce; a falha ao gravar é aviso,
 *    não interrompe); depois, `app_minimo` não passa da versão do app (`atende`, que falha fechado); se
 *    passar, nada se baixa e o aviso pede o app novo;
 * 4. cada arquivo baixado tem o tamanho e o sha256 do manifesto; o patch aplicado e o pacote inteiro
 *    descomprimido têm o `sha256_banco`;
 * 5. o banco abre, passa no `quick_check` e tem o esquema deste app e a versão do manifesto.
 *
 * Só então ele vira `base/pendente.sqlite`. Uma falha em qualquer passo apaga os temporários e deixa
 * a base em uso como estava.
 *
 * O catálogo de tarefas e a lista de skills retiradas vêm dentro do manifesto: a assinatura do passo 1
 * já os cobre, e nada mais se baixa por eles. O app os grava num arquivo de nome fixo
 * (`catalogo/pendente.json`); nenhum caminho vem do canal. Das skills, o nome é conferido pelo schema do
 * manifesto e cada caminho de arquivo, pelo `caminhoSeguro` do pacote.
 *
 * Sem a API do GitHub: só GET em URLs diretas (`releases/download/...`), que não contam no limite de
 * 60 consultas por hora por IP.
 */
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import type * as Semaphore from "effect/Semaphore";
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
import {
  type Abertura,
  acrescentarRetiradas,
  baixadoVence,
  caminhos,
  type EstadoGravado,
  escreverAtomico,
  gravarCatalogoPendente,
  gravarEstado,
  lerCatalogo,
  lerEstado,
  naPasta,
  trava,
  versaoDaPastaSkills,
} from "./local.ts";
import {
  arquivoManifesto,
  atende,
  type Canal,
  compararVersoes,
  decodificarManifesto,
  LIMITE_MANIFESTO,
  maiorVersao,
  type Manifesto,
  maisNova,
  SUFIXO_ASSINATURA,
  urlDoArquivo,
} from "./manifesto.ts";
import { type ChavePublica, lerChavePublica, verificar } from "./minisign.ts";
import { desempacotarSkill } from "./pacote-skill.ts";
import { aplicarPatch, descomprimir, sha256, validarBancoEmWorker } from "./pesado.ts";

/** Limite da base descomprimida (2 GB); o do manifesto (1 MB) é `LIMITE_MANIFESTO`, que a fábrica também confere. */
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

const conferirHash = Effect.fn("Atualizacao.conferirHash")(function* (
  dados: Uint8Array,
  esperado: { sha256: string; bytes: number },
  pacote: string,
) {
  if (dados.byteLength !== esperado.bytes) {
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

function feedValido(feed: string): boolean {
  try {
    urlManifesto(feed, "beta");
    return true;
  } catch {
    return false;
  }
}

/**
 * A política da atualização: o feed e a chave pública (o texto da linha base64), da política de fábrica
 * ou dos argumentos. Desligada, com o motivo, quando falta um deles ou a chave não se lê. O servidor do
 * app e o `simplifica-mcp` leem a política por aqui.
 */
export function opcoesDaPolitica(entrada: {
  readonly feed: string | null;
  readonly chave: string | null;
}):
  | { readonly desligada: null; readonly feed: string; readonly chave: ChavePublica }
  | { readonly desligada: string; readonly feed: string | null; readonly chave: ChavePublica | null } {
  let chave: ChavePublica | null = null;
  let problemaChave: string | null = null;
  try {
    chave = entrada.chave === null ? null : lerChavePublica(entrada.chave);
  } catch (erro) {
    problemaChave = `a chave pública da atualização é inválida (${(erro as Error).message})`;
  }
  if (entrada.feed === null) {
    return {
      desligada: "o endereço das atualizações ainda não está no app (hospedagem a configurar)",
      feed: null,
      chave,
    };
  }
  // `urlManifesto` usa `new URL`, que lança: um feed inválido desliga aqui, não vira defeito na conferência
  if (!feedValido(entrada.feed)) {
    return { desligada: "o endereço das atualizações é inválido", feed: entrada.feed, chave };
  }
  if (chave === null) {
    return {
      desligada: problemaChave ?? "a chave pública da fábrica ainda não está no app",
      feed: entrada.feed,
      chave,
    };
  }
  return { desligada: null, feed: entrada.feed, chave };
}

export interface Contexto {
  readonly pasta: string;
  readonly versaoApp: string;
  /**
   * O que `prepararAbertura` decidiu: a base em uso (o arquivo e a versão), a versão da base empacotada e
   * de onde vem o catálogo de tarefas do app (sem ela, `sem-pasta`: vale o baixado).
   */
  readonly abertura: Pick<Abertura, "banco" | "info" | "versaoEmpacotada"> & Partial<Pick<Abertura, "origemCatalogo">>;
  /** As versões das skills já disponíveis (empacotadas ou baixadas), por nome (padrão: nenhuma). */
  readonly versoesSkills?: ReadonlyMap<string, string>;
  /** As skills retiradas que o app já conhece (as do instalador e as baixadas): nenhuma se baixa nem fica. */
  readonly skillsRetiradas?: ReadonlySet<string>;
  /** Só a base, sem as skills nem o catálogo de tarefas (o `simplifica-mcp` fora do app). Padrão: tudo. */
  readonly soBase?: boolean;
  /** Prazo de cada download (padrão: `PRAZO_DOWNLOAD`). */
  readonly prazo?: Duration.Input;
  /**
   * A trava do `atualizacao.json` neste processo (a do `Atualizador`): cada leitura-modificação-gravação
   * do arquivo passa por ela, as desta conferência e as da tela (canal, voltar, novidades vistas). Nunca
   * fica tomada durante um download. Sem ela (o `simplifica-mcp`), só a trava da pasta.
   */
  readonly travaEstado?: Semaphore.Semaphore;
  /**
   * O que esta conferência baixa ainda vale? Perguntado na trava do estado, antes de pôr no lugar o que
   * ela baixou: `false` (o canal mudou no meio dela) e nada fica pendente (resultado `descartada`).
   * Padrão: vale.
   */
  readonly vale?: Effect.Effect<boolean>;
}

export type Resultado = (
  | { readonly tipo: "em-dia" }
  | { readonly tipo: "app-desatualizado"; readonly appMinimo: string; readonly versao: string }
  | {
      readonly tipo: "baixada";
      readonly versao: string;
      readonly via: "patch" | "inteiro" | "nenhum";
      readonly skills: number;
      /** O manifesto trouxe um catálogo de tarefas mais novo que o em uso. */
      readonly catalogo: boolean;
    }
  /** O canal mudou durante a conferência (`Contexto.vale`): o que ela baixou não ficou pendente. */
  | { readonly tipo: "descartada" }
) & {
  /**
   * Skills em uso nesta execução (`Contexto.versoesSkills`) que as retiradas gravadas tiram (em
   * `retiradas.json` ou, se ele não se gravou, no catálogo baixado), com a versão do manifesto conferido:
   * saem quando o servidor reiniciar, e a tela oferece a troca. Só vem quando há. A retirada que não ficou
   * gravada em nenhum dos dois não vem: o reinício não a tiraria.
   */
  readonly retiradasPendentes?: { readonly versao: string; readonly skills: ReadonlyArray<string> };
  /** O que falhou sem interromper a conferência (gravar `retiradas.json`), para o log e a tela. Só vem quando há. */
  readonly avisos?: ReadonlyArray<string>;
};

/**
 * Lê, altera e grava o `atualizacao.json` na trava do estado (`Contexto.travaEstado`), se o que a
 * conferência baixou ainda vale (`Contexto.vale`). `antes` roda na trava, entre a leitura e a gravação (o
 * `rename` que põe o baixado no lugar). Devolve `false` quando não valia mais: nada mudou.
 */
const guardar = <E = never, R = never>(
  ctx: Contexto,
  alterar: (estado: EstadoGravado) => EstadoGravado,
  antes: Effect.Effect<void, E, R> = Effect.void as Effect.Effect<void, E, R>,
) => {
  const efeito = Effect.gen(function* () {
    if (!(yield* ctx.vale ?? Effect.succeed(true))) return false;
    const estado = yield* lerEstado(ctx.pasta);
    yield* antes;
    yield* gravarEstado(ctx.pasta, alterar(estado));
    return true;
  });
  return ctx.travaEstado === undefined ? efeito : ctx.travaEstado.withPermits(1)(efeito);
};

/**
 * Com o manifesto conferido: decide, baixa e deixa pendentes a base, as skills mais novas e o catálogo
 * de tarefas.
 *
 * - **Retiradas primeiro:** a lista do manifesto (pequena e sob a assinatura) entra em `retiradas.json`
 *   antes de tudo, também quando o app é velho demais (`app-desatualizado`) e quando a base não chega. Uma
 *   falha ao gravá-la vira aviso (`avisos`) e não interrompe o resto; as retiradas do manifesto valem
 *   assim mesmo nesta conferência. A retirada de uma skill em uso nesta execução sai em
 *   `retiradasPendentes`, em todo resultado, se ficou gravada (em `retiradas.json` ou no catálogo baixado).
 * - **Skills e catálogo, nunca de manifesto mais velho** que o último processado (`ultimoManifesto`), e só
 *   de manifesto mais novo que a base do instalador: um manifesto antigo servido de novo, ou um canal mais
 *   velho que o instalador, não volta uma skill retirada nem tira uma mais nova. O mesmo manifesto pode
 *   ser reprocessado: baixa a skill elegível que falta (a que pedia um app mais novo, depois de o app
 *   subir) numa pasta nova, sem refazer as que já estão, e regrava o catálogo só se nem o atual nem o
 *   pendente o têm legível. O catálogo é gravado por último e marca o manifesto como processado: uma falha
 *   nas skills se tenta de novo na conferência seguinte.
 * - **Catálogo que a abertura descartaria não se grava:** perde para o do app (`baixadoVence`, com a
 *   origem do catálogo desta execução: o do checkout, ou o de um instalador de commit mais novo); o
 *   manifesto fica processado assim mesmo, e a tela não avisa de tarefas novas que não viriam.
 * - **Canal trocado no meio** (`Contexto.vale`): o que já foi baixado não se põe no lugar, e o resultado é
 *   `descartada`. As retiradas gravadas ficam (só crescem, e valem em qualquer canal).
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
  // As retiradas não esperam nada: nem o app novo, nem a base.
  const c = caminhos(ctx.pasta);
  const avisos: string[] = [];
  let retiradas: ReadonlyArray<string> = [];
  // As retiradas que ficaram gravadas; `undefined`: `retiradas.json` não se gravou, e valem as que o
  // catálogo baixado guardar (lidas no fim, depois de ele talvez ser gravado por esta conferência).
  let gravadas: ReadonlyArray<string> | undefined = [];
  if (ctx.soBase !== true) {
    const lista = yield* acrescentarRetiradas(ctx.pasta, manifesto.skills_retiradas).pipe(Effect.result);
    if (Result.isFailure(lista)) {
      avisos.push(`a lista de skills retiradas não foi gravada (${lista.failure.message})`);
      retiradas = manifesto.skills_retiradas;
      gravadas = undefined;
    } else {
      retiradas = lista.success;
      gravadas = lista.success;
    }
  }
  const doCatalogoBaixado = Effect.gen(function* () {
    const nomes: string[] = [];
    for (const arquivo of [c.catalogoAtual, c.catalogoPendente]) {
      const lido = yield* lerCatalogo(arquivo);
      if (typeof lido === "object") nomes.push(...lido.skills_retiradas);
    }
    return nomes;
  });
  const comExtras = Effect.fnUntraced(function* (resultado: Resultado) {
    const persistidas = gravadas ?? (yield* doCatalogoBaixado);
    const emUsoRetiradas = retiradas.filter(
      (nome) => ctx.versoesSkills?.has(nome) === true && persistidas.includes(nome),
    );
    return {
      ...resultado,
      ...(emUsoRetiradas.length === 0
        ? {}
        : { retiradasPendentes: { versao: manifesto.versao, skills: emUsoRetiradas } }),
      ...(avisos.length === 0 ? {} : { avisos }),
    } satisfies Resultado as Resultado;
  });
  if (!atende(manifesto.app_minimo, ctx.versaoApp)) {
    return yield* comExtras({ tipo: "app-desatualizado", appMinimo: manifesto.app_minimo, versao: manifesto.versao });
  }
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const estado = yield* lerEstado(ctx.pasta);
  const versaoEmUso = ctx.abertura.info?.versao;
  // Versão fora do padrão conta como já tida: não se baixa.
  const jaTem = (versao: string) =>
    (versaoEmUso !== undefined && !maisNova(versao, versaoEmUso)) ||
    (estado.pendente !== undefined && !maisNova(versao, estado.pendente.versao)) ||
    estado.recusada === versao;

  let via: "patch" | "inteiro" | "nenhum" = "nenhum";
  if (!jaTem(manifesto.versao)) {
    const trazida = yield* baixarBase(manifesto, urlDoManifesto, ctx);
    if (trazida === "descartada") return yield* comExtras({ tipo: "descartada" });
    via = trazida;
  }
  const resultado = (skills: number, catalogo: boolean) =>
    comExtras(
      via === "nenhum" && skills === 0 && !catalogo
        ? { tipo: "em-dia" }
        : { tipo: "baixada", versao: manifesto.versao, via, skills, catalogo },
    );
  if (ctx.soBase === true) return yield* resultado(0, false);

  const lido = yield* lerEstado(ctx.pasta);
  const ultimo = lido.ultimoManifesto;
  // Mais velho que o último processado, ou sem comparação com ele: nada de skills nem catálogo.
  if (ultimo !== undefined && !atende(ultimo, manifesto.versao)) return yield* resultado(0, false);
  const empacotada = maiorVersao([ctx.abertura.versaoEmpacotada ?? undefined]);
  if (empacotada !== undefined && !maisNova(manifesto.versao, empacotada)) return yield* resultado(0, false);
  const mesmo = ultimo !== undefined && compararVersoes(ultimo, manifesto.versao) === 0;

  // Skills: as não retiradas, elegíveis (app e base mínimos) e mais novas que as disponíveis. A base é a
  // maior entre a em uso e a pendente (baixada agora ou numa tentativa anterior).
  const versaoBase = maiorVersao([versaoEmUso, lido.pendente?.versao]) ?? manifesto.versao;
  const conhecidas = new Set([...(ctx.skillsRetiradas ?? []), ...retiradas]);
  const elegiveis = manifesto.skills.filter(
    (skill) =>
      !conhecidas.has(skill.nome) &&
      atende(skill.app_minimo, ctx.versaoApp) &&
      atende(skill.base_minima, versaoBase) &&
      maisNova(skill.versao, ctx.versoesSkills?.get(skill.nome) ?? "0.0.0"),
  );
  const jaPendentes = lido.skillsPendentes ?? lido.skills;
  const atual = jaPendentes === undefined ? undefined : path.join(c.skills, jaPendentes);
  // A pasta montada deste mesmo manifesto já traz as skills dele: só falta o que não está nela.
  const novas =
    atual !== undefined && versaoDaPastaSkills(jaPendentes ?? "") === manifesto.versao
      ? yield* Effect.filter(elegiveis, (skill) =>
          fs.exists(path.join(atual, skill.nome)).pipe(
            Effect.map((existe) => !existe),
            naPasta("ler as skills"),
          ),
        )
      : elegiveis;
  let skills = 0;
  if (novas.length > 0) {
    // A pasta em uso não se reescreve: o mesmo manifesto reprocessado monta `<versao>+<n>`.
    let nomePasta = manifesto.versao;
    for (let n = 2; yield* fs.exists(path.join(c.skills, nomePasta)).pipe(naPasta("ler as skills")); n += 1) {
      nomePasta = `${manifesto.versao}+${n}`;
    }
    const destino = path.join(c.skills, nomePasta);
    const temporario = `${destino}.baixando`;
    const remover = (alvo: string) => fs.remove(alvo, { recursive: true, force: true });
    const montar = Effect.gen(function* () {
      yield* remover(temporario).pipe(naPasta("limpar as skills"));
      // As skills baixadas antes que o manifesto ainda lista, que não chegam agora e não foram retiradas
      // continuam: a pasta nova substitui a atual inteira na próxima abertura.
      const continuam = manifesto.skills
        .map((skill) => skill.nome)
        .filter((nome) => !conhecidas.has(nome) && !novas.some((nova) => nova.nome === nome));
      for (const nome of continuam) {
        if (atual === undefined) continue;
        const origem = path.join(atual, nome);
        if (!(yield* fs.exists(origem).pipe(naPasta("copiar as skills")))) continue;
        yield* fs.copy(origem, path.join(temporario, nome)).pipe(naPasta("copiar as skills"));
      }
      for (const skill of novas) {
        const pacote = `skill ${skill.nome}`;
        const dados = yield* baixar(urlDoArquivo(skill, urlDoManifesto), skill.bytes, ctx.prazo);
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
    });
    const guardada = yield* montar.pipe(
      Effect.andThen(
        guardar(
          ctx,
          (estado) => ({ ...estado, skillsPendentes: nomePasta }),
          fs.rename(temporario, destino).pipe(naPasta("trocar as skills")),
        ),
      ),
      Effect.onError(() => remover(temporario).pipe(Effect.ignore)),
    );
    if (!guardada) {
      yield* remover(temporario).pipe(Effect.ignore);
      return yield* comExtras({ tipo: "descartada" });
    }
    skills = novas.length;
  }
  // O catálogo do manifesto fica pendente, inteiro; qual vale, o baixado ou o do app, a abertura decide
  // (`OrigemCatalogo`). A versão de que se voltou só recusa a base: o catálogo dela vale. Do mesmo
  // manifesto, só se o catálogo dele se perdeu (o atual e o pendente ausentes ou ilegíveis).
  let catalogo = true;
  if (mesmo) {
    const catalogoAtual = yield* lerCatalogo(c.catalogoAtual);
    const catalogoPendente = yield* lerCatalogo(c.catalogoPendente);
    const noAtual = typeof catalogoAtual === "object" && atende(manifesto.versao, catalogoAtual.versao);
    const noPendente =
      lido.catalogoPendente !== undefined &&
      typeof catalogoPendente === "object" &&
      catalogoPendente.versao === manifesto.versao;
    catalogo = !noAtual && !noPendente;
  }
  // O catálogo que perde para o do app (o do checkout, o de um instalador de commit mais novo) não se
  // grava: a abertura o descartaria, e a tela avisaria de tarefas novas que não vêm.
  const vence = baixadoVence(
    manifesto,
    ctx.abertura.origemCatalogo ?? { tipo: "sem-pasta" },
    ctx.abertura.versaoEmpacotada,
  );
  if (catalogo && !vence.vence) {
    catalogo = false;
    const marcado = yield* guardar(ctx, (estado) => ({ ...estado, ultimoManifesto: manifesto.versao }));
    if (!marcado) return yield* comExtras({ tipo: "descartada" });
  } else if (catalogo) {
    const guardado = yield* guardar(
      ctx,
      (estado) => ({ ...estado, catalogoPendente: manifesto.versao, ultimoManifesto: manifesto.versao }),
      gravarCatalogoPendente(ctx.pasta, {
        versao: manifesto.versao,
        commit: manifesto.commit,
        data_commit: manifesto.data_commit,
        tarefas: manifesto.tarefas,
        skills_retiradas: manifesto.skills_retiradas,
      }),
    );
    if (!guardado) return yield* comExtras({ tipo: "descartada" });
  }
  return yield* resultado(skills, catalogo);
});

const baixarBase = Effect.fn("Atualizacao.baixarBase")(function* (
  manifesto: Manifesto,
  urlDoManifesto: string,
  ctx: Contexto,
) {
  const fs = yield* FileSystem.FileSystem;
  const c = caminhos(ctx.pasta);
  const base = manifesto.base;
  const emUso = ctx.abertura.info;
  const patch = emUso === null ? undefined : base.patches.find((p) => p.de === emUso.versao);

  /** O banco pelo patch, se ele aplica e dá o `sha256_banco`; senão, `undefined` (cai no pacote inteiro). */
  const pelPatch = Effect.fn("Atualizacao.baixarPatch")(function* (p: NonNullable<typeof patch>) {
    const dados = yield* baixar(urlDoArquivo(p, urlDoManifesto), p.bytes, ctx.prazo);
    yield* conferirHash(dados, p, "patch da base");
    // patch que não aplica (base local diferente): cai no pacote inteiro
    const aplicado = yield* fs.readFile(ctx.abertura.banco).pipe(
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
    yield* escreverAtomico(c.baixando, banco);
    yield* validarBancoEmWorker(c.baixando, { versao: manifesto.versao, dataReferencia: base.data_referencia });
    // O `rename` e o estado juntos, na trava do estado: o arquivo pendente e a versão gravada não se separam.
    const guardada = yield* guardar(
      ctx,
      (estado) => ({ ...estado, pendente: { versao: manifesto.versao, novidades: manifesto.novidades } }),
      fs.rename(c.baixando, c.pendente).pipe(naPasta("guardar a base baixada")),
    );
    if (!guardada) {
      yield* fs.remove(c.baixando, { force: true }).pipe(Effect.ignore);
      return "descartada" as const;
    }
    return pelo === undefined ? ("inteiro" as const) : ("patch" as const);
  });
  return yield* trazer.pipe(Effect.onError(() => fs.remove(c.baixando, { force: true }).pipe(Effect.ignore)));
});

/**
 * Confere o manifesto e baixa o que for novo, uma vez, com a trava da pasta e gravando a hora da
 * conferência. O `Atualizador` do servidor e o `simplifica-mcp` fora do app usam o mesmo caminho.
 */
export const atualizarUmaVez = Effect.fn("Atualizacao.atualizarUmaVez")(function* (
  opcoes: Contexto & { readonly feed: string; readonly canal: Canal; readonly chave: ChavePublica },
) {
  if (!(yield* trava(opcoes.pasta))) return yield* new OutroProcessoAtualizando();
  const url = urlManifesto(opcoes.feed, opcoes.canal);
  const manifesto = yield* conferirManifesto({
    urlManifesto: url,
    canal: opcoes.canal,
    chave: opcoes.chave,
    ...(opcoes.prazo === undefined ? {} : { prazo: opcoes.prazo }),
  });
  const agora = DateTime.formatIso(yield* DateTime.now);
  const vale = yield* guardar(opcoes, (estado) => ({
    ...estado,
    ultimaConferencia: agora,
    manifestoGeradoEm: manifesto.gerado_em,
  }));
  if (!vale) return { tipo: "descartada" } satisfies Resultado as Resultado;
  return yield* baixarAtualizacao(manifesto, url, opcoes);
}, Effect.scoped);
