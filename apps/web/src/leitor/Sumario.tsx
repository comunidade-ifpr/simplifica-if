/**
 * O índice de navegação da norma no leitor ("Neste documento"): as divisões em dois níveis, com a faixa
 * de artigos de cada uma; as seções só do capítulo em leitura; "Ir ao art."; e, na norma sem divisões, a
 * grade com os números dos artigos. O item em leitura fica marcado conforme a rolagem.
 *
 * O índice não rola o texto por conta própria: pede ao `Documento` do mesmo leitor (o `irPara` da
 * instância, `instancia.ts`), que monta o bloco do destino antes. O item em leitura se mede pelo elemento do item ou, enquanto o bloco dele não se
 * montou, pelo espaço reservado do bloco (`data-linha`).
 */
import type { DadosDocumento } from "@simplifica-if/contratos-app";
import { type FormEvent, useMemo, useState } from "react";
import { Input } from "../components/ui/input.tsx";
import { cn } from "../lib/utils.ts";
import { useEmLeitura } from "./emLeitura.ts";
import { useInstanciaLeitor } from "./instancia.ts";
import {
  artigoPedido,
  conteudoDoIndice,
  type Destino,
  faixaDeArtigos,
  faixaPorExtenso,
  idDoItem,
  itensVisiveis,
  numeroDoArtigo,
  rotuloCurto,
} from "./sumario.ts";

const CLASSE_ITEM =
  "grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2 rounded-md py-1 pr-2 text-left text-muted-foreground text-small hover:bg-muted hover:text-foreground aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground";

/** "Ir ao art.": o número do artigo e Enter. */
function IrAoArtigo({ ancoras }: { readonly ancoras: DadosDocumento["ancoras"] }) {
  const { irPara } = useInstanciaLeitor();
  const [texto, setTexto] = useState("");
  const [naoAchado, setNaoAchado] = useState<string | null>(null);
  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (texto.trim() === "") return;
    const artigo = artigoPedido(texto, ancoras);
    setNaoAchado(artigo === null ? texto.trim() : null);
    if (artigo !== null) irPara({ id: artigo.id, linha: artigo.linha_inicio });
  };
  return (
    <form onSubmit={enviar} className="space-y-1">
      <Input
        size="sm"
        inputMode="numeric"
        aria-label="Ir ao artigo"
        placeholder="Ir ao art. (número e Enter)"
        value={texto}
        onChange={(evento) => {
          setTexto(evento.target.value);
          setNaoAchado(null);
        }}
      />
      {naoAchado !== null ? (
        <p role="status" className="text-muted-foreground text-micro">
          Não há art. {naoAchado} neste texto.
        </p>
      ) : null}
    </form>
  );
}

/**
 * O índice. `modo`: `lateral`, aberto ao lado do texto, com o item em leitura marcado e as seções só do
 * capítulo atual; `recolhido`, no painel estreito, fechado e com todos os itens.
 */
export function Sumario({
  documento,
  modo,
}: {
  readonly documento: Pick<DadosDocumento, "sumario" | "ancoras">;
  readonly modo: "lateral" | "recolhido";
}) {
  const { itens, artigos, comDivisoes, comGrade, vazio } = useMemo(() => conteudoDoIndice(documento), [documento]);
  const destinos = useMemo(
    (): ReadonlyArray<Destino> =>
      comGrade
        ? artigos.map((a) => ({ id: a.id, linha: a.linha_inicio }))
        : itens.map((item) => ({ id: idDoItem(item), linha: item.linha })),
    [artigos, itens, comGrade],
  );
  const instancia = useInstanciaLeitor();
  const { irPara } = instancia;
  const { nav, ativo } = useEmLeitura(destinos, modo === "lateral", instancia);
  if (vazio) return null;

  const visiveis = modo === "lateral" && !comGrade ? itensVisiveis(itens, ativo) : itens.map((_, i) => i);
  const lista = (
    <ul>
      {visiveis.map((i) => {
        const item = itens[i]!;
        const faixa = faixaDeArtigos(item);
        return (
          <li key={item.linha}>
            <button
              type="button"
              aria-current={!comGrade && ativo === i ? "location" : undefined}
              onClick={() => irPara({ id: idDoItem(item), linha: item.linha })}
              className={CLASSE_ITEM}
              style={{ paddingLeft: `${0.5 + item.nivel * 0.75}rem` }}
            >
              <span className="break-words">
                {rotuloCurto(item)}
                {item.nome !== null ? <span className="font-normal"> · {item.nome}</span> : null}
              </span>
              {faixa !== null ? (
                <span className="font-normal text-micro tabular-nums" aria-label={faixaPorExtenso(item) ?? undefined}>
                  {faixa}
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
  const grade = comGrade ? (
    <ul aria-label="Artigos" className="grid grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1">
      {artigos.map((artigo, i) => (
        <li key={artigo.id}>
          <button
            type="button"
            aria-label={`Artigo ${numeroDoArtigo(artigo.id)}`}
            aria-current={ativo === i ? "location" : undefined}
            onClick={() => irPara({ id: artigo.id, linha: artigo.linha_inicio })}
            className={cn(CLASSE_ITEM, "block px-0 py-1 pr-0 text-center tabular-nums")}
          >
            {numeroDoArtigo(artigo.id)}
          </button>
        </li>
      ))}
    </ul>
  ) : null;
  const conteudo = (
    <>
      {comDivisoes && artigos.length > 0 ? <IrAoArtigo ancoras={documento.ancoras} /> : null}
      {grade}
      {itens.length > 0 ? lista : null}
    </>
  );

  if (modo === "recolhido") {
    return (
      <details className="rounded-md border border-border p-2 text-sm @4xl:hidden">
        <summary className="cursor-pointer font-semibold">Neste documento</summary>
        <nav aria-label="Neste documento" className="mt-2 max-h-72 space-y-2 overflow-y-auto">
          {conteudo}
        </nav>
      </details>
    );
  }
  return (
    <nav ref={nav} aria-label="Neste documento" className="hidden space-y-2 @4xl:block">
      <h3 className="font-semibold text-muted-foreground text-small">Neste documento</h3>
      {conteudo}
    </nav>
  );
}
