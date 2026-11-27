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
 * antes (`beforeprint` e o `montarTudo` da instância, `instancia.ts`).
 *
 * O índice da norma (`Sumario.tsx`) pede a rolagem até um item ou um artigo (o `irPara` da instância): o
 * bloco do destino se monta na hora, e o texto rola até o elemento. Os cabeçalhos do sumário ganham um
 * `id` (`sumario-<linha>`) e os de divisão, a classe `divisao`. Todo `id` leva o prefixo da instância do
 * leitor, para a mesma norma poder estar aberta na tela e no painel.
 *
 * Selecionar texto mostra a barra da seleção (`BarraSelecao.tsx`): "Perguntar sobre este trecho" e "Copiar
 * citação", com o dispositivo do começo da seleção.
 */
import type { Ancora, DadosDocumento } from "@simplifica-if/contratos-app";
import { ImageOffIcon } from "lucide-react";
import { type ComponentProps, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import { leitorEmFoco } from "../components/BuscaPainel.tsx";
import { AbrirLink, LinkMarkdown, transformarUrl } from "../components/Markdown.tsx";
import { BarraSelecao } from "./BarraSelecao.tsx";
import { type Bloco, blocoDaLinha, dividirEmBlocos, ordemDeMontagem } from "./blocos.ts";
import { pintar } from "./destaques.ts";
import { raizAImprimir, useInstanciaLeitor } from "./instancia.ts";
import { faixasDoRealce, NOME_REALCE, rolarAte, textosDe } from "./realce.ts";
import { ancorasPorLinha, linhasDoTrecho, rehypeDispositivos } from "./rehypeDispositivos.ts";
import { remarkMarcadores, remarkQuebras } from "./remarkLeitor.ts";
import { ancorasDoSumario, linhasDeDivisao } from "./sumario.ts";
import type { AoAbrirLink } from "../painel/abrirLink.ts";

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
    prefixo,
  }: {
    readonly bloco: Bloco;
    readonly ancoras: ReadonlyMap<number, ReadonlyArray<string>>;
    readonly destaque: Trecho | null;
    readonly divisoes: ReadonlySet<number>;
    readonly prefixo: string;
  }) {
    const plugins = useMemo(
      (): Options["rehypePlugins"] => [
        [
          rehypeDispositivos,
          { ancoras, destaque, divisoes, prefixo, deslocamento: bloco.linhaInicial - 1, linhaFinal: bloco.linhaFinal },
        ],
      ],
      [ancoras, destaque, divisoes, prefixo, bloco.linhaInicial, bloco.linhaFinal],
    );
    // As notas de rodapé do GFM também levam o prefixo nos `id` (o título delas, no `rehypeDispositivos`).
    const opcoesRehype = useMemo(
      () => ({
        clobberPrefix: `${prefixo}user-content-`,
        footnoteLabel: "Notas de rodapé",
        footnoteBackLabel: (indice: number) => `Voltar à chamada da nota ${indice + 1}`,
      }),
      [prefixo],
    );
    return (
      <div
        className={destaque === null ? "bloco-documento" : "bloco-documento bloco-alvo"}
        data-linha={bloco.linhaInicial}
      >
        <ReactMarkdown
          remarkPlugins={PLUGINS_REMARK}
          rehypePlugins={plugins}
          remarkRehypeOptions={opcoesRehype}
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
    antes.prefixo === depois.prefixo &&
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
  /** Uma norma ou um PPC da base, ou o PPC revisado (`ifpr://revisao-ppc/…`): o texto, as âncoras e o link sem fragmento. */
  readonly documento: Pick<DadosDocumento, "markdown" | "ancoras"> & {
    readonly link: string;
    /** O sumário da norma; o PPC em revisão não tem. */
    readonly sumario?: DadosDocumento["sumario"];
  };
  /** O fragmento a destacar e a mostrar (`art28-xviii`); `null` abre no começo. */
  readonly alvo: string | null;
  readonly aoAbrirLink: AoAbrirLink;
  /** O nome acessível do texto ("Texto da norma"). */
  readonly rotulo: string;
  /** A frase a realçar dentro do trecho destacado (o trecho da pendência); `null` destaca só o bloco. */
  readonly realce?: string | null;
}) {
  const instancia = useInstanciaLeitor();
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

  const conteiner = useRef<HTMLDivElement>(null);
  const caixa = useRef<HTMLDivElement>(null);

  // Para imprimir e para buscar (Ctrl/⌘+F), o documento inteiro.
  useEffect(() => {
    // Já tudo montado, o mesmo estado: a busca pede a cada tecla e não deve renderizar a lista de novo.
    const montarTudo = () =>
      flushSync(() =>
        setMontados((atuais) => (atuais.size === blocos.length ? atuais : new Set(blocos.map((_, i) => i)))),
      );
    // Na impressão, só o leitor que vai para o papel monta tudo (um PPC chega a 720 mil caracteres).
    const aoImprimir = () => {
      const raiz = raizAImprimir(leitorEmFoco);
      if (raiz === undefined || raiz.contains(conteiner.current)) montarTudo();
    };
    window.addEventListener("beforeprint", aoImprimir);
    const pararDeOuvir = instancia.aoMontarTudo(montarTudo);
    return () => {
      window.removeEventListener("beforeprint", aoImprimir);
      pararDeOuvir();
    };
  }, [blocos, instancia]);

  // O índice pede um item ou um artigo: o bloco dele se monta já, e o texto rola até o elemento. Os
  // blocos de cima ainda podem mudar de altura ao se desenhar; dois quadros depois, a rolagem se acerta.
  useEffect(() => {
    let quadro = 0;
    const pararDeOuvir = instancia.aoIrPara(({ id, linha }) => {
      const indice = blocoDaLinha(blocos, linha);
      flushSync(() => setMontados((atuais) => (atuais.has(indice) ? atuais : new Set(atuais).add(indice))));
      const elemento = conteiner.current?.querySelector(`[id="${CSS.escape(instancia.id(id))}"]`);
      if (!(elemento instanceof HTMLElement)) return;
      cancelAnimationFrame(quadro);
      let acertos = 2;
      const rolar = () => {
        elemento.scrollIntoView({ block: "start" });
        quadro = acertos > 0 ? requestAnimationFrame(rolar) : 0;
        acertos -= 1;
      };
      rolar();
    });
    return () => {
      pararDeOuvir();
      cancelAnimationFrame(quadro);
    };
  }, [blocos, instancia]);

  // Rola até o trecho pedido, uma vez por alvo.
  const rolado = useRef<string | null>(null);
  useLayoutEffect(() => {
    const chave = `${documento.link}#${alvo ?? ""}`;
    if (alvo === null || rolado.current === chave) return;
    const elemento = conteiner.current?.querySelector(`[id="${CSS.escape(instancia.id(alvo))}"]`);
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
    const apagar = pintar(NOME_REALCE, faixas);
    raiz.classList.add("com-realce");
    rolarAte(faixas[0]!);
    return () => {
      apagar();
      raiz.classList.remove("com-realce");
    };
  }, [realce, trecho]);

  return (
    <AbrirLink value={aoAbrirLink}>
      <div ref={caixa} className="relative">
        <BarraSelecao conteiner={conteiner} caixa={caixa} documento={documento.link} prefixo={instancia.prefixo} />
        <div ref={conteiner} role="document" aria-label={rotulo} className="markdown documento-leitor" data-conteudo>
          {blocos.map((bloco, i) =>
            visiveis.has(i) ? (
              <BlocoMarkdown
                key={bloco.linhaInicial}
                bloco={bloco}
                ancoras={ancoras}
                divisoes={divisoes}
                prefixo={instancia.prefixo}
                destaque={trecho !== null && i >= primeiro && i <= ultimo ? trecho : null}
              />
            ) : (
              <EspacoReservado key={bloco.linhaInicial} bloco={bloco} />
            ),
          )}
        </div>
      </div>
    </AbrirLink>
  );
}
