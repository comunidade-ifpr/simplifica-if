/**
 * A avaliação de uma resposta (M1.9): 👍/👎, gravados no servidor (`conversa.avaliar`), e "Isto está
 * errado" (M1.12), que abre o relato da resposta para a curadoria (`RelatoErro.tsx`) logo abaixo.
 */
import type { NotaResposta } from "@simplifica-if/contratos-app";
import { FlagIcon, ThumbsDownIcon, ThumbsUpIcon } from "lucide-react";
import { cn } from "../lib/utils.ts";
import { Button } from "./ui/button.tsx";

export function Avaliacao({
  turno,
  nota,
  aoAvaliar,
  aoApontarErro,
  relatoAberto = false,
}: {
  readonly turno: number;
  readonly nota: NotaResposta | undefined;
  readonly aoAvaliar: (turno: number, nota: NotaResposta | null) => void;
  /** M1.12: abre (ou fecha) o relato do erro. */
  readonly aoApontarErro: (turno: number) => void;
  readonly relatoAberto?: boolean;
}) {
  const alternar = (escolhida: NotaResposta) => aoAvaliar(turno, nota === escolhida ? null : escolhida);
  return (
    <div
      className="flex flex-wrap items-center gap-1"
      role="group"
      aria-label="Avaliar esta resposta"
      data-avaliacao={turno}
    >
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
        aria-expanded={relatoAberto}
        onClick={() => aoApontarErro(turno)}
      >
        <FlagIcon /> Isto está errado
      </Button>
    </div>
  );
}
