/**
 * As leituras do Explorar do app (`explorarIndice` e `explorarBuscar`, contrato em `../explorar.ts`).
 *
 * O índice sai dos serviços do kb (`Normas.listar`, `Cursos.listar`, a regra do `listar_cursos`, para
 * o CNCT, as ofertas e os turnos de cada curso, `Ppcs.listar`, `Cursos.campi`, o CNCT, os processos
 * seletivos e `Conselhos.reunioes`). As fichas da revisão de PPC ficam fora: são critério interno da
 * revisão, e a página de cada uma (`lerFicha`) abre pelo link que a revisão e a IA dão. Ele é montado na primeira chamada e guardado: o banco
 * não muda com o servidor no ar (a troca da base é na abertura). A busca usa esse índice na memória
 * para as coleções pequenas, o `Normas.buscar` (a regra do `buscar_norma`: citação ou ID ao
 * dispositivo, termos no FTS dos dispositivos e dos metadados) e `Ppcs.buscarSecoesPorPrefixo`.
 */
import * as Conselhos from "@simplifica-if/kb/Conselhos";
import * as Cursos from "@simplifica-if/kb/Cursos";
import * as Normas from "@simplifica-if/kb/Normas";
import * as Ppcs from "@simplifica-if/kb/Ppcs";
import * as Effect from "effect/Effect";
import type { Base } from "../contratos.ts";
import { responder } from "../envelope.ts";
import type {
  CampusDoIndice,
  CnctDoIndice,
  CursoDoIndice,
  DadosIndice,
  EntradaBusca,
  EntradaIndice,
  GrupoBusca,
  NormaDoIndice,
  PpcDoIndice,
  ResultadoBusca,
  ReuniaoDoIndice,
  TipoResultado,
} from "../explorar.ts";
import { linkCampus, linkCnct, linkCurso, linkNorma, linkPpc } from "../links.ts";
import {
  buscarNaMemoria,
  campo,
  item,
  type ItemBuscavel,
  ORDEM_GRUPOS,
  termosDaConsulta,
  tituloDoDispositivo,
  trechoEmVolta,
} from "./busca-explorar.ts";

const unicos = (valores: Iterable<string | null>) =>
  [...new Set([...valores].filter((v): v is string => v !== null && v !== ""))].sort();

/** Os serviços do kb de que o índice sai. */
interface ServicosDoIndice {
  readonly normas: Normas.Normas["Service"];
  readonly cursos: Cursos.Cursos["Service"];
  readonly ppcs: Ppcs.Ppcs["Service"];
  readonly conselhos: Conselhos.Conselhos["Service"];
}

/** O índice inteiro, dos serviços do kb. */
const lerIndice = Effect.fn("Explorar.lerIndice")(function* (kb: ServicosDoIndice) {
  const normas = (yield* kb.normas.listar).map(
    (n): NormaDoIndice & { readonly palavras_chave: ReadonlyArray<string> } => ({
      id: n.id,
      titulo: n.titulo,
      tipo: n.tipo_documento,
      numero: n.numero,
      ano: n.ano,
      orgao: n.orgao,
      situacao: n.situacao,
      status_vigencia: n.status_vigencia,
      ementa: n.ementa,
      apelidos: n.aliases,
      link: linkNorma(n.id),
      palavras_chave: n.palavras_chave,
    }),
  );

  const paginas = yield* kb.cursos.paginasOficiais;
  const cursos = (yield* kb.cursos.listar({})).map((c): CursoDoIndice => ({
    id: c.id.replace(/^curso:/, ""),
    nome: c.nome,
    campus: c.campus.id,
    campus_nome: c.campus.nome ?? c.campus.id,
    nivel: c.nivel,
    forma_oferta: c.forma_oferta,
    modalidade: c.modalidade,
    situacao: c.situacao,
    cnct: c.cnct
      ? { slug: c.cnct.id.replace(/^cnct:/, ""), nome: c.cnct.denominacao ?? c.cnct.id, eixo: c.cnct.eixo_tecnologico }
      : null,
    ppc: c.ppc ? { chave: c.ppc.id.replace(/^ppc:/, ""), ano: c.ppc.ano_documento } : null,
    turnos: unicos(c.ofertas.map((o) => o.turno)),
    processos: unicos(c.ofertas.flatMap((o) => o.processos)),
    pagina_oficial: paginas.get(c.id) ?? null,
    link: linkCurso(c.id),
  }));

  const ppcs = (yield* kb.ppcs.listar).map((p): PpcDoIndice => ({
    chave: p.chave,
    versao: p.versao,
    vigente: p.vigente,
    substituido_por: p.substituido_por ? linkPpc(p.substituido_por) : null,
    nome: p.curso_nome,
    campus: p.campus_id,
    campus_nome: p.campus_nome,
    nivel: p.nivel,
    forma: p.tipo_oferta,
    ano: p.ano_documento,
    fonte_url: p.fonte_pdf,
    curso: p.curso_id ? linkCurso(p.curso_id) : null,
    link: linkPpc(p.chave),
  }));

  const campi = (yield* kb.cursos.campi).map((c): CampusDoIndice => ({
    id: c.campus_id,
    nome: c.nome,
    site: c.site,
    calendario_academico: c.calendario_academico,
    horarios_url: c.horarios_url,
    horarios_coletado_em: c.horarios_coletado_em,
    link: linkCampus(c.campus_id),
  }));

  const cnct = (yield* kb.cursos.catalogoCnct).map((c): CnctDoIndice => ({
    slug: c.slug,
    denominacao: c.denominacao,
    eixo: c.eixo_tecnologico,
    area: c.area_tecnologica,
    carga_horaria_minima: c.carga_horaria_minima_h,
    link: linkCnct(c.slug),
  }));

  const processos = (yield* kb.cursos.processos).map((p) => ({ id: p.id, nome: p.nome, ano_ingresso: p.ano_ingresso }));

  const reunioes = (yield* kb.conselhos.reunioes).map((r): ReuniaoDoIndice => ({
    id: r.id,
    conselho: r.conselho,
    conselho_nome: r.conselho_nome,
    data: r.data,
    titulo: r.titulo,
    tipo: r.tipo,
    situacao: r.situacao,
    fonte: r.fonte,
    documentos: r.documentos.map((d) => ({
      id: d.documento_id,
      tipo: d.tipo,
      titulo: d.titulo,
      numero: d.numero,
      data: d.data,
      resumo: d.resumo,
      url: d.url,
    })),
    itens: r.itens.map((i) => ({
      id: i.item_id,
      ordem: i.ordem,
      titulo: i.titulo,
      resumo: i.resumo,
      tipo_demanda: i.tipo_demanda,
      resultado: i.resultado,
      documento: i.documento_id,
      processo_sei: i.processo_sei,
      campus_texto: i.campus_texto,
      campus: i.campus_id,
      curso_texto: i.curso_texto,
      curso: i.curso_id,
    })),
  }));

  return { normas, cursos, ppcs, campi, cnct, processos, reunioes };
});

type Indice = Effect.Success<ReturnType<typeof lerIndice>>;

/** Os itens da busca na memória, por tipo, a partir do índice. */
function itensDaBusca(indice: Indice): ReadonlyMap<TipoResultado, ReadonlyArray<ItemBuscavel>> {
  const nomeCampus = new Map(indice.campi.map((c) => [c.id, c.nome]));
  const descricaoCurso = (c: { nivel: string | null; forma_oferta?: string | null }) =>
    [c.nivel, c.forma_oferta].filter(Boolean).join(", ");
  return new Map<TipoResultado, ReadonlyArray<ItemBuscavel>>([
    [
      "norma",
      indice.normas.map((n) =>
        item(
          {
            tipo: "norma",
            titulo: n.titulo,
            detalhe: [n.orgao, n.status_vigencia].filter(Boolean).join(" · ") || null,
            trecho: n.ementa,
            link: n.link,
          },
          [
            campo([n.titulo, ...n.apelidos], 3),
            campo([n.numero, n.ano === null ? null : String(n.ano), n.orgao, n.tipo], 2),
            campo([n.ementa, ...n.palavras_chave], 1),
          ],
        ),
      ),
    ],
    [
      "curso",
      indice.cursos.map((c) =>
        item(
          {
            tipo: "curso",
            titulo: c.nome,
            detalhe: [`Campus ${c.campus_nome}`, descricaoCurso(c)].filter(Boolean).join(" · "),
            link: c.link,
          },
          [
            campo([c.nome], 3),
            campo([c.campus_nome, c.campus], 2),
            campo([c.cnct?.nome, c.cnct?.eixo, c.nivel, c.forma_oferta, c.modalidade, ...c.turnos], 1),
          ],
        ),
      ),
    ],
    [
      "ppc",
      indice.ppcs.map((p) =>
        item(
          {
            tipo: "ppc",
            titulo: `PPC — ${p.nome}`,
            detalhe: [`Campus ${p.campus_nome}`, p.forma, p.ano === null ? null : `documento de ${p.ano}`]
              .filter(Boolean)
              .join(" · "),
            link: p.link,
          },
          [
            campo([p.nome, "ppc", "projeto pedagógico"], 3),
            campo([p.campus_nome, p.campus], 2),
            campo([p.nivel, p.forma], 1),
          ],
        ),
      ),
    ],
    [
      "campus",
      indice.campi.map((c) =>
        item({ tipo: "campus", titulo: `Campus ${c.nome}`, detalhe: c.site, link: c.link }, [
          campo([c.nome, c.id], 3),
          campo(["campus"], 1),
        ]),
      ),
    ],
    [
      "cnct",
      indice.cnct.map((c) =>
        item(
          {
            tipo: "cnct",
            titulo: c.denominacao,
            detalhe: [
              `Eixo ${c.eixo}`,
              c.carga_horaria_minima === null ? null : `mínimo de ${c.carga_horaria_minima} h`,
            ]
              .filter(Boolean)
              .join(" · "),
            link: c.link,
          },
          [campo([c.denominacao], 3), campo([c.eixo, c.area, "cnct", "catálogo"], 1)],
        ),
      ),
    ],
    [
      "consepe",
      indice.reunioes.flatMap((r) => [
        item(
          {
            tipo: "consepe",
            titulo: r.titulo,
            detalhe: r.itens.length === 1 ? "1 item de pauta" : `${r.itens.length} itens de pauta`,
            link: null,
            reuniao: r.id,
          },
          [campo([r.titulo, r.conselho, "reunião", "pauta"], 3), campo([r.data, r.tipo], 1)],
        ),
        ...r.itens.map((i) =>
          item(
            {
              tipo: "consepe",
              titulo: i.titulo,
              detalhe: [r.titulo, i.resultado].filter(Boolean).join(" · "),
              link: null,
              reuniao: r.id,
            },
            [
              campo([i.curso_texto, i.tipo_demanda], 3),
              campo([i.campus_texto, i.campus === null ? null : nomeCampus.get(i.campus), r.conselho], 2),
              campo([i.titulo, i.resumo, i.processo_sei], 1),
            ],
          ),
        ),
      ]),
    ],
  ]);
}

export const makeExplorar = Effect.fn("Leitura.makeExplorar")(function* (base: Base) {
  const cursos = yield* Cursos.Cursos;
  const normas = yield* Normas.Normas;
  const ppcs = yield* Ppcs.Ppcs;
  const conselhos = yield* Conselhos.Conselhos;

  // montado na primeira chamada e guardado (o banco não muda com o servidor no ar)
  const indice = yield* Effect.cached(lerIndice({ normas, cursos, ppcs, conselhos }));
  const itens = yield* Effect.cached(Effect.map(indice, itensDaBusca));

  const explorarIndice = Effect.fn("Leitura.explorarIndice")(function* (_: typeof EntradaIndice.Type) {
    const { normas: comPalavras, ...resto } = yield* indice;
    const dados: DadosIndice = { ...resto, normas: comPalavras.map(({ palavras_chave: _, ...n }) => n) };
    return responder(base, dados);
  });

  const secoes = Effect.fn("Explorar.secoes")(function* (termos: ReadonlyArray<string>, limite: number) {
    if (termos.join("").length < 3) return [];
    const linhas = yield* ppcs.buscarSecoesPorPrefixo(termos, limite);
    return linhas.map((s): ResultadoBusca => ({
      tipo: "secao",
      titulo: s.titulo,
      detalhe: `PPC ${s.curso_nome} · Campus ${s.campus_nome}`,
      trecho: trechoEmVolta(s.texto, termos),
      link: linkPpc(s.id),
      reuniao: null,
    }));
  });

  /** As normas pela regra do `buscar_norma`: a citação resolvida vira dispositivo; o resto, trecho ou norma. */
  const pelasNormas = Effect.fn("Explorar.pelasNormas")(function* (consulta: string, limite: number) {
    const { resultados } = yield* normas.buscar(consulta, { limite });
    const citacao: ResultadoBusca[] = [];
    const trechos: ResultadoBusca[] = [];
    const normasAchadas: ResultadoBusca[] = [];
    const termos = termosDaConsulta(consulta);
    for (const r of resultados) {
      const detalhe = r.norma.status_vigencia;
      if (r.dispositivo) {
        const d = r.dispositivo;
        const alvo = r.origem === "citacao-resolvida" ? citacao : trechos;
        alvo.push({
          tipo: "dispositivo",
          titulo: tituloDoDispositivo(r.norma.titulo, d.id, d.rotulo),
          detalhe: [
            r.origem === "citacao-resolvida" ? "Citação reconhecida" : null,
            detalhe,
            d.revogado ? "dispositivo revogado" : null,
          ]
            .filter(Boolean)
            .join(" · "),
          trecho: trechoEmVolta(d.texto, termos, 220),
          link: linkNorma(d.id),
          reuniao: null,
        });
      } else {
        normasAchadas.push({
          tipo: "norma",
          titulo: r.norma.titulo,
          detalhe:
            [r.origem === "citacao-resolvida" ? "Citação reconhecida" : null, detalhe].filter(Boolean).join(" · ") ||
            null,
          trecho: r.norma.ementa,
          link: linkNorma(r.norma.id),
          reuniao: null,
        });
      }
    }
    return {
      citacao,
      trechos,
      normas: normasAchadas,
      resolvida: resultados.some((r) => r.origem === "citacao-resolvida"),
    };
  });

  const explorarBuscar = Effect.fn("Leitura.explorarBuscar")(function* (e: typeof EntradaBusca.Type) {
    const consulta = e.consulta.trim();
    if (consulta === "") return responder(base, { grupos: [] });
    const porTipo = yield* itens;
    const termos = termosDaConsulta(consulta);
    const [peloBanco, deSecoes] = yield* Effect.all([pelasNormas(consulta, e.limite), secoes(termos, e.limite)]);
    const resultados = new Map<TipoResultado, ResultadoBusca[]>();
    for (const [tipo, lista] of porTipo) resultados.set(tipo, buscarNaMemoria(lista, consulta, e.limite));

    // normas: a citada primeiro, depois as da memória (título, apelidos), depois as do FTS dos metadados
    const vistas = new Set<string>();
    const normasJuntas: ResultadoBusca[] = [];
    for (const r of [
      ...(peloBanco.resolvida ? peloBanco.normas : []),
      ...resultados.get("norma")!,
      ...peloBanco.normas,
    ]) {
      if (r.link === null || vistas.has(r.link)) continue;
      vistas.add(r.link);
      normasJuntas.push(r);
    }
    resultados.set("norma", normasJuntas.slice(0, e.limite));
    resultados.set("dispositivo", [...peloBanco.citacao, ...peloBanco.trechos].slice(0, e.limite));
    resultados.set("secao", deSecoes);

    const ordem: TipoResultado[] = peloBanco.resolvida
      ? [
          peloBanco.citacao.length ? "dispositivo" : "norma",
          ...ORDEM_GRUPOS.filter((t) => t !== (peloBanco.citacao.length ? "dispositivo" : "norma")),
        ]
      : [...ORDEM_GRUPOS];
    const grupos: GrupoBusca[] = ordem.flatMap((tipo) => {
      const lista = resultados.get(tipo) ?? [];
      return lista.length ? [{ tipo, resultados: lista }] : [];
    });
    return responder(base, { grupos });
  });

  return { explorarIndice, explorarBuscar };
});
