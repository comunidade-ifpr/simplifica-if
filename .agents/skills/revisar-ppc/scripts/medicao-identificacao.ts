/**
 * Medição da identificação do curso (curso, campus, forma de oferta e
 * modalidade) sobre os PPCs técnicos convertidos da base.
 *
 * O gabarito vem de `dados/institucional/cursos/<campus>/<curso>.json`
 * (`nome`, `campus_id`, `forma_oferta`, `modalidade` e `ppc.markdown_path`),
 * só para leitura: a extração não consulta esses dados. O nome do arquivo
 * também não entra na extração (o nome de reserva é neutro), para que o slug
 * do caminho não conte como acerto.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { type CaminhosAnalise, caminhosPadrao } from "./caminhos.ts";
import { type Identificacao, inferirIdentificacaoDoMarkdown, normalizarBusca } from "./identificacao.ts";

/** Nome de reserva neutro: a medição não deve acertar pelo nome do arquivo. */
export const NOME_RESERVA_MEDICAO = "PPC";

/**
 * Amostra fixa do teste: PPCs de formatos variados (capa em caixa alta,
 * identificação em títulos numerados, em tabela, em grade de opções, vários
 * rótulos em negrito na mesma linha, subsequente, integrado e PROEJA), quase
 * todos errados antes da correção.
 */
export const AMOSTRA_MEDICAO = [
  "institucional/ifpr/ppcs/curitiba/tecnico-em-enfermagem.md",
  "institucional/ifpr/ppcs/arapongas/tecnico-em-sistemas-de-energia-renovavel-integrado-ao-ensino-medio.md",
  "institucional/ifpr/ppcs/assis-chateaubriand/tecnico-em-comercio.md",
  "institucional/ifpr/ppcs/assis-chateaubriand/tecnico-em-eletrotecnica-subsequente.md",
  "institucional/ifpr/ppcs/astorga/curso-tecnico-de-informatica-integrado-ao-ensino-medio.md",
  "institucional/ifpr/ppcs/barracao/tecnico-em-informatica.md",
  "institucional/ifpr/ppcs/campo-largo/administracao-proeja.md",
  "institucional/ifpr/ppcs/cascavel/tecnico-em-edificacoes.md",
  "institucional/ifpr/ppcs/coronel-vivida/tecnico-em-cooperativismo.md",
  "institucional/ifpr/ppcs/curitiba/tecnico-em-petroleo-e-gas-integrado-ao-ensino-medio.md",
  "institucional/ifpr/ppcs/goioere/tecnico-em-informatica.md",
  "institucional/ifpr/ppcs/paranagua/tecnico-em-mecanica.md",
  "institucional/ifpr/ppcs/uniao-da-vitoria/tecnico-em-manutencao-e-suporte-em-informatica-proeja.md",
] as const;

export const CAMPOS_MEDIDOS = ["curso", "campus", "forma_oferta", "modalidade"] as const;
export type CampoMedido = (typeof CAMPOS_MEDIDOS)[number];

export type Gabarito = {
  caminho: string;
  nome: string;
  campus_id: string;
  forma_oferta: string;
  modalidade: string | null;
};

export type ResultadoCampo = "certo" | "errado" | "vazio" | "sem_gabarito";

export type CasoMedido = {
  caminho: string;
  gabarito: Gabarito;
  extraido: Record<CampoMedido, string>;
  resultado: Record<CampoMedido, ResultadoCampo>;
};

export type Medicao = {
  total: number;
  campos: Record<CampoMedido, { certos: number; errados: number; vazios: number; avaliados: number; acuracia: number }>;
  casos: CasoMedido[];
};

export type Extrator = (texto: string, caminhos: CaminhosAnalise) => Identificacao;

export const extratorPadrao: Extrator = (texto, caminhos) =>
  inferirIdentificacaoDoMarkdown(texto, NOME_RESERVA_MEDICAO, caminhos);

/** Cursos técnicos (nível médio) com PPC convertido na base. */
export function carregarGabarito(caminhos: CaminhosAnalise = caminhosPadrao()): Gabarito[] {
  const raiz = path.dirname(caminhos.baseConhecimentoDir);
  const cursosDir = path.join(raiz, "dados", "institucional", "cursos");
  const gabarito: Gabarito[] = [];
  for (const campus of readdirSync(cursosDir).sort()) {
    const dir = path.join(cursosDir, campus);
    if (!existsSync(dir) || !campus || campus.startsWith(".")) continue;
    let arquivos: string[];
    try {
      arquivos = readdirSync(dir).filter((nome) => nome.endsWith(".json"));
    } catch {
      continue;
    }
    for (const nome of arquivos.sort()) {
      const curso = JSON.parse(readFileSync(path.join(dir, nome), "utf8")) as Record<string, any>;
      const caminho = curso.ppc?.markdown_path;
      if (curso.nivel !== "médio" || typeof caminho !== "string") continue;
      if (!existsSync(path.join(caminhos.baseConhecimentoDir, caminho))) continue;
      gabarito.push({
        caminho,
        nome: String(curso.nome),
        campus_id: String(curso.campus_id),
        forma_oferta: String(curso.forma_oferta),
        modalidade: typeof curso.modalidade === "string" ? curso.modalidade : null,
      });
    }
  }
  return gabarito;
}

const QUALIFICADORES_CURSO =
  /\b(integrad[oa]s?( ao ensino medio)?|subsequente( ao ensino medio)?|concomitante( ao ensino medio)?|proeja|oferta experimental|ensino medio|na forma.*|forma de oferta.*)$/;

/** Núcleo da denominação para comparação: sem "curso", "técnico em" e qualificadores de oferta. */
export function nucleoCurso(texto: string): string {
  let nucleo = normalizarBusca(texto);
  nucleo = nucleo.replace(/^(curso )?(tecnico )?(em |de )?/, "");
  for (let anterior = ""; anterior !== nucleo;) {
    anterior = nucleo;
    nucleo = nucleo.replace(QUALIFICADORES_CURSO, "").trim();
  }
  return nucleo;
}

/** Categoria da forma de oferta: `integrado`, `subsequente`, `concomitante` ou vazio. */
export function categoriaFormaOferta(texto: string): string {
  const normalizado = normalizarBusca(texto);
  if (/\b(integrad[oa]|proeja)\b/.test(normalizado)) return "integrado";
  if (/\bsubsequente\b/.test(normalizado)) return "subsequente";
  if (/\bconcomitante\b/.test(normalizado)) return "concomitante";
  return "";
}

/** Categoria da modalidade de ensino: `presencial`, `ead` ou vazio. */
export function categoriaModalidade(texto: string): string {
  const normalizado = normalizarBusca(texto);
  if (/\b(ead|a distancia|educacao a distancia)\b/.test(normalizado)) return "ead";
  if (/\bpresencial\b/.test(normalizado)) return "presencial";
  return "";
}

function campiPorNome(caminhos: CaminhosAnalise): Map<string, string> {
  const indice = JSON.parse(
    readFileSync(path.join(caminhos.baseConhecimentoDir, "institucional", "ifpr", "campi", "index.json"), "utf8"),
  ) as { items: Array<{ id: string; nome: string }> };
  return new Map(indice.items.map((item) => [normalizarBusca(item.nome), item.id]));
}

const PLACEHOLDER = /n[ãa]o identificad[oa]$/i;

function avaliar(valor: string, esperado: string | null, comparar: (valor: string) => boolean): ResultadoCampo {
  if (esperado === null) return "sem_gabarito";
  if (!valor.trim() || PLACEHOLDER.test(valor.trim())) return "vazio";
  return comparar(valor) ? "certo" : "errado";
}

/** Compara a identificação extraída com o gabarito, campo a campo. */
export function compararComGabarito(
  identificacao: Identificacao,
  gabarito: Gabarito,
  campus: Map<string, string>,
): Pick<CasoMedido, "extraido" | "resultado"> {
  const extraido: Record<CampoMedido, string> = {
    curso: identificacao.curso,
    campus: identificacao.campus,
    forma_oferta: identificacao.forma_oferta,
    modalidade: identificacao.modalidade_ensino,
  };
  return {
    extraido,
    resultado: {
      curso: avaliar(extraido.curso, gabarito.nome, (v) => nucleoCurso(v) === nucleoCurso(gabarito.nome)),
      campus: avaliar(
        extraido.campus,
        gabarito.campus_id,
        (v) => campus.get(normalizarBusca(v)) === gabarito.campus_id,
      ),
      forma_oferta: avaliar(
        extraido.forma_oferta,
        gabarito.forma_oferta,
        (v) => categoriaFormaOferta(v) === gabarito.forma_oferta,
      ),
      modalidade: avaliar(
        extraido.modalidade,
        gabarito.modalidade,
        (v) => categoriaModalidade(v) === gabarito.modalidade,
      ),
    },
  };
}

/** Roda o extrator sobre os PPCs do gabarito (ou só sobre os caminhos de `amostra`). */
export function medirIdentificacao(
  opcoes: { caminhos?: CaminhosAnalise; amostra?: readonly string[]; extrator?: Extrator } = {},
): Medicao {
  const caminhos = opcoes.caminhos ?? caminhosPadrao();
  const extrator = opcoes.extrator ?? extratorPadrao;
  const campus = campiPorNome(caminhos);
  let gabarito = carregarGabarito(caminhos);
  if (opcoes.amostra) {
    const amostra = new Set(opcoes.amostra);
    gabarito = gabarito.filter((item) => amostra.has(item.caminho));
  }
  const casos = gabarito.map((item): CasoMedido => {
    const texto = readFileSync(path.join(caminhos.baseConhecimentoDir, item.caminho), "utf8");
    return { caminho: item.caminho, gabarito: item, ...compararComGabarito(extrator(texto, caminhos), item, campus) };
  });
  const campos = {} as Medicao["campos"];
  for (const campo of CAMPOS_MEDIDOS) {
    const contar = (r: ResultadoCampo) => casos.filter((caso) => caso.resultado[campo] === r).length;
    const certos = contar("certo");
    const errados = contar("errado");
    const vazios = contar("vazio");
    const avaliados = certos + errados + vazios;
    campos[campo] = { certos, errados, vazios, avaliados, acuracia: avaliados ? certos / avaliados : 0 };
  }
  return { total: casos.length, campos, casos };
}

/** Relatório em texto: acurácia por campo e, opcionalmente, os casos errados ou vazios. */
export function formatarMedicao(medicao: Medicao, opcoes: { erros?: boolean } = {}): string {
  const linhas = [`PPCs técnicos medidos: ${medicao.total}`, ""];
  linhas.push("campo          certos  errados  vazios  acurácia");
  for (const campo of CAMPOS_MEDIDOS) {
    const c = medicao.campos[campo];
    linhas.push(
      `${campo.padEnd(14)} ${String(c.certos).padStart(6)}  ${String(c.errados).padStart(7)}  ${String(c.vazios).padStart(6)}  ${(100 * c.acuracia).toFixed(1).padStart(7)}%`,
    );
  }
  if (opcoes.erros) {
    for (const caso of medicao.casos) {
      const falhas = CAMPOS_MEDIDOS.filter((campo) => ["errado", "vazio"].includes(caso.resultado[campo]));
      if (!falhas.length) continue;
      linhas.push("", caso.caminho);
      for (const campo of falhas) {
        const esperado = {
          curso: caso.gabarito.nome,
          campus: caso.gabarito.campus_id,
          forma_oferta: caso.gabarito.forma_oferta,
          modalidade: caso.gabarito.modalidade,
        }[campo];
        linhas.push(`  ${campo}: ${JSON.stringify(caso.extraido[campo].slice(0, 120))} (esperado: ${esperado})`);
      }
    }
  }
  return `${linhas.join("\n")}\n`;
}
