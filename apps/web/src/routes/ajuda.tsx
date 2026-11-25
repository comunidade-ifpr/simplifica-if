/**
 * Ajuda: as perguntas frequentes (uma aberta por vez), o e-mail de quem mantém o app e as maneiras de
 * contribuir, da que não pede nada (apontar um erro) à que pede o GitHub (base e código). Abre pelo "?"
 * do cabeçalho. Os textos ficam em `ajuda/conteudo.ts`.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckIcon, CopyIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { EMAIL_CONTATO, linkEmail, PERGUNTAS, URL_COMO_CONTRIBUIR, URL_REPOSITORIO } from "../ajuda/conteudo.ts";
import { abrirFora } from "../components/Markdown.tsx";
import { Pagina } from "../components/Pagina.tsx";
import { Button } from "../components/ui/button.tsx";
import { LinhaExpansivel } from "../components/ui/linha-expansivel.tsx";
import { SECAO_DIAGNOSTICO } from "../configuracoes/Diagnostico.tsx";
import { LinkExterno } from "../leitor/pecas.tsx";
import { ponteDesktop } from "../ponte-desktop.ts";

export const Route = createFileRoute("/ajuda")({ component: Ajuda });

/** Abre o programa de e-mail com a mensagem começada. No desktop, quem abre é o sistema, pela ponte. */
function LinkEmail({ assunto, children }: { readonly assunto: string; readonly children: ReactNode }) {
  const href = linkEmail(assunto);
  return (
    <a
      href={href}
      className="link-grifo"
      onClick={(evento) => {
        if (ponteDesktop() === undefined) return;
        evento.preventDefault();
        abrirFora(href);
      }}
    >
      {children}
    </a>
  );
}

/** Para quem não tem programa de e-mail configurado: o endereço na área de transferência. */
function CopiarEmail() {
  const [copiado, setCopiado] = useState(false);
  return (
    <Button
      size="xs"
      variant="outline"
      onClick={() =>
        void navigator.clipboard.writeText(EMAIL_CONTATO).then(
          () => {
            setCopiado(true);
            window.setTimeout(() => setCopiado(false), 2500);
          },
          () => undefined,
        )
      }
    >
      {copiado ? <CheckIcon /> : <CopyIcon />}
      <span role="status">{copiado ? "Copiado" : "Copiar"}</span>
    </Button>
  );
}

function Perguntas() {
  const [aberta, setAberta] = useState<string>();
  return (
    <section aria-labelledby="titulo-perguntas" className="flex flex-col gap-1">
      <h2 id="titulo-perguntas" className="text-title">
        Perguntas frequentes
      </h2>
      <div className="border-border border-t">
        {PERGUNTAS.map(({ id, pergunta, resposta }) => (
          <LinhaExpansivel
            key={id}
            id={`pergunta-${id}`}
            aberta={aberta === id}
            aoAlternar={() => setAberta(aberta === id ? undefined : id)}
            cabecalho={<h3 className="font-semibold">{pergunta}</h3>}
          >
            {/* A resposta na serifada, a voz de documento da identidade. */}
            <div className="max-w-prose space-y-2 font-serif text-[1.0625rem] leading-relaxed">
              {resposta.map((paragrafo) => (
                <p key={paragrafo}>{paragrafo}</p>
              ))}
            </div>
          </LinhaExpansivel>
        ))}
      </div>
    </section>
  );
}

function Contato() {
  return (
    <section aria-labelledby="titulo-contato" className="flex flex-col gap-2">
      <h2 id="titulo-contato" className="text-title">
        Não achou a resposta?
      </h2>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span>
          Escreva para <LinkEmail assunto="dúvida">{EMAIL_CONTATO}</LinkEmail>.
        </span>
        <CopiarEmail />
      </p>
    </section>
  );
}

function Maneira({ titulo, children }: { readonly titulo: string; readonly children: ReactNode }) {
  return (
    <li className="grid gap-x-8 gap-y-1 border-border border-b py-4 sm:grid-cols-[13rem_minmax(0,1fr)]">
      <h3 className="font-semibold">{titulo}</h3>
      <p className="text-muted-foreground">{children}</p>
    </li>
  );
}

function ComoContribuir() {
  return (
    <section aria-labelledby="titulo-contribuir" className="flex flex-col gap-3">
      <h2 id="titulo-contribuir" className="text-title">
        Como contribuir
      </h2>
      <p className="max-w-prose text-muted-foreground">
        O Simplifica IF melhora com quem o usa. Estas são as maneiras de ajudar, da mais simples à que pede uma conta no
        GitHub.
      </p>
      <ul className="border-border border-t">
        <Maneira titulo="Apontar uma resposta errada">
          Na conversa, use “Isto está errado”, abaixo da resposta. O app monta o relato, e você revisa antes de enviar.
        </Maneira>
        <Maneira titulo="Relatar uma tarefa que falhou">
          O aviso de erro traz um código em “Detalhes técnicos”. Gere o pacote em{" "}
          <Link to="/configuracoes" hash={SECAO_DIAGNOSTICO} className="link-grifo">
            Configurações › Diagnóstico
          </Link>{" "}
          e mande <LinkEmail assunto="problema numa tarefa">por e-mail</LinkEmail>, com o código.
        </Maneira>
        <Maneira titulo="Avisar o que falta na base">
          Norma, PPC ou dado de curso que não está na base, ou que está desatualizado:{" "}
          <LinkEmail assunto="falta na base">escreva dizendo qual</LinkEmail>, com o link da publicação oficial, se
          tiver.
        </Maneira>
        <Maneira titulo="Sugerir uma tarefa">
          Algo que você faz à mão e o app poderia fazer:{" "}
          <LinkEmail assunto="sugestão de tarefa">descreva o passo a passo de hoje</LinkEmail> e o resultado que espera.
        </Maneira>
        <Maneira titulo="Corrigir a base ou o código">
          O projeto é aberto. Correções da base, normas novas, fichas da revisão de PPC e código entram por pull
          request: veja o <LinkExterno href={URL_REPOSITORIO}>repositório no GitHub</LinkExterno> e o{" "}
          <LinkExterno href={URL_COMO_CONTRIBUIR}>guia de contribuição</LinkExterno>.
        </Maneira>
      </ul>
    </section>
  );
}

function Ajuda() {
  return (
    <Pagina largura="estreita" className="gap-10">
      <h1 className="text-display">Ajuda</h1>
      <Perguntas />
      <Contato />
      <ComoContribuir />
    </Pagina>
  );
}
