/**
 * Leituras das ferramentas de PPCs e cursos (T3): `citacoes_da_norma`, `impacto_da_norma`,
 * `adequacao_art71`, `buscar_secoes`, `ler_secao`, `listar_cursos`, `ficha_curso` e `fatos_ppc`,
 * sobre os serviços `Ppcs`, `Cursos`, `Impacto` e `FontesNormativas` do kb.
 *
 * O SQL próprio (os tipos de seção válidos e o título das fichas) é lido uma vez, na construção:
 * o banco é só de leitura.
 */
import { INDICADORES } from "@simplifica-if/kb/adequacao/art71";
import * as Cursos from "@simplifica-if/kb/Cursos";
import * as Sql from "@simplifica-if/kb/db/sql";
import * as FontesNormativas from "@simplifica-if/kb/FontesNormativas";
import * as Impacto from "@simplifica-if/kb/Impacto";
import * as Normas from "@simplifica-if/kb/Normas";
import type { PpcCitante } from "@simplifica-if/kb/ppcs/citacoes";
import * as Ppcs from "@simplifica-if/kb/Ppcs";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { type Aviso, type Base, EntradaInvalida, type Fonte, type Pagina, type TransicaoResumo } from "../contratos.ts";
import { responder } from "../envelope.ts";
import * as AdequacaoArt71 from "../ferramentas/adequacao-art71.ts";
import * as BuscarSecoes from "../ferramentas/buscar-secoes.ts";
import * as CitacoesDaNorma from "../ferramentas/citacoes-da-norma.ts";
import * as FatosPpcFerramenta from "../ferramentas/fatos-ppc.ts";
import type * as FichaCurso from "../ferramentas/ficha-curso.ts";
import * as ImpactoDaNorma from "../ferramentas/impacto-da-norma.ts";
import * as LerSecao from "../ferramentas/ler-secao.ts";
import * as ListarCursos from "../ferramentas/listar-cursos.ts";
import { textoFatosPpc } from "../ferramentas/comum-ppcs.ts";
import { lerLink, linkCampus, linkCnct, linkCurso, linkFicha, linkNorma, linkPpc } from "../links.ts";
import { paginarNoTeto, RESERVA_TEXTO } from "../orcamento.ts";
import { dataBr } from "../texto.ts";
import {
  AVISO_FATO_EXTRAIDO,
  avisoBaixaConfianca,
  avisoVigencia,
  chaveCurso,
  chavePpc,
  normaPedida,
  opcionalmente,
  paraFatosPpc,
  relacaoSaida,
  transicaoResumo,
} from "./comum.ts";

const linhasTipo = Sql.todas(Schema.Struct({ tipo: Schema.String }));
const linhasFicha = Sql.todas(Schema.Struct({ id: Schema.String, titulo: Schema.String, path: Schema.String }));

function ocorrenciasDoPpc(ato: string, p: PpcCitante): CitacoesDaNorma.Ocorrencia[] {
  return p.ocorrencias.map((o) => ({
    linha: o.linha,
    trecho: o.trecho,
    regra: o.regra,
    confianca: o.confianca,
    dispositivo: o.dispositivoId ? `${ato}${o.dispositivoId}` : null,
    link: o.dispositivoId ? linkNorma(ato, o.dispositivoId.slice(1)) : linkNorma(ato),
    fonte: { path: `base-conhecimento/${p.path}`, linha_inicio: o.linha, linha_fim: o.linha },
  }));
}

const idDaSecao = Effect.fn("Leitura.idDaSecao")(function* (valor: string) {
  if (valor.startsWith("ifpr://")) {
    const link = lerLink(valor);
    if (!link || link.tipo !== "ppc" || link.fragmento === null) {
      return yield* new EntradaInvalida({
        mensagem: `id: esperava um link ifpr://ppc/campus/curso#secao, veio "${valor}"`,
      });
    }
    return `${link.caminho}#${link.fragmento}`;
  }
  const id = valor.replace(/^ppc:/, "");
  if (!/^[A-Za-z0-9._~-]+\/[A-Za-z0-9._~-]+#[A-Za-z0-9._~-]+$/.test(id)) {
    return yield* new EntradaInvalida({
      mensagem: `id: esperava "campus/curso#secao" (como "curitiba/tecnico-em-enfermagem#estagio_praticas-1"), veio "${valor}"`,
    });
  }
  return id;
});

export const makePpcs = Effect.fn("Leitura.makePpcs")(function* (base: Base) {
  const normas = yield* Normas.Normas;
  const ppcs = yield* Ppcs.Ppcs;
  const cursos = yield* Cursos.Cursos;
  const impacto = yield* Impacto.Impacto;
  const fontes = yield* FontesNormativas.FontesNormativas;
  // ORDER BY com a colação BINARY do SQLite ordena por code point, como compararTexto do kb
  const tiposDeSecao = (yield* linhasTipo("SELECT DISTINCT tipo FROM secoes ORDER BY tipo")).map((t) => t.tipo);
  const fichasPorPath = new Map((yield* linhasFicha("SELECT id, titulo, path FROM fichas")).map((f) => [f.path, f]));

  const citacoesDaNorma = Effect.fn("Leitura.citacoesDaNorma")(function* (e: typeof CitacoesDaNorma.Entrada.Type) {
    const norma = yield* normaPedida(normas, e.id);
    const ato = norma.id;
    const ppc = yield* opcionalmente(e.ppc, (valor) => chavePpc(valor));
    const citantes = (yield* ppcs.citacoesDaNorma(e.id, { confiancaMinima: e.confianca_min })).filter(
      (p) =>
        (ppc === undefined || p.ppc === ppc) &&
        (e.nivel === undefined || p.nivel === e.nivel) &&
        (e.campus === undefined || p.ppc.split("/")[0] === e.campus),
    );
    const itens: (CitacoesDaNorma.ItemPpc & { regras: string[] })[] = citantes.map((p) => ({
      ppc: p.ppc,
      curso: p.curso,
      campus: p.campus,
      nivel: p.nivel,
      forma: p.tipo_oferta,
      link: linkPpc(p.ppc),
      ocorrencias: ppc === undefined ? p.ocorrencias.length : ocorrenciasDoPpc(ato, p),
      regras: p.ocorrencias.map((o) => o.regra),
    }));
    const consulta = {
      ferramenta: "citacoes_da_norma",
      base: base.versao,
      id: e.id,
      confianca_min: e.confianca_min,
      ppc,
      nivel: e.nivel,
      campus: e.campus,
    };
    const { itens: pagina, pagina: paginacao } = yield* paginarNoTeto(itens, {
      limite: e.limite,
      cursor: e.cursor,
      consulta,
      orcamento: CitacoesDaNorma.TETO_CITACOES - RESERVA_TEXTO,
      medir: (item) => CitacoesDaNorma.blocoPpc(item).length + 2,
    });
    const avisos: Aviso[] = [...avisoBaixaConfianca(pagina.flatMap((p) => p.regras))];
    if (itens.length === 0) {
      avisos.push({
        tipo: "nao-encontrado",
        mensagem: `nenhum PPC da base cita ${e.id}${ppc || e.nivel || e.campus ? " com esses filtros" : ""}${e.confianca_min > 0 ? ` com confiança ≥ ${e.confianca_min}` : ""}`,
        ref: e.id,
      });
    }
    return responder(
      base,
      {
        id: e.id,
        norma,
        total_ppcs: itens.length,
        total_ocorrencias: citantes.reduce((total, p) => total + p.ocorrencias.length, 0),
        ppcs: pagina.map(({ regras: _r, ...item }) => item),
      },
      { avisos, pagina: paginacao },
    );
  });

  const impactoDaNorma = Effect.fn("Leitura.impactoDaNorma")(function* (e: typeof ImpactoDaNorma.Entrada.Type) {
    const norma = yield* normaPedida(normas, e.id);
    const resultado = yield* impacto.daNorma(e.id, { incluirPpcs: false });
    const citantes = yield* ppcs.citacoesDaNorma(e.id);
    const transicoes = new Map((yield* normas.vigencia(norma.id)).transicoes.map((t) => [t.id, t]));
    const relacoes = fontes.relacoes.filter((r) => r.origem === norma.id || r.alvo === norma.id);
    const fichas = resultado.arquivos
      .filter((a) => a.categoria === "ficha")
      .map((a) => {
        const ficha = fichasPorPath.get(a.arquivo);
        const id = ficha?.id ?? a.arquivo;
        return {
          id,
          titulo: ficha?.titulo ?? a.arquivo,
          papel: a.motivos.join(", "),
          dispositivos: a.dispositivos,
          link: linkFicha(id),
        };
      });
    const avisos: Aviso[] = [...avisoVigencia(norma)];
    if (resultado.status.endsWith("(a confirmar)") && avisos.length === 0) {
      avisos.push({
        tipo: "vigencia-a-confirmar",
        mensagem: `o status de ${norma.titulo} em ${dataBr(resultado.data_referencia)} está a confirmar; diga isso ao usuário`,
        ref: norma.id,
      });
    }
    // laço pelas normas que citam esta (dezenas): o título de cada uma
    const normasQueCitam = yield* Effect.forEach(
      resultado.normas_que_citam,
      Effect.fnUntraced(function* (n) {
        const ficha = yield* normas.ficha(n.id);
        return { id: n.id, titulo: ficha?.titulo ?? n.id, dispositivos: n.dispositivos, link: linkNorma(n.id) };
      }),
    );
    return responder(
      base,
      {
        norma,
        status: resultado.status,
        data_referencia: resultado.data_referencia,
        sucessoras: resultado.sucessoras,
        transicoes: resultado.transicoes.map((id) => transicaoResumo(transicoes.get(id)!)),
        relacoes: relacoes.map(relacaoSaida),
        normas_que_citam: normasQueCitam,
        ppcs: {
          total: citantes.length,
          amostra: citantes
            .slice(0, ImpactoDaNorma.AMOSTRA_PPCS)
            .map((p) => ({ ppc: p.ppc, nome: p.curso, campus: p.campus, link: linkPpc(p.ppc) })),
        },
        fichas,
        topicos: resultado.topicos_atingidos,
      },
      { avisos },
    );
  });

  const adequacaoArt71 = Effect.fn("Leitura.adequacaoArt71")(function* (e: AdequacaoArt71.Entrada) {
    const relatorio = yield* cursos.adequacaoArt71({ incluirTecnologia: e.incluir_tecnologia });
    const curso = yield* opcionalmente(e.curso, (valor) =>
      valor.includes("/") || valor.includes(":") ? chaveCurso(valor) : Effect.succeed(valor),
    );
    const filtrado = e.campus !== undefined || curso !== undefined || e.indicador !== undefined;
    const lista: AdequacaoArt71.Curso[] = relatorio.cursos
      .map((c) => {
        const [campus, slug] = c.curso.replace(/^curso:/, "").split("/") as [string, string];
        return { c, campus, slug };
      })
      .filter(
        ({ c, campus, slug }) =>
          (e.campus === undefined || campus === e.campus) &&
          (curso === undefined || (curso.includes("/") ? `${campus}/${slug}` === curso : slug === curso)) &&
          (e.indicador === undefined || c.indicador === e.indicador),
      )
      .map(({ c, campus }) => ({
        curso: c.curso,
        nome: c.nome,
        campus,
        forma_oferta: c.forma_oferta,
        ppc_ano: c.ppc_ano,
        indicador: c.indicador,
        dcn_citadas: c.dcn_citadas.map((d) => ({ id: d.id, linhas: d.linhas, regras: d.regras })),
        link: linkCurso(c.curso),
      }));
    const totais = Object.fromEntries(INDICADORES.map((i) => [i, 0])) as Record<string, number>;
    for (const c of lista) totais[c.indicador] = (totais[c.indicador] ?? 0) + 1;
    const avisos: Aviso[] = [];
    if (!filtrado) {
      return responder(base, { criterio: relatorio.criterio, totais, cursos: [] }, { avisos });
    }
    const consulta = {
      ferramenta: "adequacao_art71",
      base: base.versao,
      campus: e.campus,
      curso,
      indicador: e.indicador,
      incluir_tecnologia: e.incluir_tecnologia,
    };
    const { itens, pagina } = yield* paginarNoTeto(lista, {
      limite: e.limite,
      cursor: e.cursor,
      consulta,
      orcamento: AdequacaoArt71.TETO_ADEQUACAO - RESERVA_TEXTO - 1200,
      medir: (c) => AdequacaoArt71.linhaCurso(c).length + 1,
    });
    avisos.push(...avisoBaixaConfianca(itens.flatMap((c) => c.dcn_citadas.flatMap((d) => d.regras))));
    if (lista.length === 0) {
      avisos.push({ tipo: "nao-encontrado", mensagem: "nenhum curso alcançado pelo art. 71 com esses filtros" });
    }
    return responder(base, { criterio: relatorio.criterio, totais, cursos: itens }, { avisos, pagina });
  });

  const buscarSecoes = Effect.fn("Leitura.buscarSecoes")(function* (e: typeof BuscarSecoes.Entrada.Type) {
    if (e.tipo) {
      const conhecidos = new Set(tiposDeSecao);
      const desconhecidos = e.tipo.filter((t) => !conhecidos.has(t));
      if (desconhecidos.length) {
        return yield* new EntradaInvalida({
          mensagem: `tipo de seção desconhecido: ${desconhecidos.join(", ")}. Tipos válidos: ${[...conhecidos].join(", ")}`,
        });
      }
    }
    const avisos: Aviso[] = [];
    let limite = e.limite;
    if (e.integral && limite > BuscarSecoes.MAX_INTEGRAL) {
      limite = BuscarSecoes.MAX_INTEGRAL;
      avisos.push({
        tipo: "resultado-resumido",
        mensagem: `com integral, a busca devolve no máximo ${BuscarSecoes.MAX_INTEGRAL} seções; peça sem integral para ver mais resultados`,
      });
    }
    const filtros = {
      tipo: e.tipo ? [...e.tipo] : undefined,
      nivel: e.nivel,
      campus: e.campus,
      cnct: e.cnct?.replace(/^cnct:/, ""),
      forma: e.forma,
      ppc: yield* opcionalmente(e.ppc, (valor) => chavePpc(valor)),
    };
    const achados = yield* ppcs.buscarSecoes(e.consulta, filtros, { limite, integral: e.integral });
    if (achados.length === 0) {
      avisos.push({
        tipo: "nao-encontrado",
        mensagem: `nenhuma seção de PPC encontrada para "${e.consulta}"${Object.values(filtros).some((v) => v !== undefined) ? " com esses filtros" : ""}`,
      });
    }
    return responder(
      base,
      {
        resultados: achados.map((r) => ({
          id: r.id,
          ppc: r.ppc,
          curso: r.curso,
          campus: r.campus,
          nivel: r.nivel,
          forma: r.forma,
          cnct_id: r.cnct_id,
          tipo: r.tipo,
          titulo: r.titulo,
          trecho: r.trecho,
          ...(r.texto !== undefined ? { texto: r.texto } : {}),
          fonte: { path: r.path, linha_inicio: r.linha_inicio, linha_fim: r.linha_fim },
          link: linkPpc(r.id),
          pontuacao: r.pontuacao,
        })),
      },
      { avisos },
    );
  });

  const lerSecao = Effect.fn("Leitura.lerSecao")(function* (e: typeof LerSecao.Entrada.Type) {
    const id = yield* idDaSecao(e.id);
    const secao = yield* ppcs.lerSecao(id);
    if (!secao) {
      return yield* new EntradaInvalida({
        mensagem: `seção não encontrada: "${id}". Use um ID devolvido por buscar_secoes ou pela ficha_curso (ppc.secoes)`,
      });
    }
    const linhas = secao.texto.split("\n");
    const orcamento = LerSecao.TETO_LER_SECAO - RESERVA_TEXTO;
    const longa = secao.texto.length > orcamento;
    let texto = secao.texto;
    let fonte: Fonte = { path: secao.path, linha_inicio: secao.linha_inicio, linha_fim: secao.linha_fim };
    let pagina: Pagina | undefined;
    if (longa || e.cursor !== undefined) {
      const recorte = yield* paginarNoTeto(linhas, {
        limite: linhas.length,
        cursor: e.cursor,
        consulta: { ferramenta: "ler_secao", base: base.versao, id },
        orcamento,
        medir: (linha) => linha.length + 1,
      });
      pagina = recorte.pagina;
      texto = recorte.itens.join("\n");
      const primeira = secao.linha_texto + recorte.inicio;
      fonte = { path: secao.path, linha_inicio: primeira, linha_fim: primeira + recorte.itens.length - 1 };
    }
    return responder(
      base,
      {
        secao: {
          id: secao.id,
          ppc: secao.ppc,
          curso: secao.curso,
          tipo: secao.tipo,
          titulo: secao.titulo,
          texto,
          fonte,
          link: linkPpc(secao.id),
        },
        anterior: secao.anterior,
        proxima: secao.proxima,
      },
      pagina ? { pagina } : {},
    );
  });

  const listarCursos = Effect.fn("Leitura.listarCursos")(function* (e: typeof ListarCursos.Entrada.Type) {
    const filtros = {
      eixo: e.eixo,
      turno: e.turno,
      campus: e.campus,
      nivel: e.nivel,
      forma: e.forma,
      situacao: e.situacao,
      cnct: e.cnct?.replace(/^cnct:/, ""),
      processo: e.processo,
    };
    const lista: ListarCursos.Curso[] = (yield* cursos.listar(filtros)).map((c) => ({
      id: c.id,
      nome: c.nome,
      campus: c.campus.id,
      nivel: c.nivel,
      forma_oferta: c.forma_oferta,
      modalidade: c.modalidade,
      situacao: c.situacao,
      cnct: c.cnct ? { id: c.cnct.id, nome: c.cnct.denominacao ?? c.cnct.id, eixo: c.cnct.eixo_tecnologico } : null,
      ppc: c.ppc ? { id: c.ppc.id, ano: c.ppc.ano_documento } : null,
      turnos: [...new Set(c.ofertas.map((o) => o.turno).filter((t): t is string => t !== null))],
      link: linkCurso(c.id),
    }));
    const { itens, pagina } = yield* paginarNoTeto(lista, {
      limite: e.limite,
      cursor: e.cursor,
      consulta: { ferramenta: "listar_cursos", base: base.versao, ...filtros },
      orcamento: ListarCursos.TETO_LISTAR_CURSOS - RESERVA_TEXTO,
      medir: (c) => ListarCursos.linhaCurso(c).length + 1,
    });
    const avisos: Aviso[] = [];
    if (lista.length === 0) avisos.push({ tipo: "nao-encontrado", mensagem: "nenhum curso com esses filtros" });
    return responder(base, { cursos: itens }, { avisos, pagina });
  });

  const fichaCurso = Effect.fn("Leitura.fichaCurso")(function* (e: typeof FichaCurso.Entrada.Type) {
    const chave = yield* chaveCurso(e.curso);
    const id = `curso:${chave}`;
    const curso = (yield* cursos.listar({ campus: chave.split("/")[0] })).find((c) => c.id === id);
    if (!curso) {
      return yield* new EntradaInvalida({
        mensagem: `curso não encontrado na base: "${e.curso}". Use o ID de listar_cursos ("campus/curso")`,
      });
    }
    const ppcId = curso.ppc?.id ?? null;
    const citadas = ppcId ? ((yield* ppcs.normasCitadas(ppcId)) ?? []) : [];
    const fatos = ppcId ? ((yield* ppcs.fatos({ ppc: ppcId }))[0] ?? null) : null;
    const adequacao = (yield* adequacaoArt71({ curso: chave, incluir_tecnologia: false, limite: 50 })).dados.cursos[0];
    const transicoes = new Map<string, TransicaoResumo>();
    for (const n of citadas) {
      for (const t of (yield* normas.vigencia(n.id)).transicoes) {
        if (!transicoes.has(t.id)) transicoes.set(t.id, transicaoResumo(t));
      }
    }
    const avisos: Aviso[] = [];
    if (fatos) avisos.push(AVISO_FATO_EXTRAIDO);
    avisos.push(...avisoBaixaConfianca(citadas.flatMap((n) => n.regras)));
    const secoes = ppcId ? yield* ppcs.indiceSecoesDoPpc(ppcId) : [];
    // laço pelas normas que o PPC cita (dezenas): o título e o status de cada uma
    const normasCitadas = yield* Effect.forEach(
      citadas,
      Effect.fnUntraced(function* (n) {
        const norma = yield* normas.ficha(n.id);
        return {
          id: n.id,
          titulo: norma?.titulo ?? n.id,
          status_vigencia: norma?.status_vigencia ?? null,
          ocorrencias: n.ocorrencias,
          link: linkNorma(n.id),
        };
      }),
    );
    return responder(
      base,
      {
        curso: {
          id: curso.id,
          nome: curso.nome,
          nivel: curso.nivel,
          forma_oferta: curso.forma_oferta,
          modalidade: curso.modalidade,
          situacao: curso.situacao,
          link: linkCurso(curso.id),
        },
        campus: { id: curso.campus.id, nome: curso.campus.nome ?? curso.campus.id, link: linkCampus(curso.campus.id) },
        cnct: curso.cnct
          ? {
              id: curso.cnct.id,
              nome: curso.cnct.denominacao ?? curso.cnct.id,
              eixo: curso.cnct.eixo_tecnologico,
              carga_horaria_minima: curso.cnct.carga_horaria_minima_h,
              link: linkCnct(curso.cnct.id),
            }
          : null,
        ppc:
          curso.ppc && ppcId
            ? {
                id: ppcId,
                ano: curso.ppc.ano_documento,
                link: linkPpc(ppcId),
                secoes: secoes.map((s) => ({ id: s.id, tipo: s.tipo, titulo: s.titulo })),
              }
            : null,
        ofertas: curso.ofertas.flatMap((o) =>
          (o.processos.length ? o.processos : ["sem processo informado"]).map((processo) => ({
            processo,
            turno: o.turno,
            vagas: o.vagas,
          })),
        ),
        fatos: fatos ? paraFatosPpc(fatos) : null,
        normas_citadas: normasCitadas,
        adequacao_art71: adequacao ? { indicador: adequacao.indicador } : null,
        transicoes_aplicaveis: [...transicoes.values()],
      },
      { avisos },
    );
  });

  const fatosPpc = Effect.fn("Leitura.fatosPpc")(function* (e: typeof FatosPpcFerramenta.Entrada.Type) {
    const filtros = {
      ppc: yield* opcionalmente(e.ppc, (valor) => chavePpc(valor)),
      nivel: e.nivel,
      campus: e.campus,
    };
    const resultado = e.divergencias ? yield* ppcs.divergencias(filtros) : { ppcs: yield* ppcs.fatos(filtros) };
    const lista = resultado.ppcs.map(paraFatosPpc);
    const { itens, pagina } = yield* paginarNoTeto(lista, {
      limite: e.limite,
      cursor: e.cursor,
      consulta: { ferramenta: "fatos_ppc", base: base.versao, divergencias: e.divergencias, ...filtros },
      orcamento: FatosPpcFerramenta.TETO_FATOS - RESERVA_TEXTO - 600,
      medir: (p) => textoFatosPpc(p).length + 2,
    });
    const avisos: Aviso[] = [AVISO_FATO_EXTRAIDO];
    if (lista.length === 0) {
      avisos.push({
        tipo: "nao-encontrado",
        mensagem: filtros.ppc
          ? `PPC não encontrado na base${e.divergencias ? ", ou sem divergência PPC × SUAP" : ""}: ${filtros.ppc}`
          : `nenhum PPC${e.divergencias ? " com divergência PPC × SUAP" : ""} com esses filtros`,
      });
    }
    return responder(
      base,
      { ppcs: itens, ...("totais" in resultado ? { totais: resultado.totais } : {}) },
      { avisos, pagina },
    );
  });

  return {
    citacoesDaNorma,
    impactoDaNorma,
    adequacaoArt71,
    buscarSecoes,
    lerSecao,
    listarCursos,
    fichaCurso,
    fatosPpc,
  };
});
