/**
 * A caixa de pedido, comum à conversa e ao Início: um cartão de cantos arredondados com o campo de texto
 * (sem borda própria, cresce com o texto até um limite e então rola) e, embaixo, à esquerda o que a tela
 * põe (os anexos), à direita a escolha da IA, quando há, e o botão redondo de enviar, que vira
 * "Interromper" enquanto a IA responde. Enter envia; Shift+Enter quebra a linha.
 *
 * O desenho segue o compositor do T3 Code (`ComposerSurface` e `ComposerPrimaryActions`), sem cópia de
 * código: cartão `rounded-2xl` com borda sutil e sombra suave, foco que só realça a borda e o botão de
 * enviar redondo, só com a seta, apagado com o campo vazio.
 *
 * Com `aoSoltarArquivos`, o cartão aceita arquivos arrastados do sistema: a borda realça enquanto
 * passam por cima, e soltar entrega os `File` à tela (que os anexa pela ponte do desktop).
 */
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import {
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { cn } from "../lib/utils.ts";
import { Spinner } from "./ui/spinner.tsx";

const DICA_ENTER = "Enter envia; Shift+Enter quebra a linha";

const botaoRedondo =
  "inline-flex size-9 shrink-0 items-center justify-center rounded-full transition-[background-color,color,transform] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:pointer-events-none sm:size-8 [&_svg]:pointer-events-none [&_svg]:size-4";

export function CaixaPedido({
  rotulo,
  rotuloFormulario,
  placeholder = "O que você precisa?",
  valor,
  aoMudar,
  aoEnviar,
  enviando = false,
  rotuloEnviando = "Abrindo a conversa…",
  interromper,
  aoSoltarArquivos,
  esquerda,
  direita,
  abaixo,
  linhas = 1,
  focar = false,
  className,
}: {
  /** O nome acessível do campo. */
  readonly rotulo: string;
  /** O nome acessível do formulário, quando a tela quer um (o Início). */
  readonly rotuloFormulario?: string;
  readonly placeholder?: string;
  readonly valor: string;
  readonly aoMudar: (valor: string) => void;
  /** Chamado com texto que não está em branco e fora de envio ou resposta. */
  readonly aoEnviar: () => void;
  /** O pedido está saindo: o botão gira e o Enter não envia de novo. */
  readonly enviando?: boolean;
  /** O que aparece ao lado do botão enquanto `enviando`. */
  readonly rotuloEnviando?: string;
  /** A IA está respondendo: o botão de enviar vira "Interromper". */
  readonly interromper?: { readonly aoInterromper: () => void; readonly interrompendo: boolean } | undefined;
  /** Arquivos soltos no cartão; sem ela, o cartão não aceita arrastar e soltar. */
  readonly aoSoltarArquivos?: ((arquivos: ReadonlyArray<File>) => void) | undefined;
  /** Na linha de baixo, à esquerda (os anexos). */
  readonly esquerda?: ReactNode;
  /** Na linha de baixo, à direita, antes do botão (a escolha da IA). */
  readonly direita?: ReactNode;
  /** Abaixo da linha de botões, dentro do cartão (um erro). */
  readonly abaixo?: ReactNode;
  /** Altura mínima do campo, em linhas. */
  readonly linhas?: number;
  /** Ao montar, o foco vai ao campo, com o cursor no fim do texto (o pedido que veio pronto do Explorar). */
  readonly focar?: boolean;
  readonly className?: string;
}) {
  const idDica = useId();
  const campo = useRef<HTMLTextAreaElement>(null);
  const vazio = valor.trim() === "";
  const [arrastando, setArrastando] = useState(false);
  // quando `focar` liga (na montagem, com o pedido pronto): o texto digitado depois não move o cursor
  useEffect(() => {
    const elemento = campo.current;
    if (!focar || elemento === null) return;
    elemento.focus();
    elemento.setSelectionRange(elemento.value.length, elemento.value.length);
  }, [focar]);
  const enviar = () => {
    if (vazio || enviando || interromper !== undefined) return;
    aoEnviar();
  };
  const aoSubmeter = (evento: FormEvent) => {
    evento.preventDefault();
    enviar();
  };
  const aoTeclar = (evento: KeyboardEvent<HTMLTextAreaElement>) => {
    if (evento.key === "Enter" && !evento.shiftKey && !evento.nativeEvent.isComposing) {
      evento.preventDefault();
      enviar();
    }
  };
  // Só arrasto de arquivo do sistema; texto e links arrastados seguem para o campo.
  const comArquivos = (evento: DragEvent) =>
    aoSoltarArquivos !== undefined && evento.dataTransfer.types.includes("Files");
  const aoArrastarPorCima = (evento: DragEvent) => {
    if (!comArquivos(evento)) return;
    evento.preventDefault();
    evento.dataTransfer.dropEffect = "copy";
    setArrastando(true);
  };
  const aoSairArrastando = (evento: DragEvent) => {
    // `dragleave` também dispara ao passar de um filho a outro do cartão.
    if (!evento.currentTarget.contains(evento.relatedTarget as Node | null)) setArrastando(false);
  };
  const aoSoltar = (evento: DragEvent) => {
    if (!comArquivos(evento)) return;
    evento.preventDefault();
    setArrastando(false);
    const arquivos = [...evento.dataTransfer.files];
    if (arquivos.length > 0) aoSoltarArquivos?.(arquivos);
  };
  return (
    <form
      onSubmit={aoSubmeter}
      onDragEnter={aoArrastarPorCima}
      onDragOver={aoArrastarPorCima}
      onDragLeave={aoSairArrastando}
      onDrop={aoSoltar}
      aria-label={rotuloFormulario}
      data-caixa-pedido
      data-arrastando={arrastando || undefined}
      className={cn(
        "flex w-full flex-col rounded-2xl border border-border bg-card text-card-foreground transition-[border-color,box-shadow] duration-150",
        "shadow-[0_1px_2px_rgb(0_0_0/5%),0_10px_28px_-14px_rgb(0_0_0/18%)] dark:shadow-[0_14px_32px_-18px_rgb(0_0_0/75%)]",
        "focus-within:border-ring/45 dark:focus-within:border-ring/55",
        "data-arrastando:border-primary data-arrastando:bg-primary/4 data-arrastando:ring-2 data-arrastando:ring-primary/25",
        className,
      )}
    >
      <textarea
        ref={campo}
        aria-label={rotulo}
        aria-describedby={idDica}
        placeholder={placeholder}
        rows={linhas}
        value={valor}
        onChange={(evento) => aoMudar(evento.currentTarget.value)}
        onKeyDown={aoTeclar}
        className="field-sizing-content max-h-[min(40vh,15rem)] w-full resize-none overflow-y-auto bg-transparent px-4 pt-3.5 pb-1 text-base text-foreground leading-relaxed outline-none wrap-anywhere placeholder:text-muted-foreground/80 sm:text-sm"
        style={{ minHeight: `calc(${linhas}lh + 1.125rem)` }}
      />
      <span id={idDica} className="sr-only">
        {DICA_ENTER}
      </span>
      <div className="flex items-end gap-2 px-2.5 pt-1 pb-2.5">
        <div className="min-w-0 flex-1">{esquerda}</div>
        <div className="flex shrink-0 items-center gap-1.5">
          {direita}
          {enviando ? (
            <span role="status" className="text-muted-foreground text-xs">
              {rotuloEnviando}
            </span>
          ) : null}
          {interromper === undefined ? (
            <button
              type="submit"
              aria-label="Enviar"
              aria-busy={enviando || undefined}
              title={`Enviar (${DICA_ENTER})`}
              disabled={vazio || enviando}
              className={cn(
                botaoRedondo,
                "cursor-pointer bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 active:scale-95 disabled:bg-foreground/10 disabled:text-muted-foreground disabled:shadow-none",
              )}
            >
              {enviando ? <Spinner size="sm" /> : <ArrowUpIcon aria-hidden strokeWidth={2.5} />}
            </button>
          ) : (
            <button
              type="button"
              aria-label="Interromper"
              title="Interromper a resposta"
              disabled={interromper.interrompendo}
              onClick={interromper.aoInterromper}
              className={cn(
                botaoRedondo,
                "cursor-pointer bg-foreground text-background hover:bg-foreground/85 active:scale-95 disabled:bg-foreground/10 disabled:text-muted-foreground",
              )}
            >
              {interromper.interrompendo ? (
                <Spinner size="sm" />
              ) : (
                <SquareIcon aria-hidden className="size-3! fill-current" />
              )}
            </button>
          )}
        </div>
      </div>
      {arrastando ? (
        <p className="px-4 pb-2.5 font-medium text-primary text-xs" aria-hidden>
          Solte para anexar
        </p>
      ) : null}
      {abaixo === undefined ? null : <div className="px-3 pb-3">{abaixo}</div>}
    </form>
  );
}
