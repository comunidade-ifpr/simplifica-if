/**
 * O catálogo de tarefas do Início (M1.9): as skills do servidor (`skills.listar`) e as tarefas nativas
 * do app, que não são skill do catálogo. Hoje a nativa é "Analisar um PPC", que leva ao fluxo da
 * revisão prévia (`/revisao-ppc`: pré-conferência, roteiro e relatório com IA), sem duplicá-lo.
 *
 * O filtro pelo perfil (`publico` × função da pessoa) entra com o perfil do primeiro uso (M1.8): sem
 * perfil, todas as tarefas aparecem.
 */
import type { ResumoSkill } from "@simplifica-if/contratos-app";
import { useEffect, useState } from "react";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { useApi, useEstadoConexao } from "../contexto.tsx";
import type { Perfil } from "./perfil.ts";

/** Uma tarefa do catálogo: uma skill (abre o formulário) ou uma tarefa nativa (abre a tela dela). */
export type Tarefa =
  | { readonly tipo: "skill"; readonly skill: ResumoSkill }
  | {
      readonly tipo: "nativa";
      readonly nome: string;
      readonly titulo: string;
      readonly resumo: string;
      readonly area: string;
      readonly rota: "/revisao-ppc";
    };

export const TAREFAS_NATIVAS: ReadonlyArray<Extract<Tarefa, { tipo: "nativa" }>> = [
  {
    tipo: "nativa",
    nome: "analisar-ppc",
    titulo: "Analisar um PPC",
    resumo:
      "Confere o PPC (.docx) com as normas, o CNCT e a matriz da base, e devolve uma cópia do documento com comentários.",
    area: "ensino",
    rota: "/revisao-ppc",
  },
];

export const tituloTarefa = (tarefa: Tarefa): string => (tarefa.tipo === "skill" ? tarefa.skill.titulo : tarefa.titulo);
export const nomeTarefa = (tarefa: Tarefa): string => (tarefa.tipo === "skill" ? tarefa.skill.nome : tarefa.nome);
export const areaTarefa = (tarefa: Tarefa): string => (tarefa.tipo === "skill" ? tarefa.skill.area : tarefa.area);
export const resumoTarefa = (tarefa: Tarefa): string => (tarefa.tipo === "skill" ? tarefa.skill.resumo : tarefa.resumo);

/** As tarefas para o perfil: as nativas primeiro, depois as skills; sem perfil, todas. */
export function tarefasDoPerfil(skills: ReadonlyArray<ResumoSkill>, perfil: Perfil | undefined): ReadonlyArray<Tarefa> {
  const funcao = perfil?.funcao;
  const servem = (skill: ResumoSkill) =>
    funcao === undefined || skill.publico.length === 0 || skill.publico.includes(funcao);
  return [...TAREFAS_NATIVAS, ...skills.filter(servem).map((skill): Tarefa => ({ tipo: "skill", skill }))];
}

export type Catalogo =
  | { readonly fase: "carregando" }
  | { readonly fase: "pronto"; readonly skills: ReadonlyArray<ResumoSkill> }
  | { readonly fase: "falhou"; readonly erro: MensagemErro };

/** As skills do servidor, carregadas quando a conexão abre. */
export function useCatalogo(): Catalogo {
  const api = useApi();
  const conectado = useEstadoConexao().fase === "conectada";
  const [catalogo, setCatalogo] = useState<Catalogo>({ fase: "carregando" });
  useEffect(() => {
    if (!conectado) return;
    let vale = true;
    api
      .chamar((cliente) => cliente["skills.listar"]({}))
      .then(
        (skills) => vale && setCatalogo({ fase: "pronto", skills }),
        (erro: unknown) => vale && setCatalogo({ fase: "falhou", erro: explicarErro(erro) }),
      );
    return () => {
      vale = false;
    };
  }, [api, conectado]);
  return catalogo;
}
