/**
 * O sinal de vigência de uma norma: uma forma por situação (cheio, com anel, meio, vazado e riscado,
 * tracejado), para que a cor nunca vá sozinha, e a palavra ao lado quando há espaço. É o mesmo sinal na
 * linha do tempo da entrada, nas linhas da coleção de normas e no cabeçalho da norma.
 */
import { cn } from "../lib/utils.ts";
import type { Vigencia } from "./colecoes.ts";

const ROTULOS: Readonly<Record<Vigencia, string>> = {
  vigente: "Em vigor",
  alterada: "Em vigor, com alterações",
  "parcialmente revogada": "Revogada em parte",
  revogada: "Revogada",
  "a confirmar": "Vigência a confirmar",
};

const CORES: Readonly<Record<Vigencia, string>> = {
  vigente: "text-success",
  alterada: "text-success",
  "parcialmente revogada": "text-warning-foreground",
  revogada: "text-destructive",
  "a confirmar": "text-muted-foreground",
};

/** As situações na ordem da legenda. */
export const VIGENCIAS: ReadonlyArray<Vigencia> = [
  "vigente",
  "alterada",
  "parcialmente revogada",
  "revogada",
  "a confirmar",
];

export function rotuloVigencia(vigencia: Vigencia): string {
  return ROTULOS[vigencia];
}

/** A cor do texto da situação (o rótulo ao lado do sinal). */
export function corVigencia(vigencia: Vigencia): string {
  return vigencia === "vigente" || vigencia === "alterada"
    ? "text-success-foreground"
    : vigencia === "revogada"
      ? "text-destructive-foreground"
      : CORES[vigencia];
}

function Forma({ vigencia }: { readonly vigencia: Vigencia }) {
  switch (vigencia) {
    case "vigente":
      return <circle cx="8" cy="8" r="6" fill="currentColor" />;
    case "alterada":
      return (
        <>
          <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="8" cy="8" r="3.25" fill="currentColor" />
        </>
      );
    case "parcialmente revogada":
      return (
        <>
          <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 1.75a6.25 6.25 0 0 0 0 12.5z" fill="currentColor" />
        </>
      );
    case "revogada":
      return (
        <>
          <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3.6 12.4 12.4 3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </>
      );
    case "a confirmar":
      return (
        <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.4 2.5" />
      );
  }
}

/** Só a forma, decorativa: quem a usa dá o nome (o rótulo ao lado ou o nome acessível do link). */
export function SinalVigencia({ vigencia, className }: { readonly vigencia: Vigencia; readonly className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className={cn("size-3 shrink-0", CORES[vigencia], className)}>
      <Forma vigencia={vigencia} />
    </svg>
  );
}

/** O sinal com a palavra: "● Em vigor". */
export function SituacaoVigencia({
  vigencia,
  className,
}: {
  readonly vigencia: Vigencia;
  readonly className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-medium text-small", corVigencia(vigencia), className)}>
      <SinalVigencia vigencia={vigencia} />
      {ROTULOS[vigencia]}
    </span>
  );
}
