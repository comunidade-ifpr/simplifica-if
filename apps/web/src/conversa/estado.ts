/**
 * O estado de uma conversa na interface e como cada item dela o muda. Funções puras: o
 * `ControleConversa` as chama a cada item de `conversa.acompanhar` (`aoVivo`) e a cada ação da pessoa.
 * Um caminho só: a conversa gravada (`conversa.carregar`) e a ao vivo passam pelos mesmos passos
 * (`aplicarItem`). O estado da conversa (`respondendo`, `pronta`, `caiu`…) vem do servidor (`Estado`); a
 * interface só antecipa o `respondendo` ao enviar e mostra a mensagem da pessoa antes de o servidor a
 * gravar (`pendente`), trocando-a pela gravada quando ela chega.
 *
 * Texto: o `TextoParcial` se junta à resposta aberta mais recente (ou abre uma); o `TextoFinal` a
 * fecha com o texto completo, que vale mais que a soma dos parciais (no Claude, os parciais chegam
 * todos no fim; no Codex, cada bloco tem os parciais e depois o final). Sem resposta aberta, o
 * `TextoFinal` vira uma resposta nova. O `FimTurno` fecha o que ficou aberto. O `MudancasPasta` (o que
 * a pessoa mexeu na pasta fora da conversa) vira uma linha logo depois da mensagem dela.
 *
 * Cada item da tela leva o número do turno a que pertence (o do servidor).
 */
import {
  type AlvoWeb,
  type ConversaGravada,
  type Decisao,
  type EstadoConversa as EstadoGravado,
  type EventoConversa,
  type ItemAoVivo,
  type ItemConversa,
  type NotaResposta,
  type Provider,
  type TipoFerramenta,
} from "@simplifica-if/contratos-app";
import { explicarErroDoTurno, type MensagemErro } from "../conexao/erros.ts";
import { ehFerramentaEtapa, type MarcaEtapa, marcaDaEntrada } from "./etapas.ts";

/**
 * Um item da conversa, sem o turno. `chave` é da interface e única na conversa (a chave do React); `id`,
 * nas ferramentas e nas aprovações, é o do provider, que pode se repetir entre turnos.
 */
type ItemSemTurno =
  | {
      readonly tipo: "pessoa";
      readonly chave: string;
      readonly texto: string;
      /** Mostrada ao enviar, antes de o servidor a gravar. */
      readonly pendente?: true;
    }
  | {
      readonly tipo: "pasta";
      readonly chave: string;
      readonly anexados: ReadonlyArray<string>;
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
      /** O tipo que o driver deu à ferramenta (o rótulo sai dele). */
      readonly classe: TipoFerramenta;
      readonly situacao: "andamento" | "concluida" | "falhou";
      readonly resumo?: string;
      /** A página ou a consulta de uma ferramenta web (substitui o resumo bruto da página na tela). */
      readonly web?: AlvoWeb;
      /** A marca da ferramenta `etapa` (o indicador de etapas da tarefa). */
      readonly etapa?: MarcaEtapa;
    }
  | {
      readonly tipo: "aprovacao";
      readonly chave: string;
      readonly id: string;
      readonly ferramenta: string;
      readonly classe: TipoFerramenta;
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

/** Um item da conversa, com o número do turno a que pertence. */
export type Item = ItemSemTurno & { readonly turno: number };

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
  /** O estado da conversa no servidor (`Estado` de `conversa.acompanhar`): `liberada` e `caiu` reabrem por retomada. */
  readonly estadoServidor?: EstadoGravado;
  /** A maior `ordem` de item gravado já vista (para voltar a `conversa.acompanhar` de onde parou). */
  readonly ordem: number;
  /** O número do turno corrente (o do último item visto, ou o da mensagem que a pessoa acabou de enviar). */
  readonly turno: number;
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
  turno: 0,
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
  /** A pessoa enviou: a mensagem aparece já, pendente, e a conversa passa a `respondendo`. */
  | { readonly tipo: "enviada"; readonly texto: string }
  /** O servidor recusou a mensagem: ela sai, e o erro aparece. */
  | { readonly tipo: "naoEnviou"; readonly erro: MensagemErro }
  /** Abrindo uma conversa gravada, pelo id. */
  | { readonly tipo: "abrindo"; readonly sessao: string }
  | { readonly tipo: "carregada"; readonly gravada: ConversaGravada }
  | { readonly tipo: "naoCarregou"; readonly erro: MensagemErro }
  /** Um item de `conversa.acompanhar`. */
  | { readonly tipo: "aoVivo"; readonly item: ItemAoVivo }
  /**
   * A conexão caiu e a interface volta a acompanhar de onde parou: a resposta aberta sai, porque o servidor
   * a manda de novo, inteira, no texto parcial acumulado.
   */
  | { readonly tipo: "retomando" }
  /** O acompanhamento falhou sem ser queda da conexão (a conversa sumiu, erro do servidor). */
  | { readonly tipo: "naoAcompanhou"; readonly erro: MensagemErro }
  | { readonly tipo: "respondendo"; readonly aprovacao: string }
  | { readonly tipo: "respondida"; readonly aprovacao: string; readonly decisao: Decisao }
  | { readonly tipo: "respostaFalhou"; readonly aprovacao: string; readonly erro: MensagemErro }
  | { readonly tipo: "interrompendo" }
  | { readonly tipo: "aviso"; readonly erro: MensagemErro }
  | { readonly tipo: "nova" };

/** Um aviso de erro, com o detalhe técnico quando há. */
const avisoDeErro =
  (erro: MensagemErro) =>
  (chave: string): ItemSemTurno => ({
    tipo: "aviso",
    chave,
    texto: erro.texto,
    gravidade: "erro",
    ...(erro.detalhe === undefined ? {} : { detalhe: erro.detalhe }),
  });

const comItem = (estado: EstadoConversa, item: (chave: string) => ItemSemTurno): EstadoConversa => ({
  ...estado,
  itens: [...estado.itens, { ...item(`i${estado.proximoId}`), turno: estado.turno }],
  proximoId: estado.proximoId + 1,
});

/** Troca o item no `indice`, que fica no turno em que estava. */
const trocar = (estado: EstadoConversa, indice: number, item: ItemSemTurno): EstadoConversa => ({
  ...estado,
  itens: estado.itens.map((atual, i) => (i === indice ? { ...item, turno: atual.turno } : atual)),
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

export function aplicarEvento(estado: EstadoConversa, evento: EventoConversa): EstadoConversa {
  switch (evento._tag) {
    case "MudancasPasta":
      return comItem(estado, (chave) => ({
        tipo: "pasta",
        chave,
        anexados: evento.anexados.map((arquivo) => arquivo.nome),
        novos: evento.novos.map((arquivo) => arquivo.nome),
        mudados: evento.mudados.map((arquivo) => arquivo.nome),
        removidos: evento.removidos,
        semTexto: [...evento.anexados, ...evento.novos, ...evento.mudados]
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
        classe: evento.tipo,
        situacao: "andamento",
        ...(evento.web === undefined ? {} : { web: evento.web }),
        ...(etapa === undefined ? {} : { etapa }),
      }));
    }
    case "FerramentaConcluida": {
      const indice = estado.itens.findLastIndex((item) => item.tipo === "ferramenta" && item.id === evento.id);
      const anterior = estado.itens[indice];
      const iniciada = anterior?.tipo === "ferramenta" ? anterior : undefined;
      const concluida = (chave: string): ItemSemTurno => ({
        tipo: "ferramenta",
        chave,
        id: evento.id,
        nome: evento.nome,
        classe: iniciada?.classe ?? "outra",
        situacao: evento.falhou ? "falhou" : "concluida",
        resumo: evento.resumo,
        ...(iniciada?.web === undefined ? {} : { web: iniciada.web }),
        ...(iniciada?.etapa === undefined ? {} : { etapa: iniciada.etapa }),
      });
      return indice < 0 ? comItem(estado, concluida) : trocar(estado, indice, concluida(estado.itens[indice]!.chave));
    }
    case "PedidoAprovacao":
      return comItem(estado, (chave) => ({
        tipo: "aprovacao",
        chave,
        id: evento.id,
        ferramenta: evento.ferramenta,
        classe: evento.tipo,
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
      const fechado: EstadoConversa = { ...estado, fase: "pronta", itens: fecharTurno(estado.itens) };
      if (evento.motivo === "parado_antes_do_envio")
        return comItem(fechado, (chave) => ({
          tipo: "aviso",
          chave,
          texto: "Parado antes de a IA receber a mensagem. Envie de novo quando quiser.",
          gravidade: "info",
        }));
      return evento.motivo === "interrompido"
        ? comItem(fechado, (chave) => ({ tipo: "aviso", chave, texto: "Resposta interrompida.", gravidade: "info" }))
        : fechado;
    }
  }
}

/** Um item gravado (ou acompanhado ao vivo) aplicado ao estado, como a interface o viu acontecer. */
export function aplicarItem(estado: EstadoConversa, item: ItemConversa): EstadoConversa {
  const comOrdem = {
    ...estado,
    ordem: Math.max(estado.ordem, item.ordem),
    turno: Math.max(estado.turno, item.turno),
  };
  switch (item._tag) {
    case "Mensagem": {
      const { uso: _uso, ...resto } = comOrdem;
      const comecado: EstadoConversa = {
        ...resto,
        fase: estado.fase === "interrompendo" ? "interrompendo" : "respondendo",
        ...(estado.titulo ? {} : { titulo: item.texto }),
      };
      // A mensagem que esta tela enviou já está à vista: a gravada toma o lugar dela.
      const pendente = estado.itens.findLastIndex((visto) => visto.tipo === "pessoa" && visto.pendente === true);
      if (pendente >= 0) {
        const itens = estado.itens.map((visto, i): Item =>
          i === pendente ? { tipo: "pessoa", chave: visto.chave, texto: item.texto, turno: item.turno } : visto,
        );
        return { ...comecado, itens };
      }
      return comItem(comecado, (chave) => ({ tipo: "pessoa", chave, texto: item.texto }));
    }
    case "EventoTurno":
      return aplicarEvento(comOrdem, item.evento);
    case "DecisaoAprovacao":
      return trocarAprovacao(comOrdem, item.aprovacao, item.decisao === "permitir" ? "permitida" : "negada");
  }
}

/** A conversa gravada remontada: os itens na ordem e, se não há turno em andamento, o turno fechado. */
/**
 * O estado que o servidor diz. `respondendo` abre o turno na tela (a mensagem pode ter vindo de outra
 * tela); os de repouso só ficam guardados: o turno se fecha no `FimTurno`, que vem logo depois.
 */
function aplicarEstado(estado: EstadoConversa, servidor: EstadoGravado): EstadoConversa {
  if (servidor !== "respondendo") return { ...estado, estadoServidor: servidor };
  return {
    ...estado,
    estadoServidor: servidor,
    fase: estado.fase === "interrompendo" ? "interrompendo" : "respondendo",
  };
}

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
    case "aoVivo":
      return acao.item._tag === "Estado" ? aplicarEstado(estado, acao.item.estado) : aplicarItem(estado, acao.item);
    case "retomando": {
      // Só a resposta aberta do turno em andamento sai; o servidor a manda de novo, acumulada.
      const aberta = respostaAberta(estado.itens);
      return aberta < 0 ? estado : { ...estado, itens: estado.itens.filter((_, i) => i !== aberta) };
    }
    case "naoAcompanhou": {
      const fechado: EstadoConversa = { ...estado, fase: "pronta", itens: fecharTurno(estado.itens) };
      return comItem(fechado, avisoDeErro(acao.erro));
    }
    case "naoIniciou":
      return { ...estado, fase: "configurando", erroInicio: acao.erro };
    case "enviada": {
      const { uso: _uso, ...resto } = estado;
      return comItem(
        {
          ...resto,
          fase: "respondendo",
          turno: estado.turno + 1,
          ...(estado.titulo ? {} : { titulo: acao.texto }),
        },
        (chave) => ({ tipo: "pessoa", chave, texto: acao.texto, pendente: true }),
      );
    }
    case "naoEnviou": {
      const pendente = estado.itens.findLastIndex((item) => item.tipo === "pessoa" && item.pendente === true);
      if (pendente < 0) return comItem(estado, avisoDeErro(acao.erro));
      const semMensagem: EstadoConversa = {
        ...estado,
        itens: estado.itens.filter((_, i) => i !== pendente),
        turno: estado.turno - 1,
        fase: estado.estadoServidor === "respondendo" ? "respondendo" : "pronta",
      };
      return comItem(semMensagem, avisoDeErro(acao.erro));
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
const ROTULOS_IFPR: Readonly<Record<string, string>> = {
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
};

/** As ferramentas nativas dos providers, pelo tipo que o driver lhes deu. */
const ROTULOS_POR_TIPO: Readonly<Record<Exclude<TipoFerramenta, "mcp-app" | "mcp-outro">, string>> = {
  leitura: "Ler arquivos",
  escrita: "Alterar arquivos",
  comando: "Rodar comando",
  "comando-rede": "Rodar comando com acesso à rede",
  web: "Consultar a internet",
  outra: "Outra ação da IA",
};

const ROTULOS_WEB: Readonly<Record<AlvoWeb["acao"], string>> = {
  ler: "Ler página na internet",
  pesquisar: "Pesquisar na internet",
};

/**
 * O nome de uma ferramenta para a pessoa, pelo tipo que o driver deu: as do MCP pelo título (as do `ifpr`)
 * ou pelo nome legível, sem o servidor; as nativas pelo tipo, as web pela ação. Nunca o nome técnico de
 * uma ferramenta nativa.
 */
export function rotuloFerramenta(ferramenta: {
  readonly nome: string;
  readonly classe: TipoFerramenta;
  readonly web?: AlvoWeb;
}): string {
  if (ferramenta.classe === "mcp-app" || ferramenta.classe === "mcp-outro") {
    const semServidor = ferramenta.nome.replace(/^[\w-]+\./, "");
    const conhecido = ROTULOS_IFPR[semServidor];
    if (conhecido !== undefined) return conhecido;
    const legivel = semServidor.replace(/[_-]+/g, " ").trim();
    return legivel.length === 0 ? ferramenta.nome : `${legivel[0]!.toUpperCase()}${legivel.slice(1)}`;
  }
  if (ferramenta.classe === "web" && ferramenta.web !== undefined) return ROTULOS_WEB[ferramenta.web.acao];
  return ROTULOS_POR_TIPO[ferramenta.classe];
}

/** O nome de uma ação no pedido de permissão; "uma ação no computador" quando o tipo não diz nada à pessoa. */
export function rotuloAprovacao(pedido: { readonly ferramenta: string; readonly classe: TipoFerramenta }): string {
  return pedido.classe === "outra"
    ? "uma ação no computador"
    : rotuloFerramenta({ nome: pedido.ferramenta, classe: pedido.classe });
}

/** A consulta (busca) ou o domínio e o caminho curto, sem a consulta da URL (página), para auditar na conversa. */
export function detalheWeb(web: AlvoWeb): string {
  if (web.acao === "pesquisar") return web.alvo.length <= 120 ? web.alvo : `${web.alvo.slice(0, 119)}…`;
  try {
    const lida = new URL(web.alvo);
    const caminho = lida.pathname === "/" ? "" : lida.pathname;
    const curto = `${lida.hostname}${caminho}`;
    return curto.length <= 100 ? curto : `${curto.slice(0, 99)}…`;
  } catch {
    return web.alvo.length <= 100 ? web.alvo : `${web.alvo.slice(0, 99)}…`;
  }
}
