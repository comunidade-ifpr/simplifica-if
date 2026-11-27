/**
 * Leituras das ferramentas da tarefa "Revisar um PPC", sobre o serviço `PacoteRevisaoPpc` do kb:
 * `criterios_revisao_ppc` (os critérios por ID, tópico ou norma) e `pacote_revisao_ppc` (T4). Esta,
 * para
 * `arquivo`, sobre a `PastaTrabalho`, que o `Leitura` recebe como opcional: sem ela, `arquivo` é
 * recusado. Os erros do kb (PPC, grupo ou tarefa desconhecidos) viram `EntradaInvalida`.
 *
 * A `PastaTrabalho` presente no contexto da chamada vale mais que a da construção do `Leitura`: o
 * servidor HTTP (`http.ts`) a fornece por requisição, com a pasta da sessão do token. No stdio, a
 * única pasta é a da construção.
 */
import type * as Sql from "@simplifica-if/kb/db/sql";
import { linhaDaChave } from "@simplifica-if/kb/institucional/dados";
import * as PacoteRevisaoPpc from "@simplifica-if/kb/PacoteRevisaoPpc";
import { REGRAS_BAIXA_CONFIANCA } from "@simplifica-if/kb/ppcs/citacoes";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { type Aviso, type Base, EntradaInvalida } from "../contratos.ts";
import { responder } from "../envelope.ts";
import * as CriteriosF from "../ferramentas/criterios-revisao-ppc.ts";
import * as PacoteRevisaoPpcF from "../ferramentas/pacote-revisao-ppc.ts";
import { linkNorma } from "../links.ts";
import { AVISO_FATO_EXTRAIDO, avisoBaixaConfianca, chavePpc } from "./comum.ts";
import * as PastaTrabalho from "./PastaTrabalho.ts";

function textoOuNulo(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor : null;
}

/** Os avisos do pacote: normas ainda não vigentes, fatos extraídos, citações de baixa confiança. */
function avisosDoPacote(d: typeof PacoteRevisaoPpcF.Dados.Type): Aviso[] {
  const avisos: Aviso[] = [];
  const naoVigentes = d.normas.filter((n) => n.status_vigencia === "ainda-nao-vigente").map((n) => n.ref);
  if (naoVigentes.length) {
    avisos.push({
      tipo: "ainda-nao-vigente",
      mensagem: `normas ainda não vigentes na data da consulta (${naoVigentes.join(", ")}): aguardam publicação ou têm vigência futura, e as regras de transição delas ainda não começaram; diga isso ao usuário`,
    });
  }
  const semTexto = d.normas.flatMap((n) => n.sem_texto);
  if (semTexto.length) {
    avisos.push({
      tipo: "stub-sem-texto",
      mensagem: `dispositivos citados pelas fichas sem texto na base: ${semTexto.join(", ")}; não afirme o conteúdo deles`,
    });
  }
  if ("fatos" in d && d.fatos !== null) avisos.push(AVISO_FATO_EXTRAIDO);
  const regras = d.marcos.flatMap((m) => m.citacoes_no_ppc.map((c) => c.regra));
  if (regras.some((r) => REGRAS_BAIXA_CONFIANCA.has(r))) avisos.push(...avisoBaixaConfianca(regras));
  return avisos;
}

export const makePacote = Effect.fn("Leitura.makePacote")(function* (base: Base) {
  const pacotes = yield* PacoteRevisaoPpc.PacoteRevisaoPpc;
  const pasta = yield* Effect.serviceOption(PastaTrabalho.PastaTrabalho);

  const doKb = <A>(
    efeito: Effect.Effect<
      A,
      Sql.FalhaNaConsulta | PacoteRevisaoPpc.PpcNaoEncontrado | PacoteRevisaoPpc.TarefaNaoReconhecida
    >,
  ) =>
    efeito.pipe(
      Effect.catchTags({
        PpcNaoEncontrado: (erro) =>
          Effect.fail(
            new EntradaInvalida({
              mensagem: `${erro.message}. Use "campus/curso/versao" (como "curitiba/tecnico-em-enfermagem/2023") ou o curso, "campus/curso", para o PPC vigente, vindo de listar_cursos ou de ficha_curso`,
            }),
          ),
        TarefaNaoReconhecida: (erro) => Effect.fail(new EntradaInvalida({ mensagem: erro.message })),
      }),
    );

  const pacoteRevisaoPpc = Effect.fn("Leitura.pacoteRevisaoPpc")(function* (e: typeof PacoteRevisaoPpcF.Entrada.Type) {
    if ((e.ppc === undefined) === (e.arquivo === undefined)) {
      return yield* new EntradaInvalida({
        mensagem:
          'informe exatamente um destes: ppc (um PPC da base, como "curitiba/tecnico-em-enfermagem") ou arquivo (um .md dentro da pasta de trabalho do servidor)',
      });
    }
    let dados: typeof PacoteRevisaoPpcF.Dados.Type;
    if (e.ppc !== undefined) {
      dados = yield* doKb(pacotes.montar(e.tarefa, yield* chavePpc(e.ppc)));
    } else {
      // a pasta da sessão (servidor HTTP), se houver; senão, a da construção
      const daChamada = yield* Effect.serviceOption(PastaTrabalho.PastaTrabalho);
      const atual = Option.orElse(daChamada, () => pasta);
      if (Option.isNone(atual)) {
        return yield* new EntradaInvalida({
          mensagem: "arquivo: este servidor não tem pasta de trabalho e não lê arquivos; use ppc, com um PPC da base",
        });
      }
      const lido = yield* atual.value.lerMarkdown(e.arquivo!);
      dados = yield* doKb(pacotes.doMarkdown(e.tarefa, lido.caminho, lido.markdown));
    }
    const avisos = avisosDoPacote(dados);
    // o texto passa do teto? (a mesma conta que a ferramenta faz com os avisos da resposta)
    const comResumo = [...avisos, PacoteRevisaoPpcF.AVISO_RESUMIDO];
    const resumido = PacoteRevisaoPpcF.corpoDoPacote(dados, PacoteRevisaoPpcF.orcamentoDoCorpo(comResumo)).resumido;
    return responder(base, dados, { avisos: resumido ? comResumo : avisos });
  });

  const criteriosRevisaoPpc = Effect.fn("Leitura.criteriosRevisaoPpc")(function* (e: typeof CriteriosF.Entrada.Type) {
    const pedidos = [e.id, e.topico, e.norma].filter((v) => v !== undefined);
    if (pedidos.length !== 1) {
      return yield* new EntradaInvalida({
        mensagem:
          'informe exatamente um destes: id (um critério, como "CT-CURR-12"), topico (como "estagio") ou norma (um ID canônico, como "br/cne-cp/res/2021/1")',
      });
    }
    const resultado = yield* pacotes
      .criterios(
        e.id !== undefined ? { id: e.id } : e.topico !== undefined ? { topico: e.topico } : { norma: e.norma! },
      )
      .pipe(
        Effect.catchTags({
          CriteriosNaoEncontrados: (erro) =>
            Effect.fail(new EntradaInvalida({ mensagem: `${erro.campo}: ${erro.message}` })),
        }),
      );
    return responder(base, {
      filtro: resultado.filtro,
      titulo: resultado.titulo,
      criterios: resultado.criterios.map((c) => {
        const ficha = c.ficha;
        const execucao = (
          typeof ficha.execucao === "object" && ficha.execucao !== null ? ficha.execucao : {}
        ) as Record<string, unknown>;
        const indentado = JSON.stringify(ficha, null, 2);
        return {
          id: c.id,
          titulo: c.titulo,
          dominio: textoOuNulo(ficha.dominio),
          criticidade: textoOuNulo(ficha.criticidade),
          path: c.path,
          topicos: c.topicos,
          execucao: { modo: textoOuNulo(execucao.modo), justificativa: textoOuNulo(execucao.justificativa) },
          campos: CriteriosF.CAMPOS_CRITERIO.flatMap(([campo, rotulo]) => {
            const texto = textoOuNulo(ficha[campo]);
            if (texto === null) return [];
            const linha = linhaDaChave(indentado, campo);
            return [{ campo, rotulo, texto, fonte: { path: c.path, linha_inicio: linha, linha_fim: linha } }];
          }),
          referencias: c.referencias.map((r) => ({
            ...r,
            link: r.ref.startsWith("cnct:") ? null : linkNorma(r.ref, r.dispositivo?.replace(/^#/, "")),
          })),
          ...(c.atingido ? { atingido: c.atingido } : {}),
          ficha,
        };
      }),
      ...(resultado.topicos_atingidos ? { topicos_atingidos: resultado.topicos_atingidos } : {}),
      ...(resultado.arquivos_da_tarefa ? { arquivos_da_tarefa: resultado.arquivos_da_tarefa } : {}),
    });
  });

  return { pacoteRevisaoPpc, criteriosRevisaoPpc };
});
