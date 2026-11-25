/**
 * O catálogo de tarefas do Início (M1.9): as skills do servidor (`skills.listar`) e as tarefas nativas
 * do app, que não são skill do catálogo. Hoje a nativa é "Revisar um PPC", que leva ao fluxo da
 * revisão prévia (`/revisao-ppc`: pré-conferência, roteiro e relatório com IA), sem duplicá-lo.
 *
 * O perfil do primeiro uso (M1.8) ordena e filtra: categoria, cargo, função e unidade da pessoa viram
 * os públicos do manifesto (`publicosDoPerfil`), e servem a ela as tarefas cujo `publico` inclui um
 * deles ou que não dizem a quem servem. O Início mostra só as que servem;
 * "Todas as tarefas" mostra o catálogo inteiro, com as que servem primeiro em cada área. Sem perfil, ou
 * com um perfil que não dá público nenhum, nada se filtra.
 */
import { type Publico, publicosDoPerfil, type ResumoSkill } from "@simplifica-if/contratos-app";
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
      readonly publico: ReadonlyArray<Publico>;
      readonly rota: "/revisao-ppc";
    };

export const TAREFAS_NATIVAS: ReadonlyArray<Extract<Tarefa, { tipo: "nativa" }>> = [
  {
    tipo: "nativa",
    nome: "revisar-ppc",
    titulo: "Revisar um PPC",
    resumo:
      "Confere o PPC (.docx) com as normas, o CNCT e a matriz da base, e devolve uma cópia do documento com comentários.",
    area: "ensino",
    // Tarefa base: serve a todo perfil.
    publico: [],
    rota: "/revisao-ppc",
  },
];

export const tituloTarefa = (tarefa: Tarefa): string => (tarefa.tipo === "skill" ? tarefa.skill.titulo : tarefa.titulo);
export const nomeTarefa = (tarefa: Tarefa): string => (tarefa.tipo === "skill" ? tarefa.skill.nome : tarefa.nome);
export const areaTarefa = (tarefa: Tarefa): string => (tarefa.tipo === "skill" ? tarefa.skill.area : tarefa.area);
export const resumoTarefa = (tarefa: Tarefa): string => (tarefa.tipo === "skill" ? tarefa.skill.resumo : tarefa.resumo);

export const publicoTarefa = (tarefa: Tarefa): ReadonlyArray<string> =>
  tarefa.tipo === "skill" ? tarefa.skill.publico : tarefa.publico;

/**
 * A tarefa serve ao perfil? `undefined` quando não há o que comparar (sem perfil, ou perfil sem
 * público); `true` também para a tarefa que não diz a quem serve.
 */
export function servePerfil(tarefa: Tarefa, perfil: Perfil | undefined): boolean | undefined {
  const publicos: ReadonlyArray<string> = publicosDoPerfil(perfil);
  if (publicos.length === 0) return undefined;
  const publico = publicoTarefa(tarefa);
  return publico.length === 0 || publico.some((p) => publicos.includes(p));
}

/** O catálogo inteiro (as nativas primeiro, depois as skills), com as que servem ao perfil antes. */
export function tarefasDoPerfil(skills: ReadonlyArray<ResumoSkill>, perfil: Perfil | undefined): ReadonlyArray<Tarefa> {
  const todas: ReadonlyArray<Tarefa> = [
    ...TAREFAS_NATIVAS,
    ...skills.map((skill): Tarefa => ({ tipo: "skill", skill })),
  ];
  return [
    ...todas.filter((tarefa) => servePerfil(tarefa, perfil) !== false),
    ...todas.filter((tarefa) => servePerfil(tarefa, perfil) === false),
  ];
}

/** As tarefas do Início: só as que servem ao perfil (todas, sem perfil); a nativa serve a todo perfil. */
export function tarefasDoInicio(skills: ReadonlyArray<ResumoSkill>, perfil: Perfil | undefined): ReadonlyArray<Tarefa> {
  return tarefasDoPerfil(skills, perfil).filter((tarefa) => servePerfil(tarefa, perfil) !== false);
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
