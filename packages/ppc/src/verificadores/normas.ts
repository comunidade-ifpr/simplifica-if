/**
 * Verificadores D da fundamentação normativa, sobre as citações resolvidas pelo registro do kb
 * (`extrairCitacoes`) e as relações de revogação (`relacoes.yaml`):
 *
 * - CT-SUP-12: normas revogadas citadas em qualquer ponto (a ficha responsável pela vigência);
 * - CT-IDENT-08: normas revogadas nas seções de identidade, e a DCN da EPT (e a DCNEM no integrado) citadas;
 * - CT-SUP-09: os marcos centrais vigentes na seção de referências, e as normas citadas no texto que
 *   faltam nela;
 * - CT-SUP-14: CNCT e marcos institucionais (PDI, PPI, Regimento) referenciados;
 * - CT-SUP-21: a legislação profissional que o CNCT indica;
 * - CT-SUP-24: a Política de Assistência Estudantil (Res. CONSUP/IFPR nº 239/2025) e as revogadas por ela.
 */
import { extrairCitacoes } from "@simplifica-if/kb/normas/resolver";
import {
  type Apontamento,
  apontamentoRevogada,
  type BaseVerificacao,
  chave,
  citacaoSegura,
  citacoesPorAto,
  linkCnct,
  linkNorma,
  linhasDasSecoes,
  normasRevogadasCitadas,
  type PpcPreparado,
  resultado,
  tituloDaNorma,
  type Trecho,
  trecho,
  type Verificador,
} from "./comum.ts";
import { MARCOS, marcoDa } from "./vigencia.ts";

const DCNEM = "br/cne-ceb/res/2024/2";
const LDB = "br/lei/1996/9394";
const LEI_14945 = "br/lei/2024/14945";
const PAE = "ifpr/consup/res/2025/239";
const PAE_REVOGADAS = ["ifpr/consup/res/2009/11", "ifpr/consup/res/2011/53"];

const titulo = (base: BaseVerificacao, id: string) => tituloDaNorma(base.registro, id);

/** Primeira citação segura (ou a primeira) de cada ato citado. */
function primeiraCitacao(ppc: PpcPreparado, id: string, linhas?: ReadonlySet<number>) {
  const lista = (citacoesPorAto(ppc.citacoes).get(id) ?? []).filter((c) => !linhas || linhas.has(c.linha));
  return lista.find(citacaoSegura) ?? lista[0];
}

/**
 * A norma de um marco em vigor: a mais recente da linha já vigente. A que aguarda publicação (a Res.
 * CNE/CP nº 2/2026) ainda não conta, mas citá-la junto com a vigente, ou no lugar dela, não falta.
 */
function vigenteDoMarco(base: BaseVerificacao, marco: string): { id: string; aceitas: string[] } {
  const linha = MARCOS.find((m) => m.id === marco)!.linha;
  const id = [...linha].reverse().find((n) => base.vigencia(n).status !== "ainda-nao-vigente") ?? linha.at(-1)!;
  return { id, aceitas: linha.slice(linha.indexOf(id)) };
}

/** Primeira citação da norma em vigor do marco, ou de uma mais recente da linha. */
function citacaoDoMarco(ppc: PpcPreparado, aceitas: readonly string[], linhas?: ReadonlySet<number>) {
  for (const id of aceitas) {
    const citacao = primeiraCitacao(ppc, id, linhas);
    if (citacao) return citacao;
  }
  return undefined;
}

const evidenciaDe = (ppc: PpcPreparado, citacao: { linha: number; trecho: string } | undefined): Trecho[] =>
  citacao ? [trecho(ppc, citacao.linha, citacao.trecho)] : [];

/**
 * A norma vigente de um marco (DCN da EPT, DCNEM) não é citada. Só a ficha responsável pelo marco
 * eleva a `nao_atende`.
 */
function ausenciaDoMarco(base: BaseVerificacao, id: string, ficha: string, mensagem: string): Apontamento {
  const marco = marcoDa(id, base.relacoes);
  const responsavel = marco?.responsavel ?? "CT-SUP-12";
  return responsavel === ficha
    ? { estado: "nao_atende", mensagem, trechos: [], fontes: [linkNorma(id)] }
    : {
        estado: "a_conferir",
        mensagem: `${mensagem} Registrado aqui; a pendência é da ${responsavel}.`,
        trechos: [],
        fontes: [linkNorma(id)],
      };
}

/** Os marcos em palavras de quem edita o PPC. */
const NOME_DO_MARCO: Record<string, string> = {
  dcn_ept: "as Diretrizes Curriculares Nacionais da educação profissional técnica mais recentes",
  dcnem: "as Diretrizes Curriculares Nacionais do ensino médio mais recentes",
};

/* ------------------------------------------------------------------ CT-SUP-12 */

export const normasRevogadas: Verificador = {
  id: "d-normas-revogadas",
  ficha: "CT-SUP-12",
  descricao:
    "Normas citadas em qualquer ponto do PPC com `status_vigencia: revogada` no registro. Pendência só sem transição em curso, sem nenhuma sucessora da cadeia citada, fora de seção de histórico e quando a norma não é de marco de outra ficha (a 11/2009 é da CT-SUP-24); senão, a conferir. E a norma vigente dos marcos (DCN da EPT; no integrado, DCNEM) não citada, quando nenhuma norma da linha é citada: a vigente é a mais recente já em vigor (a que aguarda publicação, como a Res. CNE/CP nº 2/2026, ainda não conta).",
  verificar(ppc, base) {
    const revogadas = normasRevogadasCitadas(ppc.citacoes, ppc.citacoes, base);
    const apontamentos = revogadas.map((norma) => apontamentoRevogada(ppc, base, norma, this.ficha));
    // Marcos da forma de oferta: a vigente não citada, quando nenhuma anterior da linha é citada
    // (citada a anterior, o apontamento da revogada já trata o caso).
    const citadas = citacoesPorAto(ppc.citacoes);
    for (const marco of MARCOS.filter((m) => m.id === "dcn_ept" || (m.id === "dcnem" && base.forma === "integrado"))) {
      // a mais recente já em vigor: a que aguarda publicação ainda não é a norma do marco
      const vigente = vigenteDoMarco(base, marco.id).id;
      if (marco.linha.some((n) => citadas.has(n))) continue;
      apontamentos.push(
        ausenciaDoMarco(
          base,
          vigente,
          this.ficha,
          `O PPC não cita ${titulo(base, vigente)}, ${NOME_DO_MARCO[marco.id] ?? "a norma mais recente desta matéria"}.`,
        ),
      );
    }
    return resultado(this, apontamentos, {
      estado: "atende",
      mensagem: `Nenhuma norma revogada entre as ${citacoesPorAto(ppc.citacoes).size} normas citadas reconhecidas, e os marcos vigentes são citados.`,
    });
  },
};

/* ------------------------------------------------------------------ CT-IDENT-08 */

/** Seções de identidade do curso (taxonomia `tecnico` do kb). */
const SECOES_IDENTIDADE = new Set([
  "identificacao",
  "justificativa",
  "objetivos",
  "concepcao_pedagogica",
  "perfil_egresso",
  "legislacao",
  "mundo_trabalho",
  "formato_oferta",
]);

export const baseLegalIdentidade: Verificador = {
  id: "d-base-legal-identidade",
  ficha: "CT-IDENT-08",
  descricao:
    "Nas seções de identidade (identificação, justificativa, objetivos, concepção, perfil, legislação), as normas revogadas citadas; e, em todo o PPC, a DCN da EPT vigente (a Res. CNE/CP nº 1/2021, enquanto a nº 2/2026 aguarda publicação; citar a mais recente também vale) e, no integrado, a DCNEM (Res. CNE/CEB nº 2/2024) citadas. É ficha de base legal dos marcos: registra os fatos como a conferir, e a pendência fica com a ficha responsável (CT-SUP-12).",
  verificar(ppc, base) {
    const linhas = new Set(linhasDasSecoes(ppc, SECOES_IDENTIDADE));
    const naIdentidade = ppc.citacoes.filter((c) => linhas.has(c.linha));
    const apontamentos: Apontamento[] = normasRevogadasCitadas(naIdentidade, ppc.citacoes, base).map((norma) =>
      apontamentoRevogada(ppc, base, norma, this.ficha),
    );
    const dcnEpt = vigenteDoMarco(base, "dcn_ept");
    const exigidas = base.forma === "integrado" ? [dcnEpt.id, DCNEM] : [dcnEpt.id];
    const evidencias: Trecho[] = [];
    for (const id of exigidas) {
      const citacao = id === dcnEpt.id ? citacaoDoMarco(ppc, dcnEpt.aceitas) : primeiraCitacao(ppc, id);
      if (citacao) evidencias.push(...evidenciaDe(ppc, citacao));
      else
        apontamentos.push(
          ausenciaDoMarco(
            base,
            id,
            this.ficha,
            `O PPC não cita ${titulo(base, id)}, ${id === dcnEpt.id ? NOME_DO_MARCO["dcn_ept"] : NOME_DO_MARCO["dcnem"]}.`,
          ),
        );
    }
    if (!linhas.size)
      apontamentos.push({
        estado: "a_conferir",
        mensagem: "Não reconhecemos as seções de identidade do curso; confira a fundamentação legal nelas.",
        trechos: [],
        fontes: [],
      });
    return resultado(this, apontamentos, {
      estado: "atende",
      mensagem: "A fundamentação cita as diretrizes vigentes, e as seções de identidade não citam norma revogada.",
      evidencias,
      fontes: exigidas.map(linkNorma),
    });
  },
};

/* ------------------------------------------------------------------ CT-SUP-09 */

export const marcosNasReferencias: Verificador = {
  id: "d-marcos-nas-referencias",
  ficha: "CT-SUP-09",
  descricao:
    "Na seção de referências, a DCN da EPT vigente (a Res. CNE/CP nº 1/2021, enquanto a nº 2/2026 aguarda publicação; a mais recente também vale) e, no integrado, a DCNEM (Res. CNE/CEB nº 2/2024), a LDB e a Lei nº 14.945/2024. Ausente em todo o PPC é pendência para a LDB; as DCN são marcos de CT-SUP-12 (aqui, a conferir) e a Lei nº 14.945/2024, “quando pertinente”, também fica a conferir; citada só fora das referências, a conferir. As demais normas citadas com segurança no texto e ausentes das referências vão num apontamento só, a conferir. As normas revogadas ficam com CT-SUP-12.",
  verificar(ppc, base) {
    const linhas = new Set(linhasDasSecoes(ppc, new Set(["referencias"])));
    const dcnEpt = vigenteDoMarco(base, "dcn_ept");
    const exigidas = base.forma === "integrado" ? [dcnEpt.id, DCNEM, LDB, LEI_14945] : [dcnEpt.id];
    const fontes = exigidas.map(linkNorma);
    if (!linhas.size)
      return resultado(
        this,
        [
          {
            estado: "a_conferir",
            mensagem: "Não encontramos a seção de referências; confira se ela existe e cita os marcos vigentes.",
            trechos: [],
            fontes,
          },
        ],
        { estado: "a_conferir", mensagem: "" },
      );
    const apontamentos: Apontamento[] = [];
    const evidencias: Trecho[] = [];
    for (const id of exigidas) {
      const aceitas = id === dcnEpt.id ? dcnEpt.aceitas : [id];
      const nasReferencias = citacaoDoMarco(ppc, aceitas, linhas);
      if (nasReferencias) {
        evidencias.push(...evidenciaDe(ppc, nasReferencias));
        continue;
      }
      const noTexto = citacaoDoMarco(ppc, aceitas);
      apontamentos.push(
        noTexto
          ? {
              estado: "a_conferir",
              mensagem: `${titulo(base, id)} é citada no texto, mas não aparece na seção de referências.`,
              trechos: evidenciaDe(ppc, noTexto),
              fontes: [linkNorma(id)],
            }
          : id === dcnEpt.id || id === DCNEM
            ? ausenciaDoMarco(base, id, this.ficha, `A seção de referências não traz ${titulo(base, id)}.`)
            : {
                estado: id === LEI_14945 ? "a_conferir" : "nao_atende",
                mensagem: `A seção de referências não traz ${titulo(base, id)}${id === LEI_14945 ? ", que alterou a LDB no ensino médio; confira se é pertinente" : ""}.`,
                trechos: [],
                fontes: [linkNorma(id)],
              },
      );
    }
    const faltantes = normasForaDasReferencias(ppc, base, linhas, new Set([...exigidas, ...dcnEpt.aceitas]));
    if (faltantes) apontamentos.push(faltantes);
    return resultado(this, apontamentos, {
      estado: "atende",
      mensagem: "A seção de referências traz os marcos vigentes da forma de oferta.",
      evidencias,
      fontes,
    });
  },
};

/** Quantas normas a mensagem nomeia; as demais entram na contagem. */
const NORMAS_NA_MENSAGEM = 6;

/** Normas superadas num marco (todas da linha, menos a última): citá-las é com CT-SUP-12, não aqui. */
const SUPERADAS_EM_MARCO = new Set(MARCOS.flatMap((m) => m.linha.slice(0, -1)));

/**
 * As normas da base citadas com segurança fora da seção de referências e ausentes dela (nem com
 * citação incerta), sem as externas (ABNT), as fora do registro, as revogadas e as superadas num
 * marco (CT-SUP-12) e as que o verificador já cobre: um apontamento `a_conferir`, porque a citação
 * pode ser só de passagem.
 */
function normasForaDasReferencias(
  ppc: PpcPreparado,
  base: BaseVerificacao,
  linhas: ReadonlySet<number>,
  jaCobertas: ReadonlySet<string>,
): Apontamento | null {
  const faltantes: { id: string; linha: number; trecho: string }[] = [];
  for (const [id, lista] of citacoesPorAto(ppc.citacoes)) {
    if (jaCobertas.has(id) || lista.some((c) => linhas.has(c.linha))) continue;
    const situacao = base.registro.obter(id)?.situacao;
    if (situacao === undefined || situacao === "externo" || SUPERADAS_EM_MARCO.has(id)) continue;
    if (base.vigencia(id).status === "revogada") continue;
    const segura = lista.find(citacaoSegura);
    if (segura) faltantes.push({ id, linha: segura.linha, trecho: segura.trecho });
  }
  if (!faltantes.length) return null;
  const nomes = faltantes.slice(0, NORMAS_NA_MENSAGEM).map((f) => titulo(base, f.id));
  const resto = faltantes.length - nomes.length;
  return {
    estado: "a_conferir",
    mensagem:
      `${faltantes.length === 1 ? "Norma citada" : "Normas citadas"} no texto sem entrada na seção de referências: ` +
      `${nomes.join("; ")}${resto > 0 ? ` e mais ${resto}` : ""}. Inclua nas referências as normas que fundamentam o curso.`,
    trechos: faltantes.slice(0, 3).map((f) => trecho(ppc, f.linha, f.trecho)),
    fontes: faltantes.slice(0, NORMAS_NA_MENSAGEM).map((f) => linkNorma(f.id)),
  };
}

/* ------------------------------------------------------------------ CT-SUP-14 */

/** Sobre o texto sem acento e sem negrito (`chave`): "Catálogo Nacional dos Cursos Técnicos" também vale. */
const RE_CNCT = /catalogo\s*nacional\s*d[eo]s?\s*cursos\s*tecnicos|\bcnct\b/;
const RE_INSTITUCIONAL =
  /plano de desenvolvimento institucional|\bpdi\b|projeto (politico[- ])?pedagogico institucional|\bppi\b|regimento geral|estatuto do (ifpr|instituto federal)/;

function primeiraLinha(ppc: PpcPreparado, padrao: RegExp): Trecho | null {
  for (const [indice, linha] of ppc.linhas.entries())
    if (padrao.test(chave(linha.replace(/\*/g, "")))) return trecho(ppc, indice + 1);
  return null;
}

export const marcosInstitucionais: Verificador = {
  id: "d-cnct-e-marcos-institucionais",
  ficha: "CT-SUP-14",
  descricao:
    "O CNCT e ao menos um marco institucional do IFPR (PDI, PPI, Regimento Geral ou Estatuto) mencionados no PPC. As DCN ficam com CT-SUP-09 e a legislação profissional com CT-SUP-21.",
  verificar(ppc, base) {
    const fontes = base.cnct ? [linkCnct(base.cnct.slug)] : [];
    const apontamentos: Apontamento[] = [];
    const evidencias: Trecho[] = [];
    const cnct = primeiraLinha(ppc, RE_CNCT);
    if (cnct) evidencias.push(cnct);
    else
      apontamentos.push({
        estado: "nao_atende",
        mensagem: "O PPC não menciona o Catálogo Nacional de Cursos Técnicos (CNCT).",
        trechos: [],
        fontes,
      });
    const institucional = primeiraLinha(ppc, RE_INSTITUCIONAL);
    // A rubrica aceita "norma institucional equivalente": citar resoluções do CONSUP deixa a conferir.
    const consup = ppc.citacoes.find((c) => c.id?.startsWith("ifpr/consup/") && citacaoSegura(c));
    if (institucional) evidencias.push(institucional);
    else
      apontamentos.push(
        consup
          ? {
              estado: "a_conferir",
              mensagem:
                "O PPC cita normas do IFPR, mas não menciona o PDI, o PPI, o Regimento Geral nem o Estatuto. Confira se os marcos institucionais estão referenciados.",
              trechos: [trecho(ppc, consup.linha, consup.trecho)],
              fontes: [],
            }
          : {
              estado: "nao_atende",
              mensagem: "O PPC não menciona os marcos institucionais do IFPR (PDI, PPI, Regimento Geral ou Estatuto).",
              trechos: [],
              fontes: [],
            },
      );
    return resultado(this, apontamentos, {
      estado: "atende",
      mensagem: "O PPC menciona o CNCT e os marcos institucionais do IFPR.",
      evidencias,
      fontes,
    });
  },
};

/* ------------------------------------------------------------------ CT-SUP-21 */

/** Conselho de fiscalização profissional (sobre o texto sem acento, em minúsculas). */
const RE_CONSELHO =
  /conselho (regional|federal)|sistema confea|\b(cft|crt|cra|crea|confea|coren|cofen|crq|cfq|crf|cff|crmv|cfmv|crbio|cro|cfo|crn|cfn|crtr|conter|cref|confef)\b/;

export const legislacaoProfissional: Verificador = {
  id: "d-legislacao-profissional",
  ficha: "CT-SUP-21",
  descricao:
    "Os atos da legislação profissional do CNCT (campo `legislacao_profissional`, resolvidos pelo registro) contra as citações do PPC: nenhum citado é pendência; citar parte basta (a ficha pede tratamento reconhecível). Sem legislação no CNCT, não se aplica; com legislação que o registro não resolve, a conferir.",
  verificar(ppc, base) {
    const { cnct } = base;
    if (!cnct)
      return resultado(
        this,
        [{ estado: "a_conferir", mensagem: "O curso não foi identificado no CNCT.", trechos: [], fontes: [] }],
        { estado: "a_conferir", mensagem: "" },
      );
    const fontes = [linkCnct(cnct.slug)];
    const legislacao = (cnct.legislacao_profissional ?? "").split("\n").filter((item) => item.trim());
    if (!legislacao.length)
      return resultado(this, [], {
        estado: "nao_se_aplica",
        mensagem: "O CNCT não indica legislação profissional para o curso.",
        fontes,
      });
    const ids = new Set(
      legislacao.flatMap((item) =>
        extrairCitacoes(item, base.registro)
          .map((c) => c.id)
          .filter((id): id is string => id !== null),
      ),
    );
    if (!ids.size)
      return resultado(
        this,
        [
          {
            estado: "a_conferir",
            mensagem: `Não conseguimos identificar na base a legislação profissional que o CNCT indica (${legislacao.join("; ")}); confira se o PPC a trata.`,
            trechos: [],
            fontes,
          },
        ],
        { estado: "a_conferir", mensagem: "" },
      );
    const citadas = ppc.citacoes.filter((c) => c.id !== null && ids.has(c.id));
    if (!citadas.length) {
      // Sem a lei, mas com o conselho profissional e as atribuições: pode ser "incorporar" a legislação
      // (a rubrica aceita), e na base 5 de 6 casos eram assim. Fica a conferir.
      const conselho = primeiraLinha(ppc, RE_CONSELHO);
      return resultado(
        this,
        [
          conselho
            ? {
                estado: "a_conferir",
                mensagem: `O PPC menciona o conselho profissional, mas não cita a legislação profissional que o CNCT indica: ${legislacao.join("; ")}. Confira se ela é tratada de modo reconhecível.`,
                trechos: [conselho],
                fontes,
              }
            : {
                estado: "nao_atende",
                mensagem: `O PPC não cita a legislação profissional que o CNCT indica para o curso: ${legislacao.join("; ")}.`,
                trechos: [],
                fontes,
              },
        ],
        { estado: "a_conferir", mensagem: "" },
      );
    }
    return resultado(this, [], {
      estado: "atende",
      mensagem: `O PPC cita ${new Set(citadas.map((c) => c.id)).size} dos ${ids.size} atos de legislação profissional do CNCT.`,
      evidencias: citadas.slice(0, 3).map((c) => trecho(ppc, c.linha, c.trecho)),
      fontes,
    });
  },
};

/* ------------------------------------------------------------------ CT-SUP-24 */

export const politicaAssistenciaEstudantil: Verificador = {
  id: "d-politica-assistencia-estudantil",
  ficha: "CT-SUP-24",
  descricao:
    "A Res. CONSUP/IFPR nº 239/2025 (Política de Assistência Estudantil) citada, e as Res. nº 11/2009 e nº 53/2011, revogadas por ela: só as antigas é pendência; as duas juntas ou nenhuma, a conferir; só a 239/2025, atende.",
  verificar(ppc, base) {
    const fontes = [linkNorma(PAE)];
    const atual = primeiraCitacao(ppc, PAE);
    const antigas = PAE_REVOGADAS.map((id) => ({ id, citacao: primeiraCitacao(ppc, id) })).filter((a) => a.citacao);
    const trechosAntigas = antigas.flatMap((a) => evidenciaDe(ppc, a.citacao));
    const nomesAntigas = antigas.map((a) => titulo(base, a.id)).join(" e ");
    const revogadas = antigas.length === 1 ? "revogada" : "revogadas";
    if (atual && !antigas.length)
      return resultado(this, [], {
        estado: "atende",
        mensagem: `O PPC cita ${titulo(base, PAE)}, a Política de Assistência Estudantil vigente.`,
        evidencias: evidenciaDe(ppc, atual),
        fontes,
      });
    const apontamento: Apontamento = atual
      ? {
          estado: "a_conferir",
          mensagem: `O PPC cita ${titulo(base, PAE)} e também ${nomesAntigas}, ${revogadas} por ela. Confira se a citação antiga é só histórica.`,
          trechos: [...evidenciaDe(ppc, atual), ...trechosAntigas],
          fontes,
        }
      : antigas.length && antigas.every((a) => citacaoSegura(a.citacao!))
        ? {
            estado: "nao_atende",
            mensagem: `O PPC cita ${nomesAntigas}, ${revogadas} pela ${titulo(base, PAE)}, sem citar a política vigente.`,
            trechos: trechosAntigas,
            fontes: [...antigas.map((a) => linkNorma(a.id)), ...fontes],
          }
        : {
            estado: "a_conferir",
            mensagem: antigas.length
              ? `O PPC parece citar ${nomesAntigas}, ${revogadas} pela ${titulo(base, PAE)}; confira a citação.`
              : `O PPC não cita ${titulo(base, PAE)}, a Política de Assistência Estudantil vigente; confira a seção de atendimento ao estudante.`,
            trechos: trechosAntigas,
            fontes,
          };
    return resultado(this, [apontamento], { estado: "a_conferir", mensagem: "" });
  },
};
