// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- fábrica: grava os pacotes e o manifesto numa pasta de saída, sem runtime Effect
/**
 * A fábrica do canal: a partir de um `kb.sqlite` publicável (e das versões anteriores, para os
 * patches) e das skills do app, grava numa pasta de saída
 *
 * - `base-<versao>.sqlite.zst`, o pacote inteiro;
 * - `base-<de>-<versao>.patch.zst`, um patch por versão anterior dada;
 * - `skill-<nome>-<versao>.zst`, uma por skill;
 * - `<canal>.json` e `<canal>.json.minisig`, o manifesto assinado, com o catálogo de tarefas e a lista de
 *   skills retiradas dentro dele.
 *
 * O catálogo vai dentro do manifesto, e não num pacote à parte, porque é pequeno (um YAML curto por
 * tarefa, contra o limite de 1 MB do manifesto) e assim chega inteiro ou não chega: a assinatura do
 * manifesto o cobre sem um segundo download para conferir, o app o troca de uma vez, e promover o
 * manifesto já o leva, como as novidades.
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
  APP_MINIMO_PADRAO,
  arquivoManifesto,
  type Canal,
  codificarManifesto,
  compararVersoes,
  decodificarManifesto,
  ehVersaoDev,
  instanteDe,
  LIMITE_MANIFESTO,
  type Manifesto,
  maisNova,
  type Novidade,
  SUFIXO_ASSINATURA,
  type TarefaDoCanal,
} from "./manifesto.ts";
import { assinar, type ChavePublica, type ChaveSecreta, verificar } from "./minisign.ts";
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

/** Uma skill como saiu numa publicação: o que a guarda de versão compara. */
export interface SkillPublicada {
  readonly nome: string;
  readonly versao: string;
  /** `hashSkill` dos arquivos publicados. */
  readonly sha256: string;
}

/**
 * Uma versão anterior do canal, com as skills que ela levou: a do manifesto publicado (`canal`, assinado:
 * `publicacaoDoManifesto`) ou um registro de `tmp/fabrica/bases/<versao>.json`, gravado ao gerar, neste
 * computador, que pode nunca ter sido publicado (`registro-local`).
 */
export interface PublicacaoAnterior {
  /** A versão do canal (`AAAA.MM.DD`). */
  readonly versao: string;
  readonly origem: "canal" | "registro-local";
  readonly skills: ReadonlyArray<SkillPublicada>;
}

/** As skills de um manifesto publicado, como a guarda de versão as compara. */
export const publicacaoDoManifesto = (manifesto: Manifesto): PublicacaoAnterior => ({
  versao: manifesto.versao,
  origem: "canal",
  skills: manifesto.skills.map((skill) => ({ nome: skill.nome, versao: skill.versao, sha256: skill.sha256_conteudo })),
});

const descricao = (publicacao: PublicacaoAnterior) =>
  publicacao.origem === "canal"
    ? `a versão ${publicacao.versao} publicada no canal`
    : `a versão ${publicacao.versao} gerada neste computador (tmp/fabrica/bases; pode não ter sido publicada)`;

/** O sha256 do conteúdo de uma skill: os caminhos e os bytes dos arquivos, em ordem de caminho. */
export function hashSkill(arquivos: ReadonlyArray<ArquivoSkill>): string {
  const hash = NodeCrypto.createHash("sha256");
  const ordenados = [...arquivos].sort((a, b) => (a.caminho < b.caminho ? -1 : a.caminho > b.caminho ? 1 : 0));
  for (const arquivo of ordenados) {
    // O tamanho separa o caminho do conteúdo e um arquivo do seguinte.
    hash.update(`${arquivo.caminho}\0${arquivo.conteudo.byteLength}\0`);
    hash.update(arquivo.conteudo);
  }
  return hash.digest("hex");
}

/**
 * A guarda de versão. O app só troca uma skill pela de versão maior: sem subir a versão, a edição nunca
 * chega a quem já tem a skill. Por isso, contra as versões anteriores (a publicada no canal e os registros
 * locais):
 *
 * - a `versao` de uma skill não desce da maior já saída;
 * - com a mesma `versao` de qualquer saída anterior, o conteúdo é o mesmo: basta uma divergente para recusar,
 *   e um registro local mais novo, com o conteúdo editado, não esconde a do canal.
 *
 * No empate de versão, a publicada no canal vem antes do registro local (é a que a mensagem cita).
 *
 * Devolve um problema por skill, com o que fazer.
 */
export function conferirVersoesSkills(
  skills: ReadonlyArray<SkillDaFabrica>,
  anteriores: ReadonlyArray<PublicacaoAnterior>,
): ReadonlyArray<string> {
  // Uma versão que não se compara faria o `sort` e o `reduce` decidirem por acaso, e a guarda passaria:
  // recusa antes, dizendo onde está.
  const comparavel = (versao: string) => !Number.isNaN(compararVersoes(versao, versao));
  const malformadas = [
    ...anteriores.flatMap((publicacao) => [
      ...(comparavel(publicacao.versao)
        ? []
        : [`a versão ${JSON.stringify(publicacao.versao)} de ${descricao(publicacao)} está malformada`]),
      ...publicacao.skills
        .filter((publicada) => !comparavel(publicada.versao))
        .map(
          (publicada) =>
            `skill ${publicada.nome}: a versão ${JSON.stringify(publicada.versao)} de ${descricao(publicacao)} está malformada`,
        ),
    ]),
    ...skills
      .filter((skill) => !comparavel(skill.versao))
      .map((skill) => `skill ${skill.nome}: a versão ${JSON.stringify(skill.versao)} está malformada (esperava X.Y.Z)`),
  ];
  if (malformadas.length > 0) return malformadas;
  const daMaisNova = [...anteriores].sort(
    (a, b) => compararVersoes(b.versao, a.versao) || (a.origem === b.origem ? 0 : a.origem === "canal" ? -1 : 1),
  );
  const problemas: string[] = [];
  for (const skill of skills) {
    const saidas = daMaisNova.flatMap((publicacao) =>
      publicacao.skills
        .filter((publicada) => publicada.nome === skill.nome)
        .map((publicada) => ({ publicacao, publicada })),
    );
    const maior = saidas.reduce<(typeof saidas)[number] | undefined>(
      (atual, saida) =>
        atual === undefined || maisNova(saida.publicada.versao, atual.publicada.versao) ? saida : atual,
      undefined,
    );
    if (maior !== undefined && maisNova(maior.publicada.versao, skill.versao)) {
      problemas.push(
        `skill ${skill.nome}: a versão ${skill.versao} é menor que a ${maior.publicada.versao} de ${descricao(maior.publicacao)}; ` +
          `suba simplifica.versao no SKILL.md para mais que ${maior.publicada.versao} e faça o commit (o app nunca troca uma skill pela de versão menor)`,
      );
      continue;
    }
    const hash = hashSkill(skill.arquivos);
    const mesma = saidas.find((saida) => saida.publicada.versao === skill.versao && saida.publicada.sha256 !== hash);
    if (mesma === undefined) continue;
    problemas.push(
      `skill ${skill.nome}: o conteúdo mudou desde ${descricao(mesma.publicacao)} e a versão continua ${skill.versao}; ` +
        `suba simplifica.versao no SKILL.md da skill e faça o commit (sem isso, a mudança não chega a quem já tem a skill)`,
    );
  }
  return problemas;
}

/**
 * O manifesto publicado do canal, lido de um texto e da assinatura dele: confere a assinatura com a chave
 * da fábrica, o formato e o canal. É a referência da fábrica para as guardas (as retiradas só crescem, a
 * versão das skills não desce, a mesma versão tem o mesmo conteúdo), que assim não dependem do computador
 * de quem publica.
 */
export function lerManifestoPublicado(opcoes: {
  readonly texto: string;
  readonly assinatura: string;
  readonly chave: ChavePublica;
  readonly canal: Canal;
}): Manifesto {
  verificar(Buffer.from(opcoes.texto, "utf8"), opcoes.assinatura, opcoes.chave);
  const manifesto = decodificarManifesto(opcoes.texto);
  if (manifesto.canal !== opcoes.canal) {
    throw new Error(`o manifesto publicado é do canal ${manifesto.canal}, não do ${opcoes.canal}`);
  }
  return manifesto;
}

/**
 * O que a versão nova (ou a promovida) não pode ter contra o manifesto publicado do canal: versão que não
 * é estritamente maior, data do commit anterior à publicada (um rebase, ou o relógio de quem publicou
 * antes) e retirada publicada que saiu da lista. Que o commit novo descende do publicado, quem tem o git
 * confere (`scripts/fabrica_atualizacao.ts`). Devolve os problemas.
 */
export function conferirContraPublicado(
  nova: { readonly versao: string; readonly dataCommit: string; readonly skillsRetiradas: ReadonlyArray<string> },
  publicado: Manifesto,
): ReadonlyArray<string> {
  const problemas: string[] = [];
  if (!maisNova(nova.versao, publicado.versao)) {
    problemas.push(
      `a versão ${nova.versao} não é maior que a ${publicado.versao}, publicada no canal ${publicado.canal} (o app não baixaria nada dela)`,
    );
  }
  const instanteNovo = instanteDe(nova.dataCommit);
  const instantePublicado = instanteDe(publicado.data_commit);
  if (Number.isNaN(instanteNovo) || Number.isNaN(instantePublicado) || instanteNovo < instantePublicado) {
    problemas.push(
      `a data do commit (${nova.dataCommit}) é anterior à do manifesto publicado (${publicado.data_commit}, commit ${publicado.commit}): ` +
        "o app ordena o catálogo de tarefas por ela, e o publicado mais novo perderia para o instalador; publique de um commit mais novo (sem rebase sobre o publicado)",
    );
  }
  const fora = publicado.skills_retiradas.filter((nome) => !nova.skillsRetiradas.includes(nome));
  if (fora.length > 0) {
    problemas.push(
      `skill retirada no canal publicado (versão ${publicado.versao}) saiu da lista de retiradas: ${fora.join(", ")} ` +
        "(o registro é só de acréscimos: um nome retirado não volta)",
    );
  }
  return problemas;
}

/** O `app_minimo` de quando a fábrica não recebe `--app-minimo`. */
export { APP_MINIMO_PADRAO };

export interface OpcoesCanal {
  readonly saida: string;
  readonly canal: Canal;
  readonly commit: string;
  /** A data do commit (ISO 8601 com fuso), que ordena o catálogo de tarefas contra o do instalador. */
  readonly dataCommit: string;
  /** O `kb.sqlite` desta versão; a versão sai do `meta.versao` dele. */
  readonly banco: string;
  /** Bancos de versões anteriores: um patch de cada. */
  readonly anteriores?: ReadonlyArray<string>;
  readonly skills?: ReadonlyArray<SkillDaFabrica>;
  /** Os registros locais das versões anteriores, para a guarda de versão das skills (`conferirVersoesSkills`). */
  readonly publicacoes?: ReadonlyArray<PublicacaoAnterior>;
  /**
   * O manifesto publicado do canal (`lerManifestoPublicado`), a referência das guardas: as retiradas novas
   * contêm as dele, e as skills passam pela guarda de versão contra ele. Sem ele, só na primeira publicação.
   */
  readonly publicado?: Manifesto;
  /** Os nomes das skills retiradas (`nomesRetirados` de `retiradas.ts`). */
  readonly skillsRetiradas?: ReadonlyArray<string>;
  /** O catálogo de tarefas inteiro: cada `catalogo/tarefas/<id>.yaml`, já lido e conferido por quem chama. */
  readonly tarefas?: ReadonlyArray<TarefaDoCanal>;
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
  /** As skills desta publicação, para a guarda de versão da próxima. */
  readonly skillsPublicadas: ReadonlyArray<SkillPublicada>;
}

export function gerarCanal(opcoes: OpcoesCanal): CanalGerado {
  const info = lerInfoBanco(opcoes.banco);
  if (info === null) throw new Error(`não foi possível ler o meta de ${opcoes.banco}`);
  const versao = info.versao;
  if (ehVersaoDev(versao)) throw new Error(`a base ${versao} não tem versão: compile com --versao AAAA.MM.DD`);
  const dataReferencia = info.dataReferencia;
  if (dataReferencia === null) throw new Error(`a base ${versao} não tem data_referencia no meta`);
  conferirEsquema(info, opcoes.anteriores ?? [], opcoes.appMinimo);
  const skillsDaVersao = opcoes.skills ?? [];
  const retiradas = [...new Set(opcoes.skillsRetiradas ?? [])].sort();
  const retiradasPublicadas = skillsDaVersao.filter((skill) => retiradas.includes(skill.nome));
  if (retiradasPublicadas.length > 0) {
    throw new Error(
      `skill retirada não se publica: ${retiradasPublicadas.map((skill) => skill.nome).join(", ")} ` +
        "(tire a pasta da skill do catálogo, ou publique-a com outro nome)",
    );
  }
  if (opcoes.publicado !== undefined) {
    const contra = conferirContraPublicado(
      { versao, dataCommit: opcoes.dataCommit, skillsRetiradas: retiradas },
      opcoes.publicado,
    );
    if (contra.length > 0) throw new Error(contra.join("\n"));
  }
  const anteriores = [
    ...(opcoes.publicacoes ?? []),
    ...(opcoes.publicado === undefined ? [] : [publicacaoDoManifesto(opcoes.publicado)]),
  ];
  const semVersao = conferirVersoesSkills(skillsDaVersao, anteriores);
  if (semVersao.length > 0) throw new Error(semVersao.join("\n"));
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

  const skills = skillsDaVersao.map((skill) => {
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
      sha256_conteudo: hashSkill(skill.arquivos),
      app_minimo: skill.appMinimo,
      base_minima: skill.baseMinima,
    };
  });

  const manifesto: Manifesto = {
    canal: opcoes.canal,
    versao,
    commit: opcoes.commit,
    data_commit: opcoes.dataCommit,
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
    skills_retiradas: retiradas,
    tarefas: opcoes.tarefas ?? [],
    app_minimo: opcoes.appMinimo,
    novidades: opcoes.novidades ?? [],
  };
  const assinado = assinarManifesto(manifesto, opcoes.chave, opcoes.agora ?? new Date());
  for (const [nome, conteudo] of assinado) gravar(nome, conteudo);
  return {
    manifesto,
    arquivos,
    skillsPublicadas: skillsDaVersao.map((skill) => ({
      nome: skill.nome,
      versao: skill.versao,
      sha256: hashSkill(skill.arquivos),
    })),
  };
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
  // A fábrica não assina o que o app recusaria: o texto passa pelo mesmo schema que o app usa, e o
  // manifesto cabe no limite do download (um maior pararia todas as atualizações).
  decodificarManifesto(texto);
  const bytes = Buffer.byteLength(texto, "utf8");
  if (bytes > LIMITE_MANIFESTO) {
    throw new Error(
      `o manifesto tem ${bytes} bytes, acima do limite de ${LIMITE_MANIFESTO} que o app baixa (o catálogo de tarefas cresceu demais)`,
    );
  }
  const nome = arquivoManifesto(manifesto.canal);
  const comentario = `timestamp:${Math.floor(agora.getTime() / 1000)}\tfile:${nome}\tversao:${manifesto.versao}`;
  return [
    [nome, texto],
    [`${nome}${SUFIXO_ASSINATURA}`, assinar(Buffer.from(texto, "utf8"), chave, comentario)],
  ];
}

/**
 * Promove uma versão de um canal a outro (beta → estável) sem refazer nada: os mesmos pacotes, os
 * mesmos sha256, o mesmo catálogo de tarefas e as mesmas skills retiradas; só o canal e a data do
 * manifesto mudam, e ele é assinado de novo. O manifesto de
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
  /**
   * O manifesto publicado do canal de destino (`lerManifestoPublicado`), contra o qual a promoção se
   * confere (`conferirContraPublicado`). Sem ele, só na primeira publicação do destino.
   */
  readonly publicado?: Manifesto;
}): { readonly manifesto: Manifesto; readonly arquivos: ReadonlyArray<readonly [string, string]> } {
  verificar(Buffer.from(opcoes.texto, "utf8"), opcoes.assinatura, opcoes.chave);
  const origem = decodificarManifesto(opcoes.texto);
  if (origem.canal !== opcoes.de) throw new Error(`o manifesto é do canal ${origem.canal}, não do ${opcoes.de}`);
  if (opcoes.de === opcoes.para) throw new Error("promover pede dois canais diferentes");
  if (opcoes.publicado !== undefined) {
    if (opcoes.publicado.canal !== opcoes.para)
      throw new Error(`o manifesto publicado é do canal ${opcoes.publicado.canal}, não do ${opcoes.para}`);
    const contra = conferirContraPublicado(
      { versao: origem.versao, dataCommit: origem.data_commit, skillsRetiradas: origem.skills_retiradas },
      opcoes.publicado,
    );
    if (contra.length > 0) throw new Error(contra.join("\n"));
  }
  const semUrl = [origem.base, ...origem.base.patches, ...origem.skills].filter((item) => item.url === undefined);
  if (semUrl.length > 0) {
    throw new Error("os pacotes do manifesto não têm url (gere o canal com --repositorio para promover)");
  }
  const manifesto: Manifesto = { ...origem, canal: opcoes.para, gerado_em: opcoes.agora.toISOString() };
  return { manifesto, arquivos: assinarManifesto(manifesto, opcoes.chave, opcoes.agora) };
}
