/**
 * Textos do Modo Servidor (M1.9), em funções puras: o nome curto de uma citação `ifpr://` (o chip), a
 * duração estimada da tarefa, os nomes das áreas do catálogo, a data da base, o pedido que o
 * formulário da tarefa monta e a nota dos anexos.
 */
import type { ArquivoAnexado, EntradaTarefa, ResumoSkill } from "@simplifica-if/contratos-app";
import { dataCurta, inteiro } from "../lib/formato.ts";

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
  const nome = SECOES_PPC[tipo];
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
      if (partes.length === 4 && TIPOS_NORMA[partes[1]!] !== undefined) {
        return comDispositivo(`${TIPOS_NORMA[partes[1]!]} ${milhar(partes[3]!)}/${partes[2]}`);
      }
      if (partes.length === 5) {
        const [jurisdicao, orgao, tipoAto, ano, numero] = partes as [string, string, string, string, string];
        const sigla = ORGAOS[orgao] ?? orgao.toUpperCase();
        const emissor = jurisdicao === "ifpr" ? `${sigla}/IFPR` : sigla;
        return comDispositivo(`${TIPOS_NORMA[tipoAto] ?? slugLegivel(tipoAto)} ${emissor} ${milhar(numero)}/${ano}`);
      }
      return comDispositivo("Norma");
    }
    case "curso":
    case "ppc": {
      const [campus, curso] = partes;
      const nome = `${tipo.toLowerCase() === "ppc" ? "PPC · " : ""}${slugLegivel(curso ?? "")} (${slugLegivel(campus ?? "")})`;
      return fragmento ? `${nome}, ${secaoPorExtenso(fragmento)}` : nome;
    }
    case "cnct":
      return `CNCT · ${slugLegivel(partes[0] ?? "")}`;
    case "campus":
      return `Campus ${slugLegivel(partes[0] ?? "")}`;
    case "ficha":
      return `Critério ${partes[0]}`;
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

export const nomeArea = (area: string): string => AREAS[area] ?? slugLegivel(area);

/** "20min" → "cerca de 20 minutos"; "1h" → "cerca de 1 hora"; sem duração, `undefined`. */
export function duracaoPorExtenso(duracao: string | undefined): string | undefined {
  if (duracao === undefined) return undefined;
  const m = /^\s*(\d+)\s*(min|h)\s*$/i.exec(duracao);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (m[2]!.toLowerCase() === "h") return `cerca de ${n} ${n === 1 ? "hora" : "horas"}`;
  return `cerca de ${n} ${n === 1 ? "minuto" : "minutos"}`;
}

/** A data da base (`2026-11-12`) como a pessoa lê: "12/11/2026". */
export function dataDaBase(iso: string): string {
  return dataCurta(iso);
}

/* ================================================================== pedido */

/** O que a pessoa preencheu no formulário: o texto, ou o nome do arquivo anexado. */
export type Valores = Readonly<Record<string, string>>;

/** A frase da entrada no pedido: "Documento a conferir: parecer.md (está na pasta da tarefa)". */
function linhaEntrada(entrada: EntradaTarefa, valor: string): string {
  return entrada.tipo === "arquivo"
    ? `${entrada.rotulo}: ${valor} (está na pasta da tarefa).`
    : `${entrada.rotulo}: ${valor}.`;
}

/** O pedido montado pelo formulário: o título da tarefa e cada entrada preenchida. A pessoa pode editá-lo. */
export function montarPedido(skill: Pick<ResumoSkill, "titulo" | "entradas">, valores: Valores): string {
  const linhas = skill.entradas.flatMap((entrada) => {
    const valor = valores[entrada.id]?.trim() ?? "";
    return valor === "" ? [] : [linhaEntrada(entrada, valor)];
  });
  return [`${skill.titulo}.`, ...linhas].join("\n");
}

/** As entradas obrigatórias que faltam, pelo rótulo. */
export function faltando(entradas: ReadonlyArray<EntradaTarefa>, valores: Valores): ReadonlyArray<string> {
  return entradas
    .filter((entrada) => !entrada.opcional && (valores[entrada.id]?.trim() ?? "") === "")
    .map((e) => e.rotulo);
}

/** O título da pasta de uma conversa livre: as primeiras palavras do pedido. */
export function tituloDoPedido(texto: string): string {
  const linha = texto.trim().split(/\r?\n/, 1)[0] ?? "";
  const palavras = linha.split(/\s+/).filter(Boolean).slice(0, 8).join(" ");
  return palavras.length === 0 ? "Conversa" : palavras;
}

/* ================================================================== nota dos anexos */

/** O nome numa linha só: o macOS aceita quebra de linha num nome de arquivo, e ela abriria outra linha na nota. */
const umaLinha = (texto: string) => texto.replace(/[\r\n]+/g, " ");

/** Código em linha do Markdown, com uma cerca maior que a maior sequência de crases do texto. */
function codigoEmLinha(texto: string): string {
  const maior = Math.max(0, ...[...texto.matchAll(/`+/g)].map((crases) => crases[0].length));
  const cerca = "`".repeat(maior + 1);
  const folga = texto.startsWith("`") || texto.endsWith("`") ? " " : "";
  return `${cerca}${folga}${texto}${folga}${cerca}`;
}

type AnexoNaNota = Pick<ArquivoAnexado, "nome" | "texto" | "semTexto">;

/** Um anexo na nota: o nome que ganhou na pasta e a versão em texto, quando o formato pede uma. */
function linhaDoAnexo(anexo: AnexoNaNota): string {
  const nome = umaLinha(anexo.nome);
  if (anexo.texto !== undefined) return `- ${nome}: leia a versão em texto, ${codigoEmLinha(umaLinha(anexo.texto))}`;
  if (anexo.semTexto !== undefined) return `- ${nome}: sem versão em texto. ${anexo.semTexto}`;
  return `- ${nome}`;
}

/**
 * O pedido com a lista dos arquivos que entraram na pasta, para a IA saber que estão lá e, para o
 * `.docx`, onde está o texto que ela consegue ler.
 */
export function comArquivos(texto: string, anexos: ReadonlyArray<AnexoNaNota>): string {
  return anexos.length === 0 ? texto : `${texto}\n\nArquivos na pasta:\n${anexos.map(linhaDoAnexo).join("\n")}`;
}
