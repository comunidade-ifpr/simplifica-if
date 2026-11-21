/**
 * O PPC sendo lido: as etapas na ordem em que acontecem, a atual com o indicador girando e as feitas
 * com ✓ (as etapas vêm do stream de `revisaoPpc.revisar`).
 */
import type { EtapaLeituraPpc } from "@simplifica-if/contratos-app";
import { CheckIcon } from "lucide-react";
import { Pagina } from "../components/Pagina.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { cn } from "~/lib/utils";
import { nomeDoArquivo } from "./lista.ts";

export const ETAPAS: ReadonlyArray<{ readonly etapa: EtapaLeituraPpc; readonly texto: string }> = [
  { etapa: "lendo", texto: "Lendo o documento" },
  { etapa: "identificando", texto: "Identificando o curso no CNCT" },
  { etapa: "conferindo", texto: "Conferindo os critérios automáticos" },
  { etapa: "gravando", texto: "Gravando a cópia comentada" },
];

export function Lendo({ arquivo, etapa }: { readonly arquivo: string; readonly etapa: EtapaLeituraPpc | null }) {
  const atual = etapa === null ? 0 : ETAPAS.findIndex((e) => e.etapa === etapa);
  return (
    <Pagina largura="estreita" className="gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-display">Revisar um PPC</h1>
        <p className="break-words text-body text-muted-foreground">{nomeDoArquivo(arquivo)}</p>
      </header>
      <ol aria-label="Etapas da leitura" className="flex flex-col gap-3">
        {ETAPAS.map((e, i) => {
          const feita = i < atual;
          const agora = i === atual;
          return (
            <li
              key={e.etapa}
              aria-current={agora ? "step" : undefined}
              className={cn("flex items-center gap-3 text-body", !feita && !agora && "text-muted-foreground")}
            >
              <span className="flex size-5 shrink-0 items-center justify-center">
                {feita ? (
                  <CheckIcon aria-label="feita" className="size-5 text-grav-ok-texto" />
                ) : agora ? (
                  <Spinner className="size-4" />
                ) : (
                  <span aria-hidden className="size-2 rounded-full bg-grav-nao-lido" />
                )}
              </span>
              <span className={agora ? "font-semibold" : undefined}>{e.texto}</span>
            </li>
          );
        })}
      </ol>
    </Pagina>
  );
}
