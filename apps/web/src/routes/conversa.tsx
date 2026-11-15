/**
 * Conversa: escolher o provider e a pasta de trabalho, conversar, aprovar ou negar o que a IA pede,
 * interromper e começar outra. Os links `ifpr://` das respostas abrem o painel de leitura ao lado.
 * As etapas declaradas pela skill e "detalhes técnicos" chegam no M1.9.
 *
 * As conversas ficam gravadas no servidor: a barra lateral as lista, e a conversa aberta fica na URL
 * (`/conversa?id=…`). Ao recarregar a tela ou reabrir o app numa conversa, ela volta com o histórico
 * e, se a IA estava respondendo, com o resto da resposta.
 */
import type { Provider } from "@simplifica-if/contratos-app";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FolderOpenIcon, PlusIcon, SendHorizontalIcon, SquareIcon } from "lucide-react";
import { type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { AvisoErro } from "../components/AvisoErro.tsx";
import { ItemConversa } from "../components/ItemConversa.tsx";
import { ListaConversas } from "../components/ListaConversas.tsx";
import { PainelLeitura } from "../components/PainelLeitura.tsx";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import { useConversa } from "../contexto.tsx";
import { cn } from "../lib/utils.ts";
import { ponteDesktop } from "../ponte-desktop.ts";
import { DESCRICOES, PROVIDERS } from "../providers.ts";

/** A busca da rota: o id da conversa aberta, quando há. */
export interface BuscaConversa {
  readonly id?: string;
}

export const Route = createFileRoute("/conversa")({
  component: TelaConversa,
  validateSearch: (busca: Record<string, unknown>): BuscaConversa =>
    typeof busca.id === "string" && busca.id !== "" ? { id: busca.id } : {},
});

function EscolhaProvider() {
  const [estado, conversa] = useConversa();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 font-semibold">Com qual IA?</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {PROVIDERS.map((provider: Provider) => (
          <label
            key={provider}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm has-checked:border-primary has-checked:bg-primary/8 has-focus-visible:ring-2 has-focus-visible:ring-ring",
            )}
          >
            <input
              type="radio"
              name="provider"
              value={provider}
              className="accent-primary"
              checked={estado.provider === provider}
              onChange={() => conversa.escolher({ provider })}
            />
            {DESCRICOES[provider].nome}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function EscolhaPasta() {
  const [estado, conversa] = useConversa();
  const escolherPasta = ponteDesktop()?.escolherPasta;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="pasta-trabalho" className="font-semibold">
        Pasta de trabalho
      </label>
      <p className="text-muted-foreground text-sm">
        A IA lê e escreve só nesta pasta. Use uma pasta com os documentos da tarefa.
      </p>
      <div className="flex gap-2">
        <Input
          id="pasta-trabalho"
          nativeInput
          placeholder="/Users/voce/Documents/Simplifica IF/minha-tarefa"
          value={estado.pastaTrabalho}
          readOnly={escolherPasta !== undefined}
          onChange={(evento) => conversa.escolher({ pastaTrabalho: evento.currentTarget.value })}
        />
        {escolherPasta === undefined ? null : (
          <Button
            variant="outline"
            onClick={async () => {
              const pasta = await escolherPasta();
              if (pasta !== null) conversa.escolher({ pastaTrabalho: pasta });
            }}
          >
            <FolderOpenIcon /> Escolher pasta…
          </Button>
        )}
      </div>
    </div>
  );
}

function FormularioInicio() {
  const [estado, conversa] = useConversa();
  const iniciando = estado.fase === "iniciando";
  const aoEnviar = (evento: FormEvent) => {
    evento.preventDefault();
    void conversa.iniciar();
  };
  return (
    <form onSubmit={aoEnviar} className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6" aria-label="Nova conversa">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">Nova conversa</h1>
        <p className="text-muted-foreground">A IA consulta a base do IFPR pelo app e cita as fontes.</p>
      </div>
      <EscolhaProvider />
      <EscolhaPasta />
      {estado.erroInicio === undefined ? null : <AvisoErro erro={estado.erroInicio} />}
      <div>
        <Button type="submit" size="lg" disabled={iniciando}>
          {iniciando ? <Spinner /> : null}
          {iniciando ? "Abrindo a conversa…" : "Começar conversa"}
        </Button>
      </div>
    </form>
  );
}

function Compositor() {
  const [estado, conversa] = useConversa();
  const [texto, setTexto] = useState("");
  const ocupada = estado.fase === "respondendo" || estado.fase === "interrompendo";
  const enviar = () => {
    if (texto.trim().length === 0 || ocupada) return;
    conversa.enviar(texto);
    setTexto("");
  };
  const aoTeclar = (evento: KeyboardEvent<HTMLTextAreaElement>) => {
    if (evento.key === "Enter" && !evento.shiftKey && !evento.nativeEvent.isComposing) {
      evento.preventDefault();
      enviar();
    }
  };
  return (
    <form
      className="flex items-end gap-2 border-border border-t bg-background p-3"
      onSubmit={(evento) => {
        evento.preventDefault();
        enviar();
      }}
    >
      <Textarea
        aria-label="Mensagem"
        placeholder="O que você precisa? (Enter envia; Shift+Enter quebra a linha)"
        rows={2}
        value={texto}
        onChange={(evento) => setTexto(evento.currentTarget.value)}
        onKeyDown={aoTeclar}
      />
      {ocupada ? (
        <Button
          variant="destructive-outline"
          size="lg"
          disabled={estado.fase === "interrompendo"}
          onClick={() => void conversa.interromper()}
        >
          {estado.fase === "interrompendo" ? <Spinner /> : <SquareIcon />}
          Interromper
        </Button>
      ) : (
        <Button type="submit" size="lg" disabled={texto.trim().length === 0}>
          <SendHorizontalIcon /> Enviar
        </Button>
      )}
    </form>
  );
}

/** Rola a conversa até o fim quando `sinal` muda (item novo, texto chegando). */
function RolarParaOFim({ sinal }: { readonly sinal: string }) {
  const fim = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (sinal.length > 0) fim.current?.scrollIntoView({ block: "end" });
  }, [sinal]);
  return <div ref={fim} />;
}

function Conversa({ aoAbrirLink }: { readonly aoAbrirLink: (link: string) => void }) {
  const [estado, conversa] = useConversa();
  const ultimo = estado.itens.at(-1);
  const tamanhoUltimo = ultimo?.tipo === "resposta" ? ultimo.texto.length : 0;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-border border-b px-4 py-2 text-sm">
        <p>
          <span className="font-semibold">{DESCRICOES[estado.provider].nome}</span>
          <span className="text-muted-foreground"> · pasta </span>
          <span className="font-mono text-xs">{estado.pastaTrabalho}</span>
        </p>
        {estado.titulo ? <p className="font-semibold">{estado.titulo}</p> : null}
        {estado.uso === undefined ? null : (
          <p className="text-muted-foreground text-xs">
            {estado.uso.entrada.toLocaleString("pt-BR")} tokens de entrada · {estado.uso.saida.toLocaleString("pt-BR")}{" "}
            de saída
          </p>
        )}
        <Button className="ml-auto" variant="outline" size="sm" onClick={() => conversa.nova()}>
          <PlusIcon /> Nova conversa
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6" aria-live="polite">
          {estado.itens.length === 0 ? (
            <p className="text-center text-muted-foreground">Conversa aberta. Escreva sua pergunta abaixo.</p>
          ) : null}
          {estado.fase === "pronta" && estado.estadoServidor === "caiu" ? (
            <p className="text-center text-muted-foreground text-sm">
              A IA parou de funcionar na última resposta. A próxima mensagem retoma a conversa de onde parou.
            </p>
          ) : null}
          {estado.itens.map((item) => (
            <ItemConversa key={item.chave} item={item} aoAbrirLink={aoAbrirLink} />
          ))}
          {estado.fase === "respondendo" && ultimo?.tipo === "pessoa" ? (
            <p className="flex items-center gap-2 text-muted-foreground text-sm">
              <Spinner size="sm" /> Pensando…
            </p>
          ) : null}
          <RolarParaOFim sinal={`${estado.itens.length}:${tamanhoUltimo}`} />
        </div>
      </div>
      <Compositor />
    </div>
  );
}

/** A barra lateral: as conversas gravadas. */
function BarraConversas() {
  const [estado] = useConversa();
  return (
    <nav
      aria-label="Conversas gravadas"
      className="hidden h-full w-64 shrink-0 flex-col gap-3 overflow-y-auto border-border border-r p-3 md:flex"
    >
      <h2 className="px-2 font-semibold text-muted-foreground text-xs uppercase tracking-wide">Conversas</h2>
      <ListaConversas atual={estado.sessao} atualizar={`${estado.sessao ?? ""}:${estado.fase}`} />
    </nav>
  );
}

function TelaConversa() {
  const [estado, conversa] = useConversa();
  const { id } = Route.useSearch();
  const navegar = useNavigate({ from: "/conversa" });
  const [leitura, setLeitura] = useState<ReadonlyArray<string>>([]);
  const abrirLink = (link: string) => setLeitura((historico) => [...historico, link]);

  // A URL manda: um id que não é o da conversa corrente abre aquela conversa.
  useEffect(() => {
    if (id !== undefined && id !== conversa.obter().sessao) {
      setLeitura([]);
      void conversa.abrir(id);
    }
  }, [id, conversa]);
  // E a URL acompanha a conversa corrente (a que acabou de começar, ou nenhuma depois de "Nova").
  useEffect(() => {
    const atual = conversa.obter().sessao;
    if (atual !== id) void navegar({ search: atual === undefined ? {} : { id: atual }, replace: true });
  }, [estado.sessao, id, conversa, navegar]);

  let conteudo: ReactNode;
  if (estado.fase === "carregando") {
    conteudo = (
      <p className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
        <Spinner /> Abrindo a conversa…
      </p>
    );
  } else if (estado.fase === "configurando" || estado.fase === "iniciando") {
    conteudo = (
      <div className="h-full flex-1 overflow-y-auto">
        <FormularioInicio />
      </div>
    );
  } else {
    conteudo = (
      <>
        <Conversa aoAbrirLink={abrirLink} />
        {leitura.length === 0 ? null : (
          <div className="h-full w-[min(32rem,45vw)] shrink-0">
            <PainelLeitura
              historico={leitura}
              aoAbrirLink={abrirLink}
              aoVoltar={() => setLeitura((historico) => historico.slice(0, -1))}
              aoFechar={() => setLeitura([])}
            />
          </div>
        )}
      </>
    );
  }
  return (
    <div className="flex h-full">
      <BarraConversas />
      {conteudo}
    </div>
  );
}
