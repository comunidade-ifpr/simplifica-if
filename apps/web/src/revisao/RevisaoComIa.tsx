/**
 * "Revisão completa com IA" (M1.11, etapa 4), depois da pré-conferência: a pessoa escolhe o provider e
 * o modo, vê a estimativa e confirma; acompanha os temas ficando prontos; pausa e retoma. O servidor
 * conduz (`revisaoPpc.prepararIa`, `iniciarIa`, `pausarIa`, `acompanharIa`); quando termina, o
 * resultado (as pendências do código e da IA juntas, e a nova cópia comentada) substitui o da
 * pré-conferência na tela.
 */
import type { EstadoRevisaoIa, ModoRevisaoIa, Provider, ResultadoRevisaoPpc } from "@simplifica-if/contratos-app";
import { CheckIcon, PauseIcon, PlayIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AvisoErro } from "../components/AvisoErro.tsx";
import { Alert, AlertDescription } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import type { Acompanhamento } from "../conexao/api.ts";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { useApi } from "../contexto.tsx";
import { DESCRICOES, PROVIDERS } from "../providers.ts";
import { andamentoPorTema, ROTULO_SITUACAO, textoEstimativa } from "./ia.ts";

const MODOS: ReadonlyArray<{ readonly modo: ModoRevisaoIa; readonly titulo: string; readonly descricao: string }> = [
  {
    modo: "rapido",
    titulo: "O que mais devolve PPC",
    descricao: "Os critérios que bloqueiam a submissão e os temas que a PROENS mais devolve.",
  },
  { modo: "completo", titulo: "Todos os critérios", descricao: "Os 68 critérios que exigem leitura." },
];

export function RevisaoComIa({
  arquivo,
  aoConcluir,
  retomada,
}: {
  readonly arquivo: string;
  readonly aoConcluir: (resultado: ResultadoRevisaoPpc) => void;
  /** Uma revisão reencontrada depois de recarregar a tela (`revisaoPpc.listarIa`): volta a acompanhá-la. */
  readonly retomada?: EstadoRevisaoIa;
}) {
  const api = useApi();
  const [provider, setProvider] = useState<Provider>("claude");
  const [modo, setModo] = useState<ModoRevisaoIa>("rapido");
  const [estado, setEstado] = useState<EstadoRevisaoIa | undefined>(retomada);
  const [ocupada, setOcupada] = useState(false);
  const [erro, setErro] = useState<MensagemErro | undefined>(undefined);
  const acompanhamento = useRef<Acompanhamento | undefined>(undefined);
  const concluiu = useRef(false);

  useEffect(() => () => acompanhamento.current?.cancelar(), []);

  const acompanhar = (id: string) => {
    acompanhamento.current?.cancelar();
    acompanhamento.current = api.acompanhar(
      (cliente) => cliente["revisaoPpc.acompanharIa"]({ revisao: id }),
      (novo) => {
        setEstado(novo);
        if (novo.situacao === "concluida" && novo.resultado !== null && !concluiu.current) {
          concluiu.current = true;
          aoConcluir(novo.resultado);
        }
      },
    );
    acompanhamento.current.fim.catch((motivo: unknown) => setErro(explicarErro(motivo)));
  };

  // Reencontrada depois de recarregar: o acompanhamento traz o estado completo (a lista vem sem os blocos).
  useEffect(() => {
    if (retomada !== undefined) acompanhar(retomada.id);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- só na montagem: o `key` do componente é a revisão
  }, []);

  const chamar = async (acao: () => Promise<EstadoRevisaoIa>, depois?: (e: EstadoRevisaoIa) => void) => {
    setOcupada(true);
    setErro(undefined);
    try {
      const novo = await acao();
      setEstado(novo);
      depois?.(novo);
    } catch (motivo) {
      setErro(explicarErro(motivo));
    } finally {
      setOcupada(false);
    }
  };

  const preparar = () => chamar(() => api.chamar((c) => c["revisaoPpc.prepararIa"]({ arquivo, provider, modo })));
  const iniciar = (id: string) =>
    chamar(
      () => api.chamar((c) => c["revisaoPpc.iniciarIa"]({ revisao: id })),
      () => acompanhar(id),
    );
  const pausar = (id: string) => chamar(() => api.chamar((c) => c["revisaoPpc.pausarIa"]({ revisao: id })));
  const apagar = async (id: string) => {
    setOcupada(true);
    setErro(undefined);
    try {
      acompanhamento.current?.cancelar();
      await api.chamar((c) => c["revisaoPpc.apagarIa"]({ revisao: id }));
      setEstado(undefined);
    } catch (motivo) {
      setErro(explicarErro(motivo));
    } finally {
      setOcupada(false);
    }
  };

  return (
    <section aria-labelledby="titulo-ia" className="flex flex-col gap-3 rounded-lg border p-4">
      <h2 id="titulo-ia" className="flex items-center gap-2 font-semibold text-lg">
        <SparklesIcon className="size-5" aria-hidden /> Gerar relatório com IA (revisão completa)
      </h2>
      {estado === undefined ? (
        <>
          <p className="text-muted-foreground text-sm">
            A IA da sua conta lê os critérios que o código não decide. O app manda só os trechos de cada tema, confere
            cada trecho e cada norma que a IA citar e junta tudo na mesma lista e no mesmo documento comentado.
          </p>
          <fieldset className="flex flex-col gap-1">
            <legend className="font-medium text-sm">Com qual IA</legend>
            <div className="flex flex-wrap gap-4">
              {PROVIDERS.map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="provider-ia" checked={provider === p} onChange={() => setProvider(p)} />
                  {DESCRICOES[p].nome}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-1">
            <legend className="font-medium text-sm">O que revisar</legend>
            {MODOS.map((m) => (
              <label key={m.modo} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="modo-ia"
                  className="mt-1"
                  checked={modo === m.modo}
                  onChange={() => setModo(m.modo)}
                />
                <span>
                  <span className="font-medium">{m.titulo}.</span> {m.descricao}
                </span>
              </label>
            ))}
          </fieldset>
          <div>
            <Button disabled={ocupada} onClick={() => void preparar()}>
              {ocupada ? <Spinner /> : null} Ver quanto vai usar do plano
            </Button>
          </div>
        </>
      ) : (
        <Andamento
          estado={estado}
          ocupada={ocupada}
          aoIniciar={() => void iniciar(estado.id)}
          aoPausar={() => void pausar(estado.id)}
          aoVoltar={() => setEstado(undefined)}
          aoApagar={() => void apagar(estado.id)}
        />
      )}
      {erro === undefined ? null : <AvisoErro erro={erro} />}
    </section>
  );
}

function Andamento({
  estado,
  ocupada,
  aoIniciar,
  aoPausar,
  aoVoltar,
  aoApagar,
}: {
  readonly estado: EstadoRevisaoIa;
  readonly ocupada: boolean;
  readonly aoIniciar: () => void;
  readonly aoPausar: () => void;
  readonly aoVoltar: () => void;
  readonly aoApagar: () => void;
}) {
  const nome = DESCRICOES[estado.provider].nome;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        <span className="font-medium">{ROTULO_SITUACAO[estado.situacao]}</span> · {nome} ·{" "}
        {estado.modo === "rapido" ? "o que mais devolve PPC" : "todos os critérios"}
      </p>
      {estado.situacao === "preparada" ? (
        <>
          <p className="text-sm">{textoEstimativa(estado.estimativa)}</p>
          <p className="text-muted-foreground text-xs">
            Estimativa aproximada. O uso por critério vem de medições reais; a fração da janela é uma referência
            provisória, porque as empresas de IA não publicam o tamanho da janela do plano. O uso de verdade aparece ao
            longo da revisão. Você pode pausar a qualquer momento, e o que já foi revisado fica guardado.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={ocupada} onClick={aoIniciar}>
              <PlayIcon /> Começar a revisão com {nome}
            </Button>
            <Button variant="outline" disabled={ocupada} onClick={aoVoltar}>
              Voltar
            </Button>
          </div>
        </>
      ) : (
        <>
          <ul className="flex flex-col gap-1 text-sm" aria-label="Andamento por tema">
            {andamentoPorTema(estado).map((t) => (
              <li key={t.ordem} className="flex items-center gap-2">
                {t.prontos === t.total ? (
                  <CheckIcon className="size-4 text-success" aria-label="pronto" />
                ) : t.emAndamento ? (
                  <Spinner />
                ) : (
                  <span className="inline-block size-4 rounded-full border" aria-label="na fila" />
                )}
                <span>{t.tema}</span>
                {t.total > 1 ? (
                  <span className="text-muted-foreground text-xs">
                    {t.prontos} de {t.total} etapas
                  </span>
                ) : null}
                {t.naoConferidas > 0 ? (
                  <span className="text-muted-foreground text-xs">
                    · {t.naoConferidas} {t.naoConferidas === 1 ? "critério ficou" : "critérios ficaram"} para conferir
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {estado.situacao === "pausada" && estado.motivo !== null ? (
            <Alert variant={estado.limite ? "warning" : "info"}>
              <AlertDescription>{estado.motivo}</AlertDescription>
            </Alert>
          ) : null}
          {estado.situacao === "falhou" && estado.motivo !== null ? (
            <AvisoErro erro={{ texto: estado.motivo }} />
          ) : null}
          <div className="flex flex-wrap gap-2">
            {estado.situacao === "em_andamento" ? (
              <Button variant="outline" disabled={ocupada} onClick={aoPausar}>
                <PauseIcon /> Pausar
              </Button>
            ) : null}
            {estado.situacao === "pausada" ? (
              <Button disabled={ocupada} onClick={aoIniciar}>
                <PlayIcon /> Retomar
              </Button>
            ) : null}
            {estado.situacao === "falhou" ? (
              <Button disabled={ocupada} onClick={aoVoltar}>
                Preparar de novo com o arquivo atual
              </Button>
            ) : null}
            {estado.situacao !== "em_andamento" ? (
              <Button variant="outline" disabled={ocupada} onClick={aoApagar}>
                <Trash2Icon /> Apagar esta revisão
              </Button>
            ) : null}
          </div>
          <p className="text-muted-foreground text-xs">
            O app guarda no seu computador o texto do PPC e o resultado desta revisão até você apagá-la.
          </p>
        </>
      )}
    </div>
  );
}
