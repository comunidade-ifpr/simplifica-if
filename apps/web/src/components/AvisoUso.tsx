/**
 * O aviso de uso (M1.8; decisão em aberto 7 do plano): o que vai para a IA conectada e o que não
 * anexar. Mostrado nas boas-vindas, com "Entendi" gravado, e em Configurações › Sua IA.
 *
 * Texto provisório: precisa da revisão do encarregado de dados do IFPR antes do piloto.
 */
import { ShieldAlertIcon } from "lucide-react";
import { Button } from "./ui/button.tsx";

export function AvisoUso({
  titulo = "O que vai para a IA",
  aoEntender,
}: {
  readonly titulo?: string;
  /** Com ele, o aviso ainda não aceito ganha o botão "Entendi" (Configurações). */
  readonly aoEntender?: () => void;
}) {
  return (
    <section
      aria-labelledby="titulo-aviso-uso"
      className="flex max-w-prose flex-col gap-3 rounded-xl border border-warning/40 bg-warning-surface p-4 text-sm"
    >
      <h2 id="titulo-aviso-uso" className="flex items-center gap-2 font-semibold text-base">
        <ShieldAlertIcon aria-hidden className="size-5 text-warning-foreground" />
        {titulo}
      </h2>
      <ul className="flex list-disc flex-col gap-2 pl-5">
        <li>
          O Simplifica IF conversa com a IA da <strong>sua conta pessoal</strong> (Claude, ChatGPT ou Gemini). Não é um
          serviço contratado pelo IFPR: o que você envia segue os termos da empresa da IA.
        </li>
        <li>
          A IA recebe a <strong>base pública do IFPR</strong> (normas, catálogos, PPCs publicados),{" "}
          <strong>o que você escrever ou anexar</strong> e <strong>os arquivos que estiverem na pasta da tarefa</strong>{" "}
          (em Documentos/Simplifica IF), que ela pode abrir e ler.
        </li>
        <li>
          <strong>Não anexe, não cole e não deixe na pasta da tarefa documento com dado pessoal</strong> (nome com CPF,
          notas, laudos, endereço ou contato de estudante ou servidor) <strong>ou de acesso restrito</strong> (processo
          sigiloso, documento interno ainda não publicado).
        </li>
        <li>
          O app guarda seu perfil, suas conversas e as pastas só neste computador.{" "}
          <strong>O que você envia à IA também fica guardado na empresa dela</strong>, conforme os termos dela.
        </li>
        <li>A IA pode errar: confira na fonte citada antes de usar a resposta num documento oficial.</li>
      </ul>
      {aoEntender === undefined ? null : (
        <Button className="self-start" onClick={aoEntender}>
          Entendi
        </Button>
      )}
    </section>
  );
}
