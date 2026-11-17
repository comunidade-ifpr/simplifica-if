/**
 * Configurações do Modo Servidor (M1.9): Sua IA (instalar, entrar e o estado de cada uma), Seu perfil
 * (o primeiro uso, M1.8), Atualizações (M1.10, outra frente: aqui fica só o lugar da seção) e, no fim,
 * discreta, a conversa com uma pasta escolhida à mão, a tela técnica de antes do Modo Servidor.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FolderCogIcon } from "lucide-react";
import type { ReactNode } from "react";
import { CartaoProvider } from "../components/CartaoProvider.tsx";
import { Button } from "../components/ui/button.tsx";
import { useConversa, useEstadoConexao } from "../contexto.tsx";
import { PROVIDERS } from "../providers.ts";

export const Route = createFileRoute("/configuracoes")({ component: Configuracoes });

function Secao({
  id,
  titulo,
  children,
}: {
  readonly id: string;
  readonly titulo: string;
  readonly children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`titulo-${id}`} className="flex flex-col gap-3">
      <h2 id={`titulo-${id}`} className="font-semibold text-xl">
        {titulo}
      </h2>
      {children}
    </section>
  );
}

function Configuracoes() {
  const conexao = useEstadoConexao();
  const [, conversa] = useConversa();
  const navegar = useNavigate();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 p-6">
        <h1 className="font-bold text-2xl tracking-tight">Configurações</h1>
        <Secao id="ia" titulo="Sua IA">
          <p className="max-w-prose text-muted-foreground">
            O Simplifica IF conversa com a IA da sua conta pessoal. A IA recebe a base pública do IFPR e os arquivos que
            você anexar; não anexe documento com dado pessoal ou de acesso restrito.
          </p>
          {conexao.fase === "sem-servidor" ? null : (
            <div className="grid gap-4 md:grid-cols-3">
              {PROVIDERS.map((provider) => (
                <CartaoProvider key={provider} provider={provider} />
              ))}
            </div>
          )}
        </Secao>
        <Secao id="perfil" titulo="Seu perfil">
          {/* M1.8: campus, função e cursos, guardados só neste computador (`tarefas/perfil.ts`). */}
          <p className="max-w-prose text-muted-foreground">
            Em breve: seu campus, sua função e seus cursos, para o Início mostrar primeiro as tarefas que servem a você.
            O perfil fica só neste computador.
          </p>
        </Secao>
        <Secao id="atualizacoes" titulo="Atualizações">
          {/* M1.10: versões do app, da base e das skills; canal (estável ou beta). */}
          <p className="max-w-prose text-muted-foreground">Em breve: as versões do app e da base, e as novidades.</p>
        </Secao>
        <Secao id="avancado" titulo="Avançado">
          <p className="max-w-prose text-muted-foreground text-sm">
            Para quem já sabe o que quer: uma conversa numa pasta que você escolhe, sem tarefa.
          </p>
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                conversa.nova();
                void navegar({ to: "/conversa" });
              }}
            >
              <FolderCogIcon /> Conversa com uma pasta escolhida
            </Button>
          </div>
        </Secao>
      </div>
    </div>
  );
}
