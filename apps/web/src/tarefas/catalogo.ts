/**
 * O catálogo de tarefas do Início: tudo vem do servidor (`tarefas.listar`), um cartão por manifesto de
 * `catalogo/tarefas/`. A tarefa abre de um de três jeitos (`abre`): um link no navegador, uma conversa (com o
 * formulário) ou a tela de um módulo do app (`abrir.ts`).
 *
 * O perfil do primeiro uso (M1.8) ordena e filtra: categoria, cargo, função e unidade da pessoa viram
 * os públicos do manifesto (`publicosDoPerfil`), e servem a ela as tarefas cujo `publico` inclui um
 * deles ou que não dizem a quem servem. O Início mostra só as que servem, com as que rodam no app
 * (conversa e módulo) antes das de link; "Todas as tarefas" mostra o catálogo inteiro, com as que servem
 * primeiro em cada área. Sem perfil, ou com um perfil que não dá público nenhum, nada se filtra.
 */
import { publicosDoPerfil, type ResumoTarefa, type TarefaRetirada } from "@simplifica-if/contratos-app";
import { useEffect, useState } from "react";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { useApi, useEstadoConexao } from "../contexto.tsx";
import type { Perfil } from "./perfil.ts";

/** Uma tarefa do catálogo. */
export type Tarefa = ResumoTarefa;

/**
 * A tarefa serve ao perfil? `undefined` quando não há o que comparar (sem perfil, ou perfil sem
 * público); `true` também para a tarefa que não diz a quem serve.
 */
export function servePerfil(tarefa: Tarefa, perfil: Perfil | undefined): boolean | undefined {
  const publicos = publicosDoPerfil(perfil);
  if (publicos.length === 0) return undefined;
  return tarefa.publico.length === 0 || tarefa.publico.some((p) => publicos.includes(p));
}

/** O catálogo inteiro, na ordem do servidor, com as que servem ao perfil antes. */
export function tarefasDoPerfil(tarefas: ReadonlyArray<Tarefa>, perfil: Perfil | undefined): ReadonlyArray<Tarefa> {
  return [
    ...tarefas.filter((tarefa) => servePerfil(tarefa, perfil) !== false),
    ...tarefas.filter((tarefa) => servePerfil(tarefa, perfil) === false),
  ];
}

/**
 * As tarefas do Início: só as que servem ao perfil (todas, sem perfil), com as de link por último. O
 * Início mostra poucos cartões: um link para outro sistema não tira da tela a tarefa que roda no app.
 */
export function tarefasDoInicio(tarefas: ReadonlyArray<Tarefa>, perfil: Perfil | undefined): ReadonlyArray<Tarefa> {
  const servem = tarefas.filter((tarefa) => servePerfil(tarefa, perfil) !== false);
  return [
    ...servem.filter((tarefa) => tarefa.abre.tipo !== "link"),
    ...servem.filter((tarefa) => tarefa.abre.tipo === "link"),
  ];
}

/**
 * O título da tarefa de uma conversa: a do catálogo ou, se ela saiu dele (descontinuada, ou que este
 * app não atende mais), o que o servidor ainda guarda dela.
 */
export function tituloDaTarefa(
  catalogo: { readonly tarefas: ReadonlyArray<Tarefa>; readonly retiradas: ReadonlyArray<TarefaRetirada> },
  id: string,
): string | undefined {
  return (
    catalogo.tarefas.find((tarefa) => tarefa.id === id)?.titulo ??
    catalogo.retiradas.find((tarefa) => tarefa.id === id)?.titulo
  );
}

export type Catalogo =
  | { readonly fase: "carregando" }
  | {
      readonly fase: "pronto";
      readonly tarefas: ReadonlyArray<Tarefa>;
      /** As tarefas fora do catálogo: só nomeiam as conversas antigas delas. */
      readonly retiradas: ReadonlyArray<TarefaRetirada>;
    }
  | { readonly fase: "falhou"; readonly erro: MensagemErro };

/** As tarefas do servidor, carregadas quando a conexão abre. */
export function useCatalogo(): Catalogo {
  const api = useApi();
  const conectado = useEstadoConexao().fase === "conectada";
  const [catalogo, setCatalogo] = useState<Catalogo>({ fase: "carregando" });
  useEffect(() => {
    if (!conectado) return;
    let vale = true;
    api
      .chamar((cliente) => cliente["tarefas.listar"]({}))
      .then(
        ({ tarefas, retiradas }) => vale && setCatalogo({ fase: "pronto", tarefas, retiradas }),
        (erro: unknown) => vale && setCatalogo({ fase: "falhou", erro: explicarErro(erro) }),
      );
    return () => {
      vale = false;
    };
  }, [api, conectado]);
  return catalogo;
}
