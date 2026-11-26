/**
 * `@simplifica-if/mcp/tarefas`: o manifesto de uma tarefa do app (`catalogo/tarefas/<id>.yaml`, seção "Manifesto
 * da tarefa" de `docs/plans/tarefas.md`) e a leitura de uma pasta de tarefas.
 *
 * A tarefa é o cartão: título, resumo, a quem serve, quem mantém e a **abertura**, o que acontece ao
 * clicar. A abertura é uma de três: `link` (abre um sistema externo no navegador), `conversa` (abre uma
 * conversa com um pedido inicial, um formulário curto e, se houver, uma skill) ou `modulo` (abre a tela
 * de um módulo do app). A skill (`./skills.ts`) e o módulo (`./modulos.ts`) são citados pelo nome; quem
 * tem as skills à mão (o servidor, o `validar_base.ts`, o build do desktop) confere se existem, com
 * `conferirAbertura`.
 *
 * Quem usa:
 *
 * - o `apps/server` (`CatalogoTarefas`), que serve o catálogo à interface (`tarefas.listar`), lido da
 *   pasta do instalador (`lerPastaTarefas`) ou do catálogo que o canal de atualização trouxe
 *   (`lerTarefasDoCanal`);
 * - a fábrica da atualização (`scripts/fabrica_atualizacao.ts`), que junta os manifestos do commit no
 *   manifesto do canal (`tarefasParaOCanal`);
 * - o `scripts/validar_base.ts`, que recusa um manifesto inválido, com campo desconhecido (`estrito`)
 *   ou que cita skill ou módulo que não existe;
 * - o build do `apps/desktop`, que copia os manifestos para o app.
 *
 * O manifesto só restringe: `abre.conversa.web: false` desliga a busca e a leitura na web da sessão, e a
 * `skill` é a única que a conversa da tarefa leva; nenhum campo abre o que a política de fábrica fecha.
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { APP_MINIMO_PADRAO, atende, Semver, VersaoBase } from "@simplifica-if/atualizacao/manifesto";
import { formatarErro } from "@simplifica-if/kb/esquema/mensagens";
import { parse, YAMLParseError } from "yaml";
import { ehModulo, type Modulo } from "./modulos.ts";
import { marcadoresDoPedido } from "./pedido.ts";
import { PUBLICOS } from "./publicos.ts";

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const NOME_SKILL = /^[a-z0-9][a-z0-9-]{0,63}$/;
const USUARIO_GITHUB = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

const texto = Schema.String.check(Schema.isMinLength(1));
const slug = Schema.String.check(Schema.isPattern(SLUG, { message: "esperava letras minúsculas, dígitos e hífen" }));

/** Só `https`, sem usuário nem senha na URL: o link abre no navegador do sistema. */
const urlHttps = Schema.String.check(
  Schema.makeFilter((valor: string) => {
    if (!URL.canParse(valor)) return "esperava uma URL completa, com https://";
    const url = new URL(valor);
    if (url.protocol !== "https:") return "o link de uma tarefa só pode ser https";
    if (url.username !== "" || url.password !== "") return "a URL não pode trazer usuário nem senha";
    return true;
  }),
);

/** Uma entrada do formulário da tarefa de conversa. */
const Entrada = Schema.Struct({
  id: slug,
  tipo: Schema.Literals(["arquivo", "curso", "texto", "norma"]),
  rotulo: texto,
  aceita: Schema.optionalKey(Schema.Array(Schema.String.check(Schema.isPattern(/^\.[a-z0-9]+$/)))),
  opcional: Schema.optionalKey(Schema.Boolean),
});
export type EntradaDaTarefa = typeof Entrada.Type;

const AberturaLink = Schema.Struct({
  url: urlHttps,
  /** O sistema de destino pede login; o app só avisa (não vê a página nem a credencial). */
  requer_login: Schema.Boolean,
});

const AberturaConversa = Schema.Struct({
  /** A skill que a conversa segue; sem ela, a conversa só leva o pedido. */
  skill: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(NOME_SKILL, { message: "esperava o nome de uma skill" })),
  ),
  /** O pedido inicial, com `{id}` no lugar de cada entrada do formulário. */
  pedido: texto,
  entradas: Schema.optionalKey(Schema.Array(Entrada)),
  /** Só restringe: `false` desliga a busca e a leitura na web da sessão. */
  web: Schema.optionalKey(Schema.Boolean),
}).check(
  Schema.makeFilter((conversa: { readonly pedido: string; readonly entradas?: ReadonlyArray<EntradaDaTarefa> }) => {
    const ids = (conversa.entradas ?? []).map((entrada) => entrada.id);
    const repetido = ids.find((id, indice) => ids.indexOf(id) !== indice);
    if (repetido !== undefined) return `a entrada "${repetido}" aparece mais de uma vez`;
    const semEntrada = marcadoresDoPedido(conversa.pedido).filter((id) => !ids.includes(id));
    if (semEntrada.length > 0) {
      return `o pedido cita ${semEntrada.map((id) => `{${id}}`).join(", ")}, que não está em entradas`;
    }
    return true;
  }),
);

const CHAVES_ABERTURA = ["link", "conversa", "modulo"] as const;

/** `link`, `conversa` ou `modulo`: exatamente uma. */
const Abertura = Schema.Struct({
  link: Schema.optionalKey(AberturaLink),
  conversa: Schema.optionalKey(AberturaConversa),
  /** O nome de um módulo do app (`./modulos.ts`). */
  modulo: Schema.optionalKey(slug),
}).check(
  Schema.makeFilter((abertura: object) => {
    const dadas = CHAVES_ABERTURA.filter((chave) => chave in abertura);
    return (
      dadas.length === 1 || `esperava exatamente uma de link, conversa, modulo (veio ${dadas.join(", ") || "nenhuma"})`
    );
  }),
);

export const SITUACOES = ["experimental", "estavel", "descontinuada"] as const;
export type Situacao = (typeof SITUACOES)[number];

/**
 * O manifesto de uma tarefa. Um campo só entra aqui junto com quem o consome (a tela, a regra ou o
 * script); os que o plano deixa para depois (`palavras_chave`, `fundamentos`, `escopo`, `ajuda`,
 * `exemplo`) não existem ainda. A tarefa não tem `versao`: o catálogo viaja inteiro.
 */
export const ManifestoTarefa = Schema.Struct({
  /** Permanente: nunca muda nem se reaproveita. É o nome do arquivo e o que `conversas.tarefa` guarda. */
  id: slug,
  titulo: texto,
  resumo: texto,
  area: slug,
  abre: Abertura,
  /** Quem mantém a tarefa; o contato é o usuário do GitHub. */
  mantenedor: Schema.Struct({
    nome: texto,
    github: Schema.String.check(Schema.isPattern(USUARIO_GITHUB, { message: "esperava um usuário do GitHub, sem @" })),
  }),
  /** `experimental` só aparece no canal beta; `descontinuada` sai do catálogo e continua nomeando as conversas antigas. */
  situacao: Schema.Literals(SITUACOES),
  /** A quem a tarefa serve, no vocabulário de `PUBLICOS`; sem ele, serve a todos. Só ordena e filtra os cartões. */
  publico: Schema.optionalKey(Schema.Array(Schema.Literals(PUBLICOS))),
  /** O que a tarefa não faz, dito à pessoa antes de começar. */
  limites: Schema.optionalKey(texto),
  /** Quem escreveu a tarefa, quando não é o mantenedor. */
  autoria: Schema.optionalKey(texto),
  /** Como `20min` ou `1h`. */
  duracao_estimada: Schema.optionalKey(texto),
  /** A menor versão do app (X.Y.Z) que atende a tarefa; o servidor esconde a tarefa num app mais velho. */
  app_minimo: Schema.optionalKey(Semver),
  /** A menor versão da base (AAAA.MM.DD) que atende a tarefa. */
  base_minima: Schema.optionalKey(VersaoBase),
});
export type ManifestoTarefa = typeof ManifestoTarefa.Type;

/** A abertura do manifesto, já separada pelo tipo. */
export type AberturaTarefa =
  | { readonly tipo: "link"; readonly url: string; readonly requerLogin: boolean }
  | {
      readonly tipo: "conversa";
      readonly skill: string | undefined;
      readonly pedido: string;
      readonly entradas: ReadonlyArray<EntradaDaTarefa>;
      /** `false` quando o manifesto desliga a busca na web. */
      readonly web: boolean;
    }
  | { readonly tipo: "modulo"; readonly modulo: string };

export function aberturaDe(manifesto: ManifestoTarefa): AberturaTarefa {
  const { link, conversa, modulo } = manifesto.abre;
  if (link !== undefined) return { tipo: "link", url: link.url, requerLogin: link.requer_login };
  if (conversa !== undefined) {
    return {
      tipo: "conversa",
      skill: conversa.skill,
      pedido: conversa.pedido,
      entradas: conversa.entradas ?? [],
      web: conversa.web !== false,
    };
  }
  // O schema garante exatamente uma das três.
  return { tipo: "modulo", modulo: modulo! };
}

/** A abertura com o que ela cita conferido: o módulo é um dos deste app. */
export type AberturaConferida =
  | Exclude<AberturaTarefa, { readonly tipo: "modulo" }>
  | { readonly tipo: "modulo"; readonly modulo: Modulo };

/** O que a abertura cita e não existe: a skill fora das skills do app, ou o módulo que o app não tem. */
export interface ReferenciaAusente {
  readonly tipo: "skill" | "modulo";
  readonly nome: string;
}

/**
 * A regra "a skill e o módulo citados existem", uma só para o servidor, o `validar_base.ts` e o build do
 * desktop. `skills`: os nomes das skills do app (um `Set` ou um `Map` pelo nome).
 */
export function conferirAbertura(
  manifesto: ManifestoTarefa,
  skills: { readonly has: (nome: string) => boolean },
):
  | { readonly ausente: ReferenciaAusente; readonly conferida?: never }
  | { readonly ausente?: never; readonly conferida: AberturaConferida } {
  const abertura = aberturaDe(manifesto);
  switch (abertura.tipo) {
    case "link":
      return { conferida: abertura };
    case "conversa":
      return abertura.skill !== undefined && !skills.has(abertura.skill)
        ? { ausente: { tipo: "skill", nome: abertura.skill } }
        : { conferida: abertura };
    case "modulo":
      return ehModulo(abertura.modulo)
        ? { conferida: { tipo: "modulo", modulo: abertura.modulo } }
        : { ausente: { tipo: "modulo", nome: abertura.modulo } };
  }
}

/**
 * A tarefa não pede um app mais velho que a skill que ela cita: se pedisse, o app entre os dois mínimos
 * mostraria o cartão com uma skill que não chega a ele (ou com a versão velha dela, que a tarefa nova não
 * conhece). Quem não declara `app_minimo` vale `APP_MINIMO_PADRAO`. A regra do `validar_base.ts` e da
 * fábrica; `appMinimoDaSkill`: o `simplifica.app_minimo` de cada skill do app, pelo nome. Devolve o
 * problema, ou `undefined`.
 */
export function conferirAppMinimo(
  manifesto: ManifestoTarefa,
  appMinimoDaSkill: (nome: string) => string | undefined,
): string | undefined {
  const abertura = aberturaDe(manifesto);
  if (abertura.tipo !== "conversa" || abertura.skill === undefined) return undefined;
  const daSkill = appMinimoDaSkill(abertura.skill) ?? APP_MINIMO_PADRAO;
  const daTarefa = manifesto.app_minimo ?? APP_MINIMO_PADRAO;
  if (atende(daSkill, daTarefa)) return undefined;
  return (
    `tarefa ${manifesto.id}: app_minimo ${manifesto.app_minimo ?? `ausente (${APP_MINIMO_PADRAO})`} é menor que o ` +
    `${daSkill} da skill ${abertura.skill}; declare app_minimo: ${daSkill} ou maior na tarefa`
  );
}

/** Um manifesto que não entra no catálogo: YAML ilegível, campo inválido, `id` diferente do arquivo. */
export class ErroTarefa extends Schema.TaggedError<ErroTarefa>()("ErroTarefa", {
  /** O nome do arquivo do manifesto. */
  arquivo: Schema.String,
  /** O problema, em português, montado do schema e da posição no arquivo; nunca da mensagem de `cause`. */
  detalhe: Schema.String,
  /** A falha de baixo, quando há: o erro do parser de YAML ou o da leitura do arquivo. */
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    return `tarefa ${this.arquivo}: ${this.detalhe}`;
  }
}

export interface OpcoesLeitura {
  /**
   * Recusa campo que o schema não conhece (o `validar_base.ts`: um nome de campo errado não passa em
   * silêncio). O servidor lê sem isto, para o catálogo de um app mais novo ainda servir a este.
   */
  readonly estrito?: boolean;
}

// Todos os problemas de uma vez: quem corrige o manifesto vê a lista inteira.
const decodificar = Schema.decodeUnknownResult(ManifestoTarefa, { errors: "all" });
const decodificarEstrito = Schema.decodeUnknownResult(ManifestoTarefa, { errors: "all", onExcessProperty: "error" });

const EXTENSAO = ".yaml";

/** Onde o parser parou (" (linha 3, coluna 7)"), quando ele diz; a mensagem dele, em inglês, fica em `cause`. */
function posicaoNoYaml(cause: unknown): string {
  const inicio = cause instanceof YAMLParseError ? cause.linePos?.[0] : undefined;
  return inicio === undefined ? "" : ` (linha ${inicio.line}, coluna ${inicio.col})`;
}

/** O manifesto de um valor já lido (o YAML do arquivo, o objeto do catálogo do canal), ou o erro com cada problema numa linha. */
function decodificarManifesto(
  valor: unknown,
  arquivo: string,
  opcoes: OpcoesLeitura,
): { readonly manifesto: ManifestoTarefa; readonly erro?: never } | { readonly erro: ErroTarefa } {
  const lido = (opcoes.estrito === true ? decodificarEstrito : decodificar)(valor);
  if (lido._tag === "Success") return { manifesto: lido.success };
  return {
    erro: new ErroTarefa({
      arquivo,
      detalhe: `manifesto inválido\n${formatarErro(lido.failure)
        .split("\n")
        .map((linha) => `  ${linha}`)
        .join("\n")}`,
    }),
  };
}

/**
 * Lê o texto de um manifesto (`<id>.yaml`). Falha com cada problema numa linha (`abre.link.url: …`)
 * e quando o `id` difere do nome do arquivo.
 */
export const lerManifestoTarefa = Effect.fn("tarefas.lerManifestoTarefa")(function* (
  textoManifesto: string,
  arquivo: string,
  opcoes: OpcoesLeitura = {},
): Effect.fn.Return<ManifestoTarefa, ErroTarefa> {
  const erro = (detalhe: string) => new ErroTarefa({ arquivo, detalhe });
  const yaml = yield* Effect.try({
    try: () => parse(textoManifesto) as unknown,
    catch: (cause) => new ErroTarefa({ arquivo, detalhe: `não é YAML válido${posicaoNoYaml(cause)}`, cause }),
  });
  const lido = decodificarManifesto(yaml, arquivo, opcoes);
  if (lido.erro !== undefined) return yield* lido.erro;
  const { manifesto } = lido;
  const esperado = `${manifesto.id}${EXTENSAO}`;
  if (arquivo !== esperado) return yield* erro(`id "${manifesto.id}" difere do nome do arquivo (esperava ${esperado})`);
  return manifesto;
});

/** O que uma pasta de tarefas tem: os manifestos válidos e os erros dos inválidos. */
export interface PastaTarefas {
  /** Em ordem alfabética do `id`. */
  readonly tarefas: ReadonlyArray<ManifestoTarefa>;
  readonly invalidas: ReadonlyArray<ErroTarefa>;
}

/**
 * Lê cada `*.yaml` de `pasta`, em ordem alfabética. Um manifesto inválido não derruba os outros: vai
 * para `invalidas`. O `id` é o nome do arquivo, o que o torna único na pasta. Falha só se a pasta não
 * puder ser listada.
 */
export const lerPastaTarefas = Effect.fn("tarefas.lerPastaTarefas")(function* (
  pasta: string,
  opcoes: OpcoesLeitura = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const nomes = (yield* fs.readDirectory(pasta)).filter((nome) => nome.endsWith(EXTENSAO)).sort();
  const tarefas: Array<ManifestoTarefa> = [];
  const invalidas: Array<ErroTarefa> = [];
  for (const nome of nomes) {
    const lida = yield* fs.readFileString(path.join(pasta, nome)).pipe(
      Effect.mapError((cause) => new ErroTarefa({ arquivo: nome, detalhe: "não foi possível ler o arquivo", cause })),
      Effect.flatMap((textoManifesto) => lerManifestoTarefa(textoManifesto, nome, opcoes)),
      Effect.result,
    );
    if (lida._tag === "Failure") invalidas.push(lida.failure);
    else tarefas.push(lida.success);
  }
  return { tarefas, invalidas } satisfies PastaTarefas;
});

/**
 * As tarefas do catálogo que o canal de atualização trouxe (os objetos do manifesto do canal), no mesmo
 * modo tolerante da pasta: campo desconhecido é ignorado, e a tarefa inválida ou de `id` repetido vai
 * para `invalidas` sem derrubar as outras. O dado é baixado: nada aqui vira caminho de arquivo, e o
 * `arquivo` do erro só nomeia a tarefa no log.
 */
export function lerTarefasDoCanal(itens: ReadonlyArray<unknown>): PastaTarefas {
  const tarefas = new Map<string, ManifestoTarefa>();
  const invalidas: Array<ErroTarefa> = [];
  for (const [indice, item] of itens.entries()) {
    const rotulo = `nº ${indice + 1} do catálogo baixado`;
    const lida = decodificarManifesto(item, rotulo, {});
    if (lida.erro !== undefined) invalidas.push(lida.erro);
    else if (tarefas.has(lida.manifesto.id)) {
      invalidas.push(new ErroTarefa({ arquivo: rotulo, detalhe: `id "${lida.manifesto.id}" repetido no catálogo` }));
    } else tarefas.set(lida.manifesto.id, lida.manifesto);
  }
  return {
    tarefas: [...tarefas.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    invalidas,
  };
}

const codificar = Schema.encodeSync(ManifestoTarefa);

/**
 * Os manifestos como vão no manifesto do canal: um objeto JSON por tarefa, em ordem de `id`, só com os
 * campos do schema (o que a fábrica leu em modo estrito).
 */
export const tarefasParaOCanal = (tarefas: ReadonlyArray<ManifestoTarefa>) =>
  [...tarefas].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((tarefa) => codificar(tarefa));
