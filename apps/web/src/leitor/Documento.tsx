/**
 * O texto de uma norma ou de um PPC no leitor (M1.6): o Markdown da base vira HTML na hora, pelo
 * `react-markdown` (sem `rehype-raw` nem `innerHTML`: o PPC é entrada não confiável, e o HTML cru do
 * arquivo some), com o plugin `rehypeDispositivos`, que põe o `id` de cada dispositivo ou seção e o
 * `<mark>` no trecho citado.
 *
 * Desempenho: o documento é dividido em blocos (`blocos.ts`). O bloco do trecho pedido se monta
 * primeiro, e o leitor rola até ele; os outros se montam um a um, no tempo ocioso do navegador, a
 * partir dos vizinhos. Enquanto não se montam, ocupam um espaço estimado; a ancoragem de rolagem do
 * navegador mantém o trecho no lugar quando o texto de cima aparece. Os blocos montados usam
 * `content-visibility: auto`, e o navegador só desenha o que está à vista; o do trecho, não (com o
 * tamanho estimado, a rolagem até ele erraria o lugar). Para imprimir, todos se montam antes
 * (`beforeprint`).
 */
import type { Ancora, DadosDocumento } from "@simplifica-if/contratos-app";
import { ImageOffIcon } from "lucide-react";
import { type ComponentProps, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import { AbrirLink, LinkMarkdown, transformarUrl } from "../components/Markdown.tsx";
import { type Bloco, blocoDaLinha, dividirEmBlocos, ordemDeMontagem } from "./blocos.ts";
import { ancorasPorLinha, linhasDoTrecho, rehypeDispositivos } from "./rehypeDispositivos.ts";

/** Imagem do PPC: não se carrega (o endereço vem de entrada não confiável e não está na base). */
function ImagemOmitida({ alt }: ComponentProps<"img">) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 text-muted-foreground text-sm">
      <ImageOffIcon aria-hidden className="size-3.5" />
      {alt !== undefined && alt.trim() !== "" ? `Imagem: ${alt}` : "Imagem do documento original (não aparece aqui)"}
    </span>
  );
}

const COMPONENTES: Components = { a: LinkMarkdown, img: ImagemOmitida };
const PLUGINS_REMARK = [remarkGfm];

type Trecho = { readonly inicio: number; readonly fim: number };

const BlocoMarkdown = memo(
  function BlocoMarkdown({
    bloco,
    ancoras,
    destaque,
  }: {
    readonly bloco: Bloco;
    readonly ancoras: ReadonlyMap<number, ReadonlyArray<string>>;
    readonly destaque: Trecho | null;
  }) {
    const plugins = useMemo(
      (): Options["rehypePlugins"] => [
        [rehypeDispositivos, { ancoras, destaque, deslocamento: bloco.linhaInicial - 1 }],
      ],
      [ancoras, destaque, bloco.linhaInicial],
    );
    return (
      <div
        className={destaque === null ? "bloco-documento" : "bloco-documento bloco-alvo"}
        data-linha={bloco.linhaInicial}
      >
        <ReactMarkdown
          remarkPlugins={PLUGINS_REMARK}
          rehypePlugins={plugins}
          components={COMPONENTES}
          urlTransform={transformarUrl}
          skipHtml
        >
          {bloco.texto}
        </ReactMarkdown>
      </div>
    );
  },
  (antes, depois) =>
    antes.bloco === depois.bloco &&
    antes.ancoras === depois.ancoras &&
    antes.destaque?.inicio === depois.destaque?.inicio &&
    antes.destaque?.fim === depois.destaque?.fim,
);

/** Um bloco ainda não montado: o espaço estimado (uma linha de texto a cada 70 caracteres). */
function EspacoReservado({ bloco }: { readonly bloco: Bloco }) {
  return (
    <div
      aria-hidden
      className="espaco-reservado"
      data-linha={bloco.linhaInicial}
      style={{ height: `${Math.max(2, Math.ceil(bloco.texto.length / 70) * 1.6)}em` }}
    />
  );
}

const ocioso = (fazer: () => void): (() => void) => {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(fazer, { timeout: 200 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(fazer, 16);
  return () => window.clearTimeout(id);
};

export function Documento({
  documento,
  alvo,
  aoAbrirLink,
  rotulo,
}: {
  readonly documento: DadosDocumento;
  /** O fragmento a destacar e a mostrar (`art28-xviii`); `null` abre no começo. */
  readonly alvo: string | null;
  readonly aoAbrirLink: (link: string) => void;
  /** O nome acessível do texto ("Texto da norma"). */
  readonly rotulo: string;
}) {
  const blocos = useMemo(() => dividirEmBlocos(documento.markdown), [documento.markdown]);
  const ancoras = useMemo(() => ancorasPorLinha(documento.ancoras), [documento.ancoras]);
  const trecho = useMemo(
    () => (alvo === null ? null : linhasDoTrecho(documento.ancoras as ReadonlyArray<Ancora>, alvo)),
    [documento.ancoras, alvo],
  );
  const primeiro = trecho === null ? 0 : blocoDaLinha(blocos, trecho.inicio);
  const ultimo = trecho === null ? 0 : blocoDaLinha(blocos, trecho.fim);

  // Os blocos montados: os do trecho já na primeira renderização, os outros aos poucos.
  const [montados, setMontados] = useState<ReadonlySet<number>>(() => new Set([primeiro]));
  const visiveis = useMemo(() => {
    const todos = new Set(montados);
    for (let i = primeiro; i <= ultimo; i += 1) todos.add(i);
    return todos;
  }, [montados, primeiro, ultimo]);

  useEffect(() => {
    const ordem = ordemDeMontagem(blocos.length, primeiro);
    let posicao = 0;
    let cancelar = () => {};
    const passo = () => {
      if (posicao >= ordem.length) return;
      const indice = ordem[posicao]!;
      posicao += 1;
      setMontados((atuais) => (atuais.has(indice) ? atuais : new Set(atuais).add(indice)));
      cancelar = ocioso(passo);
    };
    cancelar = ocioso(passo);
    return () => cancelar();
  }, [blocos, primeiro]);

  // Para imprimir, o documento inteiro.
  useEffect(() => {
    const montarTudo = () => flushSync(() => setMontados(new Set(blocos.map((_, i) => i))));
    window.addEventListener("beforeprint", montarTudo);
    return () => window.removeEventListener("beforeprint", montarTudo);
  }, [blocos]);

  // Rola até o trecho pedido, uma vez por alvo.
  const conteiner = useRef<HTMLDivElement>(null);
  const rolado = useRef<string | null>(null);
  useLayoutEffect(() => {
    const chave = `${documento.link}#${alvo ?? ""}`;
    if (alvo === null || rolado.current === chave) return;
    const elemento = conteiner.current?.querySelector(`[id="${CSS.escape(alvo)}"]`);
    if (elemento instanceof HTMLElement) {
      rolado.current = chave;
      elemento.scrollIntoView({ block: "start" });
    }
  });

  return (
    <AbrirLink value={aoAbrirLink}>
      <div ref={conteiner} role="document" aria-label={rotulo} className="markdown documento-leitor">
        {blocos.map((bloco, i) =>
          visiveis.has(i) ? (
            <BlocoMarkdown
              key={bloco.linhaInicial}
              bloco={bloco}
              ancoras={ancoras}
              destaque={trecho !== null && i >= primeiro && i <= ultimo ? trecho : null}
            />
          ) : (
            <EspacoReservado key={bloco.linhaInicial} bloco={bloco} />
          ),
        )}
      </div>
    </AbrirLink>
  );
}
