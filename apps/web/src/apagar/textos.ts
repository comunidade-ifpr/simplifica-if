/**
 * As frases do diálogo de apagar: o que sai do app, o que fica no computador e o que a pessoa pode
 * escolher (`TextosApagar`), e a nota de depois. Aqui ficam as da conversa, a partir dos fatos que o
 * servidor dá (`conversa.previaApagar`); quem apaga outra coisa monta os seus `TextosApagar` do lado dele
 * (a revisão de PPC, em `modulos/revisao-ppc/apagar.ts`) e os passa ao `DialogoApagar`, que só os mostra. Puras, para
 * os testes.
 */
import type { PreviaApagarConversa } from "@simplifica-if/contratos-app";
import { nomeDoArquivo, plural } from "../lib/texto.ts";

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

/** O que aconteceu com cada item apagado, para a nota depois de apagar. */
export interface Desfecho {
  /** O nome que a pessoa vê (o título da conversa, o arquivo da revisão). */
  readonly titulo: string;
  /** Não saiu do app: o motivo. */
  readonly falhou?: boolean;
  /** O registro da conversa no provider ficou (o app tenta de novo quando abrir): o nome da IA. */
  readonly transcricaoFicou?: string;
  /** As pastas que não foram para a Lixeira (a revisão tem uma por conversa ao lado). */
  readonly pastasFicaram?: ReadonlyArray<string>;
}

/**
 * A nota depois de apagar, quando algo não saiu como o diálogo disse: o que não foi apagado, o registro
 * do provider que ficou (o servidor tenta de novo na próxima vez que o app abrir) e a pasta que a Lixeira
 * recusou. Nula quando tudo saiu.
 */
/** A nota depois de apagar: o título diz se tudo, parte ou nada saiu. */
export interface NotaApagar {
  readonly titulo: string;
  readonly texto: string;
}

/** O nome do que se apaga, no singular e no plural (um substantivo feminino: "A conversa saiu"). */
export interface NomeDoItem {
  readonly um: string;
  readonly varios: string;
}

export const CONVERSA: NomeDoItem = { um: "conversa", varios: "conversas" };

export function notaDepoisDeApagar(desfechos: ReadonlyArray<Desfecho>, nome: NomeDoItem): NotaApagar | null {
  const { um, varios: outro } = nome;
  const falharam = desfechos.filter((d) => d.falhou === true);
  const apagados = desfechos.length - falharam.length;
  const transcricoes = desfechos.filter((d) => d.falhou !== true && d.transcricaoFicou !== undefined);
  const pastas = [...new Set(desfechos.flatMap((d) => (d.falhou === true ? [] : (d.pastasFicaram ?? []))))];
  if (falharam.length === 0 && transcricoes.length === 0 && pastas.length === 0) return null;
  const partes: Array<string> = [];
  if (desfechos.length === 1 && falharam.length === 0) partes.push(`A ${um} saiu do app.`);
  else if (apagados > 0)
    partes.push(
      apagados === desfechos.length
        ? `${plural(apagados, `${um} saiu`, `${outro} saíram`)} do app.`
        : `${apagados} de ${plural(desfechos.length, um, outro)} ${apagados === 1 ? "saiu" : "saíram"} do app.`,
    );
  if (falharam.length > 0)
    partes.push(`Não foi possível apagar ${falharam.map((d) => `“${d.titulo}”`).join(", ")}. Tente de novo.`);
  if (transcricoes.length === 1)
    partes.push(
      `O registro que o ${transcricoes[0]!.transcricaoFicou} guarda neste computador não pôde ser apagado agora; o app tenta de novo quando abrir.`,
    );
  else if (transcricoes.length > 1)
    partes.push(
      `O registro de ${transcricoes.length} conversas que a IA guarda neste computador não pôde ser apagado agora; o app tenta de novo quando abrir.`,
    );
  if (pastas.length === 1)
    partes.push(
      `A pasta “${nomeDoArquivo(pastas[0]!)}” não foi para a Lixeira e continua em Documentos/Simplifica IF.`,
    );
  else if (pastas.length > 1 && pastas.length <= 3)
    partes.push(
      `As pastas ${pastas.map((p) => `“${nomeDoArquivo(p)}”`).join(", ")} não foram para a Lixeira e continuam em Documentos/Simplifica IF.`,
    );
  else if (pastas.length > 3)
    partes.push(`${pastas.length} pastas não foram para a Lixeira e continuam em Documentos/Simplifica IF.`);
  return {
    titulo: apagados === 0 ? "Nada foi apagado" : falharam.length > 0 ? "Apagado em parte" : "Apagado",
    texto: partes.join(" "),
  };
}

/** Uma conversa a apagar com a prévia dela. */
export interface ConversaComPrevia {
  readonly previa: PreviaApagarConversa;
  readonly titulo: string;
  readonly ia: string;
}

/** As pastas que podem ir à Lixeira: do app, de nenhuma outra conversa, sem repetir. */
export function pastasParaLixeira(itens: ReadonlyArray<ConversaComPrevia>): ReadonlyArray<string> {
  return [
    ...new Set(
      itens.flatMap((i) => (i.previa.pasta.gerida && !i.previa.pasta.compartilhada ? [i.previa.pasta.caminho] : [])),
    ),
  ];
}

/** Apagar várias conversas de uma vez: as contagens somadas; com uma só, os textos dela. */
export function textosApagarConversas(itens: ReadonlyArray<ConversaComPrevia>, podeLixeira: boolean): TextosApagar {
  if (itens.length === 1) return textosApagarConversa(itens[0]!.previa, itens[0]!, podeLixeira);
  const n = itens.length;
  const mensagens = itens.reduce((soma, i) => soma + i.previa.mensagens, 0);
  // Duas conversas da mesma pasta contam a pasta (e os arquivos dela) uma vez.
  const porPasta = new Map(itens.map((i) => [i.previa.pasta.caminho, i.previa.pasta.arquivos]));
  const pastas = [...porPasta.keys()];
  const arquivos = [...porPasta.values()].reduce((soma, n) => soma + n, 0);
  const relatos = itens.reduce((soma, i) => soma + i.previa.relatos.length, 0);
  const respondendo = itens.filter((i) => i.previa.respondendo).length;
  const lixeira = pastasParaLixeira(itens);
  const arquivosLixeira = lixeira.reduce((soma, pasta) => soma + (porPasta.get(pasta) ?? 0), 0);
  return {
    titulo: `Apagar ${n} conversas?`,
    saiDoApp: [
      mensagens === 0
        ? `${n} conversas, ainda sem mensagens`
        : `${plural(mensagens, "mensagem sua", "mensagens suas")} e as respostas da IA, em ${n} conversas`,
      "As cópias que o app guardava para o Desfazer",
      "O registro das conversas que cada IA guarda neste computador",
    ],
    ficaNoComputador: [
      {
        texto: `${plural(pastas.length, "pasta de tarefa", "pastas de tarefa")}${arquivos > 0 ? `, com ${plural(arquivos, "arquivo", "arquivos")}` : ""}`,
      },
      ...(relatos === 0
        ? []
        : [
            {
              texto: `${plural(relatos, "relato de erro salvo", "relatos de erro salvos")}, com trechos destas conversas`,
            },
          ]),
      { texto: "O que já foi enviado às IAs segue a política de dados da sua conta" },
    ],
    aviso:
      respondendo === 0
        ? null
        : `A IA está respondendo em ${respondendo === 1 ? "uma delas" : `${respondendo} delas`}. O app para as respostas antes de apagar.`,
    opcaoPasta:
      podeLixeira && lixeira.length > 0
        ? `Mandar também ${lixeira.length === 1 ? "a pasta" : `as ${lixeira.length} pastas`} para a Lixeira${arquivosLixeira > 0 ? `, com ${plural(arquivosLixeira, "arquivo", "arquivos")}` : ""}`
        : null,
    confirmar: `Apagar ${n} conversas`,
  };
}
