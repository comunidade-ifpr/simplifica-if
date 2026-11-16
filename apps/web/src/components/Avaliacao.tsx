/**
 * A avaliação de uma resposta (M1.9): 👍/👎, gravados no servidor (`conversa.avaliar`), e "Isto está
 * errado", o ponto de extensão do M1.12 (apontar o erro com o trecho e a fonte e mandar à curadoria).
 * Até lá, o botão só avisa que vem em breve.
 */
import type { NotaResposta } from "@simplifica-if/contratos-app";
import { FlagIcon, ThumbsDownIcon, ThumbsUpIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/utils.ts";
import { Button } from "./ui/button.tsx";

export function Avaliacao({
  turno,
  nota,
  aoAvaliar,
  aoApontarErro,
}: {
  readonly turno: number;
  readonly nota: NotaResposta | undefined;
  readonly aoAvaliar: (turno: number, nota: NotaResposta | null) => void;
  /** M1.12: abre o relato do erro. Sem ele, o aviso de "em breve". */
  readonly aoApontarErro?: (turno: number) => void;
}) {
  const [emBreve, setEmBreve] = useState(false);
  const alternar = (escolhida: NotaResposta) => aoAvaliar(turno, nota === escolhida ? null : escolhida);
  return (
    <div className="flex flex-col gap-1" data-avaliacao={turno}>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Avaliar esta resposta">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Resposta útil"
          aria-pressed={nota === "util"}
          className={cn(nota === "util" && "bg-success/12 text-success")}
          onClick={() => alternar("util")}
        >
          <ThumbsUpIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Resposta não ajudou"
          aria-pressed={nota === "nao_util"}
          className={cn(nota === "nao_util" && "bg-destructive/10 text-destructive")}
          onClick={() => alternar("nao_util")}
        >
          <ThumbsDownIcon />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => (aoApontarErro === undefined ? setEmBreve(true) : aoApontarErro(turno))}
        >
          <FlagIcon /> Isto está errado
        </Button>
      </div>
      {emBreve ? (
        <p role="status" className="text-muted-foreground text-xs">
          Em breve você vai poder apontar o trecho errado e a fonte, e o aviso vai para a equipe que cuida da base. Por
          enquanto, use o 👎.
        </p>
      ) : null}
    </div>
  );
}
