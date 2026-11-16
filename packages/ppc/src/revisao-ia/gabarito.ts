/**
 * Revisão com IA (M1.11, etapa 4): o gabarito dos recortes, para medir sem IA se o que a IA recebe
 * contém a evidência que a ficha pede.
 *
 * Para cada ficha do modo rápido, a evidência esperada é um conjunto de requisitos (todos valem):
 * um padrão sobre o texto dobrado (sem acento, caixa e marcação), ou a presença de pelo menos 60% dos
 * componentes da matriz ou do ementário. A medida é **condicional**: só conta um PPC para uma ficha
 * quando o próprio PPC contém a evidência; se nem o PPC tem, o "a conferir" (ou a pendência) é
 * legítimo e não é erro do recorte. Os padrões são heurísticos, escritos a partir dos critérios e do
 * diagnóstico do teste real; servem para comparar versões do recorte, não para julgar o PPC.
 */
import { componentesDaMatriz, componentesDoEmentario, fracaoPresente } from "./estrutura.ts";
import { dobrar, type SecaoTexto } from "./plano.ts";

export type Requisito =
  | { tipo: "padrao"; padrao: RegExp; descricao: string }
  | { tipo: "matriz"; descricao: string }
  | { tipo: "ementario"; descricao: string }
  /** O conteúdo traz o começo (200 caracteres) de alguma seção de um destes tipos. */
  | { tipo: "secao"; tipos: readonly string[]; descricao: string };

const p = (padrao: RegExp, descricao: string): Requisito => ({ tipo: "padrao", padrao, descricao });
const MATRIZ: Requisito = { tipo: "matriz", descricao: "60% dos componentes da matriz" };
const EMENTARIO: Requisito = { tipo: "ementario", descricao: "60% dos componentes do ementário" };
const secao = (...tipos: string[]): Requisito => ({ tipo: "secao", tipos, descricao: `seção ${tipos.join(" ou ")}` });

const FORMA = p(
  /(forma|oferta|modalidade)\W{0,3}(\w+\W{1,2}){0,4}(subsequente|integrad[oa]|concomitante|proeja)/,
  "forma de oferta declarada",
);
const FORMATO = p(
  /(modalidade|formato( de oferta)?)\W{0,3}(\w+\W{1,2}){0,4}(presencial|a distancia|ead|semipresencial|hibrid)/,
  "modalidade ou formato declarado",
);

/** O gabarito das fichas do modo rápido (as 22 do teste real). */
export const GABARITO: Readonly<Record<string, readonly Requisito[]>> = {
  "CT-CURR-23": [
    p(
      /segunda\W{0,3}(feira\W{0,3})?a\W{0,3}sexta|\b\d{1,2} ?h ?\d{2}\b|horario (de oferta|das aulas)/,
      "horário ou dias das aulas",
    ),
  ],
  "CT-CURR-27": [FORMATO],
  "CT-IDENT-02": [FORMA, p(/carga\W{0,2}horaria total/, "carga horária total")],
  "CT-IDENT-09": [FORMA, FORMATO],
  "CT-IDENT-16": [
    p(/processo seletivo|formas? de (ingresso|acesso)|requisitos? (e formas )?de acesso/, "forma de ingresso"),
  ],
  "CT-IDENT-17": [p(/reserva de vagas|cotas|12\.?711|acoes afirmativas/, "reserva de vagas")],
  "CT-CURR-01": [MATRIZ],
  "CT-CURR-03": [MATRIZ],
  "CT-CURR-10": [p(/representacao grafica/, 'representação gráfica (a seção; "fluxograma" aparece em ementas)')],
  "CT-CURR-04": [MATRIZ, p(/perfil (do egresso|profissional)/, "perfil")],
  "CT-CURR-07": [MATRIZ],
  "CT-CURR-12": [MATRIZ],
  "CT-CURR-19": [p(/pratica(s)? profissiona|estagio/, "prática profissional ou estágio")],
  "CT-CURR-05": [EMENTARIO],
  "CT-CURR-06": [EMENTARIO],
  "CT-SUP-13": [secao("referencias")],
  "CT-TRANS-01": [secao("objetivos"), secao("perfil_egresso"), MATRIZ],
  "CT-TRANS-02": [secao("concepcao_pedagogica", "organizacao_curricular"), secao("avaliacao")],
  "CT-TRANS-03": [EMENTARIO],
  "CT-TRANS-04": [secao("corpo_docente"), secao("infraestrutura"), MATRIZ],
  "CT-TRANS-05": [secao("avaliacao_curso", "acompanhamento_egresso")],
  "CT-TRANS-07": [
    p(/\b\d{1,3} vagas|vagas\W{0,25}\d{1,3}\b/, "número de vagas"),
    p(/laboratorio|infraestrutura|sala/, "infraestrutura"),
  ],
};

export type PpcParaGabarito = { markdown: string; secoes: readonly (SecaoTexto & { tipo: string })[] };

/** Os nomes que cada requisito estrutural procura, calculados uma vez por PPC. */
export function nomesDoPpc(ppc: PpcParaGabarito) {
  return {
    matriz: componentesDaMatriz(ppc.secoes),
    ementario: componentesDoEmentario(ppc.markdown).map((c) => c.nome),
    /** O começo dobrado de cada seção com corpo (os primeiros 200 caracteres, sem as pontas cortadas). */
    secoes: ppc.secoes
      .map((s) => ({
        tipo: s.tipo,
        inicio: dobrar(s.texto)
          .slice(0, 200)
          .replace(/\s\S*$/, ""),
      }))
      .filter((s) => s.inicio.length >= 60),
  };
}

const MINIMO_NOMES = 5;

/** O requisito vale para o texto? `null` quando não se aplica (PPC sem matriz ou ementário reconhecível). */
function vale(r: Requisito, texto: string, dobrado: string, nomes: ReturnType<typeof nomesDoPpc>): boolean | null {
  if (r.tipo === "padrao") return r.padrao.test(dobrado);
  if (r.tipo === "secao") {
    const inicios = nomes.secoes.filter((s) => r.tipos.includes(s.tipo)).map((s) => s.inicio);
    if (!inicios.length) return false;
    return inicios.some((i) => dobrado.includes(i));
  }
  const lista = r.tipo === "matriz" ? nomes.matriz : nomes.ementario;
  if (lista.length < MINIMO_NOMES) return null;
  return fracaoPresente(lista, texto) >= 0.6;
}

/**
 * A ficha no PPC e no recorte: `noPpc` (o PPC tem a evidência; `null` quando o gabarito não se aplica)
 * e `noRecorte` (o conteúdo que a IA recebe a tem).
 */
export function avaliarRecorte(
  ficha: string,
  conteudo: string,
  ppc: PpcParaGabarito,
  nomes = nomesDoPpc(ppc),
): { noPpc: boolean | null; noRecorte: boolean } {
  const requisitos = GABARITO[ficha];
  if (!requisitos) return { noPpc: null, noRecorte: false };
  const dPpc = dobrar(ppc.markdown);
  const dConteudo = dobrar(conteudo);
  let noPpc: boolean | null = true;
  let noRecorte = true;
  for (const r of requisitos) {
    const emPpc = vale(r, ppc.markdown, dPpc, nomes);
    if (emPpc === null) return { noPpc: null, noRecorte: false };
    if (!emPpc) noPpc = false;
    if (!vale(r, conteudo, dConteudo, nomes)) noRecorte = false;
  }
  return { noPpc, noRecorte };
}
