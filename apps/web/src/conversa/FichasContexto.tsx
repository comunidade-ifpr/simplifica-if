/**
 * As fichas de contexto (`docs/plans/multitarefa.md`, decisão 3): acima da caixa, o que a tela deixou
 * junto da pergunta, já incluído, cada ficha com o botão que a tira (por teclado também: "Tirar o PPC do
 * contexto"), e as ofertas, que só entram se a pessoa as puser ("Anexar o .docx"); na mensagem enviada, as
 * fichas que foram. O que vai junto (o texto da pendência, o trecho, o link, o arquivo e a instrução de
 * leitura dele) abre em cada ficha, pelo mouse ou pelo teclado: nada vai escondido.
 */
import type { FichaContexto } from "@simplifica-if/contratos-app";
import { FileTextIcon, ListChecksIcon, type LucideIcon, PaperclipIcon, PlusIcon, QuoteIcon, XIcon } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import type { FichaRascunho } from "../painel/ControlePainel.ts";

const ICONES: Readonly<Record<FichaRascunho["tipo"], LucideIcon>> = {
  documento: FileTextIcon,
  trecho: QuoteIcon,
  pendencia: ListChecksIcon,
  arquivo: PaperclipIcon,
};

const classeFicha =
  "flex min-w-0 max-w-full items-start gap-1.5 rounded-md border border-border bg-muted/60 py-0.5 pr-0.5 pl-2 text-small";

/**
 * O rótulo da ficha, que abre o que vai junto (por teclado também: é um `<summary>`); sem detalhe, só o
 * rótulo.
 */
function ComDetalhe({ rotulo, detalhe }: { readonly rotulo: ReactNode; readonly detalhe: string | undefined }) {
  if (detalhe === undefined || detalhe === "")
    return <span className="flex min-h-6 min-w-0 flex-1 items-center gap-1.5">{rotulo}</span>;
  return (
    <details className="min-w-0 flex-1" data-detalhe-ficha>
      <summary className="flex min-h-6 min-w-0 cursor-pointer list-none items-center gap-1.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        {rotulo}
      </summary>
      <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words pb-1 text-micro text-muted-foreground">
        {detalhe}
      </p>
    </details>
  );
}

export function FichasNaCaixa({
  fichas,
  ofertas,
  aoTirar,
  aoPor,
}: {
  readonly fichas: ReadonlyArray<FichaRascunho>;
  readonly ofertas: ReadonlyArray<FichaRascunho>;
  readonly aoTirar: (chave: string) => void;
  readonly aoPor: (chave: string) => void;
}) {
  if (fichas.length === 0 && ofertas.length === 0) return null;
  return (
    <section aria-label="Vai junto com a pergunta" className="flex flex-col gap-1.5" data-fichas>
      {fichas.length === 0 ? null : (
        <>
          <p className="font-medium text-micro text-muted-foreground">Vai junto</p>
          <ul className="flex flex-col gap-1">
            {fichas.map((ficha) => {
              const Icone = ICONES[ficha.tipo];
              return (
                <li key={ficha.chave} className={classeFicha} data-ficha={ficha.chave}>
                  <ComDetalhe
                    detalhe={ficha.detalhe}
                    rotulo={
                      <>
                        <Icone aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate" data-conteudo>
                          {ficha.rotulo}
                        </span>
                      </>
                    }
                  />
                  <button
                    type="button"
                    data-tirar
                    aria-label={ficha.tirar}
                    title={ficha.tirar}
                    onClick={() => aoTirar(ficha.chave)}
                    className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <XIcon aria-hidden className="size-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {ofertas.length === 0 ? null : (
        <div className="flex flex-wrap gap-1">
          {ofertas.map((oferta) => (
            <button
              key={oferta.chave}
              type="button"
              title={oferta.detalhe}
              onClick={() => aoPor(oferta.chave)}
              className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-micro text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <PlusIcon aria-hidden className="size-3.5" /> {oferta.oferta ?? `Anexar “${oferta.rotulo}”`}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Tirar ou pôr uma ficha pelo teclado não deixa o foco cair no corpo da página: depois do desenho que a
 * tirou, vai ao botão da vizinha, ou à caixa de texto; depois de pôr uma oferta, ao botão da ficha posta.
 * `caixa` contém as fichas e a caixa de texto.
 */
export function useFocoDasFichas(
  caixa: RefObject<HTMLElement | null>,
  fichas: ReadonlyArray<FichaRascunho>,
): {
  readonly tirando: (chave: string) => void;
  readonly pondo: (chave: string) => void;
} {
  const depois = useRef<{ readonly ficha: string } | "texto">(undefined);
  useEffect(() => {
    const alvo = depois.current;
    depois.current = undefined;
    if (alvo === undefined) return;
    const botao =
      alvo === "texto"
        ? undefined
        : caixa.current?.querySelector<HTMLElement>(`[data-ficha="${CSS.escape(alvo.ficha)}"] [data-tirar]`);
    (botao ?? caixa.current?.querySelector("textarea"))?.focus();
  });
  return {
    tirando: (chave) => {
      const i = fichas.findIndex((f) => f.chave === chave);
      const vizinha = fichas[i + 1] ?? fichas[i - 1];
      depois.current = vizinha === undefined ? "texto" : { ficha: vizinha.chave };
    },
    pondo: (chave) => {
      depois.current = { ficha: chave };
    },
  };
}

const ICONE_GRAVADA: Readonly<Record<FichaContexto["_tag"], LucideIcon>> = {
  link: FileTextIcon,
  arquivo: PaperclipIcon,
  texto: QuoteIcon,
};

/** O que a ficha gravada levou à IA, por inteiro (o arquivo com a instrução de leitura que foi com ele). */
function detalheGravado(ficha: FichaContexto): string {
  if (ficha._tag === "texto") return ficha.texto;
  const onde = ficha._tag === "link" ? ficha.link : `Na pasta da conversa: ${ficha.arquivo}`;
  return ficha.texto === undefined ? onde : `${onde}\n${ficha.texto}`;
}

/** As fichas que foram com a mensagem, abaixo dela. */
export function FichasDaMensagem({ fichas }: { readonly fichas: ReadonlyArray<FichaContexto> }) {
  return (
    <ul aria-label="Foi junto" className="-mt-2 ml-auto flex max-w-[85%] flex-wrap justify-end gap-1">
      {fichas.map((ficha) => {
        const Icone = ICONE_GRAVADA[ficha._tag];
        const detalhe = detalheGravado(ficha);
        return (
          <li
            key={`${ficha._tag}:${ficha.rotulo}:${detalhe}`}
            className="flex min-w-0 max-w-full rounded-md border border-border px-1.5 py-0.5 text-micro text-muted-foreground"
          >
            <ComDetalhe
              detalhe={detalhe}
              rotulo={
                <>
                  <Icone aria-hidden className="size-3 shrink-0" />
                  <span className="truncate" data-conteudo>
                    {ficha.rotulo}
                  </span>
                </>
              }
            />
          </li>
        );
      })}
    </ul>
  );
}
