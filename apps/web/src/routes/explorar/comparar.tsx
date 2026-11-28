/**
 * O modo Comparar: duas normas que se sucedem lado a lado, pela tabela de correspondência entre elas
 * (`compararNormas`; a interface não lê a tabela). Uma lista de linhas numa rolagem só, na ordem da
 * norma de origem, com a relação de cada linha no meio (= equivalente, ≈ parcial, − sem equivalente) e,
 * no fim, os artigos novos da sucessora. Num par, só as palavras que mudaram levam o grifo. O aviso de
 * que a tabela é rascunho fica preso no topo enquanto ela não tiver revisão. Cada linha tem "Perguntar à IA
 * sobre a diferença", que leva os dispositivos da linha à conversa ao lado, como fichas.
 */
import type { LadoComparado, LinhaComparada, NormaComparada, TrechoComparado } from "@simplifica-if/contratos-app";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ArrowLeftIcon, MessageSquareIcon, TriangleAlertIcon } from "lucide-react";
import { type MouseEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import { useApi, useApp } from "../../contexto.tsx";
import { vigenciaDaNorma } from "../../explorar/colecoes.ts";
import {
  linhasVisiveis,
  numeroDaNorma,
  RELACOES,
  type Relacao,
  textoHerdado,
  textoSubordinados,
  textoTambem,
} from "../../explorar/comparar.ts";
import { SituacaoVigencia } from "../../explorar/Vigencia.tsx";
import { useCarga } from "../../leitor/carga.ts";
import { ComCarga } from "../../leitor/pecas.tsx";
import { cn } from "../../lib/utils.ts";
import { ondeDoClique, useAbrirLink } from "../../painel/abrirLink.ts";
import { fichaDoLink } from "../../painel/conversar.ts";

export interface BuscaComparar {
  readonly a: string;
  readonly b: string;
}

export const Route = createFileRoute("/explorar/comparar")({
  component: Comparar,
  validateSearch: (busca: Record<string, unknown>): BuscaComparar => ({
    a: typeof busca.a === "string" ? busca.a : "",
    b: typeof busca.b === "string" ? busca.b : "",
  }),
});

/** As três colunas: a origem, a relação e o destino; no estreito, uma embaixo da outra. */
const classeGrade = "grid gap-x-6 gap-y-2 @3xl:grid-cols-[minmax(0,1fr)_6.5rem_minmax(0,1fr)]";

function Comparar() {
  const { a, b } = Route.useSearch();
  const api = useApi();
  const roteador = useRouter();
  const carga = useCarga(a && b ? `comparar:${a}:${b}` : null, () => api.chamar((c) => c.compararNormas({ a, b })));
  if (!a || !b) return <p className="text-muted-foreground text-sm">Escolha duas normas para comparar.</p>;
  return (
    <div className="space-y-6">
      <NoTopo key={`${a}:${b}`} />
      <div className="-mt-2">
        <Button size="sm" variant="ghost" className="-ml-2.5" onClick={() => roteador.history.back()}>
          <ArrowLeftIcon /> Voltar
        </Button>
      </div>
      <ComCarga carga={carga} titulo="Não foi possível comparar as normas">
        {({ dados }) => <Comparacao {...dados} />}
      </ComCarga>
    </div>
  );
}

/**
 * A rolagem é a do Explorar, que não desmonta entre as páginas dele: cada comparação aberta (a chave é
 * o par) começa do topo, e não onde a página anterior estava.
 */
function NoTopo() {
  useEffect(() => {
    document.querySelector("[data-rolagem-explorar]")?.scrollTo({ top: 0 });
  }, []);
  return null;
}

function Comparacao({
  tabela,
  origem,
  destino,
  linhas,
  novos,
}: {
  readonly tabela: { readonly status: "rascunho" | "revisado" };
  readonly origem: NormaComparada;
  readonly destino: NormaComparada;
  readonly linhas: ReadonlyArray<LinhaComparada>;
  readonly novos: ReadonlyArray<LadoComparado>;
}) {
  const [soOQueMudou, setSoOQueMudou] = useState(false);
  const visiveis = useMemo(() => linhasVisiveis(linhas, soOQueMudou), [linhas, soOQueMudou]);
  const escondidas = linhas.length - visiveis.length;
  return (
    <section aria-labelledby="titulo-comparar" className="@container space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 space-y-1">
          <p className="font-semibold text-muted-foreground text-small">Comparar</p>
          <h2 id="titulo-comparar" className="break-words text-title">
            {origem.titulo} ⇄ {destino.titulo}
          </h2>
        </div>
        <Button
          size="sm"
          variant={soOQueMudou ? "default" : "outline"}
          aria-pressed={soOQueMudou}
          onClick={() => setSoOQueMudou((s) => !s)}
        >
          Só o que mudou
        </Button>
      </div>

      {/* preso no topo da rolagem: o aviso e as colunas acompanham a leitura */}
      <div className="sticky top-0 z-10 -mx-1 space-y-3 bg-background px-1 pt-1 pb-2">
        {tabela.status === "rascunho" ? (
          <p
            role="note"
            className="flex items-start gap-2 rounded-xl border border-warning/32 bg-warning-surface px-3.5 py-2.5 text-small text-warning-foreground"
          >
            <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>
              <strong>Correspondência em rascunho, sem revisão jurídica.</strong> O alinhamento é uma indicação para ler
              os dois textos, não fundamento. Confira as regras de transição antes de citar.
            </span>
          </p>
        ) : null}
        <div className={cn(classeGrade, "border-border border-b pb-2 font-semibold text-sm")}>
          <Cabeca norma={origem} />
          <span aria-hidden className="hidden @3xl:block" />
          <Cabeca norma={destino} />
        </div>
      </div>

      {escondidas > 0 ? (
        <p role="status" className="text-muted-foreground text-small">
          {escondidas === 1
            ? "1 par de texto idêntico escondido."
            : `${escondidas} pares de texto idêntico escondidos.`}
        </p>
      ) : null}

      <ol aria-label="Linhas da comparação" className="divide-y divide-border">
        {visiveis.map((l) => (
          <Linha key={l.origem.id} linha={l} origem={origem.titulo} />
        ))}
      </ol>

      {novos.length > 0 ? (
        <section aria-labelledby="titulo-novos" className="space-y-1 pt-4">
          <h3 id="titulo-novos" className="flex flex-wrap items-baseline gap-x-3 font-semibold text-body">
            Novos na {numeroDaNorma(destino.titulo)}
            <span className="font-normal text-muted-foreground text-small">
              artigos que nenhum item da tabela aponta, na ordem da {numeroDaNorma(destino.titulo)}
            </span>
          </h3>
          <ol aria-label={`Novos na ${numeroDaNorma(destino.titulo)}`} className="divide-y divide-border">
            {novos.map((n) => (
              <li key={n.id} className={cn(classeGrade, "py-4")}>
                <SemPar />
                <Meio relacao="novo" />
                <Lado lado={n} />
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </section>
  );
}

function Cabeca({ norma }: { readonly norma: NormaComparada }) {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>{norma.titulo}</span>
      <SituacaoVigencia vigencia={vigenciaDaNorma(norma)} />
    </p>
  );
}

function Linha({ linha, origem }: { readonly linha: LinhaComparada; readonly origem: string }) {
  const { painel } = useApp();
  const tambem = (d: LinhaComparada["destinos"][number]) => textoTambem(d.tambem, origem);
  return (
    <li className={cn(classeGrade, "py-4")} data-relacao={linha.tipo}>
      <div className="min-w-0 space-y-1.5">
        <Lado lado={linha.origem} />
        {linha.herdado_de ? <Nota>{textoHerdado(linha.herdado_de)}</Nota> : null}
      </div>
      <Meio relacao={linha.tipo} reescrito={linha.reescrito} />
      <div className="min-w-0 space-y-1.5">
        {linha.destinos.length === 0 ? <SemPar /> : null}
        {linha.destinos.map((d, i) => (
          <div key={d.id} className={cn(i > 0 ? "border-border border-t border-dashed pt-2.5" : "")}>
            <Lado lado={d} />
            {tambem(d) ? <Nota>{tambem(d)}</Nota> : null}
          </div>
        ))}
        {linha.nota ? <Nota italico>Nota da tabela: {linha.nota}</Nota> : null}
        <Button
          size="sm"
          variant="ghost"
          className="-ml-2.5"
          onClick={() =>
            painel.conversar({
              fichas: [linha.origem, ...linha.destinos].map((lado) => fichaDoLink(lado.link)),
            })
          }
        >
          <MessageSquareIcon /> Perguntar à IA sobre a diferença
        </Button>
      </div>
    </li>
  );
}

/** Um dispositivo: o rótulo (que abre no leitor), o texto com o grifo e, no artigo só pelo caput, os filhos. */
function Lado({ lado }: { readonly lado: LadoComparado }) {
  const abrirLink = useAbrirLink();
  const abrir = (evento: MouseEvent) => abrirLink(lado.link, ondeDoClique(evento));
  const filhos = textoSubordinados(lado.subordinados);
  return (
    <p className="font-serif text-quote" data-conteudo>
      <button type="button" onClick={abrir} className="mr-1.5 link-grifo font-bold font-sans text-sm">
        {lado.rotulo}
      </button>
      <Trechos trechos={lado.trechos} />
      {filhos ? (
        <>
          {" "}
          <button type="button" onClick={abrir} className="link-grifo font-sans text-muted-foreground text-small">
            ({filhos})
          </button>
        </>
      ) : null}
    </p>
  );
}

function Trechos({ trechos }: { readonly trechos: ReadonlyArray<TrechoComparado> }) {
  // a chave é a posição do trecho no texto, que não muda
  let posicao = 0;
  return trechos.map((t) => {
    const chave = posicao;
    posicao += t.texto.length;
    return t.mudou ? (
      <mark key={chave} className="diferenca">
        {t.texto}
      </mark>
    ) : (
      <span key={chave}>{t.texto}</span>
    );
  });
}

function Meio({ relacao, reescrito = false }: { readonly relacao: Relacao; readonly reescrito?: boolean }) {
  const { sinal, nome } = RELACOES[relacao];
  return (
    <div className="flex items-center gap-2 text-muted-foreground @3xl:flex-col @3xl:justify-start @3xl:gap-1 @3xl:pt-1 @3xl:text-center">
      <span
        aria-hidden
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-full font-extrabold text-body text-foreground",
          relacao === "parcial"
            ? "bg-grifo"
            : relacao === "novo"
              ? "bg-primary text-primary-foreground"
              : relacao === "sem-equivalente"
                ? "border border-input border-dashed bg-card"
                : "bg-muted",
        )}
      >
        {sinal}
      </span>
      <span className="font-semibold text-micro">{nome}</span>
      {reescrito ? <span className="text-micro">redação reescrita</span> : null}
    </div>
  );
}

function SemPar() {
  return <p className="text-muted-foreground text-sm italic">Sem dispositivo correspondente</p>;
}

function Nota({ children, italico = false }: { readonly children: ReactNode; readonly italico?: boolean }) {
  return <p className={cn("text-muted-foreground text-small", italico ? "italic" : "")}>{children}</p>;
}
