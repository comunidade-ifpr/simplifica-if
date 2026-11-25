// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- fábrica: grava os pacotes e o manifesto numa pasta de saída, sem runtime Effect
/**
 * A fábrica do canal: a partir de um `kb.sqlite` publicável (e das versões anteriores, para os
 * patches) e das skills do app, grava numa pasta de saída
 *
 * - `base-<versao>.sqlite.zst`, o pacote inteiro;
 * - `base-<de>-<versao>.patch.zst`, um patch por versão anterior dada;
 * - `skill-<nome>-<versao>.zst`, uma por skill;
 * - `<canal>.json` e `<canal>.json.minisig`, o manifesto assinado.
 *
 * `urlPacotes` dá o `url` de cada pacote no manifesto, relativo ao manifesto (no GitHub Releases,
 * `../base-<versao>/<arquivo>`, porque o manifesto fica no release fixo do canal e os pacotes no
 * release da versão). Sem ela, os pacotes ficam ao lado do manifesto.
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { type InfoBanco, lerInfoBanco } from "./local.ts";
import {
  arquivoManifesto,
  type Canal,
  codificarManifesto,
  decodificarManifesto,
  ehVersaoDev,
  type Manifesto,
  type Novidade,
  SUFIXO_ASSINATURA,
} from "./manifesto.ts";
import { assinar, type ChaveSecreta, verificar } from "./minisign.ts";
import { type ArquivoSkill, empacotarSkill } from "./pacote-skill.ts";
import { comprimir, criarPatch } from "./zstd.ts";

const sha256 = (dados: Uint8Array) => NodeCrypto.createHash("sha256").update(dados).digest("hex");

export interface SkillDaFabrica {
  readonly nome: string;
  readonly versao: string;
  readonly appMinimo: string;
  readonly baseMinima: string;
  readonly arquivos: ReadonlyArray<ArquivoSkill>;
}

/** O `app_minimo` de quando a fábrica não recebe `--app-minimo`. */
export const APP_MINIMO_PADRAO = "0.1.0";

export interface OpcoesCanal {
  readonly saida: string;
  readonly canal: Canal;
  readonly commit: string;
  /** O `kb.sqlite` desta versão; a versão sai do `meta.versao` dele. */
  readonly banco: string;
  /** Bancos de versões anteriores: um patch de cada. */
  readonly anteriores?: ReadonlyArray<string>;
  readonly skills?: ReadonlyArray<SkillDaFabrica>;
  /**
   * A primeira versão do app que pode usar esta base. Obrigatória (diferente de `APP_MINIMO_PADRAO`)
   * quando a base sobe o esquema em relação a uma das `anteriores`: o app antigo recusaria a base nova.
   */
  readonly appMinimo: string;
  readonly novidades?: ReadonlyArray<Novidade>;
  readonly chave: ChaveSecreta;
  readonly urlPacotes?: (arquivo: string) => string;
  /** Nível do zstd (padrão 19; os testes usam menos). */
  readonly nivel?: number;
  readonly agora?: Date;
}

export interface CanalGerado {
  readonly manifesto: Manifesto;
  readonly arquivos: ReadonlyArray<string>;
}

export function gerarCanal(opcoes: OpcoesCanal): CanalGerado {
  const info = lerInfoBanco(opcoes.banco);
  if (info === null) throw new Error(`não foi possível ler o meta de ${opcoes.banco}`);
  const versao = info.versao;
  if (ehVersaoDev(versao)) throw new Error(`a base ${versao} não tem versão: compile com --versao AAAA.MM.DD`);
  const dataReferencia = info.dataReferencia;
  if (dataReferencia === null) throw new Error(`a base ${versao} não tem data_referencia no meta`);
  conferirEsquema(info, opcoes.anteriores ?? [], opcoes.appMinimo);
  NodeFS.mkdirSync(opcoes.saida, { recursive: true });
  const arquivos: string[] = [];
  const gravar = (nome: string, dados: Uint8Array | string) => {
    NodeFS.writeFileSync(NodePath.join(opcoes.saida, nome), dados);
    arquivos.push(nome);
  };
  const url = (arquivo: string) => (opcoes.urlPacotes === undefined ? {} : { url: opcoes.urlPacotes(arquivo) });

  const banco = NodeFS.readFileSync(opcoes.banco);
  const nomeBase = `base-${versao}.sqlite.zst`;
  const pacote = comprimir(banco, opcoes.nivel);
  gravar(nomeBase, pacote);

  const patches = (opcoes.anteriores ?? []).map((caminho) => {
    const de = lerInfoBanco(caminho)?.versao;
    if (de === undefined) throw new Error(`não foi possível ler o meta de ${caminho}`);
    if (ehVersaoDev(de))
      throw new Error(`${caminho} é uma base de desenvolvimento (${de}): não há patch a partir dela`);
    const dados = criarPatch(NodeFS.readFileSync(caminho), banco, opcoes.nivel);
    const arquivo = `base-${de}-${versao}.patch.zst`;
    gravar(arquivo, dados);
    return { de, arquivo, ...url(arquivo), sha256: sha256(dados), bytes: dados.byteLength };
  });

  const skills = (opcoes.skills ?? []).map((skill) => {
    const dados = empacotarSkill({ nome: skill.nome, versao: skill.versao, arquivos: skill.arquivos });
    const arquivo = `skill-${skill.nome}-${skill.versao}.zst`;
    gravar(arquivo, dados);
    return {
      nome: skill.nome,
      versao: skill.versao,
      arquivo,
      ...url(arquivo),
      sha256: sha256(dados),
      bytes: dados.byteLength,
      app_minimo: skill.appMinimo,
      base_minima: skill.baseMinima,
    };
  });

  const manifesto: Manifesto = {
    canal: opcoes.canal,
    versao,
    commit: opcoes.commit,
    gerado_em: (opcoes.agora ?? new Date()).toISOString(),
    base: {
      arquivo: nomeBase,
      ...url(nomeBase),
      sha256: sha256(pacote),
      bytes: pacote.byteLength,
      sha256_banco: sha256(banco),
      data_referencia: dataReferencia,
      patches,
    },
    skills,
    app_minimo: opcoes.appMinimo,
    novidades: opcoes.novidades ?? [],
  };
  const assinado = assinarManifesto(manifesto, opcoes.chave, opcoes.agora ?? new Date());
  for (const [nome, conteudo] of assinado) gravar(nome, conteudo);
  return { manifesto, arquivos };
}

/**
 * A base que muda de esquema só sai com `appMinimo` informado: o app de esquema antigo baixaria a base
 * e a recusaria na conferência (e, sem isso, quem não atualiza o app ficaria sem base nova sem aviso).
 * Com o `app_minimo` no manifesto, o app antigo mostra "atualize o app" (`remoto.ts`).
 */
export function conferirEsquema(nova: InfoBanco, anteriores: ReadonlyArray<string>, appMinimo: string): void {
  if (appMinimo !== APP_MINIMO_PADRAO) return;
  for (const caminho of anteriores) {
    const anterior = lerInfoBanco(caminho);
    if (anterior !== null && anterior.versaoEsquema !== nova.versaoEsquema) {
      throw new Error(
        `a base ${nova.versao} é do esquema ${nova.versaoEsquema ?? "?"}, e a ${anterior.versao} era do ${anterior.versaoEsquema ?? "?"}: informe --app-minimo com a primeira versão do app que lê o esquema ${nova.versaoEsquema ?? "?"} (o app antigo recusaria a base)`,
      );
    }
  }
}

/** O manifesto e a assinatura, prontos para gravar: `[[nome, texto], [nome.minisig, assinatura]]`. */
export function assinarManifesto(
  manifesto: Manifesto,
  chave: ChaveSecreta,
  agora: Date,
): ReadonlyArray<readonly [string, string]> {
  const texto = codificarManifesto(manifesto);
  const nome = arquivoManifesto(manifesto.canal);
  const comentario = `timestamp:${Math.floor(agora.getTime() / 1000)}\tfile:${nome}\tversao:${manifesto.versao}`;
  return [
    [nome, texto],
    [`${nome}${SUFIXO_ASSINATURA}`, assinar(Buffer.from(texto, "utf8"), chave, comentario)],
  ];
}

/**
 * Promove uma versão de um canal a outro (beta → estável) sem refazer nada: os mesmos pacotes, os
 * mesmos sha256, só o canal e a data do manifesto mudam, e ele é assinado de novo. O manifesto de
 * origem é conferido antes (assinatura e canal). Os pacotes precisam ter `url` (o release imutável da
 * versão): o manifesto novo vai para o release de outro canal.
 */
export function promoverManifesto(opcoes: {
  readonly texto: string;
  readonly assinatura: string;
  readonly de: Canal;
  readonly para: Canal;
  readonly chave: ChaveSecreta;
  readonly agora: Date;
}): { readonly manifesto: Manifesto; readonly arquivos: ReadonlyArray<readonly [string, string]> } {
  verificar(Buffer.from(opcoes.texto, "utf8"), opcoes.assinatura, opcoes.chave);
  const origem = decodificarManifesto(opcoes.texto);
  if (origem.canal !== opcoes.de) throw new Error(`o manifesto é do canal ${origem.canal}, não do ${opcoes.de}`);
  if (opcoes.de === opcoes.para) throw new Error("promover pede dois canais diferentes");
  const semUrl = [origem.base, ...origem.base.patches, ...origem.skills].filter((item) => item.url === undefined);
  if (semUrl.length > 0) {
    throw new Error("os pacotes do manifesto não têm url (gere o canal com --repositorio para promover)");
  }
  const manifesto: Manifesto = { ...origem, canal: opcoes.para, gerado_em: opcoes.agora.toISOString() };
  return { manifesto, arquivos: assinarManifesto(manifesto, opcoes.chave, opcoes.agora) };
}
