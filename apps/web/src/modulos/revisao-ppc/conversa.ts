/**
 * A conversa ao lado da revisão (`docs/plans/multitarefa.md`, "Conversa ao lado"): o pedido que a revisão
 * leva ao painel do app. As fichas da revisão, já incluídas e removíveis: o PPC inteiro (o Markdown que o
 * servidor grava na pasta da conversa no envio, só se a ficha ficou) e a pendência em foco (o texto dela e o
 * trecho do PPC); a oferta "Anexar o .docx". A origem é a revisão (`revisao:<lista>`, só dado): uma conversa
 * por revisão (a lista guarda o id, e o painel a retoma) e a IA da revisão (senão, a última usada).
 *
 * `origensDaRevisao` é o que o módulo faz com essa origem (a composição o põe no contexto do app): antes de
 * cada mensagem, `revisaoPpc.conversarSobre` com o que as fichas que ficaram pedem (o PPC, o `.docx` e a
 * pendência cuja ficha ficou, que guia a instrução de leitura), e o aviso de que a leitura com IA em
 * andamento desta revisão gasta a mesma assinatura, que muda com o `ControleRevisao`.
 *
 * O link `ifpr://revisao/<lista>/…` (o PPC no Ler) não é da base: `pedidoDoLinkDaRevisao` o troca pelas
 * fichas da revisão (a composição o liga ao contexto do app).
 */
import type { FichaContexto } from "@simplifica-if/contratos-app";
import type { ListaPendencias, PendenciaRevisao } from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import type { Api } from "../../conexao/api.ts";
import type { GerenteConversas } from "../../conversa/GerenteConversas.ts";
import { horaDe } from "../../lib/formato.ts";
import { nomeDoArquivo } from "../../lib/texto.ts";
import type { FichaRascunho, OrigensConversa, PedidoConversa } from "../../painel/ControlePainel.ts";
import { type ControleRevisao, lendoComIa } from "./ControleRevisao.ts";
import { descreverCurso } from "./lista.ts";

/** O que a conversa da revisão pede ao app. */
export interface ApoioConversa {
  readonly api: Api;
  readonly revisao: ControleRevisao;
  readonly conversas: GerenteConversas;
}

/** O nome curto do PPC: o curso, ou o nome do arquivo. */
const nomeDoPpc = (lista: ListaPendencias) =>
  lista.resultado.curso.cnct?.denominacao ?? nomeDoArquivo(lista.arquivoOriginal).replace(/\.docx$/i, "");

/** "PPC <nome>", sem repetir o "PPC" que o nome do arquivo já traz. */
const comPpc = (nome: string) => (/^PPC\b/i.test(nome) ? nome : `PPC ${nome}`);

/** A pendência como vai à IA: o problema, o que falta, o que fazer e o trecho do PPC. */
export function textoDaPendencia(p: PendenciaRevisao): string {
  return [
    p.titulo,
    p.explicacao ?? "",
    p.faltas.length === 0 ? "" : `Falta: ${p.faltas.join("; ")}.`,
    p.oQueFazer === "" ? "" : `O que fazer: ${p.oQueFazer}`,
    p.secao === null ? "" : `Seção do PPC: ${p.secao}`,
    p.trecho === null ? "" : `Trecho do PPC: “${p.trecho}”`,
    `Critério da revisão: ${p.tituloFicha}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** A origem da conversa ao lado da revisão `lista`. */
const chaveDaOrigem = (lista: string) => `revisao:${lista}`;

/** As fichas da revisão e a origem dela, com a pendência `chave` em foco (se há). */
export function pedidoDaRevisao(apoio: ApoioConversa, chave: string | null): PedidoConversa | undefined {
  const lista = apoio.revisao.obter().lista;
  if (lista === undefined) return undefined;
  const nome = nomeDoPpc(lista);
  const ppc: FichaRascunho = {
    chave: `ppc:${lista.id}`,
    rotulo: comPpc(descreverCurso(lista.resultado.curso) ?? nome),
    tipo: "documento",
    tirar: "Tirar o PPC do contexto",
    detalhe:
      "O texto inteiro do PPC, em Markdown, na pasta da conversa, com o pedido de lê-lo inteiro antes de responder (começando pela seção da pendência, se ela vai junto).",
  };
  const arquivoDocx = lista.arquivoAcompanhado ?? lista.arquivoOriginal;
  const docx: FichaRascunho = {
    chave: `docx:${lista.id}`,
    rotulo: nomeDoArquivo(arquivoDocx),
    tipo: "arquivo",
    tirar: "Tirar o .docx do contexto",
    detalhe: "Uma cópia do .docx, na pasta da conversa.",
    oferta: "Anexar o .docx",
  };
  const viva = chave === null ? undefined : lista.pendencias.find((v) => v.chave === chave);
  const pendencia: FichaRascunho | undefined =
    viva === undefined
      ? undefined
      : {
          chave: `pendencia:${viva.chave}`,
          rotulo: `Pendência: ${viva.pendencia.titulo}`,
          tipo: "pendencia",
          tirar: "Tirar a pendência do contexto",
          detalhe: textoDaPendencia(viva.pendencia),
          ficha: {
            _tag: "texto",
            rotulo: `Pendência: ${viva.pendencia.titulo}`,
            texto: textoDaPendencia(viva.pendencia),
          },
        };
  const ligada = lista.conversaAoLado?.conversa;
  return {
    ...(ligada === undefined || apoio.conversas.foiApagada(ligada) ? {} : { conversa: ligada }),
    fichas: pendencia === undefined ? [ppc] : [ppc, pendencia],
    ofertas: [docx],
    origem: { chave: chaveDaOrigem(lista.id), ...(lista.provider === null ? {} : { ia: lista.provider }) },
  };
}

/** A preparação de cada mensagem da conversa ao lado de uma revisão, e o aviso da caixa. */
export function origensDaRevisao(apoio: ApoioConversa): OrigensConversa {
  return {
    preparar: (origem, { fichas, ia }) => {
      if (!origem.chave.startsWith(chaveDaOrigem(""))) return undefined;
      const lista = origem.chave.slice(chaveDaOrigem("").length);
      const ppc = fichas.find((f) => f.chave === `ppc:${lista}`);
      const docx = fichas.find((f) => f.chave === `docx:${lista}`);
      // A pendência cuja ficha ficou (a última que entrou): a instrução de leitura começa pela seção dela.
      const pendencia = fichas.findLast((f) => f.chave.startsWith("pendencia:"))?.chave.slice("pendencia:".length);
      return (async () => {
        const r = await apoio.api.chamar((c) =>
          c["revisaoPpc.conversarSobre"]({
            lista,
            ...(pendencia === undefined ? {} : { chave: pendencia }),
            provider: ia.provider,
            ...(ia.modelo === undefined ? {} : { modelo: ia.modelo }),
            ...(ia.esforco === undefined ? {} : { esforco: ia.esforco }),
            ppc: ppc !== undefined,
            docx: docx !== undefined,
          }),
        );
        // A lista guarda outra conversa (a nova, ou a continuação com outra IA); sem acompanhar a lista (sem
        // arquivo no Word), a tela a lê de novo, para "Conversar sobre esta pendência" retomar essa.
        if (r.nova && apoio.revisao.obter().lista?.id === lista) {
          const atual = await apoio.api.chamar((c) => c["revisaoPpc.lista"]({ lista }));
          if (apoio.revisao.obter().lista?.id === lista) apoio.revisao.abrirLista(atual);
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
          return f.ficha === undefined ? [] : [f.ficha];
        });
        return { conversa: r.conversa, fichas: prontas };
      })();
    },
    aviso: (origem) => {
      const estado = apoio.revisao.obter();
      return estado.lista !== undefined && origem.chave === chaveDaOrigem(estado.lista.id) && lendoComIa(estado)
        ? "A conferência com IA deste PPC está em andamento: as duas gastam a mesma assinatura."
        : null;
    },
    observar: apoio.revisao.observar,
  };
}

/** O link do PPC em revisão (`ifpr://revisao/<lista>/…#p-<chave>`) vira o pedido da revisão aberta. */
export function pedidoDoLinkDaRevisao(apoio: ApoioConversa, link: string): PedidoConversa | undefined {
  const m = /^ifpr:\/\/revisao\/([^/#]+)\/[^#]*(?:#p-(.+))?$/.exec(link);
  if (m === null) return undefined;
  // O PPC de outra revisão (não a aberta) não tem o que levar: a IA não o lê.
  if (apoio.revisao.obter().lista?.id !== m[1]) return {};
  return pedidoDaRevisao(apoio, m[2] ?? null);
}

/** O link do PPC da revisão `lista` no Ler. */
export const ehLinkDaRevisao = (lista: string) => (link: string) => link.startsWith(`ifpr://revisao/${lista}/`);
