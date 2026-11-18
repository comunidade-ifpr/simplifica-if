/**
 * Ponto de entrada Effect dos scripts: o `executarPrincipal` comum (`@simplifica-if/kb/principal`,
 * com o relatório de falha no stderr e os códigos de saída) mais o `ConfigProvider` de
 * `configuracao.ts` (ambiente, com recaída no `.env.local` da raiz). `EncerrarComCodigo` e `sairCom`
 * vêm direto de `@simplifica-if/kb/principal`.
 */
import type * as NodeServices from "@effect/platform-node/NodeServices";
import * as Principal from "@simplifica-if/kb/principal";
import * as Effect from "effect/Effect";
import * as Configuracao from "./configuracao.ts";

/** Roda `programa` como ponto de entrada do processo (só em `if (import.meta.main)`). */
export function executarPrincipal<E>(nome: string, programa: Effect.Effect<void, E, NodeServices.NodeServices>): void {
  // A falha ao montar a configuração (um `.env.local` ilegível) também passa pelo relatório.
  Principal.executarPrincipal(nome, programa.pipe(Effect.provide(Configuracao.layer)));
}
