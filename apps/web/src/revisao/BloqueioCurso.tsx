/**
 * O bloqueio de causa-raiz: o curso não foi reconhecido no CNCT, e os critérios que dependem dele
 * (denominação, eixo, carga horária mínima, ingresso) ficaram sem conferência. As pendências que
 * dependem disso saem da lista e ficam contadas aqui. "Qual é o curso?" procura no CNCT da base e
 * refaz a lista com o curso escolhido (com a leitura com IA, se houve).
 */
import type { CnctDoIndice, PendenciaViva } from "@simplifica-if/contratos-app";
import { ChevronRightIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { useIndiceExplorar } from "../explorar/indice.ts";
import { cn } from "~/lib/utils";
import { GlifoGravidade } from "./IndicadorGravidade.tsx";
import { buscarCnct, plural } from "./lista.ts";

const MAXIMO_OPCOES = 8;

export function BloqueioCurso({
  pendencias,
  conferindo,
  emLeitura = false,
  aoEscolher,
}: {
  readonly pendencias: ReadonlyArray<PendenciaViva>;
  /** A lista está sendo refeita com o curso escolhido. */
  readonly conferindo: boolean;
  /** A leitura com IA está em andamento: trocar o curso espera a pausa. */
  readonly emLeitura?: boolean;
  readonly aoEscolher: (slug: string) => void;
}) {
  const [verPendencias, setVerPendencias] = useState(false);
  const id = useId();
  return (
    <section
      aria-labelledby={`${id}-titulo`}
      className="flex flex-col gap-3 rounded-xl border border-grav-conferir/60 bg-grav-conferir-fundo/50 p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-titulo`} className="flex items-center gap-2 text-heading">
          <GlifoGravidade gravidade="conferir" />
          Não reconhecemos o curso no Catálogo Nacional (CNCT)
        </h2>
        <p className="max-w-[68ch] pl-6 text-small">
          Sem ele, a denominação, o eixo, a carga horária mínima e os requisitos de ingresso ficaram sem conferência.
          Confira o nome do curso: ele precisa estar como no CNCT.
        </p>
        {emLeitura ? (
          <p className="max-w-[68ch] pl-6 text-muted-foreground text-small">
            Para trocar o curso, pause antes a leitura com IA; o que ela já leu fica na lista.
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-3 pl-6 sm:flex-row sm:items-start sm:justify-between">
        <EscolhaCnct conferindo={conferindo} bloqueado={emLeitura} aoEscolher={aoEscolher} />
        {pendencias.length ? (
          <button
            type="button"
            aria-expanded={verPendencias}
            aria-controls={`${id}-pendencias`}
            onClick={() => setVerPendencias((v) => !v)}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1 self-start rounded-sm py-1.5 text-small outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {plural(pendencias.length, "pendência depende", "pendências dependem")} disso
            <ChevronRightIcon aria-hidden className={cn("size-4 transition-transform", verPendencias && "rotate-90")} />
          </button>
        ) : null}
      </div>
      {verPendencias ? (
        <ul id={`${id}-pendencias`} className="flex flex-col gap-1 pl-6 text-small">
          {pendencias.map((v) => (
            <li key={v.chave} className="flex gap-2">
              <GlifoGravidade gravidade={v.pendencia.estado === "nao_atende" ? "corrigir" : "conferir"} />
              <span className="min-w-0">{v.pendencia.titulo}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** A busca no CNCT da base: uma caixa de texto com a lista de sugestões (`combobox` com `listbox`). */
function EscolhaCnct({
  conferindo,
  bloqueado,
  aoEscolher,
}: {
  readonly conferindo: boolean;
  readonly bloqueado: boolean;
  readonly aoEscolher: (slug: string) => void;
}) {
  const indice = useIndiceExplorar();
  const [busca, setBusca] = useState("");
  const [ativo, setAtivo] = useState(0);
  const [escolhido, setEscolhido] = useState<CnctDoIndice | undefined>(undefined);
  const id = useId();
  const cnct = indice.fase === "lido" ? indice.valor.cnct : [];
  const opcoes = useMemo(() => buscarCnct(cnct, busca).slice(0, MAXIMO_OPCOES), [cnct, busca]);
  const aberta = escolhido === undefined && opcoes.length > 0;
  const escolher = (c: CnctDoIndice) => {
    setEscolhido(c);
    setBusca(c.denominacao);
  };
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <label htmlFor={`${id}-busca`} className="font-semibold text-small">
        Qual é o curso?
      </label>
      <div className="flex flex-wrap items-start gap-2">
        <div className="relative w-full max-w-md">
          <Input
            id={`${id}-busca`}
            nativeInput
            role="combobox"
            aria-expanded={aberta}
            aria-controls={`${id}-opcoes`}
            aria-autocomplete="list"
            aria-activedescendant={aberta ? `${id}-opcao-${ativo}` : undefined}
            placeholder={indice.fase === "carregando" ? "Carregando o CNCT…" : "Procure pelo nome, como “agropecuária”"}
            value={busca}
            onChange={(e) => {
              setBusca(e.currentTarget.value);
              setEscolhido(undefined);
              setAtivo(0);
            }}
            onKeyDown={(e) => {
              if (!aberta) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setAtivo((a) => Math.min(opcoes.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setAtivo((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const opcao = opcoes[ativo];
                if (opcao !== undefined) escolher(opcao);
              }
            }}
          />
          {aberta ? (
            <ul
              id={`${id}-opcoes`}
              role="listbox"
              aria-label="Cursos do CNCT"
              className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)]"
            >
              {opcoes.map((c, i) => (
                <li
                  key={c.slug}
                  id={`${id}-opcao-${i}`}
                  role="option"
                  aria-selected={i === ativo}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => escolher(c)}
                  onMouseEnter={() => setAtivo(i)}
                  className={cn(
                    "flex cursor-pointer flex-col rounded-sm px-2 py-1.5 text-small",
                    i === ativo && "bg-accent text-accent-foreground",
                  )}
                >
                  <span className="font-medium">{c.denominacao}</span>
                  <span className="text-micro text-muted-foreground">{c.eixo}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {escolhido === undefined ? null : (
          <Button disabled={conferindo || bloqueado} onClick={() => aoEscolher(escolhido.slug)}>
            {conferindo ? <Spinner /> : null}
            Conferir com este curso
          </Button>
        )}
      </div>
      {indice.fase === "carregando" ? (
        <p className="flex items-center gap-2 text-muted-foreground text-small">
          <Spinner className="size-3.5" /> Carregando o CNCT…
        </p>
      ) : null}
      {busca.trim() !== "" && escolhido === undefined && opcoes.length === 0 && indice.fase === "lido" ? (
        <p className="text-muted-foreground text-small">Nenhum curso do CNCT com esse nome.</p>
      ) : null}
    </div>
  );
}
