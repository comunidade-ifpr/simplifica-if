// @effect-diagnostics nodeBuiltinImport:off globalFetch:off extendsNativeError:off -- download e gravação na pasta do app; funções em Promise que o serviço Effect (Atualizador.ts) chama por Effect.tryPromise; o fetch do Node basta para GET com prazo
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
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
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
import { EnvHttpProxyAgent, fetch as fetchUndici } from "undici";
import { caminhos, escreverAtomico, gravarEstado, type InfoBanco, lerEstado, tomarTrava } from "./local.ts";
import { desempacotarSkill } from "./pacote-skill.ts";
import { aplicarPatchAsync, descomprimirAsync, sha256Async, validarBancoEmWorker } from "./pesado.ts";

/** Limite de um manifesto (1 MB) e da base descomprimida (2 GB). */
const LIMITE_MANIFESTO = 1024 * 1024;
const LIMITE_BANCO = 2 * 1024 * 1024 * 1024;

export class ErroAtualizacao extends Error {
  override readonly name = "ErroAtualizacao";
}

export type Baixar = (url: string, limite: number) => Promise<Uint8Array>;

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
 * GET com prazo, limite de tamanho e proxy, pelo `fetch` do `undici` (a mesma versão que o servidor já
 * leva) com o `EnvHttpProxyAgent`: o `fetch` global do Node não usa a proxy do ambiente sem
 * `NODE_USE_ENV_PROXY`, que precisa estar no ambiente desde a partida do processo.
 */
export const baixarComFetch =
  (prazoMs = 10 * 60 * 1000, proxy: OpcoesProxy = {}): Baixar =>
  async (url, limite) => {
    const agente = new EnvHttpProxyAgent(proxy);
    let resposta: Awaited<ReturnType<typeof fetchUndici>>;
    try {
      resposta = await fetchUndici(url, {
        signal: AbortSignal.timeout(prazoMs),
        redirect: "follow",
        dispatcher: agente,
      });
    } catch (erro) {
      throw new ErroAtualizacao(`sem conexão com o servidor de atualização (${String(erro)})`, { cause: erro });
    }
    if (!resposta.ok) throw new ErroAtualizacao(`o servidor de atualização respondeu ${resposta.status} para ${url}`);
    const declarado = Number(resposta.headers.get("content-length") ?? "0");
    if (declarado > limite) throw new ErroAtualizacao(`arquivo maior que o esperado: ${url}`);
    const partes: Uint8Array[] = [];
    let total = 0;
    try {
      for await (const parte of resposta.body ?? []) {
        total += parte.byteLength;
        if (total > limite) throw new ErroAtualizacao(`arquivo maior que o esperado: ${url}`);
        partes.push(parte);
      }
    } catch (erro) {
      if (erro instanceof ErroAtualizacao) throw erro;
      throw new ErroAtualizacao(`o download caiu no meio (${url})`, { cause: erro });
    } finally {
      void agente.close();
    }
    return Buffer.concat(partes);
  };

async function conferirHash(dados: Uint8Array, esperado: { sha256: string; bytes?: number }, oQue: string) {
  if (esperado.bytes !== undefined && dados.byteLength !== esperado.bytes) {
    throw new ErroAtualizacao(`${oQue}: tamanho diferente do manifesto`);
  }
  if ((await sha256Async(dados)) !== esperado.sha256) {
    throw new ErroAtualizacao(`${oQue}: sha256 diferente do manifesto`);
  }
}

/** Baixa e confere o manifesto do canal (assinatura e canal). */
export async function conferirManifesto(opcoes: {
  readonly urlManifesto: string;
  readonly canal: Canal;
  readonly chave: ChavePublica;
  readonly baixar: Baixar;
}): Promise<Manifesto> {
  const dados = await opcoes.baixar(opcoes.urlManifesto, LIMITE_MANIFESTO);
  const assinatura = await opcoes.baixar(`${opcoes.urlManifesto}${SUFIXO_ASSINATURA}`, 64 * 1024);
  try {
    verificar(dados, Buffer.from(assinatura).toString("utf8"), opcoes.chave);
  } catch (erro) {
    throw new ErroAtualizacao(`manifesto recusado: ${(erro as Error).message}`, { cause: erro });
  }
  let manifesto: Manifesto;
  try {
    manifesto = decodificarManifesto(Buffer.from(dados).toString("utf8"));
  } catch (erro) {
    throw new ErroAtualizacao("manifesto assinado, mas fora do formato", { cause: erro });
  }
  if (manifesto.canal !== opcoes.canal) {
    throw new ErroAtualizacao(`manifesto do canal ${manifesto.canal}, e o pedido foi ${opcoes.canal}`);
  }
  return manifesto;
}

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
  readonly baixar: Baixar;
  /** Baixar também as skills (padrão: sim; o `simplifica-mcp` fora do app só quer a base). */
  readonly comSkills?: boolean;
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
export async function baixarAtualizacao(
  manifesto: Manifesto,
  urlDoManifesto: string,
  ctx: Contexto,
): Promise<Resultado> {
  if (compararVersoes(manifesto.app_minimo, ctx.versaoApp) > 0) {
    return { tipo: "app-desatualizado", appMinimo: manifesto.app_minimo, versao: manifesto.versao };
  }
  const c = caminhos(ctx.pasta);
  const estado = lerEstado(ctx.pasta);
  const versaoEmUso = ctx.baseEmUso.info?.versao;
  const jaTem = (versao: string) =>
    (versaoEmUso !== undefined && compararVersoes(versao, versaoEmUso) <= 0) ||
    (estado.pendente !== undefined && compararVersoes(versao, estado.pendente.versao) <= 0) ||
    estado.recusada === versao;

  let via: "patch" | "inteiro" | "nenhum" = "nenhum";
  let versaoBase = versaoEmUso ?? manifesto.versao;
  if (!jaTem(manifesto.versao)) {
    via = await baixarBase(manifesto, urlDoManifesto, ctx);
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
  const jaPendentes = lerEstado(ctx.pasta).skillsPendentes ?? lerEstado(ctx.pasta).skills;
  if (novas.length > 0 && jaPendentes !== manifesto.versao) {
    const destino = NodePath.join(c.skills, manifesto.versao);
    const temporario = `${destino}.baixando`;
    NodeFS.rmSync(temporario, { recursive: true, force: true });
    try {
      // As skills baixadas antes que o manifesto ainda lista e que não chegam agora continuam: a pasta
      // nova substitui a atual inteira na próxima abertura.
      const atual = jaPendentes === undefined ? undefined : NodePath.join(c.skills, jaPendentes);
      const continuam = manifesto.skills
        .map((skill) => skill.nome)
        .filter((nome) => !novas.some((nova) => nova.nome === nome));
      for (const nome of continuam) {
        if (atual === undefined || !NodeFS.existsSync(NodePath.join(atual, nome))) continue;
        NodeFS.cpSync(NodePath.join(atual, nome), NodePath.join(temporario, nome), { recursive: true });
      }
      for (const skill of novas) {
        const dados = await ctx.baixar(urlDoArquivo(skill, urlDoManifesto), 50 * 1024 * 1024);
        await conferirHash(dados, skill, `skill ${skill.nome}`);
        const pacote = desempacotarSkill(dados);
        if (pacote.nome !== skill.nome || pacote.versao !== skill.versao) {
          throw new ErroAtualizacao(`skill ${skill.nome}: o pacote não é o do manifesto`);
        }
        for (const arquivo of pacote.arquivos) {
          const alvo = NodePath.join(temporario, pacote.nome, ...arquivo.caminho.split("/"));
          NodeFS.mkdirSync(NodePath.dirname(alvo), { recursive: true });
          NodeFS.writeFileSync(alvo, arquivo.conteudo);
        }
      }
      NodeFS.rmSync(destino, { recursive: true, force: true });
      NodeFS.renameSync(temporario, destino);
    } catch (erro) {
      NodeFS.rmSync(temporario, { recursive: true, force: true });
      throw erro;
    }
    const atual = lerEstado(ctx.pasta);
    gravarEstado(ctx.pasta, { ...atual, skillsPendentes: manifesto.versao });
    skills = novas.length;
  }
  if (via === "nenhum" && skills === 0) return { tipo: "em-dia" };
  return { tipo: "baixada", versao: manifesto.versao, via, skills };
}

async function baixarBase(manifesto: Manifesto, urlDoManifesto: string, ctx: Contexto): Promise<"patch" | "inteiro"> {
  const c = caminhos(ctx.pasta);
  const base = manifesto.base;
  const patch = ctx.baseEmUso.info === null ? undefined : base.patches.find((p) => p.de === ctx.baseEmUso.info?.versao);
  let banco: Uint8Array | undefined;
  let via: "patch" | "inteiro" = "inteiro";
  try {
    if (patch !== undefined) {
      const dados = await ctx.baixar(urlDoArquivo(patch, urlDoManifesto), patch.bytes ?? 256 * 1024 * 1024);
      await conferirHash(dados, patch, "patch da base");
      try {
        const aplicado = await aplicarPatchAsync(
          await NodeFS.promises.readFile(ctx.baseEmUso.caminho),
          dados,
          LIMITE_BANCO,
        );
        if ((await sha256Async(aplicado)) === base.sha256_banco) {
          banco = aplicado;
          via = "patch";
        }
      } catch {
        // patch que não aplica (base local diferente): cai no pacote inteiro
      }
    }
    if (banco === undefined) {
      const dados = await ctx.baixar(urlDoArquivo(base, urlDoManifesto), base.bytes);
      await conferirHash(dados, base, "pacote da base");
      try {
        banco = await descomprimirAsync(dados, LIMITE_BANCO);
      } catch (erro) {
        throw new ErroAtualizacao("pacote da base não descomprime", { cause: erro });
      }
      if ((await sha256Async(banco)) !== base.sha256_banco) {
        throw new ErroAtualizacao("pacote da base: o banco descomprimido não tem o sha256 do manifesto");
      }
    }
    escreverAtomico(c.baixando, banco);
    await validarBancoEmWorker(c.baixando, {
      versao: manifesto.versao,
      ...(base.data_referencia === undefined ? {} : { dataReferencia: base.data_referencia }),
    });
    NodeFS.renameSync(c.baixando, c.pendente);
  } catch (erro) {
    NodeFS.rmSync(c.baixando, { force: true });
    if (erro instanceof ErroAtualizacao) throw erro;
    throw new ErroAtualizacao((erro as Error).message, { cause: erro });
  }
  const estado = lerEstado(ctx.pasta);
  gravarEstado(ctx.pasta, {
    ...estado,
    pendente: { versao: manifesto.versao, sha256: base.sha256_banco, novidades: manifesto.novidades ?? [] },
  });
  return via;
}

/**
 * Confere o manifesto e baixa o que for novo, uma vez, gravando a hora da conferência. O `Atualizador`
 * do servidor e o `simplifica-mcp` fora do app usam o mesmo caminho.
 */
export async function atualizarUmaVez(opcoes: {
  readonly feed: string;
  readonly canal: Canal;
  readonly chave: ChavePublica;
  readonly agora: string;
  readonly contexto: Contexto;
}): Promise<Resultado> {
  const pasta = opcoes.contexto.pasta;
  const soltar = tomarTrava(pasta);
  if (soltar === null) throw new ErroAtualizacao("outro processo está atualizando esta pasta; tente mais tarde");
  try {
    const url = urlManifesto(opcoes.feed, opcoes.canal);
    const manifesto = await conferirManifesto({
      urlManifesto: url,
      canal: opcoes.canal,
      chave: opcoes.chave,
      baixar: opcoes.contexto.baixar,
    });
    gravarEstado(pasta, {
      ...lerEstado(pasta),
      ultimaConferencia: opcoes.agora,
      ...(manifesto.gerado_em === undefined ? {} : { manifestoGeradoEm: manifesto.gerado_em }),
    });
    return await baixarAtualizacao(manifesto, url, opcoes.contexto);
  } finally {
    soltar();
  }
}
