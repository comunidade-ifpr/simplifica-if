/**
 * Rota provisória da seção "Atualizações" (M1.10), sem link na navegação: a tela de Configurações do
 * Modo Servidor (M1.9) monta o mesmo componente na seção dela, e esta rota sai depois.
 */
import { createFileRoute } from "@tanstack/react-router";
import { Atualizacoes } from "../configuracoes/Atualizacoes.tsx";

export const Route = createFileRoute("/atualizacoes")({ component: TelaAtualizacoes });

function TelaAtualizacoes() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
        <Atualizacoes />
      </div>
    </div>
  );
}
