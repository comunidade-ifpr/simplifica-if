/**
 * Leituras dos recursos `ifpr://` sem ferramenta própria (M1.5): o PPC sem seção, o curso do CNCT, o
 * campus e a ficha da `revisar-ppc`, sobre os serviços `Ppcs`, `Cursos` e `FontesNormativas` do kb.
 * As outras (norma, dispositivo, curso e seção de PPC) são as leituras das ferramentas.
 *
 * Os campos de texto do CNCT e das fichas levam a linha da chave no arquivo de origem: os arquivos
 * são o JSON com indentação de 2 espaços (o que `JSON.stringify(_, null, 2)` reproduz), e o banco
 * guarda o objeto com as chaves na ordem do arquivo. Sem o objeto (`{}`), a linha é a 1.
 */
import * as Cursos from "@simplifica-if/kb/Cursos";
import * as FontesNormativas from "@simplifica-if/kb/FontesNormativas";
import { linhaDaChave } from "@simplifica-if/kb/institucional/dados";
import * as Ppcs from "@simplifica-if/kb/Ppcs";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { type Aviso, type Base, EntradaInvalida, FalhaNaBase, type Fonte } from "../contratos.ts";
import { responder } from "../envelope.ts";
import { linkCampus, linkCnct, linkCurso, linkFicha, linkNorma, linkPpc } from "../links.ts";
import * as Conteudos from "../recursos/conteudos.ts";
import { AVISO_FATO_EXTRAIDO, chavePpc, paraFatosPpc } from "./comum.ts";
import { paraCurso } from "./ppcs.ts";

/** Um campus da tabela `campi`, lido uma vez na construção do `Leitura`. */
export interface CampusDaBase {
  readonly id: string;
  readonly nome: string;
  readonly site: string | null;
  readonly path: string;
}

const decodificarJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)));

const SLUG = /^[A-Za-z0-9._~-]+$/;

function textoOuNulo(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor : null;
}

/** A linha da chave `campo` no arquivo JSON (indentado) do objeto `objeto`. */
function fonteDoCampo(objeto: Readonly<Record<string, unknown>>, path: string, campo: string): Fonte {
  const linha = linhaDaChave(JSON.stringify(objeto, null, 2), campo);
  return { path, linha_inicio: linha, linha_fim: linha };
}

export const makeRecursos = Effect.fn("Leitura.makeRecursos")(function* (
  base: Base,
  campi: ReadonlyMap<string, CampusDaBase>,
) {
  const ppcs = yield* Ppcs.Ppcs;
  const cursos = yield* Cursos.Cursos;
  const fontes = yield* FontesNormativas.FontesNormativas;

  const lerPpc = Effect.fn("Leitura.lerPpc")(function* (e: typeof Conteudos.EntradaPpc.Type) {
    const chave = yield* chavePpc(e.ppc);
    const fatos = (yield* ppcs.fatos({ ppc: chave }))[0];
    if (!fatos) {
      return yield* new EntradaInvalida({
        mensagem: `PPC não encontrado na base: "${chave}". Use o ID de listar_cursos ("campus/curso")`,
      });
    }
    const secoes = (yield* ppcs.indiceSecoesDoPpc(chave)).map((s) => ({
      id: s.id,
      tipo: s.tipo,
      titulo: s.titulo,
      fonte: { path: fatos.path, linha_inicio: s.linha_inicio, linha_fim: s.linha_fim },
      link: linkPpc(s.id),
    }));
    const ultima = Math.max(1, ...secoes.map((s) => s.fonte.linha_fim));
    const avisos: Aviso[] = fatos.fatos.length ? [AVISO_FATO_EXTRAIDO] : [];
    return responder(
      base,
      {
        ppc: {
          id: fatos.ppc,
          nome: fatos.nome,
          campus: fatos.campus,
          nivel: fatos.nivel,
          forma: fatos.forma,
          link: linkPpc(fatos.ppc),
          curso: fatos.curso ? linkCurso(fatos.curso) : null,
          fonte: { path: fatos.path, linha_inicio: 1, linha_fim: ultima },
        },
        secoes,
        fatos: paraFatosPpc(fatos),
      },
      { avisos },
    );
  });

  const lerCnct = Effect.fn("Leitura.lerCnct")(function* (e: typeof Conteudos.EntradaCnct.Type) {
    const slug = e.cnct.replace(/^cnct:/, "");
    const registro = SLUG.test(slug) ? yield* cursos.cnct(slug) : null;
    if (!registro) {
      return yield* new EntradaInvalida({
        mensagem: `curso não encontrado no CNCT: "${slug}". Use o slug do catálogo, como "tecnico-em-enfermagem" (o CNCT de cada curso está em ficha_curso)`,
      });
    }
    const { dados } = registro;
    const path = registro.path ?? `base-conhecimento/catalogos/cnct/cursos/${registro.slug}.json`;
    const campos = Conteudos.CAMPOS_CNCT.flatMap(([campo, rotulo]) => {
      const texto = textoOuNulo(dados[campo]);
      return texto === null ? [] : [{ campo, rotulo, texto, fonte: fonteDoCampo(dados, path, campo) }];
    });
    return responder(base, {
      cnct: {
        id: registro.id,
        denominacao: registro.denominacao,
        eixo: registro.eixo_tecnologico,
        area: registro.area_tecnologica,
        carga_horaria_minima: registro.carga_horaria_minima_h,
        link: linkCnct(registro.slug),
      },
      campos,
      cursos_ifpr: (yield* cursos.listar({ cnct: registro.slug })).map(paraCurso),
    });
  });

  const lerCampus = Effect.fn("Leitura.lerCampus")(function* (e: typeof Conteudos.EntradaCampus.Type) {
    const id = e.campus.replace(/^campus:/, "");
    const campus = campi.get(id);
    if (!campus) {
      return yield* new EntradaInvalida({
        mensagem: `campus não encontrado na base: "${id}". Os IDs dos campi estão em sobre_a_base`,
      });
    }
    return responder(base, {
      campus: { ...campus, link: linkCampus(campus.id) },
      cursos: (yield* cursos.listar({ campus: campus.id })).map(paraCurso),
    });
  });

  const lerFicha = Effect.fn("Leitura.lerFicha")(function* (e: typeof Conteudos.EntradaFicha.Type) {
    const pedido = e.ficha.replace(/^ficha:/, "").toUpperCase();
    const { arquivos } = yield* fontes.conteudoDasSkills();
    // as fichas do banco (dezenas): decodifica só as que podem ser a pedida
    const padrao = new RegExp(`"id"\\s*:\\s*"${pedido.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "i");
    let achada: { readonly arquivo: string; readonly ficha: Readonly<Record<string, unknown>> } | null = null;
    for (const candidato of arquivos.filter((a) => padrao.test(a.texto))) {
      const ficha = yield* decodificarJson(candidato.texto).pipe(
        Effect.catchTags({
          SchemaError: (erro) => Effect.fail(new FalhaNaBase({ operacao: "ficha da revisar-ppc", cause: erro })),
        }),
      );
      if (String(ficha.id).toUpperCase() === pedido) {
        achada = { arquivo: candidato.arquivo, ficha };
        break;
      }
    }
    if (!achada) {
      return yield* new EntradaInvalida({
        mensagem: `ficha não encontrada na base: "${e.ficha}". Use o ID da ficha da revisar-ppc, como "CT-CURR-12"`,
      });
    }
    const { arquivo, ficha } = achada;
    const id = String(ficha.id);
    const referencias = Array.isArray(ficha.referencias_normativas) ? ficha.referencias_normativas : [];
    return responder(base, {
      ficha: {
        id,
        titulo: textoOuNulo(ficha.titulo) ?? id,
        dominio: textoOuNulo(ficha.dominio),
        criticidade: textoOuNulo(ficha.criticidade),
        tipo_escopo: textoOuNulo(ficha.tipo_escopo),
        path: arquivo,
        link: linkFicha(id),
      },
      campos: Conteudos.CAMPOS_FICHA.flatMap(([campo, rotulo]) => {
        const texto = textoOuNulo(ficha[campo]);
        return texto === null ? [] : [{ campo, rotulo, texto, fonte: fonteDoCampo(ficha, arquivo, campo) }];
      }),
      referencias: referencias.flatMap((r: unknown) => {
        if (typeof r !== "object" || r === null) return [];
        const { ref, dispositivo, papel } = r as Record<string, unknown>;
        if (typeof ref !== "string") return [];
        const disp = textoOuNulo(dispositivo);
        return [{ ref, dispositivo: disp, papel: textoOuNulo(papel), link: linkNorma(ref, disp?.replace(/^#/, "")) }];
      }),
    });
  });

  return { lerPpc, lerCnct, lerCampus, lerFicha };
});
