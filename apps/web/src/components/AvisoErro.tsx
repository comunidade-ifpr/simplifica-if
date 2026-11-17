/**
 * Um erro para a pessoa: a frase em português e, quando há, o texto técnico original num "Detalhes
 * técnicos" recolhido (muitas vezes em inglês, da CLI do provider).
 */
import { CircleAlertIcon } from "lucide-react";
import type { MensagemErro } from "../conexao/erros.ts";
import { Alert, AlertDescription } from "./ui/alert.tsx";

export function DetalhesTecnicos({ detalhe }: { readonly detalhe: string | undefined }) {
  if (detalhe === undefined || detalhe.length === 0) return null;
  return (
    <details className="mt-1 text-xs" data-texto-tecnico>
      <summary className="cursor-pointer select-none font-medium">Detalhes técnicos</summary>
      <pre className="mt-1 whitespace-pre-wrap break-words font-mono">{detalhe}</pre>
    </details>
  );
}

export function AvisoErro({ erro, icone = false }: { readonly erro: MensagemErro; readonly icone?: boolean }) {
  return (
    <Alert variant="error">
      {icone ? <CircleAlertIcon /> : null}
      <AlertDescription>
        <p>{erro.texto}</p>
        <DetalhesTecnicos detalhe={erro.detalhe} />
      </AlertDescription>
    </Alert>
  );
}
