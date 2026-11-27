/**
 * Ferramenta 14, `pacote_revisao_ppc`: o contexto de uma tarefa da revisão de PPC (uma ficha, várias, um
 * tópico ou `todas`) para um PPC, montado pelo serviço `PacoteRevisaoPpc` do kb.
 * O PPC é um da base (`ppc`) ou um `.md` da pasta de trabalho (`arquivo`); exatamente um dos dois.
 *
 * Os `dados` são o pacote do kb como está: o de um PPC
 * da base ou o de um arquivo, que têm formas diferentes. O texto para a IA traz as fichas inteiras,
 * o CNCT, os fatos, os marcos, as transições, os dispositivos e as seções, com o literal, a fonte e o
 * link. Teto de 80 mil caracteres: acima dele, os literais mais longos (seções, dispositivos,
 * transições) são cortados por igual, e só em último caso o fim do texto; o JSON continua inteiro.
 */
import * as Schema from "effect/Schema";
import type { Aviso } from "../contratos.ts";
import { opcional, textoAparado } from "../esquema.ts";
import { linkCnct, linkNorma, linkPpc } from "../links.ts";
import { cortar, RESERVA_TEXTO } from "../orcamento.ts";
import { blocoItem, comLink, dataBr, linhaAviso } from "../texto.ts";
import { definirFerramenta } from "./ferramenta.ts";

export const TETO_PACOTE_REVISAO_PPC = 80000;

/** Nenhum literal cortado fica abaixo disto: abaixo, corta-se o fim do texto. */
const LITERAL_MINIMO = 300;

export const Entrada = Schema.Struct({
  tarefa: textoAparado(
    { minimo: 1, maximo: 1000 },
    'a tarefa da revisão de PPC: uma ficha ("CT-CURR-12"), várias separadas por vírgula ("CT-CURR-12,CT-IDENT-01"), um tópico ("estagio") ou "todas"',
  ),
  ppc: opcional(
    textoAparado(
      { minimo: 3, maximo: 300 },
      'PPC da base ("campus/curso", como "curitiba/tecnico-em-enfermagem", ou o link ifpr://ppc/…); não use junto com arquivo',
    ),
  ),
  arquivo: opcional(
    textoAparado(
      { minimo: 4, maximo: 1000 },
      'arquivo .md do PPC dentro da pasta de trabalho do servidor ("PPC.md" ou "rodada/PPC.md"); não use junto com ppc',
    ),
  ),
});

/* ------------------------------------------------------------------ dados: as partes do pacote do kb */

const Texto = Schema.String;
const TextoNulo = Schema.NullOr(Schema.String);
const Linha = Schema.Int;

const Dispositivo = Schema.Struct({
  id: Texto,
  citados: Schema.optionalKey(Schema.Array(Texto)),
  fichas: Schema.Array(Texto),
  caput: Schema.optionalKey(Schema.Array(Texto)),
  texto: Texto,
  subordinados: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Texto, texto: Texto }))),
  notas: Schema.optionalKey(Schema.Array(Schema.Struct({ tipo: Texto, texto: Texto }))),
  revogado: Schema.optionalKey(Schema.Literal(true)),
  path: Texto,
  linha_inicio: Linha,
  linha_fim: Linha,
});

const Norma = Schema.Struct({
  ref: Texto,
  titulo: TextoNulo,
  status_vigencia: TextoNulo,
  path: TextoNulo,
  fichas: Schema.Array(Texto),
  dispositivos: Schema.Array(Dispositivo),
  sem_texto: Schema.Array(Texto),
});

const CitacaoPpc = Schema.Struct({
  norma_id: Texto,
  linha: Linha,
  trecho: Texto,
  papel: Texto,
  secao_tipo: TextoNulo,
  regra: Texto,
});

const Marco = Schema.Struct({
  marco: Texto,
  tema: Texto,
  vigente: Texto,
  /** As normas do marco, como `marcos-normativos.json` as grava. */
  normas: Schema.Unknown,
  transicao: TextoNulo,
  orientacao_analise: TextoNulo,
  path: Texto,
  citacoes_no_ppc: Schema.Array(CitacaoPpc),
});

const Transicao = Schema.Struct({
  id: Texto,
  norma_id: Texto,
  dispositivo: Texto,
  tipo: Texto,
  norma_anterior: TextoNulo,
  aplica_a: Texto,
  regra: Texto,
  /** `a-iniciar`, `em-curso` ou `encerrada`, em `vigencia_em`. */
  situacao: Texto,
  inicio: Texto,
  /** `null` quando a norma que estabelece a regra aguarda publicação. */
  inicio_em: TextoNulo,
  fim: Texto,
  fim_em: TextoNulo,
  caput: Schema.optionalKey(Schema.Array(Texto)),
  texto: TextoNulo,
  path: TextoNulo,
  linha_inicio: Schema.NullOr(Linha),
  linha_fim: Schema.NullOr(Linha),
});

const Secao = Schema.Struct({
  /** `campus/curso#secao` (PPC da base, para `ler_secao`) ou `ppc:avulso#secao` (arquivo). */
  id: Texto,
  tipo: Texto,
  titulo: Texto,
  path: Texto,
  linha_inicio: Linha,
  linha_fim: Linha,
  /** Por que a seção entrou: `topico:<id>` ou `busca:<ficha>:<consulta>`. */
  motivo: Schema.Array(Texto),
  texto: Texto,
});

/** Pacote de um PPC da base (`ppc`). */
export const PacoteDaBase = Schema.Struct({
  tarefa: Texto,
  fichas_ids: Schema.Array(Texto),
  ppc: Schema.Struct({
    id: Texto,
    curso_nome: Texto,
    campus_nome: Texto,
    nivel: Texto,
    tipo_oferta: Texto,
    path: Texto,
    curso_id: TextoNulo,
    ano_documento: Schema.NullOr(Schema.Int),
    cnct_id: TextoNulo,
  }),
  /** O curso do CNCT, como o catálogo o grava. */
  cnct: Schema.Unknown,
  /** As fichas da revisão de PPC, como os arquivos as gravam. */
  fichas: Schema.Array(Schema.Unknown),
  normas: Schema.Array(Norma),
  marcos: Schema.Array(Marco),
  vigencia_em: Texto,
  transicoes: Schema.Array(Transicao),
  secoes: Schema.Array(Secao),
  /** Fatos do PPC cruzados com o SUAP (`fatos`, `suap`, `cruzamento`), ou `null`. */
  fatos: Schema.Unknown,
  /** `caracteres` é o tamanho do pacote em JSON indentado; os demais, quanto do PPC inteiro entrou. */
  tamanho: Schema.Struct({
    caracteres: Schema.Int,
    secoes: Schema.Int,
    caracteres_secoes: Schema.Int,
    caracteres_ppc_inteiro: Schema.Int,
  }),
});

/** Pacote de um `.md` da pasta de trabalho (`arquivo`). */
export const PacoteDoArquivo = Schema.Struct({
  /** O arquivo, relativo à pasta de trabalho. */
  path: Texto,
  fichas_ids: Schema.Array(Texto),
  cnct: Schema.Unknown,
  normas: Schema.Array(Norma),
  marcos: Schema.Array(Marco),
  vigencia_em: Texto,
  transicoes: Schema.Array(Transicao),
  secoes: Schema.Array(Secao),
  citacoes_ppc: Schema.optionalKey(Schema.Array(CitacaoPpc)),
  fichas: Schema.Array(Schema.Unknown),
  tamanho: Schema.Struct({ caracteres: Schema.Int, caracteres_ppc_inteiro: Schema.Int }),
});

export const Dados = Schema.Union([PacoteDaBase, PacoteDoArquivo]);
type Dados = typeof Dados.Type;
export type PacoteDaBase = typeof PacoteDaBase.Type;

const ehDaBase = (d: Dados): d is PacoteDaBase => "tarefa" in d;

/* ------------------------------------------------------------------ texto */

/** Bloco com um literal que pode ser cortado para caber no teto. */
interface Elastico {
  readonly antes: string;
  readonly literal: string;
  readonly depois: string;
  /** Onde ler o literal inteiro, quando cortado. */
  readonly marca: string;
}

type Bloco = string | Elastico;

const numero = (n: number) => n.toLocaleString("pt-BR");

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Valor de ficha ou do CNCT em Markdown: escalares numa linha, listas e objetos em subitens. */
function markdownDeValor(valor: unknown, recuo: string): string {
  if (valor === null || valor === undefined) return "—";
  if (typeof valor !== "object") return String(valor).replace(/\n/g, `\n${recuo}  `);
  if (Array.isArray(valor)) {
    if (valor.length === 0) return "—";
    if (valor.every((v) => !ehObjeto(v) && !Array.isArray(v))) return valor.map((v) => String(v)).join("; ");
    return valor.map((v) => `\n${recuo}- ${markdownDeValor(v, `${recuo}  `)}`).join("");
  }
  return Object.entries(valor)
    .map(([k, v]) => `${k}: ${ehObjeto(v) || Array.isArray(v) ? JSON.stringify(v) : String(v)}`)
    .join("; ");
}

function camposEmMarkdown(objeto: Record<string, unknown>, fora: readonly string[]): string {
  return Object.entries(objeto)
    .filter(([k]) => !fora.includes(k))
    .map(([k, v]) => `- **${k}:** ${markdownDeValor(v, "  ")}`)
    .join("\n");
}

function blocoFicha(ficha: unknown): string {
  if (!ehObjeto(ficha)) return JSON.stringify(ficha);
  const id = String(ficha.id);
  const titulo = typeof ficha.titulo === "string" ? `${id} — ${ficha.titulo}` : id;
  return `### ${titulo}\n${camposEmMarkdown(ficha, ["id", "titulo"])}`;
}

function blocoCnct(cnct: unknown): string | null {
  if (!ehObjeto(cnct) || typeof cnct.id !== "string") return null;
  const nome = typeof cnct.denominacao === "string" ? cnct.denominacao : cnct.id;
  return `## CNCT: ${comLink(nome, linkCnct(cnct.id))}\n${camposEmMarkdown(cnct, ["id", "denominacao", "denominacao_normalizada", "indice", "path"])}${typeof cnct.path === "string" ? `\nfonte: \`${cnct.path}\`` : ""}`;
}

function blocoFatos(fatos: unknown): string | null {
  if (!ehObjeto(fatos)) return null;
  const linhas = ["## Fatos do PPC × SUAP (extraídos por regra: confira o trecho)"];
  for (const f of Array.isArray(fatos.fatos) ? fatos.fatos : []) {
    if (!ehObjeto(f)) continue;
    linhas.push(
      `- ${String(f.fato)} = ${String(f.valor)} [${String(f.status_curadoria)}, ${String(f.regra)}]: "${cortar(String(f.trecho_fonte), 300)}" — fonte: \`${String(f.path)}:${String(f.linha)}\``,
    );
  }
  for (const c of Array.isArray(fatos.cruzamento) ? fatos.cruzamento : []) {
    if (ehObjeto(c)) linhas.push(`- SUAP, ${String(c.aspecto)}: ${String(c.resultado)} — ${String(c.explicacao)}`);
  }
  return linhas.join("\n");
}

function blocoMarco(m: (typeof Marco)["Type"]): string {
  const linhas = [`**${m.tema}** (marco \`${m.marco}\`) — vigente: ${comLink(m.vigente, linkNorma(m.vigente))}`];
  if (m.transicao) linhas.push(`Transição: ${m.transicao}`);
  if (m.orientacao_analise) linhas.push(`Orientação para a análise: ${m.orientacao_analise}`);
  if (ehObjeto(m.normas)) linhas.push(`Normas do marco: ${markdownDeValor(m.normas, "")}`);
  for (const c of m.citacoes_no_ppc) {
    linhas.push(
      `- citado no PPC, linha ${c.linha} (${c.norma_id}, ${c.papel}, regra ${c.regra}): "${cortar(c.trecho, 300)}"`,
    );
  }
  linhas.push(`fonte: \`${m.path}\``);
  return linhas.join("\n");
}

function literalDispositivo(d: { readonly caput?: readonly string[]; readonly texto: string | null }): string {
  return [...(d.caput ?? []), d.texto ?? ""].filter(Boolean).join("\n");
}

function blocosNorma(n: (typeof Norma)["Type"]): Bloco[] {
  const titulo = n.titulo ?? n.ref;
  const cabecalho = `### ${comLink(titulo, linkNorma(n.ref))} — ${n.status_vigencia ?? "sem status"}; fichas: ${n.fichas.join(", ")}${n.sem_texto.length ? `\nSem texto na base (não afirme o conteúdo): ${n.sem_texto.join(", ")}` : ""}`;
  return [
    cabecalho,
    ...n.dispositivos.map((d): Elastico => ({
      antes: blocoItem({
        titulo: d.id,
        link: linkNorma(d.id),
        detalhe: `fichas: ${d.fichas.join(", ")}${d.revogado ? "; revogado" : ""}${d.citados ? `; cobre ${d.citados.join(", ")}` : ""}`,
      }),
      literal: [literalDispositivo(d), ...(d.subordinados ?? []).map((s) => s.texto)].join("\n"),
      depois: [
        ...(d.notas ?? []).map((nota) => `nota (${nota.tipo}): ${nota.texto}`),
        `fonte: \`${d.path}:${d.linha_inicio}-${d.linha_fim}\``,
      ].join("\n"),
      marca: `[cortado; leia o resto com ler_dispositivos("${d.id}")]`,
    })),
  ];
}

function blocoTransicao(t: (typeof Transicao)["Type"]): Bloco {
  const link = linkNorma(t.norma_id, t.dispositivo.startsWith("#") ? t.dispositivo.slice(1) : undefined);
  const cabecalho = [
    blocoItem({ titulo: t.id, link, detalhe: `${t.tipo}; situação: ${t.situacao}` }),
    `Aplica-se a: ${t.aplica_a}`,
    `Regra: ${t.regra}`,
    `Início: ${t.inicio_em ?? `${t.inicio} (a norma aguarda publicação)`}; fim: ${t.fim_em ?? t.fim}${t.norma_anterior ? `; norma anterior: ${t.norma_anterior}` : ""}`,
  ].join("\n");
  if (t.texto === null) return cabecalho;
  return {
    antes: cabecalho,
    literal: literalDispositivo(t),
    depois: t.path ? `fonte: \`${t.path}:${t.linha_inicio}-${t.linha_fim}\`` : "",
    marca: `[cortado; leia o dispositivo com ler_dispositivos("${t.norma_id}${t.dispositivo}")]`,
  };
}

function blocoSecao(s: (typeof Secao)["Type"], daBase: boolean): Elastico {
  const [ppc, fragmento] = s.id.split("#") as [string, string | undefined];
  return {
    antes: blocoItem({
      titulo: s.titulo,
      ...(daBase && fragmento ? { link: linkPpc(ppc, fragmento) } : {}),
      detalhe: `\`${s.tipo}\`, \`${s.id}\`; motivo: ${s.motivo.join("; ")}`,
    }),
    literal: s.texto,
    depois: `fonte: \`${s.path}:${s.linha_inicio}-${s.linha_fim}\``,
    marca: daBase
      ? `[cortado; leia o resto com ler_secao("${s.id}")]`
      : `[cortado; o texto inteiro está em ${s.path}, linhas ${s.linha_inicio} a ${s.linha_fim}]`,
  };
}

function blocosDoPacote(d: Dados): Bloco[] {
  const daBase = ehDaBase(d);
  const cabecalho = daBase
    ? `**Pacote de contexto da revisão de PPC: ${d.tarefa}** — PPC ${comLink(`${d.ppc.curso_nome} — ${d.ppc.campus_nome}`, linkPpc(d.ppc.id))} (${d.ppc.nivel}, ${d.ppc.tipo_oferta}${d.ppc.ano_documento ? `, PPC de ${d.ppc.ano_documento}` : ""})`
    : `**Pacote de contexto da revisão de PPC** — arquivo \`${d.path}\` (PPC fora da base)`;
  const tamanho = daBase
    ? `Tamanho: ${d.tamanho.secoes} seções do PPC, ${numero(d.tamanho.caracteres_secoes)} de ${numero(d.tamanho.caracteres_ppc_inteiro)} caracteres do PPC inteiro (${Math.round((100 * d.tamanho.caracteres_secoes) / Math.max(1, d.tamanho.caracteres_ppc_inteiro))}%).`
    : `Tamanho: ${d.secoes.length} seções do PPC; o PPC inteiro tem ${numero(d.tamanho.caracteres_ppc_inteiro)} caracteres.`;
  const blocos: Bloco[] = [
    [
      cabecalho,
      `Fichas (${d.fichas_ids.length}): ${d.fichas_ids.join(", ")}. Situação das transições em ${dataBr(d.vigencia_em)}. ${tamanho}`,
    ].join("\n"),
    "## Fichas",
    ...d.fichas.map(blocoFicha),
  ];
  const cnct = blocoCnct(d.cnct);
  if (cnct) blocos.push(cnct);
  const fatos = daBase ? blocoFatos(d.fatos) : null;
  if (fatos) blocos.push(fatos);
  if (d.marcos.length) blocos.push("## Marcos normativos", ...d.marcos.map(blocoMarco));
  if (d.transicoes.length) {
    blocos.push(`## Regras de transição (situação em ${dataBr(d.vigencia_em)})`, ...d.transicoes.map(blocoTransicao));
  }
  if (d.normas.length) blocos.push("## Normas e dispositivos citados nas fichas", ...d.normas.flatMap(blocosNorma));
  if (d.secoes.length) {
    blocos.push("## Seções do PPC (o texto do PPC sob revisão)", ...d.secoes.map((s) => blocoSecao(s, daBase)));
  }
  return blocos;
}

const ehElastico = (b: Bloco): b is Elastico => typeof b !== "string";

function montar(blocos: readonly Bloco[], teto: number | null): string {
  return blocos
    .map((b) => {
      if (!ehElastico(b)) return b;
      const literal =
        teto !== null && b.literal.length > teto
          ? `${cortar(b.literal, Math.max(1, teto - b.marca.length - 1))}\n${b.marca}`
          : b.literal;
      const citado = literal
        .split("\n")
        .map((linha) => (linha.trim() === "" ? ">" : `> ${linha}`))
        .join("\n");
      return [b.antes, citado, b.depois].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

/** Maior teto por literal com que a soma dos literais cabe em `espaco` (cortes por igual nos mais longos). */
function tetoPorLiteral(tamanhos: readonly number[], espaco: number): number {
  const ordenados = [...tamanhos].sort((a, b) => a - b);
  let resto = espaco;
  for (const [i, tamanho] of ordenados.entries()) {
    const porItem = Math.floor(resto / (ordenados.length - i));
    if (tamanho > porItem) return porItem;
    resto -= tamanho;
  }
  return Number.POSITIVE_INFINITY;
}

const NOTA_CORTE =
  "\n\n[texto cortado no teto de 80 mil caracteres: o pacote inteiro está no JSON da resposta; para um texto menor, peça uma ficha ou um tópico]";

/**
 * O corpo do texto em `orcamento` caracteres. `resumido` diz se algo foi cortado: primeiro os
 * literais mais longos, por igual (nunca abaixo de `LITERAL_MINIMO`); depois, se ainda faltar
 * espaço, o fim do texto.
 */
export function corpoDoPacote(d: Dados, orcamento: number): { readonly texto: string; readonly resumido: boolean } {
  const blocos = blocosDoPacote(d);
  const inteiro = montar(blocos, null);
  if (inteiro.length <= orcamento) return { texto: inteiro, resumido: false };
  const elasticos = blocos.filter(ehElastico);
  const literais = elasticos.map((b) => b.literal.length);
  // o citado (`> ` por linha) é maior que o literal: o ajuste repete até caber
  let teto = tetoPorLiteral(literais, orcamento - (inteiro.length - literais.reduce((t, n) => t + n, 0)));
  let texto = inteiro;
  for (let tentativa = 0; tentativa < 12; tentativa += 1) {
    teto = Math.max(LITERAL_MINIMO, Math.min(teto, Math.max(...literais)));
    texto = montar(blocos, teto);
    if (texto.length <= orcamento || teto === LITERAL_MINIMO) break;
    const cortados = Math.max(1, literais.filter((n) => n > teto).length);
    teto = Math.floor(teto - (texto.length - orcamento) / cortados) - 1;
  }
  if (texto.length > orcamento) texto = `${cortar(texto, orcamento - NOTA_CORTE.length)}${NOTA_CORTE}`;
  return { texto, resumido: true };
}

/** Espaço do corpo, descontados os avisos e a reserva de rodapé. */
export function orcamentoDoCorpo(avisos: ReadonlyArray<Aviso>): number {
  return TETO_PACOTE_REVISAO_PPC - RESERVA_TEXTO - avisos.reduce((t, a) => t + linhaAviso(a).length + 1, 0);
}

export const AVISO_RESUMIDO: Aviso = {
  tipo: "resultado-resumido",
  mensagem: `o pacote passa do teto de ${numero(TETO_PACOTE_REVISAO_PPC)} caracteres do texto: os literais mais longos foram cortados e marcados (leia o resto com ler_secao ou ler_dispositivos); o JSON da resposta traz o pacote inteiro; para um texto inteiro, peça uma ficha ou um tópico`,
};

export const pacoteRevisaoPpc = definirFerramenta({
  nome: "pacote_revisao_ppc",
  titulo: "Contexto da revisão de PPC",
  descricao:
    'Monta o contexto da tarefa "Revisar um PPC" para um PPC: os critérios (as fichas), CNCT, dispositivos citados nos critérios, marcos, transições, seções relevantes do PPC e fatos. Use para conferir um PPC contra os critérios. Aceita um PPC da base ou um arquivo `.md` da pasta de trabalho.',
  entrada: Entrada,
  dados: Dados,
  texto: (resposta) => corpoDoPacote(resposta.dados, orcamentoDoCorpo(resposta.avisos)).texto,
});
