/**
 * Revisão com IA (M1.11, etapa 4): as partes do PPC que o código extrai pela estrutura, e não por
 * termos, para os pedidos: o quadro de identificação, a matriz em TSV e o índice do ementário.
 *
 * Vieram do diagnóstico do teste real: no PPC de Enfermagem (Curitiba), o quadro de identificação é
 * uma série de seções curtas em que o rótulo está no título (`1.1.5 Modalidade` → "Presencial"), e o
 * recorte por termos não as pegava; a matriz chegava cortada; o ementário, só com três componentes.
 * Tudo aqui é "derivado pelo código": o pedido diz isso, e a IA confere no texto.
 */
import { dobrar, type SecaoTexto } from "./plano.ts";

/** Tipos de seção do quadro de identificação (taxonomia `tecnico` do `kb`). */
export const TIPOS_QUADRO = new Set([
  "identificacao",
  "formato_oferta",
  "carga_horaria",
  "prazo_integralizacao",
  "requisitos_acesso",
]);

const LIMITE_CAMPO_QUADRO = 450;
export const LIMITE_QUADRO = 3500;
export const LIMITE_MATRIZ = 12_000;
export const LIMITE_EMENTARIO = 8000;

const limparCelula = (c: string) =>
  c
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();

const celulas = (linha: string) => linha.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(limparCelula);
const ehSeparador = (linha: string) => /^\|?[\s:|-]+\|?\s*$/.test(linha) && linha.includes("-");

/**
 * O quadro de identificação: cada seção dos tipos do quadro como "título: valor", curto, mais os fatos
 * que o `kb` extraiu (carga horária total, estágio), até `LIMITE_QUADRO`.
 */
export function quadroDeIdentificacao(
  secoes: readonly (SecaoTexto & { tipo: string })[],
  fatos: readonly { fato: string; valor: string }[] = [],
): string {
  const linhas: string[] = [];
  let tamanho = 0;
  for (const s of secoes) {
    if (!TIPOS_QUADRO.has(s.tipo)) continue;
    const corpo = s.texto
      .split("\n")
      .filter((l) => !ehSeparador(l))
      .map((l) => (l.startsWith("|") ? celulas(l).filter(Boolean).join(" · ") : limparCelula(l)))
      .filter(Boolean)
      .join(" ");
    const valor = corpo.length > LIMITE_CAMPO_QUADRO ? `${corpo.slice(0, LIMITE_CAMPO_QUADRO)} […]` : corpo;
    const linha = `- ${limparCelula(s.titulo)}: ${valor || "(vazio)"}`;
    if (tamanho + linha.length > LIMITE_QUADRO) break;
    linhas.push(linha);
    tamanho += linha.length;
  }
  for (const f of fatos) linhas.push(`- (extraído pelo código) ${f.fato}: ${f.valor}`);
  return linhas.join("\n");
}

const NUMERO = /^\d+([.,]\d+)?\s*(h|horas|ha)?$/i;
const CABECALHO = /^(total|subtotal|componentes? curricular|carga hor|disciplina|m[oó]dulo|semestre|per[ií]odo|ano)\b/i;

/** As linhas de tabela das seções de matriz (ou, sem elas, das de organização curricular). */
function linhasDaMatriz(secoes: readonly (SecaoTexto & { tipo: string })[]): string[] {
  const tabelas = (tipo: string) =>
    secoes.filter((s) => s.tipo === tipo).flatMap((s) => s.texto.split("\n").filter((l) => l.trim().startsWith("|")));
  const matriz = tabelas("matriz_curricular");
  return matriz.length ? matriz : tabelas("organizacao_curricular");
}

/** A matriz em TSV (mais barata em tokens que a tabela GFM), sem colunas vazias, até `LIMITE_MATRIZ`. */
export function matrizEmTsv(secoes: readonly (SecaoTexto & { tipo: string })[]): string {
  const saida: string[] = [];
  let tamanho = 0;
  let anterior = "";
  for (const linha of linhasDaMatriz(secoes)) {
    if (ehSeparador(linha)) continue;
    const tsv = celulas(linha).filter(Boolean).join("\t");
    if (!tsv || tsv === anterior) continue;
    anterior = tsv;
    if (tamanho + tsv.length > LIMITE_MATRIZ) {
      saida.push("[… matriz encurtada pelo Simplifica IF …]");
      break;
    }
    saida.push(tsv);
    tamanho += tsv.length + 1;
  }
  return saida.join("\n");
}

/** Os nomes dos componentes da matriz (linhas com número e um texto que não é cabeçalho). */
export function componentesDaMatriz(secoes: readonly (SecaoTexto & { tipo: string })[]): string[] {
  const nomes = new Set<string>();
  for (const linha of linhasDaMatriz(secoes)) {
    if (ehSeparador(linha)) continue;
    const cs = celulas(linha).filter(Boolean);
    if (!cs.some((c) => NUMERO.test(c))) continue;
    const texto = cs.filter((c) => !NUMERO.test(c) && /[a-zà-ú]{4}/i.test(c) && !CABECALHO.test(c));
    const nome = texto.sort((a, b) => b.length - a.length)[0];
    if (nome && nome.length <= 120) nomes.add(nome);
  }
  return [...nomes];
}

const COMPONENTE = /^[|#*\s_]*(?:componente curricular|unidade curricular|disciplina)\s*:\s*(.+)$/i;
const EMENTA = /^[|#*\s_]*ementa\b/i;
const BASICA = /^[|#*\s_]*bibliografia b[aá]sica/i;
const COMPLEMENTAR = /^[|#*\s_]*bibliografia complementar/i;
const OUTRO_ROTULO = /^[|#*\s_]*(carga hor|objetivo|pr[eé]-requisito|per[ií]odo|m[oó]dulo|semestre|ano)\b/i;

export type ComponenteDoEmentario = { nome: string; ementa: string; basicas: number; complementares: number };

/**
 * O ementário, componente a componente (o rótulo "Componente curricular:" abre cada um): o começo da
 * ementa e quantas referências básicas e complementares há (linhas não vazias depois de cada rótulo).
 */
export function componentesDoEmentario(markdown: string): ComponenteDoEmentario[] {
  const saida: ComponenteDoEmentario[] = [];
  let atual: ComponenteDoEmentario | null = null;
  let parte: "ementa" | "basica" | "complementar" | null = null;
  for (const bruta of markdown.split("\n")) {
    const linha = bruta.trim();
    const componente = COMPONENTE.exec(linha);
    if (componente) {
      atual = {
        nome: limparCelula(componente[1]!).replace(/\|.*$/, "").trim(),
        ementa: "",
        basicas: 0,
        complementares: 0,
      };
      saida.push(atual);
      parte = null;
      continue;
    }
    if (!atual || !linha) continue;
    if (EMENTA.test(linha)) {
      parte = "ementa";
      const resto = limparCelula(linha.replace(/^[|#*\s_]*ementa\s*:?/i, ""));
      if (resto) atual.ementa += `${resto} `;
      continue;
    }
    if (BASICA.test(linha)) {
      parte = "basica";
      continue;
    }
    if (COMPLEMENTAR.test(linha)) {
      parte = "complementar";
      continue;
    }
    if (OUTRO_ROTULO.test(linha) || /^#{1,6}\s/.test(linha)) {
      if (parte !== "ementa" || /^#{1,6}\s/.test(linha)) parte = null;
      continue;
    }
    if (parte === "ementa" && atual.ementa.length < 300) atual.ementa += `${limparCelula(linha)} `;
    else if (parte === "basica" && /[a-z]{3}/i.test(linha)) atual.basicas += 1;
    else if (parte === "complementar" && /[a-z]{3}/i.test(linha)) atual.complementares += 1;
  }
  return saida.filter((c) => c.nome.length >= 3);
}

/** O índice do ementário em TSV: componente, começo da ementa, nº de referências básicas e complementares. */
export function indiceDoEmentario(markdown: string): string {
  const linhas = ["componente\tementa (começo)\tref. básicas\tref. complementares"];
  let tamanho = linhas[0]!.length;
  for (const c of componentesDoEmentario(markdown)) {
    const ementa = c.ementa.trim()
      ? `${c.ementa.trim().slice(0, 140)}${c.ementa.length > 140 ? "…" : ""}`
      : "(sem ementa)";
    const linha = `${c.nome}\t${ementa}\t${c.basicas}\t${c.complementares}`;
    if (tamanho + linha.length > LIMITE_EMENTARIO) {
      linhas.push("[… índice encurtado pelo Simplifica IF …]");
      break;
    }
    linhas.push(linha);
    tamanho += linha.length + 1;
  }
  return linhas.length > 1 ? linhas.join("\n") : "";
}

/** A presença de cada nome no texto (ignorando acento, caixa e marcação). */
export function fracaoPresente(nomes: readonly string[], texto: string): number {
  if (!nomes.length) return 0;
  const alvo = dobrar(texto);
  return nomes.filter((n) => alvo.includes(dobrar(n))).length / nomes.length;
}
