/**
 * Início: os três providers, com a detecção e os botões de instalar e entrar, e as conversas recentes
 * (gravadas no servidor; cada uma abre com o histórico). As tarefas e o "Para você" do Modo Servidor
 * chegam no M1.9.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { MessageSquareTextIcon } from "lucide-react";
import { CartaoProvider } from "../components/CartaoProvider.tsx";
import { ListaConversas } from "../components/ListaConversas.tsx";
import { buttonVariants } from "../components/ui/button.tsx";
import { useEstadoConexao } from "../contexto.tsx";
import { PROVIDERS } from "../providers.ts";

export const Route = createFileRoute("/")({ component: Inicio });

function Inicio() {
  const conexao = useEstadoConexao();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
        <section className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-bold text-2xl tracking-tight">Sua IA</h1>
            <p className="max-w-prose text-muted-foreground">
              O Simplifica IF conversa com a IA da sua conta pessoal. Instale e entre em pelo menos uma delas para
              começar.
            </p>
          </div>
          <Link to="/conversa" className={buttonVariants({ size: "lg" })}>
            <MessageSquareTextIcon /> Ir para a conversa
          </Link>
        </section>
        {conexao.fase === "sem-servidor" ? null : (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              {PROVIDERS.map((provider) => (
                <CartaoProvider key={provider} provider={provider} />
              ))}
            </div>
            <section aria-labelledby="titulo-recentes" className="flex max-w-xl flex-col gap-2">
              <h2 id="titulo-recentes" className="font-semibold text-lg">
                Conversas recentes
              </h2>
              <ListaConversas limite={5} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}
