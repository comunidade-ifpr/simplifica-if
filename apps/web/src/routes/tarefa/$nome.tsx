/**
 * A página de uma tarefa do catálogo (M1.9): o título, o resumo, o que ela não faz (`limites`), a
 * duração estimada, quem a escreveu e quem a mantém, e o começo dela conforme a abertura:
 *
 * - **conversa:** o formulário curto gerado das `entradas` do manifesto (arquivo, curso, texto, norma).
 *   O formulário monta o pedido, que a pessoa pode editar antes de enviar; "Começar" cria a pasta da
 *   tarefa em Documentos/Simplifica IF, copia os anexos para ela e abre a conversa da tarefa;
 * - **módulo:** o botão que leva à tela do módulo;
 * - **link:** o botão que abre o sistema no navegador, com o domínio de destino.
 *
 * Os cartões de módulo e de link abrem direto; esta página os atende quando alguém chega pelo endereço.
 */
import type { AberturaTarefa, EntradaTarefa, ResumoTarefa } from "@simplifica-if/contratos-app";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, ClockIcon, ExternalLinkIcon, FolderIcon, PlayIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { AvisoErro } from "../../components/AvisoErro.tsx";
import { Pagina } from "../../components/Pagina.tsx";
import { Button, buttonVariants } from "../../components/ui/button.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";
import { Textarea } from "../../components/ui/textarea.tsx";
import { explicarErro, type MensagemErro } from "../../conexao/erros.ts";
import { useApi, useApp } from "../../contexto.tsx";
import { abrirLinkDaTarefa, dominioDoLink, ROTAS_MODULO } from "../../tarefas/abrir.ts";
import { useCatalogo } from "../../tarefas/catalogo.ts";
import { nomeDoArquivo } from "../../lib/texto.ts";
import { Anexos, comecarTarefa, EscolhaIa } from "../../tarefas/comecar.tsx";
import type { EscolhaDaIa } from "../../tarefas/modelos.ts";
import { duracaoPorExtenso, faltando, montarPedido, type Valores } from "../../tarefas/textos.ts";

export const Route = createFileRoute("/tarefa/$nome")({ component: TelaTarefa });

const DICAS: Readonly<Record<EntradaTarefa["tipo"], string | undefined>> = {
  arquivo: undefined,
  curso: "Ex.: Técnico em Enfermagem, Campus Curitiba",
  norma: "Ex.: Resolução CNE/CP nº 2/2026",
  texto: undefined,
};

function CampoEntrada({
  entrada,
  valor,
  anexos,
  aoMudar,
  aoAnexar,
}: {
  readonly entrada: EntradaTarefa;
  readonly valor: string;
  readonly anexos: ReadonlyArray<string>;
  readonly aoMudar: (valor: string) => void;
  readonly aoAnexar: (anexos: ReadonlyArray<string>) => void;
}) {
  const id = useId();
  const rotulo = `${entrada.rotulo}${entrada.opcional ? " (opcional)" : ""}`;
  if (entrada.tipo === "arquivo") {
    return (
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 font-medium text-sm">{rotulo}</legend>
        <Anexos
          anexos={anexos}
          aceita={entrada.aceita}
          rotulo="Escolher arquivo…"
          aoMudar={(novos) => {
            aoAnexar(novos);
            aoMudar(novos.map(nomeDoArquivo).join(", "));
          }}
        />
        {entrada.aceita === undefined ? null : (
          <p className="text-muted-foreground text-small">Aceita {entrada.aceita.join(", ")}.</p>
        )}
      </fieldset>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-medium text-sm">
        {rotulo}
      </label>
      {entrada.tipo === "texto" ? (
        <Textarea id={id} rows={3} value={valor} onChange={(evento) => aoMudar(evento.currentTarget.value)} />
      ) : (
        <Input
          id={id}
          nativeInput
          value={valor}
          placeholder={DICAS[entrada.tipo]}
          onChange={(evento) => aoMudar(evento.currentTarget.value)}
        />
      )}
    </div>
  );
}

/**
 * O cabeçalho comum às três aberturas: o que a tarefa é, quanto leva, o que ela não faz e quem responde
 * por ela. `nota` é a frase própria da abertura (onde ficam os arquivos, aonde o link leva).
 */
function Apresentacao({ tarefa, nota }: { readonly tarefa: ResumoTarefa; readonly nota?: ReactNode }) {
  const duracao = duracaoPorExtenso(tarefa.duracaoEstimada);
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-display">{tarefa.titulo}</h1>
      <p className="max-w-prose text-muted-foreground">{tarefa.resumo}</p>
      {duracao === undefined && nota === undefined ? null : (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-sm">
          {duracao === undefined ? null : (
            <span className="flex items-center gap-1.5">
              <ClockIcon aria-hidden className="size-4" /> Leva {duracao}.
            </span>
          )}
          {nota}
        </p>
      )}
      {tarefa.limites === undefined ? null : (
        <p className="max-w-prose text-sm" data-limites>
          <span className="font-medium">O que esta tarefa não faz:</span> {tarefa.limites}
        </p>
      )}
      <p className="text-muted-foreground text-small" data-mantenedor>
        {tarefa.autoria === undefined ? null : `Escrita por ${tarefa.autoria}. `}
        Mantida por {tarefa.mantenedor.nome} (@{tarefa.mantenedor.github} no GitHub).
      </p>
    </div>
  );
}

function Formulario({
  tarefa,
  conversa: abertura,
}: {
  readonly tarefa: ResumoTarefa;
  readonly conversa: Extract<AberturaTarefa, { tipo: "conversa" }>;
}) {
  const api = useApi();
  const { conversas } = useApp();
  const navegar = useNavigate();
  const idPedido = useId();
  // Pelo `id` da entrada, em `Map`: o `id` vem do manifesto, e `constructor` não é campo preenchido.
  const [valores, setValores] = useState<Valores>(new Map());
  const [anexos, setAnexos] = useState<ReadonlyMap<string, ReadonlyArray<string>>>(new Map());
  // O pedido editado pela pessoa; sem edição, o montado a partir do formulário.
  const [editado, setEditado] = useState<string>();
  const [ia, setIa] = useState<EscolhaDaIa>(() => ({ provider: conversas.ultimaIa() }));
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<MensagemErro>();

  const pedido = editado ?? montarPedido(abertura, valores);
  const falta = faltando(abertura.entradas, valores);

  const aoEnviar = async (evento: FormEvent) => {
    evento.preventDefault();
    if (falta.length > 0 || pedido.trim() === "" || enviando) return;
    setEnviando(true);
    setErro(undefined);
    try {
      await comecarTarefa(
        api,
        conversas,
        { titulo: tarefa.titulo, tarefa: tarefa.id, ia, anexos: [...anexos.values()].flat(), texto: pedido },
        (sessao) => navegar({ to: "/conversa", search: { id: sessao } }),
      );
    } catch (falha) {
      setErro(explicarErro(falha));
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={aoEnviar} className="flex flex-col gap-5" aria-label={tarefa.titulo}>
      <Apresentacao
        tarefa={tarefa}
        nota={
          <span className="flex items-center gap-1.5">
            <FolderIcon aria-hidden className="size-4" /> Os arquivos ficam numa pasta nova em Documentos › Simplifica
            IF.
          </span>
        }
      />
      {abertura.entradas.map((entrada) => (
        <CampoEntrada
          key={entrada.id}
          entrada={entrada}
          valor={valores.get(entrada.id) ?? ""}
          anexos={anexos.get(entrada.id) ?? []}
          aoMudar={(valor) => {
            setValores((anteriores) => new Map(anteriores).set(entrada.id, valor));
            setEditado(undefined);
          }}
          aoAnexar={(novos) => setAnexos((anteriores) => new Map(anteriores).set(entrada.id, novos))}
        />
      ))}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={idPedido} className="font-medium text-sm">
          O pedido que vai para a IA
        </label>
        <p className="text-micro text-muted-foreground">
          Você pode mudar o texto antes de começar.
          {[...anexos.values()].some((lista) => lista.length > 0)
            ? " A lista dos arquivos anexados vai junto, no fim, com o caminho da versão em texto de cada documento do Word."
            : null}
        </p>
        <Textarea id={idPedido} rows={4} value={pedido} onChange={(evento) => setEditado(evento.currentTarget.value)} />
      </div>
      {falta.length === 0 ? null : (
        <p className="text-muted-foreground text-sm" role="status">
          Falta: {falta.join(", ")}.
        </p>
      )}
      {erro === undefined ? null : <AvisoErro erro={erro} />}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={falta.length > 0 || pedido.trim() === "" || enviando}>
          {enviando ? <Spinner /> : <PlayIcon />}
          {enviando ? "Abrindo…" : "Começar"}
        </Button>
        <EscolhaIa valor={ia} aoMudar={setIa} />
      </div>
    </form>
  );
}

/** A tarefa de link ou de módulo: a apresentação e o botão que abre. */
function Abrir({
  tarefa,
  abertura,
}: {
  readonly tarefa: ResumoTarefa;
  readonly abertura: Exclude<AberturaTarefa, { tipo: "conversa" }>;
}) {
  const [erro, setErro] = useState<MensagemErro>();
  if (abertura.tipo === "modulo") {
    return (
      <div className="flex flex-col gap-5">
        <Apresentacao tarefa={tarefa} />
        <Link to={ROTAS_MODULO[abertura.modulo]} className={buttonVariants({ size: "lg", className: "self-start" })}>
          <PlayIcon /> Começar
        </Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <Apresentacao
        tarefa={tarefa}
        nota={
          <span className="flex items-center gap-1.5">
            <ExternalLinkIcon aria-hidden className="size-4" /> Abre no navegador: {dominioDoLink(abertura.url)}
            {abertura.requerLogin ? " (pede o seu login de lá)" : ""}.
          </span>
        }
      />
      {erro === undefined ? null : <AvisoErro erro={erro} />}
      <Button
        size="lg"
        className="self-start"
        onClick={() => {
          setErro(undefined);
          void abrirLinkDaTarefa(abertura.url).then(setErro);
        }}
      >
        <ExternalLinkIcon /> Abrir no navegador
      </Button>
    </div>
  );
}

function TelaTarefa() {
  const { nome } = Route.useParams();
  const catalogo = useCatalogo();
  const tarefa = catalogo.fase === "pronto" ? catalogo.tarefas.find((candidata) => candidata.id === nome) : undefined;
  return (
    <Pagina largura="estreita" className="gap-4">
      <Link to="/" className="flex w-fit items-center gap-1 text-muted-foreground text-small hover:text-foreground">
        <ArrowLeftIcon className="size-3.5" /> Início
      </Link>
      {catalogo.fase === "carregando" ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Spinner size="sm" /> Carregando a tarefa…
        </p>
      ) : catalogo.fase === "falhou" ? (
        <AvisoErro erro={catalogo.erro} />
      ) : tarefa === undefined ? (
        <p>Esta tarefa não existe mais no app.</p>
      ) : tarefa.abre.tipo === "conversa" ? (
        // A `key` zera o formulário ao trocar de tarefa: o pedido editado e os anexos são da tarefa.
        <Formulario key={tarefa.id} tarefa={tarefa} conversa={tarefa.abre} />
      ) : (
        <Abrir key={tarefa.id} tarefa={tarefa} abertura={tarefa.abre} />
      )}
    </Pagina>
  );
}
