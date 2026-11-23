/**
 * O texto de uma norma ou de um PPC no leitor (M1.6): o Markdown da base vira HTML na hora, pelo
 * `react-markdown` (sem `rehype-raw` nem `innerHTML`: o PPC é entrada não confiável, e o HTML cru do
 * arquivo some), com o plugin `rehypeDispositivos`, que põe o `id` de cada dispositivo ou seção e o
 * `<mark>` no trecho citado. Com `realce` (o trecho de uma pendência, no PPC em revisão), a frase exata
 * se pinta dentro do `<mark>` (`realce.ts`), e o leitor rola até ela.
 *
 * Desempenho: o documento é dividido em blocos (`blocos.ts`). O bloco do trecho pedido se monta
 * primeiro, e o leitor rola até ele; os outros se montam um a um, no tempo ocioso do navegador, a
 * partir dos vizinhos. Enquanto não se montam, ocupam um espaço estimado; a ancoragem de rolagem do
 * navegador mantém o trecho no lugar quando o texto de cima aparece. Os blocos montados usam
 * `content-visibility: auto`, e o navegador só desenha o que está à vista; o do trecho, não (com o
 * tamanho estimado, a rolagem até ele erraria o lugar). Para imprimir e para buscar, todos se montam
 * antes (`beforeprint` e `MONTAR_TUDO`, de `busca.ts`).
 *
 * O índice da norma (`Sumario.tsx`) pede a rolagem até um item ou um artigo (`IR_PARA`): o bloco do
 * destino se monta na hora, e o texto rola até o elemento. Os cabeçalhos do sumário ganham um `id`
 * (`sumario-<linha>`) e os de divisão, a classe `divisao`.
 */
import type { Ancora, DadosDocumento } from "@simplifica-if/contratos-app";
import { ImageOffIcon } from "lucide-react";
import { type ComponentProps, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import { AbrirLink, LinkMarkdown, transformarUrl } from "../components/Markdown.tsx";
import { type Bloco, blocoDaLinha, dividirEmBlocos, ordemDeMontagem } from "./blocos.ts";
import { MONTAR_TUDO } from "./busca.ts";
import { faixasDoRealce, NOME_REALCE, rolarAte, textosDe } from "./realce.ts";
import { ancorasPorLinha, linhasDoTrecho, rehypeDispositivos } from "./rehypeDispositivos.ts";
import { remarkMarcadores, remarkQuebras } from "./remarkLeitor.ts";
import { ancorasDoSumario, type Destino, IR_PARA, linhasDeDivisao } from "./sumario.ts";

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
const PLUGINS_REMARK = [remarkGfm, remarkMarcadores, remarkQuebras];

type Trecho = { readonly inicio: number; readonly fim: number };

const BlocoMarkdown = memo(
  function BlocoMarkdown({
    bloco,
    ancoras,
    destaque,
    divisoes,
  }: {
    readonly bloco: Bloco;
    readonly ancoras: ReadonlyMap<number, ReadonlyArray<string>>;
    readonly destaque: Trecho | null;
    readonly divisoes: ReadonlySet<number>;
  }) {
    const plugins = useMemo(
      (): Options["rehypePlugins"] => [
        [
          rehypeDispositivos,
          { ancoras, destaque, divisoes, deslocamento: bloco.linhaInicial - 1, linhaFinal: bloco.linhaFinal },
        ],
      ],
      [ancoras, destaque, divisoes, bloco.linhaInicial, bloco.linhaFinal],
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
    antes.divisoes === depois.divisoes &&
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
  realce = null,
}: {
  /** Uma norma ou um PPC da base, ou o PPC revisado (`ifpr://revisao/…`): o texto, as âncoras e o link sem fragmento. */
  readonly documento: Pick<DadosDocumento, "markdown" | "ancoras"> & {
    readonly link: string;
    /** O sumário da norma; o PPC em revisão não tem. */
    readonly sumario?: DadosDocumento["sumario"];
  };
  /** O fragmento a destacar e a mostrar (`art28-xviii`); `null` abre no começo. */
  readonly alvo: string | null;
  readonly aoAbrirLink: (link: string) => void;
  /** O nome acessível do texto ("Texto da norma"). */
  readonly rotulo: string;
  /** A frase a realçar dentro do trecho destacado (o trecho da pendência); `null` destaca só o bloco. */
  readonly realce?: string | null;
}) {
  const blocos = useMemo(() => dividirEmBlocos(documento.markdown), [documento.markdown]);
  const ancoras = useMemo(
    () => ancorasPorLinha([...documento.ancoras, ...ancorasDoSumario(documento.sumario ?? [])]),
    [documento.ancoras, documento.sumario],
  );
  const divisoes = useMemo(() => linhasDeDivisao(documento.sumario ?? []), [documento.sumario]);
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

  // Para imprimir e para buscar (Ctrl/⌘+F no painel), o documento inteiro.
  useEffect(() => {
    // Já tudo montado, o mesmo estado: a busca pede a cada tecla e não deve renderizar a lista de novo.
    const montarTudo = () =>
      flushSync(() =>
        setMontados((atuais) => (atuais.size === blocos.length ? atuais : new Set(blocos.map((_, i) => i)))),
      );
    window.addEventListener("beforeprint", montarTudo);
    window.addEventListener(MONTAR_TUDO, montarTudo);
    return () => {
      window.removeEventListener("beforeprint", montarTudo);
      window.removeEventListener(MONTAR_TUDO, montarTudo);
    };
  }, [blocos]);

  const conteiner = useRef<HTMLDivElement>(null);

  // O índice pede um item ou um artigo: o bloco dele se monta já, e o texto rola até o elemento. Os
  // blocos de cima ainda podem mudar de altura ao se desenhar; dois quadros depois, a rolagem se acerta.
  useEffect(() => {
    let quadro = 0;
    const irPara = (evento: Event) => {
      const { id, linha } = (evento as CustomEvent<Destino>).detail;
      const indice = blocoDaLinha(blocos, linha);
      flushSync(() => setMontados((atuais) => (atuais.has(indice) ? atuais : new Set(atuais).add(indice))));
      const elemento = conteiner.current?.querySelector(`[id="${CSS.escape(id)}"]`);
      if (!(elemento instanceof HTMLElement)) return;
      cancelAnimationFrame(quadro);
      let acertos = 2;
      const rolar = () => {
        elemento.scrollIntoView({ block: "start" });
        quadro = acertos > 0 ? requestAnimationFrame(rolar) : 0;
        acertos -= 1;
      };
      rolar();
    };
    window.addEventListener(IR_PARA, irPara);
    return () => {
      window.removeEventListener(IR_PARA, irPara);
      cancelAnimationFrame(quadro);
    };
  }, [blocos]);

  // Rola até o trecho pedido, uma vez por alvo.
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

  // A frase exata dentro do destaque, depois da rolagem até o bloco (os efeitos rodam na ordem).
  useLayoutEffect(() => {
    const raiz = conteiner.current;
    if (realce === null || trecho === null || raiz === null || !("highlights" in CSS)) return;
    const faixas = faixasDoRealce(textosDe([...raiz.querySelectorAll("mark.trecho-citado")]), realce);
    if (faixas.length === 0) return;
    CSS.highlights.set(NOME_REALCE, new Highlight(...faixas));
    raiz.classList.add("com-realce");
    rolarAte(faixas[0]!);
    return () => {
      CSS.highlights.delete(NOME_REALCE);
      raiz.classList.remove("com-realce");
    };
  }, [realce, trecho]);

  return (
    <AbrirLink value={aoAbrirLink}>
      <div ref={conteiner} role="document" aria-label={rotulo} className="markdown documento-leitor" data-conteudo>
        {blocos.map((bloco, i) =>
          visiveis.has(i) ? (
            <BlocoMarkdown
              key={bloco.linhaInicial}
              bloco={bloco}
              ancoras={ancoras}
              divisoes={divisoes}
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
