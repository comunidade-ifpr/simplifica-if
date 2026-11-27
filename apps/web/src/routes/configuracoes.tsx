/**
 * Configurações do Modo Servidor (M1.9): Sua IA (o aviso de uso, instalar, entrar, o estado de cada
 * uma e "Não usar no app", M1.8), Seu perfil (editar e apagar, M1.8; e "Rever as boas-vindas"),
 * Aparência (o tema; `configuracoes/Aparencia.tsx`), Avisos (no desktop, o aviso do sistema quando uma
 * resposta fica pronta ou a IA pede permissão, ligado de fábrica), Atualizações (M1.10: versões do app, da base e das skills, canal, procurar, usar a versão nova e
 * voltar a base; `configuracoes/Atualizacoes.tsx`) e Diagnóstico (o pacote para anexar ao relato de um
 * problema; `configuracoes/Diagnostico.tsx`).
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { RotateCcwIcon, Trash2Icon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { AvisoUso } from "../components/AvisoUso.tsx";
import { FormPerfil } from "../components/FormPerfil.tsx";
import { Pagina } from "../components/Pagina.tsx";
import { CartaoProvider } from "../components/CartaoProvider.tsx";
import { Aparencia } from "../configuracoes/Aparencia.tsx";
import { Atualizacoes } from "../configuracoes/Atualizacoes.tsx";
import { Diagnostico, SECAO_DIAGNOSTICO } from "../configuracoes/Diagnostico.tsx";
import { Button, buttonVariants } from "../components/ui/button.tsx";
import { useEstadoConexao } from "../contexto.tsx";
import { ponteDesktop } from "../ponte-desktop.ts";
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
      <h2 id={`titulo-${id}`} className="text-title">
        {titulo}
      </h2>
      {children}
    </section>
  );
}

/** As seções da tela, na ordem, para o índice ao lado. */
const SECOES = [
  { id: "ia", nome: "Sua IA" },
  { id: "perfil", nome: "Seu perfil" },
  { id: "aparencia", nome: "Aparência" },
  { id: "avisos", nome: "Avisos" },
  { id: "atualizacoes", nome: "Atualizações" },
  { id: SECAO_DIAGNOSTICO, nome: "Diagnóstico" },
] as const;

/**
 * O índice das seções, que acompanha a rolagem (como a coluna lateral das páginas do Explorar). São
 * botões, não âncoras: no desktop o roteador usa o `#` do endereço.
 */
function IndiceSecoes({ ocultas }: { readonly ocultas: ReadonlySet<string> }) {
  return (
    <nav aria-label="Seções" className="hidden lg:sticky lg:top-8 lg:block lg:self-start">
      <ul className="border-border border-l">
        {SECOES.filter((s) => !ocultas.has(s.id)).map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => document.getElementById(s.id)?.scrollIntoView({ block: "start", behavior: "smooth" })}
              className="-ml-px block w-full border-transparent border-l-2 px-4 py-1.5 text-left text-muted-foreground text-small hover:border-primary hover:text-foreground"
            >
              {s.nome}
            </button>
          </li>
        ))}
      </ul>
    </nav>
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
              <span role="status" className="text-small text-success-foreground">
                Perfil salvo.
              </span>
            ) : null}
          </>
        }
      />
    </div>
  );
}

/** O aviso do sistema (no desktop): ligado até a pessoa desligar. */
function Avisos() {
  const { preferencias, avisarNoSistema } = usePreferencias();
  if (preferencias === undefined) return <EsperaPreferencias telaInteira={false} />;
  return (
    <div className="flex flex-col gap-2">
      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-primary"
          checked={preferencias.avisosDoSistema}
          onChange={(evento) => void avisarNoSistema(evento.target.checked)}
        />
        Avisar quando uma resposta ficar pronta ou a IA pedir permissão
      </label>
      <p className="max-w-prose text-muted-foreground text-small">
        O aviso aparece só com o app em segundo plano e não mostra o assunto da conversa: diz apenas “Uma resposta está
        pronta” ou “A IA pede uma permissão”.
      </p>
    </div>
  );
}

function Configuracoes() {
  const conexao = useEstadoConexao();
  const { preferencias, usarIa, aceitarAviso } = usePreferencias();
  // Enquanto o aviso não foi aceito, ele vem com "Entendi" e os cartões não oferecem "Entrar".
  const avisoPendente = preferencias !== undefined && preferencias.avisoAceitoEm === undefined;
  return (
    <Pagina largura="larga" className="gap-8">
      <h1 className="text-display">Configurações</h1>
      <div className="grid gap-x-12 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <IndiceSecoes
          ocultas={
            new Set([
              ...(conexao.fase === "sem-servidor" ? ["atualizacoes", SECAO_DIAGNOSTICO, "avisos"] : []),
              ...(ponteDesktop() === undefined ? ["avisos"] : []),
            ])
          }
        />
        {/* Uma divisória entre as seções; cada uma para a rolagem com folga do topo. */}
        <div className="flex min-w-0 flex-col gap-10 [&>section+section]:border-border [&>section+section]:border-t [&>section+section]:pt-10 [&>section]:scroll-mt-8">
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
              "Não usar no app" só tira a IA da escolha das conversas: a conta continua conectada no computador. Para
              sair da conta de vez, use o próprio programa da IA.
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
          <Secao id="aparencia" titulo="Aparência">
            <Aparencia />
          </Secao>
          {conexao.fase === "sem-servidor" || ponteDesktop() === undefined ? null : (
            <Secao id="avisos" titulo="Avisos">
              <Avisos />
            </Secao>
          )}
          {conexao.fase === "sem-servidor" ? null : <Atualizacoes />}
          {conexao.fase === "sem-servidor" ? null : <Diagnostico />}
        </div>
      </div>
    </Pagina>
  );
}
