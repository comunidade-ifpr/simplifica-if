/**
 * A tarefa de uma skill (M1.9): o formulário curto gerado das `entradas` do manifesto (arquivo, curso,
 * texto, norma), a frase do que vai acontecer e a duração estimada. O formulário monta o pedido, que a
 * pessoa pode editar antes de enviar; "Começar" cria a pasta da tarefa em Documentos/Simplifica IF,
 * copia os anexos para ela e abre a conversa com a skill.
 */
import type { EntradaTarefa, ResumoSkill } from "@simplifica-if/contratos-app";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, ClockIcon, FolderIcon, PlayIcon } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { AvisoErro } from "../../components/AvisoErro.tsx";
import { Pagina } from "../../components/Pagina.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";
import { Textarea } from "../../components/ui/textarea.tsx";
import { explicarErro, type MensagemErro } from "../../conexao/erros.ts";
import { useApi, useConversa } from "../../contexto.tsx";
import { useCatalogo } from "../../tarefas/catalogo.ts";
import { Anexos, comecarTarefa, EscolhaIa, nomeArquivo } from "../../tarefas/comecar.tsx";
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
            aoMudar(novos.map(nomeArquivo).join(", "));
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

function Formulario({ skill }: { readonly skill: ResumoSkill }) {
  const api = useApi();
  const [estado, conversa] = useConversa();
  const navegar = useNavigate();
  const idPedido = useId();
  const [valores, setValores] = useState<Valores>({});
  const [anexos, setAnexos] = useState<Readonly<Record<string, ReadonlyArray<string>>>>({});
  // O pedido editado pela pessoa; sem edição, o montado a partir do formulário.
  const [editado, setEditado] = useState<string>();
  const [ia, setIa] = useState<EscolhaDaIa>({ provider: estado.provider });
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<MensagemErro>();

  const pedido = editado ?? montarPedido(skill, valores);
  const falta = faltando(skill.entradas, valores);
  const duracao = duracaoPorExtenso(skill.duracaoEstimada);

  const aoEnviar = async (evento: FormEvent) => {
    evento.preventDefault();
    if (falta.length > 0 || pedido.trim() === "" || enviando) return;
    setEnviando(true);
    setErro(undefined);
    try {
      const sessao = await comecarTarefa(api, conversa, {
        titulo: skill.titulo,
        tarefa: skill.nome,
        ia,
        anexos: Object.values(anexos).flat(),
        texto: pedido,
      });
      await navegar({ to: "/conversa", search: { id: sessao } });
    } catch (falha) {
      setErro(explicarErro(falha));
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={aoEnviar} className="flex flex-col gap-5" aria-label={skill.titulo}>
      <div className="flex flex-col gap-2">
        <h1 className="text-display">{skill.titulo}</h1>
        <p className="max-w-prose text-muted-foreground">{skill.resumo}</p>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-sm">
          {duracao === undefined ? null : (
            <span className="flex items-center gap-1.5">
              <ClockIcon aria-hidden className="size-4" /> Leva {duracao}.
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <FolderIcon aria-hidden className="size-4" /> Os arquivos ficam numa pasta nova em Documentos › Simplifica
            IF.
          </span>
        </p>
      </div>
      {skill.entradas.map((entrada) => (
        <CampoEntrada
          key={entrada.id}
          entrada={entrada}
          valor={valores[entrada.id] ?? ""}
          anexos={anexos[entrada.id] ?? []}
          aoMudar={(valor) => {
            setValores((anteriores) => ({ ...anteriores, [entrada.id]: valor }));
            setEditado(undefined);
          }}
          aoAnexar={(novos) => setAnexos((anteriores) => ({ ...anteriores, [entrada.id]: novos }))}
        />
      ))}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={idPedido} className="font-medium text-sm">
          O pedido que vai para a IA
        </label>
        <p className="text-micro text-muted-foreground">
          Você pode mudar o texto antes de começar.
          {Object.values(anexos).some((lista) => lista.length > 0)
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

function TelaTarefa() {
  const { nome } = Route.useParams();
  const catalogo = useCatalogo();
  const skill = catalogo.fase === "pronto" ? catalogo.skills.find((candidata) => candidata.nome === nome) : undefined;
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
      ) : skill === undefined ? (
        <p>Esta tarefa não existe mais no app.</p>
      ) : (
        <Formulario skill={skill} />
      )}
    </Pagina>
  );
}
