/**
 * A linha do tempo das normas, na entrada do Explorar: um sinal por norma, empilhado no ano dela, com a
 * forma da situação de vigência. Passar o ponteiro (ou o foco) num sinal mostra a norma embaixo; o clique
 * abre a norma, e o ano abre a coleção filtrada por ele. Os anos sem norma não ocupam lugar: um intervalo
 * maior entre dois anos vizinhos aparece como um respiro.
 *
 * Pelo teclado, os anos são as paradas; os sinais ficam fora da ordem do Tab (são mais de cem), e as
 * mesmas normas estão na coleção que o ano abre.
 */
import type { NormaDoIndice } from "@simplifica-if/contratos-app";
import { Link } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "../lib/utils.ts";
import { normasPorAno, quantos, vigenciaDaNorma } from "./colecoes.ts";
import { rotuloVigencia, SinalVigencia, SituacaoVigencia, VIGENCIAS } from "./Vigencia.tsx";

/** Quantos anos sem norma entre dois vizinhos viram um respiro. */
const SALTO = 3;

export function LinhaDoTempo({ normas }: { readonly normas: ReadonlyArray<NormaDoIndice> }) {
  const [emFoco, setEmFoco] = useState<NormaDoIndice | null>(null);
  // Em janela estreita a linha rola de lado: começa no fim, onde estão as normas mais recentes.
  const rolagem = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const caixa = rolagem.current;
    if (caixa !== null) caixa.scrollLeft = caixa.scrollWidth;
  }, []);
  const grupos = normasPorAno(normas)
    .filter((g): g is { ano: number; normas: ReadonlyArray<NormaDoIndice> } => g.ano !== null)
    .reverse();
  if (grupos.length === 0) return null;
  const comTexto = normas.filter((n) => n.situacao === "base").length;
  const presentes = VIGENCIAS.filter((v) => normas.some((n) => vigenciaDaNorma(n) === v));
  return (
    <section aria-labelledby="titulo-linha-do-tempo" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 id="titulo-linha-do-tempo" className="text-title">
          As normas no tempo
        </h2>
        <ul aria-label="Legenda" className="flex flex-wrap gap-x-4 gap-y-1">
          {presentes.map((v) => (
            <li key={v}>
              <SituacaoVigencia vigencia={v} className="font-normal text-muted-foreground" />
            </li>
          ))}
        </ul>
      </div>

      <div ref={rolagem} className="overflow-x-auto pb-1">
        <ol
          className="flex min-w-max items-end border-border border-b"
          onMouseLeave={() => setEmFoco(null)}
          onBlur={() => setEmFoco(null)}
        >
          {grupos.map((g, i) => {
            const anterior = grupos[i - 1]?.ano;
            const salto = anterior !== undefined && g.ano - anterior > SALTO;
            return (
              <li
                key={g.ano}
                className={cn(
                  "flex min-w-[1.625rem] flex-1 flex-col items-center",
                  salto ? "ml-2 border-border border-l border-dashed pl-2" : "",
                )}
              >
                <div className="flex flex-col-reverse items-center gap-[3px] pb-2">
                  {g.normas.map((n) => {
                    const vigencia = vigenciaDaNorma(n);
                    return (
                      <Link
                        key={n.id}
                        to="/explorar/ver"
                        search={{ link: n.link }}
                        tabIndex={-1}
                        aria-label={`${n.titulo}: ${rotuloVigencia(vigencia)}`}
                        onMouseEnter={() => setEmFoco(n)}
                        onFocus={() => setEmFoco(n)}
                        className={cn(
                          "rounded-full p-px outline-offset-1 transition-transform duration-100 hover:scale-150 focus-visible:scale-150 motion-reduce:transition-none",
                          emFoco !== null && emFoco.id !== n.id ? "opacity-40" : "",
                        )}
                      >
                        <SinalVigencia vigencia={vigencia} className="size-3" />
                      </Link>
                    );
                  })}
                </div>
                <Link
                  to="/explorar/normas"
                  search={{ ano: String(g.ano) }}
                  aria-label={`Normas de ${g.ano}: ${g.normas.length}`}
                  className="-mb-px w-full border-transparent border-b-2 px-0.5 pt-1 pb-1.5 text-center font-medium text-muted-foreground text-micro tabular-nums [font-stretch:75%] hover:border-primary hover:text-foreground"
                >
                  {g.ano}
                </Link>
              </li>
            );
          })}
        </ol>
      </div>

      {/* A leitura do sinal sob o ponteiro; sem ele, o resumo da coleção. Altura fixa: a página não pula. */}
      <div aria-live="off" className="min-h-[4.75rem]">
        {emFoco === null ? (
          <p className="max-w-[68ch] text-muted-foreground text-small">
            {quantos(normas.length, "norma", "normas")}, de {grupos[0]!.ano} a {grupos.at(-1)!.ano}; a base guarda o
            texto de {comTexto} e a referência das outras. Cada sinal é uma norma: passe o ponteiro para ver qual é e
            clique para abrir. O ano abre as normas dele.
          </p>
        ) : (
          <div className="max-w-[68ch]">
            <p className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-semibold">{emFoco.titulo}</span>
              <SituacaoVigencia vigencia={vigenciaDaNorma(emFoco)} />
            </p>
            <p className="line-clamp-2 font-serif text-muted-foreground" data-conteudo>
              {emFoco.ementa ?? "A base guarda só a referência desta norma."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
