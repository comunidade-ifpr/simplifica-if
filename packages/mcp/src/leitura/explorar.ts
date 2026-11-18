/**
 * As leituras do Explorar do app (`explorarIndice` e `explorarBuscar`, contrato em `../explorar.ts`).
 *
 * O índice sai de consultas diretas às tabelas do `kb.sqlite` (e de `Cursos.listar`, a regra do
 * `listar_cursos`, para o CNCT, as ofertas e os turnos de cada curso). Ele é montado na primeira
 * chamada e guardado: o banco não muda com o servidor no ar (a troca da base é na abertura). A busca
 * usa esse índice na memória para as coleções pequenas, o `Normas.buscar` (a regra do `buscar_norma`:
 * citação ou ID ao dispositivo, termos no FTS dos dispositivos e dos metadados) e o FTS das seções dos
 * PPCs.
 */
import { expressaoFtsPrefixo } from "@simplifica-if/kb/busca/fts";
import * as Cursos from "@simplifica-if/kb/Cursos";
import * as Sql from "@simplifica-if/kb/db/sql";
import * as Normas from "@simplifica-if/kb/Normas";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type { Base } from "../contratos.ts";
import { responder } from "../envelope.ts";
import type {
  CampusDoIndice,
  CnctDoIndice,
  CursoDoIndice,
  DadosIndice,
  EntradaBusca,
  EntradaIndice,
  FichaDoIndice,
  GrupoBusca,
  NormaDoIndice,
  PpcDoIndice,
  ResultadoBusca,
  ReuniaoDoIndice,
  TipoResultado,
} from "../explorar.ts";
import { linkCampus, linkCnct, linkCurso, linkFicha, linkNorma, linkPpc } from "../links.ts";
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

const Texto = Schema.NullOr(Schema.String);
const Inteiro = Schema.NullOr(Schema.Int);

const linhasNormas = Sql.todas(
  Schema.Struct({
    id: Schema.String,
    situacao: Schema.Literals(["base", "stub", "externo"]),
    titulo: Schema.String,
    tipo_documento: Texto,
    numero: Texto,
    ano: Inteiro,
    orgao: Texto,
    status_vigencia: Texto,
    ementa: Texto,
    aliases_json: Schema.fromJsonString(Schema.Array(Schema.String)),
    keywords_json: Schema.fromJsonString(Schema.Array(Schema.String)),
    a_confirmar: Schema.Int,
  }),
);
const linhasPaginas = Sql.todas(Schema.Struct({ id: Schema.String, pagina_oficial: Texto }));
const linhasPpcs = Sql.todas(
  Schema.Struct({
    chave: Schema.String,
    curso_nome: Schema.String,
    campus_id: Schema.String,
    campus_nome: Schema.String,
    nivel: Schema.String,
    tipo_oferta: Schema.String,
    ano_documento: Inteiro,
    curso_id: Texto,
  }),
);
const linhasCampi = Sql.todas(
  Schema.Struct({
    campus_id: Schema.String,
    nome: Schema.String,
    site: Texto,
    calendario_academico: Texto,
    horarios_url: Texto,
    horarios_coletado_em: Texto,
  }),
);
const linhasCnct = Sql.todas(
  Schema.Struct({
    slug: Schema.String,
    denominacao: Schema.String,
    eixo_tecnologico: Schema.String,
    area_tecnologica: Texto,
    carga_horaria_minima_h: Inteiro,
  }),
);
const linhasFichas = Sql.todas(
  Schema.Struct({ id: Schema.String, titulo: Schema.String, dominio: Texto, criticidade: Texto }),
);
const linhasProcessos = Sql.todas(Schema.Struct({ id: Schema.String, nome: Schema.String, ano_ingresso: Inteiro }));
const linhasReunioes = Sql.todas(
  Schema.Struct({
    id: Schema.String,
    conselho: Schema.String,
    conselho_nome: Schema.String,
    data: Schema.String,
    titulo: Schema.String,
    tipo: Texto,
    situacao: Texto,
    fonte: Texto,
  }),
);
const linhasDocumentos = Sql.todas(
  Schema.Struct({
    reuniao_id: Schema.String,
    documento_id: Schema.String,
    tipo: Schema.String,
    titulo: Schema.String,
    numero: Texto,
    data: Texto,
    resumo: Texto,
    url: Texto,
  }),
);
const linhasItens = Sql.todas(
  Schema.Struct({
    reuniao_id: Schema.String,
    item_id: Schema.String,
    ordem: Schema.Int,
    titulo: Schema.String,
    resumo: Texto,
    tipo_demanda: Texto,
    resultado: Texto,
    documento_id: Texto,
    processo_sei: Texto,
    campus_texto: Texto,
    campus_id: Texto,
    curso_texto: Texto,
    curso_id: Texto,
  }),
);
const linhasSecoes = Sql.todas(
  Schema.Struct({
    id: Schema.String,
    titulo: Schema.String,
    texto: Schema.String,
    curso_nome: Schema.String,
    campus_nome: Schema.String,
  }),
);

const unicos = (valores: Iterable<string | null>) =>
  [...new Set([...valores].filter((v): v is string => v !== null && v !== ""))].sort();

/** O índice inteiro, das tabelas do banco. */
const lerIndice = Effect.fn("Explorar.lerIndice")(function* () {
  const cursosKb = yield* Cursos.Cursos;

  const normas = (yield* linhasNormas(
    `SELECT id, situacao, titulo, tipo_documento, numero, ano, orgao, status_vigencia, ementa, aliases_json, keywords_json,
            (COALESCE(status_vigencia = 'a confirmar', 0) OR COALESCE(json_type(front_matter_json, '$.vigencia_a_confirmar') = 'text', 0)) AS a_confirmar
       FROM normas ORDER BY id`,
  )).map((n): NormaDoIndice & { readonly palavras_chave: ReadonlyArray<string> } => ({
    id: n.id,
    titulo: n.titulo,
    tipo: n.tipo_documento,
    numero: n.numero,
    ano: n.ano,
    orgao: n.orgao,
    situacao: n.situacao,
    status_vigencia: n.status_vigencia,
    vigencia_a_confirmar: n.a_confirmar === 1,
    ementa: n.ementa,
    apelidos: n.aliases_json,
    link: linkNorma(n.id),
    palavras_chave: n.keywords_json,
  }));

  const paginas = new Map(
    (yield* linhasPaginas("SELECT id, pagina_oficial FROM cursos")).map((c) => [c.id, c.pagina_oficial]),
  );
  const cursos = (yield* cursosKb.listar({})).map((c): CursoDoIndice => ({
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

  const ppcs = (yield* linhasPpcs(
    "SELECT chave, curso_nome, campus_id, campus_nome, nivel, tipo_oferta, ano_documento, curso_id FROM ppcs ORDER BY chave",
  )).map((p): PpcDoIndice => ({
    chave: p.chave,
    nome: p.curso_nome,
    campus: p.campus_id,
    campus_nome: p.campus_nome,
    nivel: p.nivel,
    forma: p.tipo_oferta,
    ano: p.ano_documento,
    curso: p.curso_id ? linkCurso(p.curso_id) : null,
    link: linkPpc(p.chave),
  }));

  const campi = (yield* linhasCampi(
    "SELECT campus_id, nome, site, calendario_academico, horarios_url, horarios_coletado_em FROM campi ORDER BY campus_id",
  )).map((c): CampusDoIndice => ({
    id: c.campus_id,
    nome: c.nome,
    site: c.site,
    calendario_academico: c.calendario_academico,
    horarios_url: c.horarios_url,
    horarios_coletado_em: c.horarios_coletado_em,
    link: linkCampus(c.campus_id),
  }));

  const cnct = (yield* linhasCnct(
    "SELECT slug, denominacao, eixo_tecnologico, area_tecnologica, carga_horaria_minima_h FROM cnct ORDER BY slug",
  )).map((c): CnctDoIndice => ({
    slug: c.slug,
    denominacao: c.denominacao,
    eixo: c.eixo_tecnologico,
    area: c.area_tecnologica,
    carga_horaria_minima: c.carga_horaria_minima_h,
    link: linkCnct(c.slug),
  }));

  const fichas = (yield* linhasFichas("SELECT id, titulo, dominio, criticidade FROM fichas ORDER BY id")).map(
    (f): FichaDoIndice => ({ ...f, link: linkFicha(f.id) }),
  );

  const processos = yield* linhasProcessos("SELECT id, nome, ano_ingresso FROM processos ORDER BY id");

  const documentos = yield* linhasDocumentos(
    `SELECT reuniao_id, documento_id, tipo, titulo, numero, data, resumo, url
       FROM conselhos_documentos ORDER BY reuniao_id, ordem`,
  );
  const itens = yield* linhasItens(
    `SELECT reuniao_id, item_id, ordem, titulo, resumo, tipo_demanda, resultado, documento_id, processo_sei,
            campus_texto, campus_id, curso_texto, curso_id
       FROM conselhos_itens ORDER BY reuniao_id, ordem`,
  );
  const reunioes = (yield* linhasReunioes(
    `SELECT r.id, c.sigla AS conselho, c.nome AS conselho_nome, r.data, r.titulo, r.tipo, r.situacao, r.fonte
       FROM conselhos_reunioes r JOIN conselhos c ON c.id = r.conselho_id ORDER BY r.data DESC, r.id`,
  )).map((r): ReuniaoDoIndice => ({
    ...r,
    documentos: documentos
      .filter((d) => d.reuniao_id === r.id)
      .map((d) => ({
        id: d.documento_id,
        tipo: d.tipo,
        titulo: d.titulo,
        numero: d.numero,
        data: d.data,
        resumo: d.resumo,
        url: d.url,
      })),
    itens: itens
      .filter((i) => i.reuniao_id === r.id)
      .map((i) => ({
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

  return { normas, cursos, ppcs, campi, cnct, fichas, processos, reunioes };
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
    [
      "ficha",
      indice.fichas.map((f) =>
        item(
          {
            tipo: "ficha",
            titulo: `${f.id}: ${f.titulo}`,
            detalhe: ["Ficha de análise de PPC", f.criticidade ? `criticidade ${f.criticidade}` : null]
              .filter(Boolean)
              .join(" · "),
            link: f.link,
          },
          [campo([f.id, f.titulo], 3), campo([f.dominio, "ficha"], 1)],
        ),
      ),
    ],
  ]);
}

export const makeExplorar = Effect.fn("Leitura.makeExplorar")(function* (base: Base) {
  const sql = yield* SqlClient.SqlClient;
  const cursos = yield* Cursos.Cursos;
  const normas = yield* Normas.Normas;
  const prover = <A, E>(efeito: Effect.Effect<A, E, SqlClient.SqlClient | Cursos.Cursos>) =>
    efeito.pipe(Effect.provideService(SqlClient.SqlClient, sql), Effect.provideService(Cursos.Cursos, cursos));

  // montado na primeira chamada e guardado (o banco não muda com o servidor no ar)
  const indice = yield* Effect.cached(prover(lerIndice()));
  const itens = yield* Effect.cached(Effect.map(indice, itensDaBusca));

  const explorarIndice = Effect.fn("Leitura.explorarIndice")(function* (_: typeof EntradaIndice.Type) {
    const { normas: comPalavras, ...resto } = yield* indice;
    const dados: DadosIndice = { ...resto, normas: comPalavras.map(({ palavras_chave: _, ...n }) => n) };
    return responder(base, dados);
  });

  const secoes = Effect.fn("Explorar.secoes")(function* (termos: ReadonlyArray<string>, limite: number) {
    const expressao = expressaoFtsPrefixo(termos, ["titulo", "texto"]);
    if (expressao === null || termos.join("").length < 3) return [];
    const linhas = yield* prover(
      linhasSecoes(
        // ranqueia só no FTS e junta depois: juntar antes leria o texto de milhares de seções (210 ms
        // na primeira busca de "curso" na base real, contra 5 ms assim)
        `SELECT s.id, s.titulo, s.texto, p.curso_nome, p.campus_nome
           FROM (SELECT rowid, bm25(secoes_fts, 4.0, 1.0, 0.0, 0.0, 0.0) AS pontos FROM secoes_fts
                  WHERE secoes_fts MATCH ? ORDER BY pontos, rowid LIMIT ?) f
           JOIN secoes s ON s.rowid = f.rowid JOIN ppcs p ON p.id = s.ppc_id
          ORDER BY f.pontos, f.rowid`,
        [expressao, limite],
      ),
    );
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
