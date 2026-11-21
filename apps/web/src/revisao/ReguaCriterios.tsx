/**
 * A régua de critérios: um traço por critério da revisão (as fichas da base), agrupados por tema, com a
 * cor da situação. Mostra a cobertura sem parágrafo: sem a IA, a maior parte fica contornada (não lida).
 * Durante a leitura com IA, os temas prontos passam de contorno a preenchido neutro (o resultado chega
 * no fim): é o único movimento automático da tela. Cada tema é um botão que filtra a lista.
 *
 * O conjunto é um `group` com o resumo no rótulo (e não um `img`, que esconderia os botões do leitor
 * de tela).
 */
import type { CriterioRevisao, EstadoCriterio } from "@simplifica-if/contratos-app";
import { cn } from "~/lib/utils";
import { gruposDaRegua, resumoGrupo, resumoRegua } from "./lista.ts";

const TRACO: Readonly<Record<EstadoCriterio, string>> = {
  nao_atende: "bg-grav-corrigir",
  a_conferir: "bg-grav-conferir",
  atende: "bg-grav-ok",
  nao_se_aplica: "bg-grav-ok/40",
  nao_lido: "border border-grav-nao-lido",
};

function Traco({ estado, lidoPelaIa }: { readonly estado: EstadoCriterio; readonly lidoPelaIa: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "block h-[22px] w-1.5 rounded-[1px] transition-colors duration-500 motion-reduce:transition-none",
        estado === "nao_lido" && lidoPelaIa ? "border border-transparent bg-muted-foreground/45" : TRACO[estado],
      )}
    />
  );
}

export function ReguaCriterios({
  criterios,
  temasLidosPelaIa,
  tema,
  aoEscolherTema,
}: {
  readonly criterios: ReadonlyArray<CriterioRevisao>;
  /** Os temas que a leitura com IA em andamento já terminou. */
  readonly temasLidosPelaIa: ReadonlySet<number>;
  /** O tema escolhido na lista (nulo: todos). */
  readonly tema: number | null;
  readonly aoEscolherTema: (ordem: number | null) => void;
}) {
  const grupos = gruposDaRegua(criterios);
  const iaLendo = temasLidosPelaIa.size > 0;
  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label={`Régua de critérios. ${resumoRegua(criterios)}`} className="flex flex-wrap gap-y-2">
        {grupos.map((g) => {
          const resumo = resumoGrupo(g);
          return (
            <button
              key={g.ordem}
              type="button"
              title={resumo}
              aria-label={resumo}
              aria-pressed={tema === g.ordem}
              onClick={() => aoEscolherTema(tema === g.ordem ? null : g.ordem)}
              className={cn(
                "-mx-[1px] flex cursor-pointer gap-0.5 rounded-sm px-[5px] py-1 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                tema === g.ordem && "bg-muted ring-1 ring-border",
              )}
            >
              {g.criterios.map((c) => (
                <Traco key={c.ficha} estado={c.estado} lidoPelaIa={temasLidosPelaIa.has(g.ordem)} />
              ))}
            </button>
          );
        })}
      </div>
      <ul aria-hidden className="flex flex-wrap gap-x-4 gap-y-1 text-micro text-muted-foreground">
        <Legenda classe="bg-grav-corrigir">corrigir</Legenda>
        <Legenda classe="bg-grav-conferir">conferir</Legenda>
        <Legenda classe="bg-grav-ok">em ordem</Legenda>
        <Legenda classe="border border-grav-nao-lido">ainda não lido</Legenda>
        {iaLendo ? <Legenda classe="bg-muted-foreground/45">lido, resultado no fim</Legenda> : null}
      </ul>
    </div>
  );
}

function Legenda({ classe, children }: { readonly classe: string; readonly children: string }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <span className={cn("block h-3 w-1.5 rounded-[1px]", classe)} />
      {children}
    </li>
  );
}
