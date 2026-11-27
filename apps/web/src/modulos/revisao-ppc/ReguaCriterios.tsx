/**
 * A régua de critérios: um traço por critério da revisão (as fichas da base), agrupados por tema, com a
 * cor da situação. Mostra a cobertura sem parágrafo: sem a IA, a maior parte fica contornada (não lida).
 * Durante a leitura com IA, cada bloco pronto entra na lista, e os critérios dele ganham a cor da
 * decisão na hora: é o único movimento automático da tela. Cada marca é um botão que abre a ficha do
 * critério no painel, também a dos que passaram; o tema escolhido na lista fica realçado.
 *
 * O conjunto é um `group` com o resumo no rótulo (e não um `img`, que esconderia os botões do leitor
 * de tela), e cada tema, outro `group`.
 */
import type { CriterioRevisao, EstadoCriterio } from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import { cn } from "~/lib/utils";
import { type OndeAbrir, ondeDoClique } from "../../painel/abrirLink.ts";
import { nomeEstadoCriterio } from "./criterio.ts";
import { gruposDaRegua, resumoGrupo, resumoRegua } from "./lista.ts";

const TRACO: Readonly<Record<EstadoCriterio, string>> = {
  nao_atende: "bg-grav-corrigir",
  a_conferir: "bg-grav-conferir",
  atende: "bg-grav-ok",
  nao_se_aplica: "bg-grav-ok/40",
  nao_lido: "border border-grav-nao-lido",
};

/** Uma marca: o botão que abre a ficha do critério ("CT-SUP-17 · Formação pedagógica…: para conferir"). */
function Traco({
  criterio,
  aoAbrir,
}: {
  readonly criterio: CriterioRevisao;
  readonly aoAbrir: (ficha: string, onde: OndeAbrir) => void;
}) {
  const nome = `${criterio.ficha} · ${criterio.titulo}: ${nomeEstadoCriterio(criterio.estado)}. Ver o critério`;
  return (
    <button
      type="button"
      title={nome}
      aria-label={nome}
      onClick={(evento) => aoAbrir(criterio.ficha, ondeDoClique(evento))}
      className="-my-1 flex cursor-pointer rounded-[2px] py-1 outline-none hover:opacity-70 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        aria-hidden
        className={cn(
          "block h-[22px] w-1.5 rounded-[1px] transition-colors duration-500 motion-reduce:transition-none",
          TRACO[criterio.estado],
        )}
      />
    </button>
  );
}

export function ReguaCriterios({
  criterios,
  tema,
  aoAbrirCriterio,
}: {
  readonly criterios: ReadonlyArray<CriterioRevisao>;
  /** O tema escolhido na lista (nulo: todos), realçado. */
  readonly tema: number | null;
  /** Abre a ficha do critério (no painel, numa tela de trabalho). */
  readonly aoAbrirCriterio: (ficha: string, onde: OndeAbrir) => void;
}) {
  const grupos = gruposDaRegua(criterios);
  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label={`Régua de critérios. ${resumoRegua(criterios)}`} className="flex flex-wrap gap-y-2">
        {grupos.map((g) => {
          const resumo = resumoGrupo(g);
          return (
            <div
              key={g.ordem}
              role="group"
              title={resumo}
              aria-label={resumo}
              className={cn(
                "-mx-[1px] flex gap-0.5 rounded-sm px-[5px] py-1",
                tema === g.ordem && "bg-muted ring-1 ring-border",
              )}
            >
              {g.criterios.map((c) => (
                <Traco key={c.ficha} criterio={c} aoAbrir={aoAbrirCriterio} />
              ))}
            </div>
          );
        })}
      </div>
      <ul aria-hidden className="flex flex-wrap gap-x-4 gap-y-1 text-micro text-muted-foreground">
        <Legenda classe="bg-grav-corrigir">corrigir</Legenda>
        <Legenda classe="bg-grav-conferir">conferir</Legenda>
        <Legenda classe="bg-grav-ok">em ordem</Legenda>
        <Legenda classe="border border-grav-nao-lido">ainda não lido</Legenda>
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
