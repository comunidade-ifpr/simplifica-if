/**
 * O que a interface faz depois de o servidor apagar uma revisão (a tela da revisão, "Revisões recentes" e
 * a revisão apagada em outra janela): esquece o PPC dela (a trilha e a prateleira do Ler, a memória do
 * leitor, as rolagens lembradas) e as origens das conversas ao lado dela no painel (a conversa já aberta
 * segue como livre; o rascunho sai). Se a pessoa pediu as pastas das conversas ao lado na Lixeira, as
 * conversas de cada pasta saem junto (a da revisão e a que a continuou com outra IA): sem a pasta, elas não
 * teriam onde seguir. O servidor as apaga antes (e fecha a sessão da IA, que não segura mais arquivo da
 * pasta), e a pasta vai à Lixeira depois.
 *
 * Depois de "Qual é o curso?", que refaz a lista com outro id, o painel segue a lista nova
 * (`depoisDeTrocarCurso`): as origens das conversas ao lado e os links do PPC no Ler.
 */
import type { PonteDesktop } from "@simplifica-if/contratos-app/ponte";
import type { ListaPendencias } from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import { ehSessaoDesconhecida } from "../../conexao/erros.ts";
import type { ContextoApp } from "../../contexto.tsx";
import type { MemoriaLeitor } from "../../leitor/carga.ts";
import { esquecerRolagens } from "../../lib/rolagem.ts";
import { ehLinkDaRevisao, grupoDaRevisao, lerOrigem } from "./conversa.ts";

/** A chave da rolagem lembrada da tela da revisão (`lib/rolagem.ts`). */
export const chaveDaRolagem = (lista: string): string => `revisao-ppc:${lista}`;

/** As pastas das conversas ao lado que não foram à Lixeira (e por isso continuam no computador), se alguma. */
export async function depoisDeApagarRevisao(
  app: Pick<ContextoApp, "api" | "conversas" | "painel">,
  memoria: MemoriaLeitor,
  lista: ListaPendencias,
  lixeira: { readonly ponte: PonteDesktop | undefined; readonly pasta: boolean },
): Promise<ReadonlyArray<string> | undefined> {
  app.painel.esquecerLinks(ehLinkDaRevisao(lista.id));
  app.painel.esquecerOrigem((chave) => lerOrigem(chave)?.lista === lista.id);
  memoria.esquecerPrefixo(`revisao-ppc:${lista.id}/`);
  esquecerRolagens((chave) => chave === chaveDaRolagem(lista.id) || chave.includes(`ifpr://revisao-ppc/${lista.id}/`));
  const ponte = lixeira.ponte;
  if (!lixeira.pasta || lista.conversas.length === 0 || ponte === undefined) return undefined;
  let todas: ReadonlyArray<{ readonly id: string; readonly pastaTrabalho: string }>;
  try {
    todas = await app.api.chamar((c) => c["conversa.listar"]({}));
  } catch {
    return [...new Set(lista.conversas.map((c) => c.pasta))];
  }
  const ficaram: string[] = [];
  // Uma pasta por conversa: cada pasta sai com as conversas dela, e a que falha não segura as outras.
  for (const pasta of new Set(lista.conversas.map((c) => c.pasta))) {
    try {
      const daPasta = new Set([
        ...lista.conversas.filter((c) => c.pasta === pasta).map((c) => c.conversa),
        ...todas.filter((c) => c.pastaTrabalho === pasta).map((c) => c.id),
      ]);
      for (const sessao of daPasta) {
        await app.api
          .chamar((c) => c["conversa.apagar"]({ sessao }))
          .catch((motivo: unknown) => {
            // Já apagada pela lista de conversas: a pasta vai do mesmo jeito.
            if (!ehSessaoDesconhecida(motivo)) throw motivo;
          });
        app.conversas.apagada(sessao);
      }
      await ponte.pastaParaLixeira(pasta);
    } catch {
      ficaram.push(pasta);
    }
  }
  return ficaram.length === 0 ? undefined : ficaram;
}

/** "Qual é o curso?" refez a lista `antiga` como `nova`: o painel segue a lista nova, e a antiga se esquece. */
export function depoisDeTrocarCurso(
  app: Pick<ContextoApp, "painel">,
  memoria: MemoriaLeitor,
  antiga: string,
  nova: string,
): void {
  const de = grupoDaRevisao(antiga);
  app.painel.trocarOrigem((chave) =>
    lerOrigem(chave)?.lista === antiga ? grupoDaRevisao(nova) + chave.slice(de.length) : chave,
  );
  app.painel.trocarLinks(`ifpr://revisao-ppc/${antiga}/`, `ifpr://revisao-ppc/${nova}/`);
  memoria.esquecerPrefixo(`revisao-ppc:${antiga}/`);
  esquecerRolagens((chave) => chave === chaveDaRolagem(antiga) || chave.includes(`ifpr://revisao-ppc/${antiga}/`));
}
