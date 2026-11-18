/**
 * `lerDocumento` (M1.6): o Markdown inteiro de uma norma da base ou de um PPC convertido
 * (`Normas.documento`, `Ppcs.documento`), com as âncoras do leitor: os dispositivos da norma ou as
 * seções do índice do PPC. O front matter vem em linhas em branco, para que as linhas do texto sejam
 * as do arquivo e as das âncoras.
 */
import * as Normas from "@simplifica-if/kb/Normas";
import * as Ppcs from "@simplifica-if/kb/Ppcs";
import * as Effect from "effect/Effect";
import { type Aviso, type Base, EntradaInvalida, FalhaNaBase } from "../contratos.ts";
import type { Ancora, EntradaDocumento } from "../documento.ts";
import { responder } from "../envelope.ts";
import { lerLink, linkNorma, linkPpc } from "../links.ts";
import { chavePpc } from "./comum.ts";

/** O Markdown do documento: a norma da base e o PPC sempre têm o arquivo na tabela `documentos`. */
const comTexto = (markdown: string | null) =>
  markdown === null
    ? // sem ele, o banco é de outro esquema
      Effect.fail(new FalhaNaBase({ operacao: "documento sem texto no kb.sqlite" }))
    : Effect.succeed(markdown);

/** O fragmento de um ID com `#` (`br/…/2#art28` → `art28`). */
const fragmento = (id: string) => id.slice(id.indexOf("#") + 1);

export const makeDocumentos = Effect.fn("Leitura.makeDocumentos")(function* (base: Base) {
  const normas = yield* Normas.Normas;
  const ppcs = yield* Ppcs.Ppcs;

  const documentoDaNorma = Effect.fnUntraced(function* (id: string, pedido: string | null) {
    const norma = yield* normas.documento(id);
    if (!norma) {
      return yield* new EntradaInvalida({
        mensagem: `norma não encontrada na base: "${id}". Confira o ID com buscar_norma`,
      });
    }
    if (norma.situacao !== "base" || norma.path === null) {
      return yield* new EntradaInvalida({
        mensagem: `a norma "${norma.titulo}" não tem o texto na base, só a referência; veja a ficha em ${linkNorma(id)}`,
      });
    }
    const ancoras: Ancora[] = norma.dispositivos.map((d) => ({
      id: d.dispositivo.replace(/^#/, ""),
      rotulo: d.rotulo,
      tipo: d.tipo,
      pai: d.pai === null ? null : fragmento(d.pai),
      linha_inicio: d.linha_inicio,
      linha_fim: d.linha_fim,
      revogado: d.revogado,
    }));
    return {
      tipo: "norma" as const,
      id: norma.id,
      titulo: norma.titulo,
      link: linkNorma(norma.id),
      path: norma.path,
      markdown: yield* comTexto(norma.markdown),
      ancoras,
      pedido,
      datas: norma.datas,
    };
  });

  const documentoDoPpc = Effect.fnUntraced(function* (caminho: string, pedido: string | null) {
    const chave = yield* chavePpc(caminho);
    const ppc = yield* ppcs.documento(chave);
    if (!ppc) {
      return yield* new EntradaInvalida({
        mensagem: `PPC não encontrado na base: "${chave}". Use o ID de listar_cursos ("campus/curso")`,
      });
    }
    const ancoras: Ancora[] = ppc.secoes.map((s) => ({
      id: fragmento(s.id),
      rotulo: s.titulo,
      tipo: s.tipo,
      pai: null,
      linha_inicio: s.linha_inicio,
      linha_fim: s.linha_fim,
      revogado: false,
    }));
    return {
      tipo: "ppc" as const,
      id: ppc.chave,
      titulo: `${ppc.curso_nome} (${ppc.campus_nome})`,
      link: linkPpc(ppc.chave),
      path: ppc.path,
      markdown: yield* comTexto(ppc.markdown),
      ancoras,
      pedido,
      datas: null,
    };
  });

  const lerDocumento = Effect.fn("Leitura.lerDocumento")(function* (e: typeof EntradaDocumento.Type) {
    const link = lerLink(e.link);
    if (!link || (link.tipo !== "norma" && link.tipo !== "ppc")) {
      return yield* new EntradaInvalida({
        mensagem: `o leitor abre como documento só links de norma e de PPC, como ifpr://norma/br/lei/1996/9394#art36 ou ifpr://ppc/curitiba/tecnico-em-enfermagem; veio "${e.link}"`,
      });
    }
    const { pedido, ...documento } =
      link.tipo === "norma"
        ? yield* documentoDaNorma(link.caminho, link.fragmento)
        : yield* documentoDoPpc(link.caminho, link.fragmento);
    const alvo = pedido !== null && documento.ancoras.some((a) => a.id === pedido) ? pedido : null;
    const avisos: Aviso[] =
      pedido !== null && alvo === null
        ? [
            {
              tipo: "nao-encontrado",
              mensagem: `"#${pedido}" não está ${link.tipo === "norma" ? "entre os dispositivos desta norma" : "entre as seções deste PPC"}; o documento abre no começo`,
              ref: e.link,
            },
          ]
        : [];
    return responder(base, { ...documento, alvo }, { avisos });
  });

  return { lerDocumento };
});
