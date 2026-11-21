/**
 * A coluna de temas, à esquerda da lista: "Tudo" e cada tema na ordem do parecer, com o glifo da
 * gravidade mais alta e quantas ficam por fazer; ✓ no tema sem nada por fazer; "não lido" no tema que
 * ninguém leu ainda. No rodapé, "4 de 11 feitas" e a nota "Sobre esta revisão". Abaixo de 960 px, a
 * coluna dá lugar a um seletor acima da lista (`SeletorTema`).
 */
import { CheckIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";
import { GlifoGravidade } from "./IndicadorGravidade.tsx";
import type { TemaNavegacao } from "./lista.ts";

function Item({
  atual,
  aoEscolher,
  children,
  fim,
}: {
  readonly atual: boolean;
  readonly aoEscolher: () => void;
  readonly children: ReactNode;
  readonly fim: ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={atual ? "true" : undefined}
        onClick={aoEscolher}
        className={cn(
          "flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left text-small outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
          atual && "bg-muted font-semibold",
        )}
      >
        <span className="flex min-w-0 flex-1 items-start gap-2">{children}</span>
        <span className="shrink-0 pt-px text-muted-foreground text-micro tabular-nums">{fim}</span>
      </button>
    </li>
  );
}

export function NavTemas({
  temas,
  tema,
  aoEscolher,
  feitas,
  sobre,
}: {
  readonly temas: ReadonlyArray<TemaNavegacao>;
  readonly tema: number | null;
  readonly aoEscolher: (ordem: number | null) => void;
  /** "4 de 11 feitas". */
  readonly feitas: string;
  readonly sobre: ReactNode;
}) {
  const abertas = temas.reduce((soma, t) => soma + t.abertas, 0);
  return (
    <nav aria-label="Temas" className="flex flex-col gap-4">
      <ul className="flex flex-col gap-0.5">
        <Item atual={tema === null} aoEscolher={() => aoEscolher(null)} fim={abertas || null}>
          <span className="w-4 shrink-0" aria-hidden />
          Tudo
        </Item>
        {temas.map((t) => (
          <Item
            key={t.ordem}
            atual={tema === t.ordem}
            aoEscolher={() => aoEscolher(t.ordem)}
            fim={t.abertas ? t.abertas : t.naoLido ? "não lido" : null}
          >
            {t.gravidade !== null ? (
              <GlifoGravidade gravidade={t.gravidade} className="pt-0.5" />
            ) : t.naoLido ? (
              <span aria-hidden className="w-4 shrink-0 pt-0.5 text-center text-grav-nao-lido leading-none">
                ○
              </span>
            ) : (
              <CheckIcon aria-label="sem nada por fazer" className="mt-0.5 size-4 shrink-0 text-grav-ok-texto" />
            )}
            <span className={cn("min-w-0", t.naoLido && "text-muted-foreground")}>{t.tema}</span>
          </Item>
        ))}
      </ul>
      <div className="flex flex-col gap-3 border-border border-t pt-3">
        <p className="font-semibold text-small tabular-nums">{feitas}</p>
        {sobre}
      </div>
    </nav>
  );
}

/** O seletor de tema da tela estreita (abaixo de 960 px). */
export function SeletorTema({
  temas,
  tema,
  aoEscolher,
}: {
  readonly temas: ReadonlyArray<TemaNavegacao>;
  readonly tema: number | null;
  readonly aoEscolher: (ordem: number | null) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-small">
      <span className="font-semibold">Tema</span>
      <select
        value={tema ?? ""}
        onChange={(e) => aoEscolher(e.currentTarget.value === "" ? null : Number(e.currentTarget.value))}
        className="h-9 w-full rounded-lg border border-input bg-background px-2 text-body outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="">Todos os temas</option>
        {temas.map((t) => (
          <option key={t.ordem} value={t.ordem}>
            {t.tema}
            {t.abertas ? ` (${t.abertas})` : t.naoLido ? " (não lido)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
