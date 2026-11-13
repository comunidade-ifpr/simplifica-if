/**
 * Geradores dos gabaritos de conjunto. Cada gerador deriva o conjunto esperado das fontes locais
 * (dados institucionais, manifesto de normas, CNCT e PPCs), sem relógio e com ordem estável.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { compararTexto, normalizarTexto } from "../normalizar.ts";
import type { GabaritoConjunto, Universos } from "../esquema.ts";
import { idNorma, itemCampus, itemCurso, itensNorma } from "../universos.ts";
import { citacoesCneCp1de2021, citacoesCneCp2de2026 } from "./citacoes.ts";
import { cnctDoCurso, type Fontes } from "./fontes.ts";

/** Situações de curso que contam como "autorizado e em oferta" (art. 71 da Res. CNE/CP nº 2/2026). */
export const SITUACOES_EM_OFERTA = new Set(["ativo", "em_oferta"]);

const chave = (curso: { campus_id: string; curso_slug: string }) => `${curso.campus_id}/${curso.curso_slug}`;

function ordenar(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort(compararTexto);
}

function detalhesOrdenados<T>(entradas: Iterable<[string, T]>): Record<string, T> {
  return Object.fromEntries([...entradas].sort(([a], [b]) => compararTexto(a, b)));
}

/* ---------------------------------------------------------------- universos */

export function gerarUniversos(fontes: Fontes): Universos {
  return {
    gerado_por: "scripts/avaliacao/gabaritos/gerar.ts",
    campus: fontes.dados.campi
      .map((campus) => itemCampus(campus.campus_id, campus.nome))
      .sort((a, b) => compararTexto(a.id, b.id)),
    curso: fontes.dados.cursos.map(itemCurso).sort((a, b) => compararTexto(a.id, b.id)),
    norma: itensNorma(fontes.normas),
  };
}

/* ---------------------------------------------------------------- geradores */

type Gerador = (fontes: Fontes) => GabaritoConjunto;

const ARQUIVO_GERADOR = "scripts/avaliacao/gabaritos/conjuntos.ts";

/** Q01: cursos integrados da habilitação Técnico em Informática do CNCT, em oferta. */
function q01(fontes: Fontes): GabaritoConjunto {
  const cursos = fontes.dados.cursos.filter(
    (curso) =>
      curso.forma_oferta === "integrado" &&
      SITUACOES_EM_OFERTA.has(curso.situacao ?? "") &&
      cnctDoCurso(curso.nome, fontes.cnct)?.id === "tecnico-em-informatica",
  );
  return {
    pergunta: "Q01",
    gerado_por: ARQUIVO_GERADOR,
    criterio:
      "Cursos de dados/institucional/ com forma_oferta=integrado, situação ativo/em_oferta e nome que casa com a habilitação 'Técnico em Informática' do CNCT (heurística provisória até o cnct_id da fase 3). Detalhes trazem o ano do PPC e a carga horária da matriz no SUAP, como referência para curadoria.",
    universo: "curso",
    avaliar_precisao: true,
    esperado: ordenar(cursos.map((curso) => `curso:${chave(curso)}`)),
    detalhes: detalhesOrdenados(
      cursos.map((curso) => [
        `curso:${chave(curso)}`,
        {
          ppc: curso.ppc?.markdown_path ?? null,
          ppc_ano: curso.ppc?.ano_documento ?? null,
          suap_ch_comum_h: curso.suap?.matrizes?.carga_horaria_comum_h ?? null,
          suap_situacao_matrizes: curso.suap?.matrizes?.situacao ?? null,
        },
      ]),
    ),
  };
}

/** Q02: PPCs convertidos que citam a Resolução CNE/CP nº 1/2021. */
function q02(fontes: Fontes): GabaritoConjunto {
  const achados = fontes.ppcs
    .map((ppc) => ({ ppc, trechos: citacoesCneCp1de2021(fontes.lerPpc(ppc.id)) }))
    .filter(({ trechos }) => trechos.length > 0);
  return {
    pergunta: "Q02",
    gerado_por: "scripts/avaliacao/gabaritos/citacoes.ts",
    criterio:
      "PPCs de base-conhecimento/institucional/ifpr/ppcs/ (todos os níveis) cujo texto casa com citacoesCneCp1de2021: Resolução CNE/CP nº 1/2021 por número e ano ou pela data de 5 de janeiro de 2021.",
    universo: "curso",
    avaliar_precisao: true,
    esperado: ordenar(achados.map(({ ppc }) => `curso:${ppc.id}`)),
    detalhes: detalhesOrdenados(achados.map(({ ppc, trechos }) => [`curso:${ppc.id}`, { nivel: ppc.nivel, trechos }])),
  };
}

function frontMatter(caminho: string): Record<string, unknown> {
  const texto = readFileSync(caminho, "utf-8");
  const fim = texto.indexOf("\n---", 3);
  if (!texto.startsWith("---") || fim < 0) return {};
  const dados = Bun.YAML.parse(texto.slice(3, fim));
  return typeof dados === "object" && dados !== null ? (dados as Record<string, unknown>) : {};
}

function listaTexto(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.map(String) : [];
}

/** Q04: normas da base publicadas a partir de 01/01/2025, com as relações do front matter. */
function q04(fontes: Fontes): GabaritoConjunto {
  const corte = "2025-01-01";
  const normas = fontes.normas.filter((norma) => norma.data_publicacao >= corte);
  return {
    pergunta: "Q04",
    gerado_por: ARQUIVO_GERADOR,
    criterio: `Entradas de base-conhecimento/manifest.json com data_publicacao >= ${corte}. A precisão não é avaliada: a resposta correta também cita as normas afetadas (revogadas ou alteradas).`,
    universo: "norma",
    avaliar_precisao: false,
    esperado: ordenar(normas.map(idNorma)),
    detalhes: detalhesOrdenados(
      normas.map((norma) => {
        const fm = frontMatter(path.join(fontes.raiz, "base-conhecimento", norma.path));
        return [
          idNorma(norma),
          {
            titulo: norma.title,
            data_publicacao: norma.data_publicacao,
            status_vigencia: norma.status_vigencia,
            revoga: listaTexto(fm.revoga),
            altera: listaTexto(fm.altera),
          },
        ];
      }),
    ),
  };
}

/** Q05: PPCs de Técnico em Agropecuária e se têm seção própria de acompanhamento de egressos. */
function q05(fontes: Fontes): GabaritoConjunto {
  const ppcs = fontes.ppcs.filter((ppc) => cnctDoCurso(ppc.curso_nome, fontes.cnct)?.id === "tecnico-em-agropecuaria");
  return {
    pergunta: "Q05",
    gerado_por: ARQUIVO_GERADOR,
    criterio:
      "PPCs do índice cujo curso casa com a habilitação 'Técnico em Agropecuária' do CNCT. Detalhes: títulos de seção que tratam de acompanhamento de egresso.",
    universo: "curso",
    avaliar_precisao: true,
    esperado: ordenar(ppcs.map((ppc) => `curso:${ppc.id}`)),
    detalhes: detalhesOrdenados(
      ppcs.map((ppc) => {
        const secoes = fontes
          .lerPpc(ppc.id)
          .split("\n")
          .filter((linha) => linha.startsWith("#") && /acompanhamento\s+d[oe]s?\s+egress/u.test(normalizarTexto(linha)))
          .map((linha) => linha.replace(/^#+\s*/u, "").trim());
        return [`curso:${ppc.id}`, { tipo_oferta: ppc.tipo_oferta, secoes_acompanhamento_egresso: secoes }];
      }),
    ),
  };
}

/** Q08: campi com oferta de curso técnico do eixo Informação e Comunicação no Processo Seletivo 2026. */
function q08(fontes: Fontes): GabaritoConjunto {
  const cursoPorChave = new Map(fontes.dados.cursos.map((curso) => [chave(curso), curso]));
  const turnos = new Map<string, Array<{ curso: string; turno: string; tipo_oferta: string }>>();
  for (const oferta of fontes.dados.ofertas) {
    if (!oferta.processos.includes("processo-seletivo-2026")) continue;
    for (const chaveCurso of oferta.cursos ?? []) {
      const curso = cursoPorChave.get(chaveCurso);
      if (!curso || cnctDoCurso(curso.nome, fontes.cnct)?.eixo_tecnologico !== "Informação e Comunicação") continue;
      const campus = `campus:${curso.campus_id}`;
      const lista = turnos.get(campus) ?? [];
      lista.push({ curso: `curso:${chaveCurso}`, turno: oferta.turno ?? "", tipo_oferta: oferta.tipo_oferta });
      turnos.set(campus, lista);
    }
  }
  return {
    pergunta: "Q08",
    gerado_por: ARQUIVO_GERADOR,
    criterio:
      "Campi das ofertas de dados/institucional/ofertas/processo-seletivo-2026/ cujo curso casa, pelo nome, com habilitação do eixo 'Informação e Comunicação' do CNCT. Detalhes: curso, turno (grafia do edital) e tipo de oferta.",
    universo: "campus",
    avaliar_precisao: true,
    esperado: ordenar(turnos.keys()),
    detalhes: detalhesOrdenados(
      [...turnos.entries()].map(([campus, lista]) => [
        campus,
        lista.sort((a, b) => compararTexto(`${a.curso} ${a.turno}`, `${b.curso} ${b.turno}`)),
      ]),
    ),
  };
}

/** Q12: cursos técnicos de nível médio autorizados e em oferta (alcance do art. 71). */
function q12(fontes: Fontes): GabaritoConjunto {
  const tecnicos = fontes.dados.cursos.filter((curso) => curso.nivel === "médio");
  const emOferta = tecnicos.filter((curso) => SITUACOES_EM_OFERTA.has(curso.situacao ?? ""));
  const fora = tecnicos.filter((curso) => !SITUACOES_EM_OFERTA.has(curso.situacao ?? ""));
  const porForma = new Map<string, number>();
  for (const curso of emOferta) {
    const forma = curso.forma_oferta ?? "(sem forma)";
    porForma.set(forma, (porForma.get(forma) ?? 0) + 1);
  }
  return {
    pergunta: "Q12",
    gerado_por: ARQUIVO_GERADOR,
    criterio:
      "Cursos de dados/institucional/ com nivel=médio e situação ativo ou em_oferta. Ficam fora os cursos em abertura (art. 70), suspensos e com situação incerta, listados em detalhes.",
    universo: "curso",
    avaliar_precisao: true,
    esperado: ordenar(emOferta.map((curso) => `curso:${chave(curso)}`)),
    detalhes: {
      total: emOferta.length,
      por_forma_oferta: detalhesOrdenados(porForma.entries()),
      fora_do_conjunto: detalhesOrdenados(fora.map((curso) => [`curso:${chave(curso)}`, curso.situacao ?? null])),
    },
  };
}

/** Q13: cursos técnicos subsequentes em oferta no campus Curitiba. */
function q13(fontes: Fontes): GabaritoConjunto {
  const cursos = fontes.dados.cursos.filter(
    (curso) =>
      curso.campus_id === "curitiba" &&
      curso.nivel === "médio" &&
      curso.forma_oferta === "subsequente" &&
      SITUACOES_EM_OFERTA.has(curso.situacao ?? ""),
  );
  return {
    pergunta: "Q13",
    gerado_por: ARQUIVO_GERADOR,
    criterio:
      "Cursos de dados/institucional/cursos/curitiba/ com nivel=médio, forma_oferta=subsequente e situação ativo/em_oferta.",
    universo: "curso",
    avaliar_precisao: true,
    esperado: ordenar(cursos.map((curso) => `curso:${chave(curso)}`)),
    detalhes: detalhesOrdenados(
      cursos.map((curso) => [`curso:${chave(curso)}`, { nome: curso.nome, modalidade: curso.modalidade ?? null }]),
    ),
  };
}

/** Q20: PPCs técnicos que já citam a Resolução CNE/CP nº 2/2026 (esperado: nenhum). */
function q20(fontes: Fontes): GabaritoConjunto {
  const achados = fontes.ppcs
    .filter((ppc) => ppc.nivel === "médio")
    .map((ppc) => ({ ppc, trechos: citacoesCneCp2de2026(fontes.lerPpc(ppc.id)) }))
    .filter(({ trechos }) => trechos.length > 0);
  return {
    pergunta: "Q20",
    gerado_por: "scripts/avaliacao/gabaritos/citacoes.ts",
    criterio:
      "PPCs técnicos (nivel=médio) cujo texto casa com citacoesCneCp2de2026. A resolução é de 11/11/2026, posterior a todos os PPCs convertidos.",
    universo: "curso",
    avaliar_precisao: true,
    esperado: ordenar(achados.map(({ ppc }) => `curso:${ppc.id}`)),
    detalhes: detalhesOrdenados(achados.map(({ ppc, trechos }) => [`curso:${ppc.id}`, { trechos }])),
  };
}

export const GERADORES: Readonly<Record<string, Gerador>> = {
  "q01-integrados-informatica.json": q01,
  "q02-ppcs-citam-cne-cp-1-2021.json": q02,
  "q04-normas-desde-2025.json": q04,
  "q05-ppcs-agropecuaria.json": q05,
  "q08-campi-eixo-informacao-comunicacao.json": q08,
  "q12-tecnicos-em-oferta.json": q12,
  "q13-curitiba-subsequentes.json": q13,
  "q20-ppcs-citam-cne-cp-2-2026.json": q20,
};

export const ARQUIVO_UNIVERSOS = "universos.json";
