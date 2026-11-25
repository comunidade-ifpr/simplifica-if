/**
 * O aviso de uso (M1.8; decisão em aberto 7 do plano): o que vai para a IA conectada e o que não
 * anexar. Mostrado nas boas-vindas, com "Entendi" gravado, e em Configurações › Sua IA.
 *
 * Texto provisório: precisa da revisão do encarregado de dados do IFPR antes do piloto.
 */
import { CheckCircle2Icon, FolderOpenIcon, LaptopIcon, ShieldAlertIcon, UserCheckIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./ui/button.tsx";

const PONTOS: ReadonlyArray<{
  readonly titulo: string;
  readonly icone: ReactNode;
  readonly texto: ReactNode;
}> = [
  {
    titulo: "Conta pessoal",
    icone: <UserCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />,
    texto: (
      <>
        Não é um serviço contratado pelo IFPR: você usa a conta pessoal que já possui (Claude, ChatGPT ou Gemini), sob
        os termos da empresa da IA.
      </>
    ),
  },
  {
    titulo: "O que a IA lê",
    icone: <FolderOpenIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />,
    texto: (
      <>
        A base pública do IFPR, o que você escreve ou anexa e os arquivos da pasta da tarefa (
        <code>Documentos/Simplifica IF</code>). Pesquisas na internet também passam pela empresa.
      </>
    ),
  },
  {
    titulo: "Onde fica salvo",
    icone: <LaptopIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />,
    texto: (
      <>
        Seu perfil, conversas e pastas ficam só neste computador; o que é enviado à IA também pode ficar guardado pelo
        serviço de IA.
      </>
    ),
  },
  {
    titulo: "Confira a fonte",
    icone: <CheckCircle2Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />,
    texto: <>A IA pode errar. Sempre valide a norma ou fonte citada antes de usar a resposta em documento oficial.</>,
  },
];

export function AvisoUso({
  aoEntender,
}: {
  /** Com ele, o aviso ainda não aceito ganha o botão "Entendi" (Configurações). */
  readonly aoEntender?: () => void;
}) {
  return (
    <section aria-labelledby="titulo-aviso-uso" className="flex flex-col gap-3">
      <h2 id="titulo-aviso-uso" className="text-heading">
        O que vai para a IA
      </h2>
      <ul className="grid gap-x-12 border-border border-t sm:grid-cols-2">
        {PONTOS.map((ponto) => (
          <li key={ponto.titulo} className="flex items-start gap-3 border-border border-b py-3 text-sm">
            {ponto.icone}
            <div className="flex flex-col gap-0.5">
              <p className="font-semibold text-foreground">{ponto.titulo}</p>
              <p className="text-muted-foreground">{ponto.texto}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning-surface p-4 text-sm">
        <ShieldAlertIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-warning-foreground" />
        <div className="flex flex-col gap-1">
          <p className="font-semibold text-warning-foreground">Não envie dados pessoais nem restritos</p>
          <p className="text-foreground">
            Não anexe, cole ou deixe na pasta da tarefa dados pessoais (CPF, notas, laudos, endereço ou contato) nem
            documentos de acesso restrito (processos sigilosos ou documentos internos não publicados).
          </p>
        </div>
      </div>
      {aoEntender === undefined ? null : (
        <Button className="self-start" onClick={aoEntender}>
          Entendi
        </Button>
      )}
    </section>
  );
}
