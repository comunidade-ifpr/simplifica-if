/**
 * Peças comuns do serviço `Leitura`: a conversão das estruturas do kb para os contratos
 * (`NormaResumo`, `Relacao`, `DispositivoTexto`, transição, fatos de PPC), os avisos repetidos e a
 * leitura dos IDs de PPC e de curso escritos pela IA. Nenhuma regra normativa: só formato.
 */
import type { FatosDoPpc } from "@simplifica-if/kb/Ppcs";
import type { TrechoDispositivo } from "@simplifica-if/kb/Normas";
import type * as Sql from "@simplifica-if/kb/db/sql";
import * as Normas from "@simplifica-if/kb/Normas";
import type { Relacao as RelacaoKb } from "@simplifica-if/kb/normas/relacoes";
import type { SituacaoTransicao } from "@simplifica-if/kb/normas/vigencia";
import { REGRAS_BAIXA_CONFIANCA } from "@simplifica-if/kb/ppcs/citacoes";
import { RE_VERSAO_PPC } from "@simplifica-if/kb/ppcs/ids";
import * as Effect from "effect/Effect";
import {
  type Aviso,
  type DispositivoTexto,
  EntradaInvalida,
  type FatosPpc,
  type Fonte,
  type NormaResumo,
  type Relacao,
  type TransicaoResumo,
} from "../contratos.ts";
import { lerLink, linkNorma, linkPpc } from "../links.ts";

/* ================================================================== normas */

export function resumoDaNorma(norma: Normas.FichaNorma): NormaResumo {
  return {
    id: norma.id,
    titulo: norma.titulo,
    situacao: norma.situacao,
    status_vigencia: norma.status_vigencia,
    assinada_em: norma.assinada_em,
    publicada_em: norma.publicada_em,
    ementa: norma.ementa,
    link: linkNorma(norma.id),
  };
}

export function relacaoSaida(r: RelacaoKb): Relacao {
  return {
    tipo: r.tipo,
    origem: r.origem,
    operador: r.operador ?? null,
    alvo: r.alvo,
    alvo_dispositivo: r.alvo_dispositivo ?? null,
    alcance: r.alcance ?? null,
    efeito_de: r.efeito_de,
    evidencia: { em: r.evidencia.em, trecho: r.evidencia.trecho },
    confirmado_em: r.confirmado_em ?? null,
    nota: r.nota ?? null,
  };
}

/** `Normas.ficha` com cache por chamada (várias respostas citam a mesma norma). */
export function leitorDeNormas(
  normas: Normas.Normas["Service"],
): (id: string) => Effect.Effect<Normas.FichaNorma | null, Sql.FalhaNaConsulta> {
  const cache = new Map<string, Normas.FichaNorma | null>();
  return (id) =>
    cache.has(id)
      ? Effect.succeed(cache.get(id)!)
      : Effect.tap(normas.ficha(id), (ficha) => Effect.sync(() => cache.set(id, ficha)));
}

/**
 * `DispositivoTexto` a partir do trecho do kb. Os rótulos dos subordinados (que o trecho não traz)
 * vêm dos descendentes do mesmo arquivo.
 */
export const dispositivoTexto = Effect.fn("Leitura.dispositivoTexto")(function* (
  normas: Normas.Normas["Service"],
  trecho: TrechoDispositivo,
) {
  const rotulos = new Map<string, string>();
  if (trecho.subordinados.length > 0) {
    for (const d of yield* normas.descendentes(trecho.id)) rotulos.set(d.disp.id, d.disp.rotulo);
  }
  const dispositivo: DispositivoTexto = {
    id: trecho.id,
    rotulo: trecho.rotulo,
    tipo: trecho.tipo,
    caput: trecho.caput,
    estrutura: trecho.estrutura,
    texto: trecho.texto,
    subordinados: trecho.subordinados.map((s) => ({ id: s.id, rotulo: rotulos.get(s.id) ?? "", texto: s.texto })),
    revogado: trecho.revogado,
    vetado: trecho.vetado,
    fonte: { path: trecho.path, linha_inicio: trecho.linha_inicio, linha_fim: trecho.linha_fim },
    link: linkNorma(trecho.id),
  };
  return dispositivo;
});

/** Avisos de norma ainda não vigente e de norma sem texto, um por norma, na ordem em que aparecem. */
export function avisosDasNormas(normas: Iterable<NormaResumo>): Aviso[] {
  const vistas = new Set<string>();
  const avisos: Aviso[] = [];
  for (const n of normas) {
    if (vistas.has(n.id)) continue;
    vistas.add(n.id);
    avisos.push(...avisoVigencia(n));
    if (n.situacao !== "base") {
      avisos.push({
        tipo: "stub-sem-texto",
        mensagem: `${n.titulo} não tem texto na base (${n.situacao === "stub" ? "só a identificação" : "referência externa"}): não afirme o conteúdo dela`,
        ref: n.id,
      });
    }
  }
  return avisos;
}

/** A norma pedida pela IA; ID desconhecido é erro de entrada, com a dica de onde achar o ID. */
export const normaPedida = Effect.fn("Leitura.normaPedida")(function* (normas: Normas.Normas["Service"], id: string) {
  const norma = yield* normas.ficha(id);
  if (!norma) {
    return yield* new EntradaInvalida({
      mensagem: `norma não encontrada na base: "${id}". Use o ID canônico (como "br/cne-cp/res/2021/1"), vindo de buscar_norma ou de resolver_citacoes`,
    });
  }
  return resumoDaNorma(norma);
});

/** Norma da base que ainda não está em vigor (aguardando publicação, ou com vigência futura). */
export function avisoVigencia(norma: NormaResumo): Aviso[] {
  return norma.situacao === "base" && norma.status_vigencia === "ainda-nao-vigente"
    ? [
        {
          tipo: "ainda-nao-vigente",
          mensagem: `${norma.titulo} ainda não está em vigor (aguarda publicação ou vigência futura; veja ficha_norma): diga isso ao usuário e não a trate como vigente`,
          ref: norma.id,
        },
      ]
    : [];
}

export function transicaoResumo(t: SituacaoTransicao): TransicaoResumo {
  return { id: t.id, regra: t.regra, situacao_na_data: t.situacao, link: linkNorma(t.norma, t.dispositivo.slice(1)) };
}

/* ================================================================== citações e fatos */

/** Aviso de citação de baixa confiança, se alguma das regras entregues estiver entre elas. */
export function avisoBaixaConfianca(regras: Iterable<string>): Aviso[] {
  const baixas = [...new Set([...regras].filter((r) => REGRAS_BAIXA_CONFIANCA.has(r)))].sort();
  if (baixas.length === 0) return [];
  return [
    {
      tipo: "citacao-baixa-confianca",
      mensagem: `há citações identificadas por regra de baixa confiança (${baixas.join(", ")}): confira o trecho no PPC antes de afirmar que ele cita a norma`,
    },
  ];
}

export const AVISO_FATO_EXTRAIDO: Aviso = {
  tipo: "fato-extraido",
  mensagem:
    "os fatos de PPC com status `extraido` foram extraídos por regra, sem revisão humana, e o `ano_documento` (`evidencia-conferida`) tem só a evidência conferida por regra: confira o trecho de origem antes de afirmar um valor ou uma divergência; só o status `revisado` foi conferido por uma pessoa",
};

function fonteLinha(path: string, linha: number): Fonte {
  return { path, linha_inicio: linha, linha_fim: linha };
}

/** Os fatos do kb no formato da ferramenta. `suap` é `null` quando o PPC não tem curso ligado. */
export function paraFatosPpc(f: FatosDoPpc): FatosPpc {
  return {
    ppc: f.ppc,
    curso: f.curso,
    nome: f.nome,
    campus: f.campus,
    nivel: f.nivel,
    forma: f.forma,
    link: linkPpc(f.ppc),
    fatos: f.fatos.map((x) => ({
      fato: x.fato,
      valor: x.valor,
      valor_num: x.valor_num,
      unidade: x.unidade,
      status_curadoria: x.status_curadoria,
      revisor: x.revisor,
      revisado_em: x.revisado_em,
      regra: x.regra,
      trecho_fonte: x.trecho_fonte,
      fonte: fonteLinha(x.path, x.linha),
    })),
    suap:
      f.curso === null
        ? null
        : {
            codigo: f.suap.codigo,
            situacao: f.suap.situacao,
            carga_horaria_comum_h: f.suap.carga_horaria_comum_h,
            coletado_em: f.suap.coletado_em,
            matrizes: f.suap.matrizes.map((m) => ({
              matriz_id: m.matriz_id,
              descricao: m.descricao,
              ano: m.ano,
              ch_exibida_h: m.ch_exibida_h,
              estagio_exigido: m.estagio_exigido,
              ch_estagio_h: m.ch_estagio_h,
              url: m.url,
              trecho: m.trecho,
            })),
          },
    cruzamento: f.cruzamento.map((c) => ({ ...c })),
  };
}

/* ================================================================== IDs escritos pela IA */

const SEGMENTO = /^[A-Za-z0-9._~-]+$/;
const RE_VERSAO = new RegExp(`^${RE_VERSAO_PPC}$`);

const campusCurso = Effect.fn("Leitura.campusCurso")(function* (
  valor: string,
  prefixo: "ppc" | "curso",
  campo: string,
) {
  let id = valor.trim();
  const link = id.startsWith("ifpr://") ? lerLink(id) : null;
  if (link) {
    if (link.tipo !== "ppc" && link.tipo !== "curso") {
      return yield* new EntradaInvalida({
        mensagem: `${campo}: esperava um link ifpr://${prefixo}/campus/curso, veio "${valor}"`,
      });
    }
    id = link.caminho;
  } else {
    for (const p of ["ppc:", "curso:"]) if (id.startsWith(p)) id = id.slice(p.length);
  }
  const partes = id.split("/");
  const comVersao = prefixo === "ppc" && partes.length === 3;
  if (
    !(partes.length === 2 || comVersao) ||
    !partes.every((p) => SEGMENTO.test(p)) ||
    (comVersao && !RE_VERSAO.test(partes[2]!))
  ) {
    const esperado =
      prefixo === "ppc"
        ? `"campus/curso/versao" ou "campus/curso" (o vigente), como "curitiba/tecnico-em-enfermagem/2023"`
        : `"campus/curso" (como "curitiba/tecnico-em-enfermagem")`;
    return yield* new EntradaInvalida({ mensagem: `${campo}: esperava ${esperado}, veio "${valor}"` });
  }
  return id;
});

/**
 * PPC escrito pela IA (`campus/curso/versao`, `ppc:…` ou `ifpr://ppc/…`) → a chave. Sem a versão
 * (`campus/curso`), a chave do curso, que as consultas resolvem para o PPC vigente.
 */
export const chavePpc = (valor: string, campo = "ppc") => campusCurso(valor, "ppc", campo);

/** Curso escrito pela IA (`campus/curso`, `curso:campus/curso` ou `ifpr://curso/campus/curso`) → `campus/curso`. */
export const chaveCurso = (valor: string, campo = "curso") => campusCurso(valor, "curso", campo);

/** Um valor opcional passado por uma leitura que pode falhar. */
export function opcionalmente<A, B, E>(
  valor: A | undefined,
  f: (valor: A) => Effect.Effect<B, E>,
): Effect.Effect<B | undefined, E> {
  return valor === undefined ? Effect.undefined : f(valor);
}
