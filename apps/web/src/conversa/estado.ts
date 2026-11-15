/**
 * O estado de uma conversa na interface e como cada evento do motor o muda. Funções puras: o
 * `ControleConversa` as chama a cada evento do stream de `conversa.enviar` e a cada ação da pessoa.
 *
 * Texto: o `TextoParcial` se junta à resposta aberta mais recente (ou abre uma); o `TextoFinal` a
 * fecha com o texto completo, que vale mais que a soma dos parciais (no Claude, os parciais chegam
 * todos no fim; no Codex, cada bloco tem os parciais e depois o final). Sem resposta aberta, o
 * `TextoFinal` vira uma resposta nova. O `FimTurno` fecha o que ficou aberto.
 *
 * Uma conversa gravada (`conversa.carregar`) se remonta com os mesmos passos (`aplicarItem`): a
 * mensagem da pessoa, os eventos e as decisões de aprovação, na ordem.
 */
import type {
  ConversaGravada,
  Decisao,
  EstadoConversa as EstadoGravado,
  Evento,
  ItemConversa,
  Provider,
} from "@simplifica-if/contratos-app";
import { explicarErroDoTurno, type MensagemErro } from "../conexao/erros.ts";

/**
 * Um item da conversa. `chave` é da interface e única na conversa (a chave do React); `id`, nas
 * ferramentas e nas aprovações, é o do provider, que pode se repetir entre turnos.
 */
export type Item =
  | { readonly tipo: "pessoa"; readonly chave: string; readonly texto: string }
  | { readonly tipo: "resposta"; readonly chave: string; readonly texto: string; readonly final: boolean }
  | {
      readonly tipo: "ferramenta";
      readonly chave: string;
      readonly id: string;
      readonly nome: string;
      readonly situacao: "andamento" | "concluida" | "falhou";
      readonly resumo?: string;
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
}

export const estadoInicial = (provider: Provider = "claude", pastaTrabalho = ""): EstadoConversa => ({
  fase: "configurando",
  provider,
  pastaTrabalho,
  ordem: 0,
  itens: [],
  proximoId: 1,
});

export type Acao =
  | { readonly tipo: "escolher"; readonly provider?: Provider; readonly pastaTrabalho?: string }
  | { readonly tipo: "iniciando" }
  | { readonly tipo: "iniciada"; readonly sessao: string }
  | { readonly tipo: "naoIniciou"; readonly erro: MensagemErro }
  | { readonly tipo: "enviada"; readonly texto: string }
  | { readonly tipo: "evento"; readonly evento: Evento }
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

export function aplicarEvento(estado: EstadoConversa, evento: Evento): EstadoConversa {
  switch (evento._tag) {
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
    case "FerramentaIniciada":
      return comItem(estado, (chave) => ({
        tipo: "ferramenta",
        chave,
        id: evento.id,
        nome: evento.nome,
        situacao: "andamento",
      }));
    case "FerramentaConcluida": {
      const indice = estado.itens.findLastIndex((item) => item.tipo === "ferramenta" && item.id === evento.id);
      const concluida = (chave: string): Item => ({
        tipo: "ferramenta",
        chave,
        id: evento.id,
        nome: evento.nome,
        situacao: evento.falhou ? "falhou" : "concluida",
        resumo: evento.resumo,
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
      return comItem(estado, avisoDeErro(explicarErroDoTurno(estado.provider, evento.mensagem)));
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
      return { ...estado, fase: "pronta", sessao: acao.sessao };
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
  pacote_contexto: "Contexto da análise de PPC",
  resolver_citacoes: "Identificar citações",
  sobre_a_base: "Sobre a base",
};

/**
 * O nome de uma ferramenta para a pessoa: as do MCP `ifpr` (`ifpr.buscar_norma`, `mcp__ifpr__…`) pelo
 * rótulo; as outras, sem o servidor e com espaços no lugar de `_`.
 */
export function rotuloFerramenta(nome: string): string {
  const semServidor = nome.replace(/^mcp__[^_]+__/, "").replace(/^[\w-]+\./, "");
  const conhecido = ROTULOS_FERRAMENTA[semServidor];
  if (conhecido !== undefined) return conhecido;
  const legivel = semServidor.replace(/[_-]+/g, " ").trim();
  return legivel.length === 0 ? nome : `${legivel[0]!.toUpperCase()}${legivel.slice(1)}`;
}
