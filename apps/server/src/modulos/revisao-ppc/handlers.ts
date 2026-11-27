/**
 * Os handlers do `GrupoRevisaoPpc`: casca fina sobre a `ListaViva`, a `RevisaoIa` e a `ConversaAoLado` (as
 * escritas que trocam o texto da lista passam por ela, que regrava o PPC na pasta da conversa), com a tradução de erro
 * do transporte (`traducao.ts`), a mesma dos outros grupos. O aviso de uso das ações que mandam o PPC à IA
 * fica nos serviços (M1.8). Entra no servidor pelo `handlers.ts` do núcleo (arquivo de composição).
 */
import * as Effect from "effect/Effect";
import { GrupoRevisaoPpc } from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import { traduzir, traduzirStream } from "../../traducao.ts";
import * as ConversaAoLado from "./ConversaAoLado.ts";
import * as ListaViva from "./ListaViva.ts";
import * as RevisaoIa from "./RevisaoIa.ts";

export const layer = GrupoRevisaoPpc.toLayer(
  Effect.gen(function* () {
    const ia = yield* RevisaoIa.RevisaoIa;
    const viva = yield* ListaViva.ListaViva;
    const aoLado = yield* ConversaAoLado.ConversaAoLado;
    return GrupoRevisaoPpc.of({
      "revisaoPpc.revisar": (entrada) => traduzirStream("revisaoPpc.revisar", viva.revisar(entrada)),
      "revisaoPpc.prepararIa": (entrada) => traduzir("revisaoPpc.prepararIa", ia.preparar(entrada)),
      "revisaoPpc.iniciarIa": ({ revisao }) => traduzir("revisaoPpc.iniciarIa", ia.iniciar(revisao)),
      "revisaoPpc.continuarIaCom": ({ lista, provider }) =>
        traduzir("revisaoPpc.continuarIaCom", ia.continuarCom(lista, provider)),
      "revisaoPpc.pausarIa": ({ revisao }) => traduzir("revisaoPpc.pausarIa", ia.pausar(revisao)),
      "revisaoPpc.acompanharIa": ({ revisao }) => traduzirStream("revisaoPpc.acompanharIa", ia.acompanhar(revisao)),
      "revisaoPpc.listarIa": () => traduzir("revisaoPpc.listarIa", ia.listar),
      "revisaoPpc.apagarIa": ({ revisao }) => traduzir("revisaoPpc.apagarIa", ia.apagar(revisao)),
      "revisaoPpc.lista": ({ lista }) => traduzir("revisaoPpc.lista", viva.lista(lista)),
      "revisaoPpc.listas": () => traduzir("revisaoPpc.listas", viva.todas),
      "revisaoPpc.trocarCurso": ({ lista, cnct, forma }) =>
        traduzir("revisaoPpc.trocarCurso", aoLado.trocarCurso(lista, cnct, forma)),
      "revisaoPpc.apagarLista": ({ lista }) => traduzir("revisaoPpc.apagarLista", aoLado.apagarLista(lista)),
      "revisaoPpc.exportarDiscordancias": () =>
        traduzir("revisaoPpc.exportarDiscordancias", viva.exportarDiscordancias),
      "revisaoPpc.marcar": ({ lista, chave, situacao }) =>
        traduzir("revisaoPpc.marcar", viva.marcar(lista, chave, situacao)),
      "revisaoPpc.estimarAcao": ({ lista, chave, acao, provider }) =>
        traduzir("revisaoPpc.estimarAcao", viva.estimar(lista, chave, acao, provider)),
      "revisaoPpc.contestar": ({ lista, chave, motivo, provider }) =>
        traduzir("revisaoPpc.contestar", viva.contestar(lista, chave, motivo, provider)),
      "revisaoPpc.sugerir": ({ lista, chave, provider }) =>
        traduzir("revisaoPpc.sugerir", viva.sugerir(lista, chave, provider)),
      "revisaoPpc.revisarDeNovo": ({ lista, chave, arquivo, provider }) =>
        traduzir("revisaoPpc.revisarDeNovo", viva.revisarDeNovo(lista, chave, arquivo, provider)),
      "revisaoPpc.revisarArquivoNovo": ({ lista, arquivo }) =>
        traduzir("revisaoPpc.revisarArquivoNovo", aoLado.revisarArquivoNovo(lista, arquivo)),
      "revisaoPpc.gerarCopia": ({ lista }) => traduzir("revisaoPpc.gerarCopia", viva.gerarCopia(lista)),
      "revisaoPpc.documento": ({ lista }) => traduzir("revisaoPpc.documento", viva.documento(lista)),
      "revisaoPpc.acompanhar": ({ lista, arquivo }) =>
        traduzir("revisaoPpc.acompanhar", viva.acompanhar(lista, arquivo)),
      "revisaoPpc.acompanharLista": ({ lista }) =>
        traduzirStream("revisaoPpc.acompanharLista", aoLado.acompanharLista(lista)),
      "revisaoPpc.conferirAcompanhado": ({ lista }) =>
        traduzir("revisaoPpc.conferirAcompanhado", aoLado.conferirAcompanhado(lista)),
      "revisaoPpc.conversarSobre": (entrada) => traduzir("revisaoPpc.conversarSobre", aoLado.conversarSobre(entrada)),
    });
  }),
);
