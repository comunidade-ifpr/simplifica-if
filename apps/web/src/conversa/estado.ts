/**
 * O estado de uma conversa na interface e como cada evento do motor o muda. Funções puras: o
 * `ControleConversa` as chama a cada evento do stream de `conversa.enviar` e a cada ação da pessoa.
 *
 * Texto: o `TextoParcial` se junta à resposta aberta mais recente (ou abre uma); o `TextoFinal` a
 * fecha com o texto completo, que vale mais que a soma dos parciais (no Claude, os parciais chegam
 * todos no fim; no Codex, cada bloco tem os parciais e depois o final). Sem resposta aberta, o
 * `TextoFinal` vira uma resposta nova. O `FimTurno` fecha o que ficou aberto. O `MudancasPasta` (o que
 * a pessoa mexeu na pasta fora da conversa) vira uma linha logo depois da mensagem dela.
 *
 * Uma conversa gravada (`conversa.carregar`) se remonta com os mesmos passos (`aplicarItem`): a
 * mensagem da pessoa, os eventos e as decisões de aprovação, na ordem.
 */
import type {
  ConversaGravada,
  Decisao,
  EstadoConversa as EstadoGravado,
  EventoConversa,
  ItemConversa,
  NotaResposta,
  Provider,
} from "@simplifica-if/contratos-app";
import { explicarErroDoTurno, type MensagemErro } from "../conexao/erros.ts";
import { ehFerramentaEtapa, type MarcaEtapa, marcaDaEntrada } from "./etapas.ts";

/**
 * Um item da conversa. `chave` é da interface e única na conversa (a chave do React); `id`, nas
 * ferramentas e nas aprovações, é o do provider, que pode se repetir entre turnos.
 */
export type Item =
  | { readonly tipo: "pessoa"; readonly chave: string; readonly texto: string }
  | {
      readonly tipo: "pasta";
      readonly chave: string;
      readonly novos: ReadonlyArray<string>;
      readonly mudados: ReadonlyArray<string>;
      readonly removidos: ReadonlyArray<string>;
      /** Os documentos novos ou mudados que ficaram sem versão em texto (a IA recebeu o motivo). */
      readonly semTexto: ReadonlyArray<string>;
    }
  | { readonly tipo: "resposta"; readonly chave: string; readonly texto: string; readonly final: boolean }
  | {
      readonly tipo: "ferramenta";
      readonly chave: string;
      readonly id: string;
      readonly nome: string;
      readonly situacao: "andamento" | "concluida" | "falhou";
      readonly resumo?: string;
      /** A marca da ferramenta `etapa` (o indicador de etapas da tarefa). */
      readonly etapa?: MarcaEtapa;
    }
  | {
      readonly tipo: "aprovacao";
      readonly chave: string;
      readonly id: string;
      readonly ferramenta: string;
      readonly descricao: string;
      /** `enviando`: a resposta saiu e o servidor ainda não confirmou; `expirada`: o turno acabou antes. */
      readonly situacao: "pendente" | "enviando" | "permitida" | "negada" | "expirada";
    }
  | {
      readonly tipo: "aviso";
      readonly chave: string;
      readonly texto: string;
      readonly gravidade: "erro" | "info";
      /** O texto técnico original de um erro, mostrado recolhido. */
      readonly detalhe?: string;
    };

export type FaseConversa =
  /** Sem sessão: a pessoa escolhe o provider e a pasta. */
  | "configurando"
  | "iniciando"
  /** Carregando uma conversa gravada (`conversa.carregar`). */
  | "carregando"
  /** Sessão aberta, sem turno em andamento. */
  | "pronta"
  | "respondendo"
  | "interrompendo";

export interface UsoTokens {
  readonly entrada: number;
  readonly saida: number;
  readonly custoUsd?: number;
}

export interface EstadoConversa {
  readonly fase: FaseConversa;
  readonly provider: Provider;
  readonly pastaTrabalho: string;
  /** O id da conversa no servidor. */
  readonly sessao?: string;
  /** O título da conversa gravada (a primeira mensagem). */
  readonly titulo?: string;
  /** O estado da sessão do provider no servidor, quando carregada: `liberada` e `caiu` reabrem por retomada. */
  readonly estadoServidor?: EstadoGravado;
  /** A maior `ordem` de item gravado já vista (para `conversa.acompanhar`). */
  readonly ordem: number;
  readonly itens: ReadonlyArray<Item>;
  /** O erro de iniciar a sessão, mostrado no formulário. */
  readonly erroInicio?: MensagemErro;
  /** O uso de tokens do último turno, quando o provider informa. */
  readonly uso?: UsoTokens;
  /** Contador das chaves dos itens. */
  readonly proximoId: number;
  /** A tarefa da conversa (o nome da skill, ou `conversa`), quando ela nasceu de uma. */
  readonly tarefa?: string;
  /** As avaliações (👍/👎) das respostas, por turno. */
  readonly avaliacoes: Readonly<Record<number, NotaResposta>>;
}

export const estadoInicial = (provider: Provider = "claude", pastaTrabalho = ""): EstadoConversa => ({
  fase: "configurando",
  provider,
  pastaTrabalho,
  ordem: 0,
  itens: [],
  proximoId: 1,
  avaliacoes: {},
});

export type Acao =
  | { readonly tipo: "escolher"; readonly provider?: Provider; readonly pastaTrabalho?: string }
  | { readonly tipo: "iniciando" }
  | { readonly tipo: "iniciada"; readonly sessao: string; readonly tarefa?: string }
  /** 👍/👎 na resposta do turno (`null` retira). */
  | { readonly tipo: "avaliada"; readonly turno: number; readonly nota: NotaResposta | null }
  | { readonly tipo: "naoIniciou"; readonly erro: MensagemErro }
  | { readonly tipo: "enviada"; readonly texto: string }
  | { readonly tipo: "evento"; readonly evento: EventoConversa }
  /** Abrindo uma conversa gravada, pelo id. */
  | { readonly tipo: "abrindo"; readonly sessao: string }
  | { readonly tipo: "carregada"; readonly gravada: ConversaGravada }
  | { readonly tipo: "naoCarregou"; readonly erro: MensagemErro }
  /** Um item de `conversa.acompanhar`. */
  | { readonly tipo: "item"; readonly item: ItemConversa }
  /** O stream do turno terminou sem `FimTurno` (a conexão caiu, erro do servidor). */
  | { readonly tipo: "turnoFalhou"; readonly erro: MensagemErro }
  | { readonly tipo: "respondendo"; readonly aprovacao: string }
  | { readonly tipo: "respondida"; readonly aprovacao: string; readonly decisao: Decisao }
  | { readonly tipo: "respostaFalhou"; readonly aprovacao: string; readonly erro: MensagemErro }
  | { readonly tipo: "interrompendo" }
  | { readonly tipo: "aviso"; readonly erro: MensagemErro }
  | { readonly tipo: "nova" };

/** Um aviso de erro, com o detalhe técnico quando há. */
const avisoDeErro =
  (erro: MensagemErro) =>
  (chave: string): Item => ({
    tipo: "aviso",
    chave,
    texto: erro.texto,
    gravidade: "erro",
    ...(erro.detalhe === undefined ? {} : { detalhe: erro.detalhe }),
  });

const comItem = (estado: EstadoConversa, item: (chave: string) => Item): EstadoConversa => ({
  ...estado,
  itens: [...estado.itens, item(`i${estado.proximoId}`)],
  proximoId: estado.proximoId + 1,
});

const trocar = (estado: EstadoConversa, indice: number, item: Item): EstadoConversa => ({
  ...estado,
  itens: estado.itens.map((atual, i) => (i === indice ? item : atual)),
});

/** O índice da resposta aberta mais recente, ou -1. */
function respostaAberta(itens: ReadonlyArray<Item>): number {
  for (let i = itens.length - 1; i >= 0; i--) {
    const item = itens[i]!;
    if (item.tipo === "resposta" && !item.final) return i;
  }
  return -1;
}

/** Fecha as respostas abertas e expira as aprovações que ficaram sem resposta. */
function fecharTurno(itens: ReadonlyArray<Item>): ReadonlyArray<Item> {
  return itens.map((item) => {
    if (item.tipo === "resposta" && !item.final) return { ...item, final: true };
    if (item.tipo === "aprovacao" && (item.situacao === "pendente" || item.situacao === "enviando")) {
      return { ...item, situacao: "expirada" };
    }
    if (item.tipo === "ferramenta" && item.situacao === "andamento") return { ...item, situacao: "concluida" };
    return item;
  });
}

/** O motivo de fim de turno que significa interrupção, nos três providers. */
export function foiInterrompido(motivo: string): boolean {
  return /interrupt|cancel|abort/i.test(motivo);
}

export function aplicarEvento(estado: EstadoConversa, evento: EventoConversa): EstadoConversa {
  switch (evento._tag) {
    case "MudancasPasta":
      return comItem(estado, (chave) => ({
        tipo: "pasta",
        chave,
        novos: evento.novos.map((arquivo) => arquivo.nome),
        mudados: evento.mudados.map((arquivo) => arquivo.nome),
        removidos: evento.removidos,
        semTexto: [...evento.novos, ...evento.mudados]
          .filter((arquivo) => arquivo.semTexto !== undefined)
          .map((arquivo) => arquivo.nome),
      }));
    case "TextoParcial": {
      const aberta = respostaAberta(estado.itens);
      if (aberta < 0) {
        return comItem(estado, (chave) => ({ tipo: "resposta", chave, texto: evento.texto, final: false }));
      }
      const item = estado.itens[aberta] as Extract<Item, { tipo: "resposta" }>;
      return trocar(estado, aberta, { ...item, texto: item.texto + evento.texto });
    }
    case "TextoFinal": {
      const aberta = respostaAberta(estado.itens);
      if (aberta < 0) {
        return comItem(estado, (chave) => ({ tipo: "resposta", chave, texto: evento.texto, final: true }));
      }
      const item = estado.itens[aberta] as Extract<Item, { tipo: "resposta" }>;
      return trocar(estado, aberta, { ...item, texto: evento.texto, final: true });
    }
    case "FerramentaIniciada": {
      const etapa = ehFerramentaEtapa(evento.nome) ? marcaDaEntrada(evento.entrada) : undefined;
      return comItem(estado, (chave) => ({
        tipo: "ferramenta",
        chave,
        id: evento.id,
        nome: evento.nome,
        situacao: "andamento",
        ...(etapa === undefined ? {} : { etapa }),
      }));
    }
    case "FerramentaConcluida": {
      const indice = estado.itens.findLastIndex((item) => item.tipo === "ferramenta" && item.id === evento.id);
      const anterior = estado.itens[indice];
      const etapa = anterior?.tipo === "ferramenta" ? anterior.etapa : undefined;
      const concluida = (chave: string): Item => ({
        tipo: "ferramenta",
        chave,
        id: evento.id,
        nome: evento.nome,
        situacao: evento.falhou ? "falhou" : "concluida",
        resumo: evento.resumo,
        ...(etapa === undefined ? {} : { etapa }),
      });
      return indice < 0 ? comItem(estado, concluida) : trocar(estado, indice, concluida(estado.itens[indice]!.chave));
    }
    case "PedidoAprovacao":
      return comItem(estado, (chave) => ({
        tipo: "aprovacao",
        chave,
        id: evento.id,
        ferramenta: evento.ferramenta,
        descricao: evento.descricao,
        situacao: "pendente",
      }));
    case "UsoTokens":
      return {
        ...estado,
        uso: {
          entrada: evento.entrada,
          saida: evento.saida,
          ...(evento.custoUsd === undefined ? {} : { custoUsd: evento.custoUsd }),
        },
      };
    case "Erro":
      return comItem(estado, avisoDeErro(explicarErroDoTurno(estado.provider, evento)));
    case "FimTurno": {
      const fechado: EstadoConversa = {
        ...estado,
        fase: "pronta",
        itens: fecharTurno(estado.itens),
        ...(estado.estadoServidor === "respondendo"
          ? { estadoServidor: evento.motivo === "falha" ? "caiu" : "pronta" }
          : {}),
      };
      return foiInterrompido(evento.motivo)
        ? comItem(fechado, (chave) => ({ tipo: "aviso", chave, texto: "Resposta interrompida.", gravidade: "info" }))
        : fechado;
    }
  }
}

/** Um item gravado (ou acompanhado ao vivo) aplicado ao estado, como a interface o viu acontecer. */
export function aplicarItem(estado: EstadoConversa, item: ItemConversa): EstadoConversa {
  const comOrdem = item.ordem > estado.ordem ? { ...estado, ordem: item.ordem } : estado;
  switch (item._tag) {
    case "Mensagem": {
      const { uso: _uso, ...resto } = comOrdem;
      return comItem({ ...resto, fase: "respondendo" }, (chave) => ({ tipo: "pessoa", chave, texto: item.texto }));
    }
    case "EventoTurno":
      return aplicarEvento(comOrdem, item.evento);
    case "DecisaoAprovacao":
      return trocarAprovacao(comOrdem, item.aprovacao, item.decisao === "permitir" ? "permitida" : "negada");
  }
}

/** A conversa gravada remontada: os itens na ordem e, se não há turno em andamento, o turno fechado. */
export function estadoDaConversa(gravada: ConversaGravada): EstadoConversa {
  const { conversa } = gravada;
  const inicial: EstadoConversa = {
    ...estadoInicial(conversa.provider, conversa.pastaTrabalho),
    fase: "pronta",
    sessao: conversa.id,
    titulo: conversa.titulo,
    estadoServidor: conversa.estado,
    ...(conversa.tarefa === undefined ? {} : { tarefa: conversa.tarefa }),
    avaliacoes: Object.fromEntries(gravada.avaliacoes.map((avaliacao) => [avaliacao.turno, avaliacao.nota])),
  };
  const montado = gravada.itens.reduce(aplicarItem, inicial);
  if (conversa.estado === "respondendo") return { ...montado, fase: "respondendo" };
  return { ...montado, fase: "pronta", itens: fecharTurno(montado.itens) };
}

function trocarAprovacao(
  estado: EstadoConversa,
  id: string,
  situacao: Extract<Item, { tipo: "aprovacao" }>["situacao"],
): EstadoConversa {
  // O pedido mais recente com esse id: o provider pode repetir ids entre turnos.
  const indice = estado.itens.findLastIndex((item) => item.tipo === "aprovacao" && item.id === id);
  const item = estado.itens[indice];
  return item?.tipo === "aprovacao" ? trocar(estado, indice, { ...item, situacao }) : estado;
}

export function reduzir(estado: EstadoConversa, acao: Acao): EstadoConversa {
  switch (acao.tipo) {
    case "escolher":
      return {
        ...estado,
        ...(acao.provider === undefined ? {} : { provider: acao.provider }),
        ...(acao.pastaTrabalho === undefined ? {} : { pastaTrabalho: acao.pastaTrabalho }),
      };
    case "iniciando": {
      const { erroInicio: _erro, ...resto } = estado;
      return { ...resto, fase: "iniciando" };
    }
    case "iniciada":
      return {
        ...estado,
        fase: "pronta",
        sessao: acao.sessao,
        ...(acao.tarefa === undefined ? {} : { tarefa: acao.tarefa }),
      };
    case "avaliada": {
      const { [acao.turno]: _anterior, ...outras } = estado.avaliacoes;
      return { ...estado, avaliacoes: acao.nota === null ? outras : { ...outras, [acao.turno]: acao.nota } };
    }
    case "abrindo":
      return { ...estadoInicial(estado.provider, estado.pastaTrabalho), fase: "carregando", sessao: acao.sessao };
    case "carregada":
      return estadoDaConversa(acao.gravada);
    case "naoCarregou":
      return { ...estadoInicial(estado.provider, estado.pastaTrabalho), erroInicio: acao.erro };
    case "item":
      return aplicarItem(estado, acao.item);
    case "naoIniciou":
      return { ...estado, fase: "configurando", erroInicio: acao.erro };
    case "enviada": {
      const { uso: _uso, ...resto } = estado;
      return comItem(
        {
          ...resto,
          fase: "respondendo",
          ...(estado.titulo ? {} : { titulo: acao.texto }),
          estadoServidor: "respondendo",
        },
        (chave) => ({ tipo: "pessoa", chave, texto: acao.texto }),
      );
    }
    case "evento":
      return aplicarEvento(estado, acao.evento);
    case "turnoFalhou": {
      const fechado: EstadoConversa = { ...estado, fase: "pronta", itens: fecharTurno(estado.itens) };
      return comItem(fechado, avisoDeErro(acao.erro));
    }
    case "respondendo":
      return trocarAprovacao(estado, acao.aprovacao, "enviando");
    case "respondida":
      return trocarAprovacao(estado, acao.aprovacao, acao.decisao === "permitir" ? "permitida" : "negada");
    case "respostaFalhou":
      return comItem(trocarAprovacao(estado, acao.aprovacao, "pendente"), avisoDeErro(acao.erro));
    case "interrompendo":
      return estado.fase === "respondendo" ? { ...estado, fase: "interrompendo" } : estado;
    case "aviso":
      return comItem(estado, avisoDeErro(acao.erro));
    case "nova":
      return estadoInicial(estado.provider, estado.pastaTrabalho);
  }
}

/** Os títulos das ferramentas do MCP `ifpr` (o `titulo` de cada uma em `packages/mcp/src/ferramentas`). */
const ROTULOS_FERRAMENTA: Readonly<Record<string, string>> = {
  adequacao_art71: "Adequação ao art. 71",
  buscar_norma: "Buscar norma",
  buscar_secoes: "Buscar seções de PPC",
  citacoes_da_norma: "PPCs que citam a norma",
  correspondencia: "Correspondência entre normas",
  etapa: "Etapa da tarefa",
  fatos_ppc: "Fatos do PPC × SUAP",
  ficha_curso: "Ficha do curso",
  ficha_norma: "Ficha da norma",
  impacto_da_norma: "Impacto da norma",
  ler_dispositivos: "Ler dispositivos",
  ler_secao: "Ler seção de PPC",
  listar_cursos: "Listar cursos",
  pacote_contexto: "Contexto da revisão de PPC",
  resolver_citacoes: "Identificar citações",
  sobre_a_base: "Sobre a base",
  // As nativas dos providers que mais aparecem (Claude, Codex, Antigravity).
  Write: "Gravar arquivo",
  Edit: "Alterar arquivo",
  MultiEdit: "Alterar arquivo",
  NotebookEdit: "Alterar arquivo",
  Read: "Ler arquivo",
  Glob: "Procurar arquivos",
  Grep: "Procurar nos arquivos",
  Bash: "Rodar comando",
  apply_patch: "Alterar arquivo",
  write_file: "Gravar arquivo",
  read_file: "Ler arquivo",
  run_command: "Rodar comando",
  shell: "Rodar comando",
  // Os nomes do Codex e os `kind` do ACP (Antigravity).
  comando: "Rodar comando",
  editar_arquivos: "Alterar arquivos",
  edit: "Alterar arquivo",
  delete: "Apagar arquivo",
  move: "Mover arquivo",
  execute: "Rodar comando",
  read: "Ler arquivo",
  search: "Procurar nos arquivos",
  fetch: "Consultar a internet",
  WebFetch: "Consultar a internet",
  WebSearch: "Consultar a internet",
};

/** Pelo jeito do nome, quando a ferramenta não está na lista (as nativas mudam de nome entre versões). */
const ROTULOS_POR_PADRAO: ReadonlyArray<readonly [RegExp, string]> = [
  [/write|create.?file|save|gravar|escrev/i, "Gravar arquivo"],
  [/edit|patch|replace|alter|change/i, "Alterar arquivo"],
  [/delete|remove|unlink|apagar/i, "Apagar arquivo"],
  [/bash|shell|command|exec|terminal|run/i, "Rodar comando"],
  [/web|fetch|browse|http|url/i, "Consultar a internet"],
  [/read|view|open|cat|ler/i, "Ler arquivo"],
  [/grep|glob|search|find|list/i, "Procurar nos arquivos"],
];

/**
 * O nome de uma ferramenta para a pessoa: as do MCP `ifpr` (`ifpr.buscar_norma`, `mcp__ifpr__…`) e as
 * nativas mais comuns pelo rótulo; as nativas desconhecidas pelo padrão do nome ("Gravar arquivo",
 * "Rodar comando"); o resto, sem o servidor e com espaços no lugar de `_`.
 */

/**
 * O nome de uma ação no pedido de permissão: o rótulo, ou "uma ação no computador" quando o nome não
 * diz nada à pessoa (nunca o nome técnico).
 */
export function rotuloAprovacao(nome: string): string {
  const semServidor = nome.replace(/^mcp__[^_]+__/, "").replace(/^[\w-]+\./, "");
  if (ROTULOS_FERRAMENTA[semServidor] !== undefined) return ROTULOS_FERRAMENTA[semServidor]!;
  return ROTULOS_POR_PADRAO.find(([regra]) => regra.test(semServidor))?.[1] ?? "uma ação no computador";
}

export function rotuloFerramenta(nome: string): string {
  const semServidor = nome.replace(/^mcp__[^_]+__/, "").replace(/^[\w-]+\./, "");
  const conhecido = ROTULOS_FERRAMENTA[semServidor];
  if (conhecido !== undefined) return conhecido;
  // As do `ifpr` sem rótulo e as de outros servidores ficam legíveis; as nativas, pelo padrão do nome.
  const nativa = !/^mcp__|^[\w-]+\./.test(nome);
  const padrao = nativa ? ROTULOS_POR_PADRAO.find(([regra]) => regra.test(semServidor))?.[1] : undefined;
  if (padrao !== undefined) return padrao;
  const legivel = semServidor.replace(/[_-]+/g, " ").trim();
  return legivel.length === 0 ? nome : `${legivel[0]!.toUpperCase()}${legivel.slice(1)}`;
}
