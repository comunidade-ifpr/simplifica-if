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

/** O que aconteceu com cada item apagado, para a nota depois de apagar. */
export interface Desfecho {
  /** O nome que a pessoa vê (o título da conversa, o arquivo da revisão). */
  readonly titulo: string;
  /** Não saiu do app: o motivo. */
  readonly falhou?: boolean;
  /** O registro da conversa no provider ficou (o app tenta de novo quando abrir): o nome da IA. */
  readonly transcricaoFicou?: string;
  /** A pasta que não foi para a Lixeira. */
  readonly pastaFicou?: string;
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

export function notaDepoisDeApagar(
  desfechos: ReadonlyArray<Desfecho>,
  tipo: "conversa" | "revisão",
): NotaApagar | null {
  const [um, outro] = tipo === "conversa" ? ["conversa", "conversas"] : ["revisão", "revisões"];
  const falharam = desfechos.filter((d) => d.falhou === true);
  const apagados = desfechos.length - falharam.length;
  const transcricoes = desfechos.filter((d) => d.falhou !== true && d.transcricaoFicou !== undefined);
  const pastas = desfechos.flatMap((d) => (d.falhou !== true && d.pastaFicou !== undefined ? [d.pastaFicou] : []));
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
  else if (pastas.length > 1)
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

/** Apagar várias revisões de uma vez; com uma só, os textos dela. */
export function textosApagarRevisoes(
  itens: ReadonlyArray<{ readonly lista: ListaPendencias; readonly lendo: boolean }>,
): TextosApagar {
  if (itens.length === 1) return textosApagarRevisao(itens[0]!.lista, itens[0]!.lendo);
  const n = itens.length;
  const pendencias = itens.reduce((soma, i) => soma + i.lista.pendencias.length, 0);
  const comIa = itens.some((i) => i.lendo || i.lista.resultado.leituraIa !== "nenhuma");
  const lendo = itens.filter((i) => i.lendo).length;
  return {
    titulo: `Apagar ${n} revisões?`,
    saiDoApp: [
      `O texto de ${n} PPCs convertidos e ${plural(pendencias, "pendência", "pendências")}`,
      "O que você marcou e o que escreveu ao discordar",
      ...(comIa ? ["As leituras com IA, com o que elas guardaram dos PPCs"] : []),
    ],
    ficaNoComputador: [{ texto: `Seus ${n} arquivos e as cópias comentadas, nas pastas deles` }],
    aviso:
      lendo === 0
        ? null
        : lendo === 1
          ? "Uma leitura com IA está em andamento. O app a para antes de apagar."
          : `${lendo} leituras com IA estão em andamento. O app as para antes de apagar.`,
    opcaoPasta: null,
    confirmar: `Apagar ${n} revisões`,
  };
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
