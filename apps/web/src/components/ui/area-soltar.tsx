/**
 * A área de soltar um arquivo, com o botão "Escolher" dentro. O arraste muda a borda e o fundo, para a
 * pessoa ver que pode soltar. Pelo teclado, o caminho é o botão; a área não recebe foco.
 */
import { UploadIcon } from "lucide-react";
import { type DragEvent, useRef, useState } from "react";
import type * as React from "react";

import { cn } from "~/lib/utils";
import { Button } from "./button.tsx";

/** O arraste traz arquivos (e não um texto ou um link). */
function trazArquivos(evento: DragEvent<HTMLElement>): boolean {
  return Array.from(evento.dataTransfer.types).includes("Files");
}

export function AreaSoltar({
  aoSoltar,
  aoEscolher,
  titulo,
  descricao,
  rotuloEscolher = "Escolher",
  desabilitada = false,
  className,
}: {
  readonly aoSoltar: (arquivos: Array<File>) => void;
  readonly aoEscolher: () => void;
  readonly titulo: React.ReactNode;
  readonly descricao?: React.ReactNode;
  readonly rotuloEscolher?: string;
  readonly desabilitada?: boolean;
  readonly className?: string;
}) {
  const [arrastando, setArrastando] = useState(false);
  // Entrar num filho dispara `dragleave` na área: só conta como saída quando o saldo volta a zero.
  const dentro = useRef(0);
  const sair = () => {
    dentro.current = 0;
    setArrastando(false);
  };
  return (
    <div
      data-arrastando={arrastando ? "" : undefined}
      aria-disabled={desabilitada || undefined}
      onDragEnter={(evento) => {
        if (desabilitada || !trazArquivos(evento)) return;
        evento.preventDefault();
        dentro.current += 1;
        setArrastando(true);
      }}
      onDragOver={(evento) => {
        if (desabilitada || !trazArquivos(evento)) return;
        evento.preventDefault();
        evento.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        dentro.current = Math.max(0, dentro.current - 1);
        if (dentro.current === 0) setArrastando(false);
      }}
      onDrop={(evento) => {
        if (desabilitada || !trazArquivos(evento)) return;
        evento.preventDefault();
        sair();
        const arquivos = Array.from(evento.dataTransfer.files);
        if (arquivos.length > 0) aoSoltar(arquivos);
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-input border-dashed px-6 py-10 text-center transition-colors",
        "data-arrastando:border-primary data-arrastando:bg-accent/60",
        desabilitada && "opacity-64",
        className,
      )}
    >
      <UploadIcon aria-hidden className="size-6 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <p className="text-heading">{titulo}</p>
        {descricao === undefined ? null : <p className="text-muted-foreground text-small">{descricao}</p>}
      </div>
      <Button disabled={desabilitada} onClick={aoEscolher}>
        {rotuloEscolher}
      </Button>
    </div>
  );
}
