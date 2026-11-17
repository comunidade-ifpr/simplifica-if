/**
 * Configurações do Modo Servidor (M1.9): Sua IA (o aviso de uso, instalar, entrar, o estado de cada
 * uma e "Não usar no app", M1.8), Seu perfil (editar e apagar, M1.8; e "Rever as boas-vindas"),
 * Atualizações (M1.10: versões do app, da base e das skills, canal, procurar, usar a versão nova e
 * voltar a base; `configuracoes/Atualizacoes.tsx`) e, no fim, discreta, a conversa com uma pasta
 * escolhida à mão, a tela técnica de antes do Modo Servidor.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { FolderCogIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { AvisoUso } from "../components/AvisoUso.tsx";
import { FormPerfil } from "../components/FormPerfil.tsx";
import { CartaoProvider } from "../components/CartaoProvider.tsx";
import { Atualizacoes } from "../configuracoes/Atualizacoes.tsx";
import { Button, buttonVariants } from "../components/ui/button.tsx";
import { useConversa, useEstadoConexao } from "../contexto.tsx";
import { PROVIDERS } from "../providers.ts";
import { linhaDoPerfil, usePreferencias } from "../tarefas/perfil.ts";
import { EsperaPreferencias } from "../components/EsperaPreferencias.tsx";

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

function SeuPerfil() {
  const { preferencias, gravarPerfil, apagarPerfil } = usePreferencias();
  const [gravado, setGravado] = useState(false);
  // Remonta o formulário depois de apagar, para ele voltar vazio.
  const [versao, setVersao] = useState(0);
  if (preferencias === undefined) return <EsperaPreferencias telaInteira={false} />;
  const linha = linhaDoPerfil(preferencias.perfil);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground" data-perfil-atual>
        {preferencias.perfil === undefined ? "Nenhum perfil salvo." : `Salvo: ${linha ?? "sem campus nem função"}.`}
      </p>
      <FormPerfil
        key={versao}
        inicial={preferencias.perfil}
        rotuloGravar="Salvar o perfil"
        aoGravar={async (perfil) => {
          await gravarPerfil(perfil);
          setGravado(true);
        }}
        secundaria={
          <>
            {preferencias.perfil === undefined ? null : (
              <Button
                type="button"
                variant="ghost"
                onClick={async () => {
                  await apagarPerfil();
                  setGravado(false);
                  setVersao((anterior) => anterior + 1);
                }}
              >
                <Trash2Icon /> Apagar o perfil
              </Button>
            )}
            {gravado ? (
              <span role="status" className="text-success text-sm">
                Perfil salvo.
              </span>
            ) : null}
          </>
        }
      />
    </div>
  );
}

function Configuracoes() {
  const conexao = useEstadoConexao();
  const { preferencias, usarIa, aceitarAviso } = usePreferencias();
  // Enquanto o aviso não foi aceito, ele vem com "Entendi" e os cartões não oferecem "Entrar".
  const avisoPendente = preferencias !== undefined && preferencias.avisoAceitoEm === undefined;
  const [, conversa] = useConversa();
  const navegar = useNavigate();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 p-6">
        <h1 className="font-bold text-2xl tracking-tight">Configurações</h1>
        <Secao id="ia" titulo="Sua IA">
          <AvisoUso {...(avisoPendente ? { aoEntender: () => void aceitarAviso() } : {})} />
          {conexao.fase === "sem-servidor" ? null : (
            <div className="grid gap-4 md:grid-cols-3">
              {PROVIDERS.map((provider) => (
                <CartaoProvider
                  key={provider}
                  provider={provider}
                  avisoPendente={avisoPendente}
                  uso={{
                    usada: !(preferencias?.iasDesligadas ?? []).includes(provider),
                    aoMudar: (usar) => void usarIa(provider, usar),
                  }}
                />
              ))}
            </div>
          )}
          <p className="max-w-prose text-muted-foreground text-sm">
            "Não usar no app" só tira a IA da escolha das conversas: a conta continua conectada no computador. Para sair
            da conta de vez, use o próprio programa da IA.
          </p>
        </Secao>
        <Secao id="perfil" titulo="Seu perfil">
          {conexao.fase === "sem-servidor" ? null : <SeuPerfil />}
          <div>
            <Link to="/boas-vindas" className={buttonVariants({ size: "sm", variant: "outline" })}>
              <RotateCcwIcon /> Rever as boas-vindas
            </Link>
          </div>
        </Secao>
        {conexao.fase === "sem-servidor" ? null : <Atualizacoes />}
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
