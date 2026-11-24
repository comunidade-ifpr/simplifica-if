/**
 * Leitura da ferramenta `pacote_contexto` (T4), sobre o serviço `PacoteContexto` do kb e, para
 * `arquivo`, sobre a `PastaTrabalho`, que o `Leitura` recebe como opcional: sem ela, `arquivo` é
 * recusado. Os erros do kb (PPC, grupo ou tarefa desconhecidos) viram `EntradaInvalida`.
 *
 * A `PastaTrabalho` presente no contexto da chamada vale mais que a da construção do `Leitura`: o
 * servidor HTTP (`http.ts`) a fornece por requisição, com a pasta da sessão do token. No stdio, a
 * única pasta é a da construção.
 */
import type * as Sql from "@simplifica-if/kb/db/sql";
import * as PacoteContexto from "@simplifica-if/kb/PacoteContexto";
import { REGRAS_BAIXA_CONFIANCA } from "@simplifica-if/kb/ppcs/citacoes";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { type Aviso, type Base, EntradaInvalida } from "../contratos.ts";
import { responder } from "../envelope.ts";
import * as PacoteContextoF from "../ferramentas/pacote-contexto.ts";
import { AVISO_FATO_EXTRAIDO, avisoBaixaConfianca, chavePpc } from "./comum.ts";
import * as PastaTrabalho from "./PastaTrabalho.ts";

/** Os avisos do pacote: normas ainda não vigentes, fatos extraídos, citações de baixa confiança. */
function avisosDoPacote(d: typeof PacoteContextoF.Dados.Type): Aviso[] {
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
  const pacotes = yield* PacoteContexto.PacoteContexto;
  const pasta = yield* Effect.serviceOption(PastaTrabalho.PastaTrabalho);

  const doKb = <A>(
    efeito: Effect.Effect<
      A,
      Sql.FalhaNaConsulta | PacoteContexto.PpcNaoEncontrado | PacoteContexto.TarefaNaoReconhecida
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

  const pacoteContexto = Effect.fn("Leitura.pacoteContexto")(function* (e: typeof PacoteContextoF.Entrada.Type) {
    if ((e.ppc === undefined) === (e.arquivo === undefined)) {
      return yield* new EntradaInvalida({
        mensagem:
          'informe exatamente um destes: ppc (um PPC da base, como "curitiba/tecnico-em-enfermagem") ou arquivo (um .md dentro da pasta de trabalho do servidor)',
      });
    }
    let dados: typeof PacoteContextoF.Dados.Type;
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
    const comResumo = [...avisos, PacoteContextoF.AVISO_RESUMIDO];
    const resumido = PacoteContextoF.corpoDoPacote(dados, PacoteContextoF.orcamentoDoCorpo(comResumo)).resumido;
    return responder(base, dados, { avisos: resumido ? comResumo : avisos });
  });

  return { pacoteContexto };
});
