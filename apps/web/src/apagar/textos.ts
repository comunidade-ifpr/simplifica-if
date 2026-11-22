/**
 * As frases do diálogo de apagar, a partir dos fatos que o servidor dá (`conversa.previaApagar`) ou que
 * a lista viva já tem: o que sai do app, o que fica no computador e o que a pessoa pode escolher. Puras,
 * para os testes; o `DialogoApagar` só as mostra.
 */
import { DIAS_LISTA, type ListaPendencias, type PreviaApagarConversa } from "@simplifica-if/contratos-app";
import { nomeDoArquivo, plural } from "../revisao/lista.ts";

/** Um item do que fica no computador, com o caminho quando ajuda a achar o arquivo. */
export interface ItemFica {
  readonly texto: string;
  readonly caminho?: string;
}

export interface TextosApagar {
  readonly titulo: string;
  readonly saiDoApp: ReadonlyArray<string>;
  readonly ficaNoComputador: ReadonlyArray<ItemFica>;
  /** Uma condição que muda o que acontece (a IA trabalhando agora); nula sem ela. */
  readonly aviso: string | null;
  /** O rótulo da escolha de mandar a pasta da tarefa à Lixeira; nulo quando ela não se oferece. */
  readonly opcaoPasta: string | null;
  readonly confirmar: string;
}

/**
 * Apagar uma conversa. `podeLixeira`: o desktop sabe mandar a pasta à Lixeira (no navegador, não). A
 * pasta só se oferece se é do app e nenhuma outra conversa a usa.
 */
export function textosApagarConversa(
  previa: PreviaApagarConversa,
  conversa: { readonly titulo: string; readonly ia: string },
  podeLixeira: boolean,
): TextosApagar {
  const pasta = previa.pasta;
  const nomePasta = nomeDoArquivo(pasta.caminho);
  const ficaPasta: ItemFica = {
    texto:
      pasta.arquivos === 0
        ? `A pasta da tarefa “${nomePasta}”`
        : `A pasta da tarefa “${nomePasta}”, com ${plural(pasta.arquivos, "arquivo", "arquivos")}${previa.anexos > 0 ? ` (${plural(previa.anexos, "anexado", "anexados")} por você)` : ""}`,
    caminho: pasta.caminho,
  };
  return {
    titulo: conversa.titulo === "" ? "Apagar esta conversa?" : `Apagar a conversa “${conversa.titulo}”?`,
    saiDoApp: [
      previa.mensagens === 0
        ? "A conversa, ainda sem mensagens"
        : `${plural(previa.mensagens, "mensagem sua", "mensagens suas")} e as respostas da IA`,
      "As cópias que o app guardava para o Desfazer",
      `O registro da conversa que o ${conversa.ia} guarda neste computador`,
    ],
    ficaNoComputador: [
      ficaPasta,
      ...(previa.relatos.length === 0
        ? []
        : [
            {
              texto: `${plural(previa.relatos.length, "relato de erro salvo", "relatos de erro salvos")}, com trechos desta conversa`,
              caminho: previa.relatos[0]!,
            },
          ]),
      { texto: `O que já foi enviado ao ${conversa.ia} segue a política de dados da sua conta` },
    ],
    aviso: previa.respondendo ? "A IA está respondendo. O app para a resposta antes de apagar." : null,
    opcaoPasta:
      podeLixeira && pasta.gerida && !pasta.compartilhada
        ? `Mandar também a pasta “${nomePasta}” para a Lixeira${pasta.arquivos > 0 ? `, com ${plural(pasta.arquivos, "arquivo", "arquivos")}` : ""}`
        : null,
    confirmar: "Apagar a conversa",
  };
}

/**
 * Apagar uma revisão de PPC. `lendo`: a leitura com IA da lista está em andamento (o servidor a para
 * antes de apagar).
 */
export function textosApagarRevisao(lista: ListaPendencias, lendo: boolean): TextosApagar {
  const r = lista.resultado;
  return {
    titulo: `Apagar a revisão de “${nomeDoArquivo(lista.arquivoOriginal)}”?`,
    saiDoApp: [
      `O texto do PPC convertido e ${plural(lista.pendencias.length, "pendência", "pendências")}`,
      "O que você marcou e o que escreveu ao discordar",
      ...(r.leituraIa === "nenhuma" && !lendo ? [] : ["A leitura com IA, com o que ela guardou do PPC"]),
    ],
    ficaNoComputador: [
      { texto: "Seu arquivo", caminho: lista.arquivoOriginal },
      { texto: "A cópia comentada", caminho: r.arquivoComentado },
    ],
    aviso: lendo ? "A leitura com IA está em andamento. O app para a leitura antes de apagar." : null,
    opcaoPasta: null,
    confirmar: "Apagar a revisão",
  };
}

/**
 * A nota depois de apagar a conversa, quando algo ficou para trás; nula quando tudo saiu como o diálogo
 * disse.
 */
export function notaDepoisDeApagar(
  resultado: { readonly transcricao: "apagada" | "ficou" | "nenhuma"; readonly pastaFicou: string | null },
  ia: string,
): string | null {
  const partes = [
    ...(resultado.transcricao === "ficou"
      ? [`O registro que o ${ia} guarda neste computador não pôde ser apagado.`]
      : []),
    ...(resultado.pastaFicou === null
      ? []
      : [
          `A pasta “${nomeDoArquivo(resultado.pastaFicou)}” não foi para a Lixeira e continua em Documentos/Simplifica IF.`,
        ]),
  ];
  return partes.length === 0 ? null : `A conversa saiu do app. ${partes.join(" ")}`;
}

/** Quantos dias faltam para a lista sair sozinha (`DIAS_LISTA` sem uso), em `agora`. */
export function diasParaSair(atualizadaEm: string, agora: number): number {
  const sai = Date.parse(atualizadaEm) + DIAS_LISTA * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((sai - agora) / (24 * 60 * 60 * 1000)));
}

/** "some em 3 dias", "some amanhã", "some hoje": só quando faltam poucos dias. */
export function avisoDeSaida(atualizadaEm: string, agora: number): string | null {
  const dias = diasParaSair(atualizadaEm, agora);
  if (dias > 7) return null;
  if (dias <= 0) return "some hoje";
  if (dias === 1) return "some amanhã";
  return `some em ${dias} dias`;
}
