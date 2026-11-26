/**
 * Textos do Modo Servidor (M1.9), em funções puras: o nome curto de uma citação `ifpr://` (o chip), a
 * duração estimada da tarefa, os nomes das áreas do catálogo, a data da base, o pedido que o
 * formulário da tarefa monta e a linha das mudanças na pasta.
 */
import { type EntradaTarefa, RE_MARCADOR } from "@simplifica-if/contratos-app";
import { inteiro } from "../lib/formato.ts";

/**
 * O valor de `chave` numa tabela de nomes, só se a chave é dela: a chave vem de fora (um link, a área de
 * um manifesto), e `constructor` ou `toString` não podem achar o que o objeto herda de `Object.prototype`.
 */
const daTabela = (tabela: Readonly<Record<string, string>>, chave: string): string | undefined =>
  Object.hasOwn(tabela, chave) ? tabela[chave] : undefined;

/* ================================================================== citações */

const ORGAOS: Readonly<Record<string, string>> = {
  "cne-cp": "CNE/CP",
  "cne-ceb": "CNE/CEB",
  "cne-ces": "CNE/CES",
  consup: "CONSUP",
  consepe: "CONSEPE",
  proens: "PROENS",
  mec: "MEC",
  setec: "SETEC",
};

const TIPOS_NORMA: Readonly<Record<string, string>> = {
  res: "Res.",
  port: "Portaria",
  portaria: "Portaria",
  parecer: "Parecer",
  in: "IN",
  nt: "Nota Técnica",
  decreto: "Decreto",
  lei: "Lei",
};

const ROMANO = /^[ivxlcdm]+$/i;

/** Número de artigo ou parágrafo: ordinal até o 9 ("5º"), cardinal a partir do 10 ("10"). */
const ordinal = (numero: string) => (Number(numero) <= 9 ? `${numero}º` : numero);

/** O dispositivo (`art28-xviii`, `art28-par1-iv`, `art71-parunico`, `anexo1-art5`) por extenso. */
export function dispositivoPorExtenso(fragmento: string): string {
  const partes = fragmento.split("-").map((parte) => {
    let m = /^art(\d+)([a-z]?)$/i.exec(parte);
    if (m) return `art. ${ordinal(m[1]!)}${m[2] ? `-${m[2].toUpperCase()}` : ""}`;
    if (/^parunico$/i.test(parte)) return "parágrafo único";
    m = /^par(\d+)$/i.exec(parte);
    if (m) return `§ ${ordinal(m[1]!)}`;
    m = /^anexo(\d+)$/i.exec(parte);
    if (m) return `Anexo ${romano(Number(m[1]))}`;
    m = /^item(\d+)$/i.exec(parte);
    if (m) return `item ${m[1]}`;
    if (ROMANO.test(parte)) return parte.toUpperCase();
    if (/^[a-z]$/.test(parte)) return `alínea ${parte}`;
    if (/^al$/i.test(parte)) return "";
    return parte;
  });
  return partes.filter((p) => p !== "").join(", ");
}

function romano(n: number): string {
  if (!Number.isInteger(n) || n <= 0 || n >= 400) return String(n);
  const tabela: ReadonlyArray<readonly [number, string]> = [
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let resto = n;
  let saida = "";
  for (const [valor, letra] of tabela) {
    while (resto >= valor) {
      saida += letra;
      resto -= valor;
    }
  }
  return saida;
}

/** O tipo da seção de PPC (o prefixo do ID, `avaliacao-1`) em linguagem comum. */
const SECOES_PPC: Readonly<Record<string, string>> = {
  acessibilidade_inclusao: "de acessibilidade e inclusão",
  acompanhamento_egresso: "de acompanhamento de egressos",
  anexos: "dos anexos",
  aproveitamento_estudos: "de aproveitamento de estudos",
  atendimento_estudante: "de atendimento ao estudante",
  atividades_complementares: "de atividades complementares",
  avaliacao: "de avaliação",
  avaliacao_curso: "de avaliação do curso",
  carga_horaria: "de carga horária",
  certificados_diplomas: "de certificados e diplomas",
  concepcao_pedagogica: "de concepção pedagógica",
  contexto_institucional: "de contexto institucional",
  corpo_docente: "do corpo docente",
  ementas: "das ementas",
  ensino_pesquisa_extensao: "de ensino, pesquisa e extensão",
  estagio_praticas: "de estágio e práticas",
  formato_oferta: "do formato da oferta",
  gestao_curso: "de gestão do curso",
  identificacao: "de identificação",
  infraestrutura: "de infraestrutura",
  itinerario_formativo: "do itinerário formativo",
  justificativa: "da justificativa",
  legislacao: "de legislação",
  matriz_curricular: "da matriz curricular",
  mundo_trabalho: "do mundo do trabalho",
  objetivos: "dos objetivos",
  organizacao_curricular: "da organização curricular",
  perfil_egresso: "do perfil do egresso",
  prazo_integralizacao: "do prazo de integralização",
  referencias: "das referências",
  requisitos_acesso: "dos requisitos de acesso",
  trabalho_conclusao: "do trabalho de conclusão",
};

/** A seção de um link de PPC (`avaliacao-1`) por extenso: "seção de avaliação"; tipo desconhecido, "uma seção". */
export function secaoPorExtenso(fragmento: string): string {
  const tipo = fragmento.replace(/-\d+$/, "");
  const nome = daTabela(SECOES_PPC, tipo);
  return nome === undefined ? "uma seção" : `seção ${nome}`;
}

const milhar = (numero: string) => (/^\d{4,}$/.test(numero) ? inteiro(Number(numero)) : numero);

/** Um slug (`tecnico-em-enfermagem`) legível: "Técnico em enfermagem". */
export function slugLegivel(slug: string): string {
  const texto = slug
    .replace(/[-_]+/g, " ")
    .replace(/\btecnico\b/g, "técnico")
    .trim();
  return texto.length === 0 ? slug : `${texto[0]!.toUpperCase()}${texto.slice(1)}`;
}

/**
 * O nome curto de um link `ifpr://` para o chip: "Res. CNE/CP 2/2026, art. 28, XVIII", "Lei
 * 9.394/1996", "PPC · Técnico em enfermagem (Curitiba)". Um link que não se reconhece fica como
 * "Fonte da base".
 */
export function nomeCurtoLink(link: string): string {
  const m = /^ifpr:\/\/([a-z]+)\/([^#]+)(?:#(.+))?$/i.exec(link);
  if (!m) return "Fonte da base";
  const [, tipo, caminho, fragmento] = m as unknown as [string, string, string, string | undefined];
  const partes = caminho.split("/");
  const comDispositivo = (nome: string) => (fragmento ? `${nome}, ${dispositivoPorExtenso(fragmento)}` : nome);
  switch (tipo.toLowerCase()) {
    case "norma": {
      // br/lei/1996/9394 · br/cne-cp/res/2026/2 · ifpr/consup/res/2024/190
      const tipoDaLei = partes.length === 4 ? daTabela(TIPOS_NORMA, partes[1]!) : undefined;
      if (tipoDaLei !== undefined) return comDispositivo(`${tipoDaLei} ${milhar(partes[3]!)}/${partes[2]}`);
      if (partes.length === 5) {
        const [jurisdicao, orgao, tipoAto, ano, numero] = partes as [string, string, string, string, string];
        const sigla = daTabela(ORGAOS, orgao) ?? orgao.toUpperCase();
        const emissor = jurisdicao === "ifpr" ? `${sigla}/IFPR` : sigla;
        return comDispositivo(
          `${daTabela(TIPOS_NORMA, tipoAto) ?? slugLegivel(tipoAto)} ${emissor} ${milhar(numero)}/${ano}`,
        );
      }
      return comDispositivo("Norma");
    }
    case "curso":
    case "ppc": {
      // PPC: `campus/curso/versao` (a versão, o ano do documento) ou `campus/curso` (o vigente).
      const [campus, curso, versao] = partes;
      const rotulo = tipo.toLowerCase() === "ppc" ? `PPC${versao ? ` ${versao}` : ""} · ` : "";
      const nome = `${rotulo}${slugLegivel(curso ?? "")} (${slugLegivel(campus ?? "")})`;
      return fragmento ? `${nome}, ${secaoPorExtenso(fragmento)}` : nome;
    }
    case "cnct":
      return `CNCT · ${slugLegivel(partes[0] ?? "")}`;
    case "campus":
      return `Campus ${slugLegivel(partes[0] ?? "")}`;
    case "ficha":
      return `Critério ${partes[0]}`;
    case "revisao":
      return "PPC em revisão (texto convertido)";
    default:
      return "Fonte da base";
  }
}

/* ================================================================== catálogo */

const AREAS: Readonly<Record<string, string>> = {
  ensino: "Ensino",
  pesquisa: "Pesquisa",
  extensao: "Extensão",
  gestao: "Gestão",
  "assistencia-estudantil": "Assistência estudantil",
};

export const nomeArea = (area: string): string => daTabela(AREAS, area) ?? slugLegivel(area);

/** "20min" → "cerca de 20 minutos"; "1h" → "cerca de 1 hora"; sem duração, `undefined`. */
export function duracaoPorExtenso(duracao: string | undefined): string | undefined {
  if (duracao === undefined) return undefined;
  const m = /^\s*(\d+)\s*(min|h)\s*$/i.exec(duracao);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (m[2]!.toLowerCase() === "h") return `cerca de ${n} ${n === 1 ? "hora" : "horas"}`;
  return `cerca de ${n} ${n === 1 ? "minuto" : "minutos"}`;
}

/* ================================================================== pedido */

/**
 * O que a pessoa preencheu no formulário, pelo `id` da entrada: o texto, ou o nome do arquivo anexado.
 * Um `Map`, e não um objeto: o `id` vem do manifesto, e uma entrada `constructor` não pode achar o que
 * o objeto herda.
 */
export type Valores = ReadonlyMap<string, string>;

/** A frase da entrada no pedido: "Documento a conferir: parecer.md (está na pasta da tarefa)". */
function linhaEntrada(entrada: EntradaTarefa, valor: string): string {
  return entrada.tipo === "arquivo"
    ? `${entrada.rotulo}: ${valor} (está na pasta da tarefa).`
    : `${entrada.rotulo}: ${valor}.`;
}

/**
 * O pedido montado pelo formulário, que a pessoa pode editar: o `pedido` do manifesto com cada `{id}`
 * trocado pelo que foi preenchido na entrada. A entrada obrigatória por preencher aparece como
 * `[rótulo]`; a linha que só cita entradas opcionais vazias sai. A entrada preenchida que o pedido não
 * cita vai numa linha própria, no fim.
 */
export function montarPedido(
  conversa: { readonly pedido: string; readonly entradas: ReadonlyArray<EntradaTarefa> },
  valores: Valores,
): string {
  const porId = new Map(conversa.entradas.map((entrada) => [entrada.id, entrada]));
  const valorDe = (id: string) => valores.get(id)?.trim() ?? "";
  const citadas = new Set<string>();
  const linhas = conversa.pedido.split("\n").flatMap((linha) => {
    const ids = [...linha.matchAll(RE_MARCADOR)].map((casamento) => casamento[1]!).filter((id) => porId.has(id));
    for (const id of ids) citadas.add(id);
    const vazias = ids.filter((id) => valorDe(id) === "");
    if (ids.length > 0 && vazias.length === ids.length && vazias.every((id) => porId.get(id)?.opcional === true)) {
      return [];
    }
    return [
      linha.replace(RE_MARCADOR, (marcador, id: string) => {
        const entrada = porId.get(id);
        if (entrada === undefined) return marcador;
        const valor = valorDe(id);
        return valor !== "" ? valor : entrada.opcional === true ? "" : `[${entrada.rotulo.toLowerCase()}]`;
      }),
    ];
  });
  const soltas = conversa.entradas.flatMap((entrada) => {
    const valor = valorDe(entrada.id);
    return citadas.has(entrada.id) || valor === "" ? [] : [linhaEntrada(entrada, valor)];
  });
  return [...linhas, ...soltas].join("\n").trim();
}

/** As entradas obrigatórias que faltam, pelo rótulo. */
export function faltando(entradas: ReadonlyArray<EntradaTarefa>, valores: Valores): ReadonlyArray<string> {
  return entradas
    .filter((entrada) => !entrada.opcional && (valores.get(entrada.id)?.trim() ?? "") === "")
    .map((e) => e.rotulo);
}

/** O título da pasta de uma conversa livre: as primeiras palavras do pedido. */
export function tituloDoPedido(texto: string): string {
  const linha = texto.trim().split(/\r?\n/, 1)[0] ?? "";
  const palavras = linha.split(/\s+/).filter(Boolean).slice(0, 8).join(" ");
  return palavras.length === 0 ? "Conversa" : palavras;
}

/* ================================================================== mudanças na pasta */

const nomes = (lista: ReadonlyArray<string>) =>
  lista.length <= 3 ? lista.join(", ") : `${lista.slice(0, 3).join(", ")} e mais ${lista.length - 3}`;

/**
 * A linha da conversa com o que entrou ou mudou na pasta sem a IA saber (`MudancasPasta`), que foi à IA
 * junto com a mensagem: "Anexados: Ata.docx. Na pasta, desde a última resposta: 2 mudados (…)".
 */
export function resumoMudancasPasta(mudancas: {
  readonly anexados: ReadonlyArray<string>;
  readonly novos: ReadonlyArray<string>;
  readonly mudados: ReadonlyArray<string>;
  readonly removidos: ReadonlyArray<string>;
  readonly semTexto: ReadonlyArray<string>;
}): string {
  const umaLinha = (lista: ReadonlyArray<string>) => nomes(lista.map((nome) => nome.replace(/[\r\n]+/g, " ")));
  const partes = [
    [mudancas.novos, "novo", "novos"],
    [mudancas.mudados, "mudado", "mudados"],
    [mudancas.removidos, "removido", "removidos"],
  ] as const;
  const fora = partes
    .filter(([lista]) => lista.length > 0)
    .map(([lista, um, varios]) => `${lista.length} ${lista.length === 1 ? um : varios} (${umaLinha(lista)})`)
    .join("; ");
  const anexados =
    mudancas.anexados.length === 0
      ? []
      : [`${mudancas.anexados.length === 1 ? "Anexado" : "Anexados"}: ${umaLinha(mudancas.anexados)}.`];
  const { semTexto } = mudancas;
  return [
    ...anexados,
    ...(fora === "" ? [] : [`Na pasta, desde a última resposta: ${fora}.`]),
    "A IA foi avisada.",
    ...(semTexto.length === 0
      ? []
      : [
          `Sem versão em texto para a IA: ${umaLinha(semTexto)}; a resposta pode não considerá-${semTexto.length === 1 ? "lo" : "los"}.`,
        ]),
  ].join(" ");
}
