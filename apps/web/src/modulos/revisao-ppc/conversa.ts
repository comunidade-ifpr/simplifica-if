/**
 * As conversas ao lado da revisão (`docs/plans/multitarefa.md`, "Conversa ao lado", decisão 12): o pedido que
 * a revisão leva ao painel do app. As fichas da revisão, já incluídas e removíveis: o PPC inteiro (o Markdown
 * que o servidor grava na pasta da conversa no envio, só se a ficha ficou) e a pendência em foco (o texto
 * dela e o trecho do PPC, com o texto do critério dela: o que confere e o que conta como atendido); a oferta
 * "Anexar o .docx". A IA é a da revisão (senão, a última usada).
 *
 * Várias conversas por revisão, cada uma com a sua pasta e a sua origem no painel (só dado; o painel junta
 * os pedidos de uma mesma origem):
 * - a de uma pendência, `revisao-ppc:<lista>#<pendência>`: "Conversar sobre esta pendência" (e ⌘J com ela
 *   aberta) retoma a conversa que nasceu dela (a lista a guarda, `conversas`), ou abre o rascunho dela;
 * - uma geral, `revisao-ppc:<lista>~<marca>`: a marca é a conversa (a que a lista guarda) ou, no rascunho
 *   de uma nova, uma marca própria, que não cai na conversa de outra pendência. ⌘J sem pendência aberta
 *   fica na conversa geral que o painel mostra, ou abre o rascunho de uma nova.
 * Os pedidos da revisão têm o grupo `revisao-ppc:<lista>`: a revisão na tela e o PPC dela no Ler vão juntos
 * como um só.
 *
 * `origensDaRevisao` é o que o módulo faz com essas origens (a composição o põe no contexto do app): antes de
 * cada mensagem, `revisaoPpc.conversarSobre` com a conversa do painel (se já há), a pendência da origem (e o
 * tema dela, se ela já saiu da lista) e o que as fichas que ficaram pedem (o PPC, o `.docx` e a pendência
 * cuja ficha ficou, que guia a instrução de leitura); depois do envio, a lista relida se ela ainda não tem a
 * conversa ou o título dela; e o aviso de que a leitura com IA em andamento desta revisão gasta a mesma
 * assinatura, que muda com o `ControleRevisao`. As fichas do PPC e do `.docx` têm chaves sem o id da lista
 * (`FICHA_PPC`, `FICHA_DOCX`): "Qual é o curso?" troca o id e a origem, e a ficha continua pedindo o PPC.
 *
 * O link `ifpr://revisao-ppc/<lista>/…` (o PPC ou um critério no Ler) não é da base: `pedidoDoLinkDaRevisao`
 * o troca pelas fichas da revisão (a composição o liga ao contexto do app).
 *
 * O texto do critério vem de `revisaoPpc.criterio`, lido uma vez por critério (`carregarCriterio`): a ficha
 * da pendência o mostra quando ele já foi lido; senão, o pedido o lê e completa a ficha na caixa quando ele
 * chega, e o envio o completa se ele ainda não chegou.
 */
import type { FichaContexto } from "@simplifica-if/contratos-app";
import type {
  ListaPendencias,
  PendenciaRevisao,
  PendenciaViva,
} from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import type { Api } from "../../conexao/api.ts";
import type { GerenteConversas } from "../../conversa/GerenteConversas.ts";
import { horaDe } from "../../lib/formato.ts";
import { nomeDoArquivo } from "../../lib/texto.ts";
import type {
  ConversaDoPainel,
  ControlePainel,
  FichaRascunho,
  OrigensConversa,
  PedidoConversa,
} from "../../painel/ControlePainel.ts";
import { type ControleRevisao, lendoComIa } from "./ControleRevisao.ts";
import { textoDoCriterio } from "./criterio.ts";
import { descreverCurso, temFichaDeCriterio } from "./lista.ts";

/** O que a conversa da revisão pede ao app. */
export interface ApoioConversa {
  readonly api: Api;
  readonly revisao: ControleRevisao;
  readonly conversas: GerenteConversas;
  /** Onde a ficha da pendência se completa com o texto do critério, quando ele chega. */
  readonly painel: ControlePainel;
}

/** O nome curto do PPC: o curso, ou o nome do arquivo. */
const nomeDoPpc = (lista: ListaPendencias) =>
  lista.resultado.curso.cnct?.denominacao ?? nomeDoArquivo(lista.arquivoOriginal).replace(/\.docx$/i, "");

/** "PPC <nome>", sem repetir o "PPC" que o nome do arquivo já traz. */
const comPpc = (nome: string) => (/^PPC\b/i.test(nome) ? nome : `PPC ${nome}`);

/**
 * O texto dos critérios já lidos, por conexão e por ID, e as leituras em curso. O texto é só da ficha na
 * base (o mesmo em toda revisão), e a base tem algumas centenas de critérios: a memória não cresce além.
 */
const criteriosLidos = new WeakMap<
  Api,
  { readonly textos: Map<string, string>; readonly lendo: Map<string, Promise<string | undefined>> }
>();

const lidosDa = (api: Api) => {
  const lidos = criteriosLidos.get(api) ?? { textos: new Map<string, string>(), lendo: new Map() };
  criteriosLidos.set(api, lidos);
  return lidos;
};

/**
 * O texto do critério `id` (`revisaoPpc.criterio`, pela revisão `lista`), lido uma vez; `undefined` se
 * falhou ou se a pendência não tem critério.
 */
export function carregarCriterio(api: Api, lista: string, id: string): Promise<string | undefined> {
  const lidos = lidosDa(api);
  const guardado = lidos.textos.get(id);
  if (guardado !== undefined) return Promise.resolve(guardado);
  if (!temFichaDeCriterio(id)) return Promise.resolve(undefined);
  const emCurso = lidos.lendo.get(id);
  if (emCurso !== undefined) return emCurso;
  const leitura = api
    .chamar((c) => c["revisaoPpc.criterio"]({ lista, id }))
    .then(
      (ficha) => {
        const texto = textoDoCriterio(ficha);
        lidos.textos.set(id, texto);
        return texto;
      },
      () => undefined,
    )
    .finally(() => lidos.lendo.delete(id));
  lidos.lendo.set(id, leitura);
  return leitura;
}

/**
 * A pendência como vai à IA: o problema, o que falta, o que fazer, o trecho do PPC e o critério (o texto
 * dele, quando lido; senão, o título).
 */
export function textoDaPendencia(p: PendenciaRevisao, criterio?: string): string {
  return [
    p.titulo,
    p.explicacao ?? "",
    p.faltas.length === 0 ? "" : `Falta: ${p.faltas.join("; ")}.`,
    p.oQueFazer === "" ? "" : `O que fazer: ${p.oQueFazer}`,
    p.secao === null ? "" : `Seção do PPC: ${p.secao}`,
    p.trecho === null ? "" : `Trecho do PPC: “${p.trecho}”`,
    criterio === undefined ? `Critério da revisão: ${p.tituloFicha}` : `\n${criterio}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * A chave da ficha do PPC e da oferta do `.docx` na caixa: sem o id da lista, que "Qual é o curso?" troca (a
 * caixa é de uma revisão só, a da origem; a ficha que volta do pedido seguinte toma o lugar da de antes).
 */
export const FICHA_PPC = "revisao-ppc:ppc";
export const FICHA_DOCX = "revisao-ppc:docx";

/** O grupo dos pedidos da revisão `lista` (o começo da chave de toda origem dela). */
export const grupoDaRevisao = (lista: string) => `revisao-ppc:${lista}`;

/** A origem da conversa da pendência `chave` da revisão `lista`. */
export const origemDaPendencia = (lista: string, chave: string) => `${grupoDaRevisao(lista)}#${chave}`;

/** A origem de uma conversa geral da revisão `lista`: `marca` é a conversa, ou a do rascunho de uma nova. */
export const origemGeral = (lista: string, marca: string) => `${grupoDaRevisao(lista)}~${marca}`;

const ORIGEM = /^revisao-ppc:([^#~]+)(?:#(.+)|~(.+))?$/;

/** A revisão de uma origem do módulo e a pendência dela (se é a de uma pendência); `undefined`, se não é. */
export function lerOrigem(chave: string): { readonly lista: string; readonly pendencia?: string } | undefined {
  const m = ORIGEM.exec(chave);
  if (m === null) return undefined;
  return m[2] === undefined ? { lista: m[1]! } : { lista: m[1]!, pendencia: m[2] };
}

/** A conversa do painel é uma das da revisão `lista`: pela origem, ou por ser uma das que a lista guarda. */
export function ehConversaDaRevisao(conversa: ConversaDoPainel, lista: ListaPendencias): boolean {
  if (conversa.apagada === true) return false;
  if (conversa.origem !== undefined && lerOrigem(conversa.origem.chave)?.lista === lista.id) return true;
  return conversa.id !== undefined && lista.conversas.some((c) => c.conversa === conversa.id);
}

/** As conversas ao lado da revisão que ainda existem (a apagada nesta execução sai). */
export const conversasVivas = (lista: ListaPendencias, conversas: Pick<GerenteConversas, "foiApagada">) =>
  lista.conversas.filter((c) => !conversas.foiApagada(c.conversa));

/** Uma marca para o rascunho de uma conversa geral nova, única nesta janela (o rascunho não volta ao reabrir). */
let marcas = 0;
const novaMarca = () => `nova-${Date.now().toString(36)}-${(marcas += 1)}`;

/** A ficha da pendência na caixa: com o critério lido, o texto dele vai à vista e pronto para a mensagem. */
function fichaDaPendencia(viva: PendenciaViva, criterio: string | undefined): FichaRascunho {
  const rotulo = `Pendência: ${viva.pendencia.titulo}`;
  const texto = textoDaPendencia(viva.pendencia, criterio);
  return {
    chave: `pendencia:${viva.chave}`,
    rotulo,
    tipo: "pendencia",
    tirar: "Tirar a pendência do contexto",
    detalhe: texto,
    ...(criterio === undefined ? {} : { ficha: { _tag: "texto", rotulo, texto } }),
  };
}

/**
 * Lê o critério da pendência e, se a caixa do painel ainda é a da revisão com a ficha dela sem o critério,
 * troca a ficha pela completa.
 */
function completarQuandoChegar(apoio: ApoioConversa, lista: string, origem: string, viva: PendenciaViva): void {
  void carregarCriterio(apoio.api, lista, viva.pendencia.ficha).then((criterio) => {
    if (criterio === undefined) return;
    const atual = apoio.painel.obter().conversa;
    const ficha = atual.fichas.find((f) => f.chave === `pendencia:${viva.chave}`);
    if (atual.apagada === true || atual.origem?.chave !== origem || ficha === undefined || ficha.ficha !== undefined)
      return;
    apoio.painel.conversar({ origem: atual.origem, fichas: [fichaDaPendencia(viva, criterio)] }, { mostrar: false });
  });
}

/**
 * O pedido da revisão aberta, com a pendência `chave` em foco (se há): a conversa dela (a que já nasceu
 * dela, ou o rascunho), com as fichas do PPC e da pendência (a conversa que já existe as recebe de novo,
 * como fichas removíveis); sem pendência, a conversa geral que o painel mostra, ou o rascunho de uma nova,
 * com a ficha do PPC.
 */
export function pedidoDaRevisao(apoio: ApoioConversa, chave: string | null): PedidoConversa | undefined {
  const lista = apoio.revisao.obter().lista;
  if (lista === undefined) return undefined;
  const nome = nomeDoPpc(lista);
  const ppc: FichaRascunho = {
    chave: FICHA_PPC,
    rotulo: comPpc(descreverCurso(lista.resultado.curso) ?? nome),
    tipo: "documento",
    tirar: "Tirar o PPC do contexto",
    detalhe:
      "O texto inteiro do PPC, em Markdown, na pasta da conversa, com o pedido de lê-lo inteiro antes de responder (começando pela seção da pendência, se ela vai junto).",
  };
  const arquivoDocx = lista.arquivoAcompanhado ?? lista.arquivoOriginal;
  const docx: FichaRascunho = {
    chave: FICHA_DOCX,
    rotulo: nomeDoArquivo(arquivoDocx),
    tipo: "arquivo",
    tirar: "Tirar o .docx do contexto",
    detalhe: "Uma cópia do .docx, na pasta da conversa.",
    oferta: "Anexar o .docx",
  };
  const viva = chave === null ? undefined : lista.pendencias.find((v) => v.chave === chave);
  const criterio = viva === undefined ? undefined : lidosDa(apoio.api).textos.get(viva.pendencia.ficha);
  const vivas = conversasVivas(lista, apoio.conversas);
  let origem: string;
  let ligada: string | undefined;
  if (viva !== undefined) {
    // A conversa da pendência: a última que nasceu dela, ou o rascunho dela.
    origem = origemDaPendencia(lista.id, viva.chave);
    ligada = vivas.findLast((c) => c.pendencia === viva.chave)?.conversa;
  } else {
    // Sem pendência: a conversa geral que o painel já mostra, se é desta revisão; senão, o rascunho de uma nova.
    const atual = apoio.painel.obter().conversa;
    const daAtual = atual.origem === undefined ? undefined : lerOrigem(atual.origem.chave);
    const geralAtual =
      atual.apagada !== true && daAtual?.lista === lista.id && daAtual.pendencia === undefined
        ? atual.origem?.chave
        : undefined;
    origem = geralAtual ?? origemGeral(lista.id, novaMarca());
    ligada = geralAtual === undefined ? undefined : atual.id;
  }
  // Sem o critério lido, a ficha se completa quando ele chega (ou no envio, em `origensDaRevisao`).
  if (viva !== undefined && criterio === undefined) completarQuandoChegar(apoio, lista.id, origem, viva);
  const pendencia = viva === undefined ? undefined : fichaDaPendencia(viva, criterio);
  return {
    ...(ligada === undefined ? {} : { conversa: ligada }),
    fichas: pendencia === undefined ? [ppc] : [ppc, pendencia],
    ofertas: [docx],
    origem: { chave: origem, ...(lista.provider === null ? {} : { ia: lista.provider }) },
    grupo: grupoDaRevisao(lista.id),
  };
}

/** O rascunho de uma conversa geral nova sobre a revisão aberta ("Nova conversa sobre esta revisão"). */
export function pedidoDeConversaNova(apoio: ApoioConversa): PedidoConversa | undefined {
  const lista = apoio.revisao.obter().lista;
  const pedido = pedidoDaRevisao(apoio, null);
  if (lista === undefined || pedido === undefined) return undefined;
  const { conversa: _conversa, ...resto } = pedido;
  return { ...resto, origem: { ...pedido.origem!, chave: origemGeral(lista.id, novaMarca()) } };
}

/** Uma das conversas da revisão aberta ("Conversas desta revisão"), sem fichas novas. */
export function pedidoDaConversa(
  apoio: ApoioConversa,
  conversa: ListaPendencias["conversas"][number],
): PedidoConversa | undefined {
  const lista = apoio.revisao.obter().lista;
  if (lista === undefined) return undefined;
  return {
    conversa: conversa.conversa,
    origem: {
      chave:
        conversa.pendencia === null
          ? origemGeral(lista.id, conversa.conversa)
          : origemDaPendencia(lista.id, conversa.pendencia),
      ...(lista.provider === null ? {} : { ia: lista.provider }),
    },
    grupo: grupoDaRevisao(lista.id),
  };
}

/** A preparação de cada mensagem da conversa ao lado de uma revisão, e o aviso da caixa. */
export function origensDaRevisao(apoio: ApoioConversa): OrigensConversa {
  return {
    preparar: (origem, { conversa, fichas, ia }) => {
      const daRevisao = lerOrigem(origem.chave);
      if (daRevisao === undefined) return undefined;
      const { lista, pendencia: daOrigem } = daRevisao;
      const ppc = fichas.find((f) => f.chave === FICHA_PPC);
      const docx = fichas.find((f) => f.chave === FICHA_DOCX);
      // A pendência cuja ficha ficou (a última que entrou): a instrução de leitura começa pela seção dela.
      const pendencia = fichas.findLast((f) => f.chave.startsWith("pendencia:"))?.chave.slice("pendencia:".length);
      // O tema da pasta, se a pendência da origem já saiu da lista do servidor (o salvamento lhe deu outro
      // trecho antes do primeiro envio): o critério dela, pela lista aberta, ou o título da ficha dela.
      const daAberta =
        daOrigem === undefined
          ? undefined
          : apoio.revisao.obter().lista?.pendencias.find((v) => v.chave === daOrigem)?.pendencia;
      const tema =
        daAberta === undefined
          ? fichas.find((f) => f.chave === `pendencia:${daOrigem}`)?.rotulo.replace(/^Pendência: /, "")
          : daAberta.tituloFicha || daAberta.titulo;
      return (async () => {
        const r = await apoio.api.chamar((c) =>
          c["revisaoPpc.conversarSobre"]({
            lista,
            ...(conversa === undefined ? {} : { conversa }),
            ...(daOrigem === undefined ? {} : { pendencia: daOrigem }),
            ...(daOrigem === undefined || tema === undefined ? {} : { tema }),
            ...(pendencia === undefined ? {} : { chave: pendencia }),
            provider: ia.provider,
            ...(ia.modelo === undefined ? {} : { modelo: ia.modelo }),
            ...(ia.esforco === undefined ? {} : { esforco: ia.esforco }),
            ppc: ppc !== undefined,
            docx: docx !== undefined,
          }),
        );
        // A pendência cujo critério não chegou antes: o texto dela, com o do critério, da lista desta conversa
        // (a aberta na tela, se é ela; senão, lida agora).
        const semCriterio = fichas.filter((f) => f.ficha === undefined && f.chave.startsWith("pendencia:"));
        const aberta = apoio.revisao.obter().lista;
        const daConversa =
          semCriterio.length === 0
            ? undefined
            : aberta?.id === lista
              ? aberta
              : await apoio.api.chamar((c) => c["revisaoPpc.lista"]({ lista })).catch(() => undefined);
        const completas = new Map<FichaRascunho, FichaContexto>();
        for (const f of semCriterio) {
          const viva = daConversa?.pendencias.find((v) => v.chave === f.chave.slice("pendencia:".length));
          const criterio =
            viva === undefined ? undefined : await carregarCriterio(apoio.api, lista, viva.pendencia.ficha);
          completas.set(f, {
            _tag: "texto",
            rotulo: f.rotulo,
            texto: viva === undefined ? (f.detalhe ?? "") : textoDaPendencia(viva.pendencia, criterio),
          });
        }
        const prontas = fichas.flatMap((f): ReadonlyArray<FichaContexto> => {
          if (f === ppc)
            return r.ppc === null
              ? []
              : [
                  {
                    _tag: "arquivo",
                    rotulo:
                      r.ppc.atualizadoEm === null
                        ? f.rotulo
                        : `${f.rotulo} · atualizado às ${horaDe(r.ppc.atualizadoEm)}`,
                    arquivo: r.ppc.arquivo,
                    texto: r.ppc.instrucao,
                  },
                ];
          if (f === docx) return r.docx === null ? [] : [{ _tag: "arquivo", rotulo: f.rotulo, arquivo: r.docx }];
          const completa = completas.get(f) ?? f.ficha;
          return completa === undefined ? [] : [completa];
        });
        return { conversa: r.conversa, fichas: prontas };
      })();
    },
    // Depois do envio (a primeira mensagem dá o título): sem acompanhar a lista (sem arquivo no Word), a tela a
    // lê de novo se ela ainda não tem a conversa (a nova, ou a continuação com outra IA) ou o título dela,
    // para "Conversar sobre esta pendência" retomar a dela e "Conversas desta revisão" a mostrar pelo título.
    // Fica para depois do envio, e a falha da leitura não é do envio: a conversa já está na lista do servidor.
    depoisDoEnvio: (origem, conversa) => {
      const lista = lerOrigem(origem.chave)?.lista;
      const aberta = apoio.revisao.obter().lista;
      if (lista === undefined || aberta?.id !== lista) return;
      const naLista = aberta.conversas.find((c) => c.conversa === conversa);
      if (naLista !== undefined && naLista.titulo.trim() !== "") return;
      void apoio.api
        .chamar((c) => c["revisaoPpc.lista"]({ lista }))
        .then((atual) => {
          if (apoio.revisao.obter().lista?.id === lista) apoio.revisao.abrirLista(atual);
        })
        .catch(() => undefined);
    },
    aviso: (origem) => {
      const estado = apoio.revisao.obter();
      return estado.lista !== undefined && lerOrigem(origem.chave)?.lista === estado.lista.id && lendoComIa(estado)
        ? "A conferência com IA deste PPC está em andamento: as duas gastam a mesma assinatura."
        : null;
    },
    observar: apoio.revisao.observar,
  };
}

/**
 * O link do PPC em revisão (`ifpr://revisao-ppc/<lista>/…#p-<chave>`) vira o pedido da revisão aberta, com
 * a pendência do fragmento; o de um critério (`…/criterio/<ID>`), o pedido da revisão sem pendência.
 */
export function pedidoDoLinkDaRevisao(apoio: ApoioConversa, link: string): PedidoConversa | undefined {
  const m = /^ifpr:\/\/revisao-ppc\/([^/#]+)\/[^#]*(?:#p-(.+))?$/.exec(link);
  if (m === null) return undefined;
  // O PPC de outra revisão (não a aberta) não tem o que levar: a IA não o lê.
  if (apoio.revisao.obter().lista?.id !== m[1]) return {};
  return pedidoDaRevisao(apoio, m[2] ?? null);
}

/** O link do PPC da revisão `lista` no Ler. */
export const ehLinkDaRevisao = (lista: string) => (link: string) => link.startsWith(`ifpr://revisao-ppc/${lista}/`);
