/**
 * "Revisar comigo" (M1.11, etapa 5b): a lista viva de pendências, guardada no servidor, apresentada por
 * parada (um tema por vez, na ordem do parecer da PROENS) ou toda de uma vez, com as ações em cada
 * pendência:
 *
 * - "Vou ajustar" e "Já resolvi" só mudam a situação; "Já resolvi" oferece conferir no arquivo
 *   atualizado (`revisaoPpc.revisarDeNovo`), e aí quem decide é a nova revisão;
 * - "Discordo…" manda o motivo à IA, e o app só retira com trecho ou norma conferidos;
 * - "Sugerir texto" mostra a redação da IA, com os fatos que o app não conferiu, para copiar e revisar.
 *
 * Cada ação com IA mostra a estimativa antes. O aviso de cobertura diz o que ainda não foi visto.
 */
import type {
  EstimativaAcao,
  ListaPendencias,
  PendenciaViva,
  Provider,
  SugestaoTexto,
} from "@simplifica-if/contratos-app";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ClipboardCopyIcon,
  DownloadIcon,
  FileCheckIcon,
  ListIcon,
  MessageSquareWarningIcon,
  RouteIcon,
  SparklesIcon,
  Trash2Icon,
  WrenchIcon,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { AvisoErro } from "../components/AvisoErro.tsx";
import { Alert, AlertDescription } from "../components/ui/alert.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { useApi } from "../contexto.tsx";
import { dolares } from "../lib/formato.ts";
import { ponteDesktop } from "../ponte-desktop.ts";
import { dataBrasileira, descreverCurso, ROTULO_ESTADO } from "./agrupar.ts";
import { CopiaComentada, DetalhesPendencia } from "./componentes.tsx";
import { textoCobertura } from "./ia.ts";
import {
  avisoCobertura,
  paradaInicial,
  pendenciasDaParada,
  resumoSituacoes,
  ROTULO_SITUACAO_PENDENCIA,
  textoEstimativaAcao,
} from "./roteiro.ts";

type Chamar = (acao: () => Promise<ListaPendencias>) => Promise<boolean>;

export function ListaViva({ lista: id, aoApagar }: { readonly lista: string; readonly aoApagar?: () => void }) {
  const api = useApi();
  const [lista, setLista] = useState<ListaPendencias | undefined>(undefined);
  const [modo, setModo] = useState<"roteiro" | "tudo">("roteiro");
  const [indice, setIndice] = useState(0);
  const [erro, setErro] = useState<MensagemErro | undefined>(undefined);
  const [gerando, setGerando] = useState(false);
  const [confirmarApagar, setConfirmarApagar] = useState(false);

  useEffect(() => {
    let ativo = true;
    api
      .chamar((c) => c["revisaoPpc.lista"]({ lista: id }))
      .then((l) => {
        if (!ativo) return;
        setLista(l);
        setIndice(paradaInicial(l));
      })
      .catch((motivo: unknown) => ativo && setErro(explicarErro(motivo)));
    return () => {
      ativo = false;
    };
  }, [api, id]);

  /** Chama uma ação; o erro fica na tela e a lista não muda. */
  const chamar: Chamar = async (acao) => {
    setErro(undefined);
    try {
      setLista(await acao());
      return true;
    } catch (motivo) {
      setErro(explicarErro(motivo));
      return false;
    }
  };

  const parada = lista?.paradas[indice];
  // Chegar a uma parada no roteiro a marca como vista (e a lista lembra onde a pessoa estava).
  useEffect(() => {
    if (modo !== "roteiro" || parada === undefined || parada.vista) return;
    void api
      .chamar((c) => c["revisaoPpc.verParada"]({ lista: id, ordem: parada.ordem }))
      .then(setLista)
      .catch(() => undefined);
  }, [api, id, modo, parada]);

  if (lista === undefined)
    return erro === undefined ? (
      <div role="status" className="flex items-center gap-2 text-muted-foreground">
        <Spinner /> Abrindo a lista de pendências…
      </div>
    ) : (
      <AvisoErro erro={erro} />
    );

  const apagar = async () => {
    setErro(undefined);
    try {
      await api.chamar((c) => c["revisaoPpc.apagarLista"]({ lista: id }));
      aoApagar?.();
    } catch (motivo) {
      setErro(explicarErro(motivo));
    }
  };
  const gerarCopia = async () => {
    setGerando(true);
    await chamar(() => api.chamar((c) => c["revisaoPpc.gerarCopia"]({ lista: id })));
    setGerando(false);
  };
  const aviso = avisoCobertura(lista);
  const r = lista.resultado;
  const uso = lista.uso.entrada + lista.uso.saida + lista.uso.cacheLeitura + lista.uso.cacheEscrita;
  const precisam = lista.pendencias.filter((p) => p.pendencia.estado === "nao_atende").length;
  const conferir = lista.pendencias.length - precisam;
  const exportar = async () => {
    setErro(undefined);
    try {
      const csv = await api.chamar((c) => c["revisaoPpc.exportarDiscordancias"]({}));
      const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "discordancias-das-regras (Simplifica IF).csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (motivo) {
      setErro(explicarErro(motivo));
    }
  };

  return (
    <section aria-labelledby="titulo-lista" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2 rounded-lg border p-4">
        <h2 id="titulo-lista" className="font-semibold text-lg">
          {precisam} {precisam === 1 ? "ponto precisa" : "pontos precisam"} de ajuste e {conferir}{" "}
          {conferir === 1 ? "é para conferir" : "são para conferir"}
        </h2>
        <p className="text-sm">{resumoSituacoes(lista)}</p>
        <p className="text-sm">Curso: {descreverCurso(r.curso)}</p>
        <p className="text-muted-foreground text-sm">
          {textoCobertura(r)} Base de normas de {dataBrasileira(r.dataBase)}. Uma revisão prévia sem pendências não é
          PPC aprovado. A lista fica guardada no seu computador: você pode fechar o app e continuar depois.
        </p>
        {uso > 0 ? (
          <p className="text-muted-foreground text-xs">
            Esta lista já usou a IA nas ações
            {lista.uso.custoUsd > 0 ? ` (pago por uso, cerca de ${dolares(lista.uso.custoUsd)})` : ""}.
          </p>
        ) : null}
        <CopiaComentada arquivo={r.arquivoComentado} />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={gerando} onClick={() => void gerarCopia()}>
            {gerando ? <Spinner /> : <FileCheckIcon />} Gerar a cópia comentada com a situação atual
          </Button>
          {lista.pendencias.some(
            (p) => p.pendencia.origem === "codigo" && p.historico.some((e) => e.acao === "contestar"),
          ) ? (
            <Button variant="outline" size="sm" onClick={() => void exportar()}>
              <DownloadIcon /> Exportar discordâncias das regras (CSV)
            </Button>
          ) : null}
          {aoApagar === undefined ? null : (
            <Button variant="ghost" size="sm" onClick={() => setConfirmarApagar(true)}>
              <Trash2Icon /> Apagar esta lista
            </Button>
          )}
        </div>
        {confirmarApagar ? (
          <Confirmar
            titulo="Apagar esta lista?"
            descricao="Some do seu computador a lista, com o texto do PPC convertido, as situações marcadas, o histórico e o que você escreveu em “Discordo…”. A cópia comentada e o arquivo original ficam."
            botao="Apagar a lista"
            aoConfirmar={() => void apagar()}
            aoFechar={() => setConfirmarApagar(false)}
            ocupada={false}
          />
        ) : null}
        <p className="text-muted-foreground text-xs">
          A lista guarda no seu computador o texto do PPC convertido e o que você escrever em "Discordo…" até você
          apagá-la (ou 30 dias sem uso).
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Como ver a lista">
        <Button variant={modo === "roteiro" ? "default" : "outline"} size="sm" onClick={() => setModo("roteiro")}>
          <RouteIcon /> Revisar comigo, uma parada por vez
        </Button>
        <Button variant={modo === "tudo" ? "default" : "outline"} size="sm" onClick={() => setModo("tudo")}>
          <ListIcon /> Ver tudo de uma vez
        </Button>
      </div>
      {erro === undefined ? null : <AvisoErro erro={erro} />}

      {modo === "roteiro" && parada !== undefined ? (
        <>
          <ol className="flex flex-wrap gap-x-3 gap-y-1 text-sm" aria-label="Paradas do roteiro">
            {lista.paradas.map((p, i) => (
              <li key={p.ordem}>
                <button
                  type="button"
                  aria-current={i === indice ? "step" : undefined}
                  className={`inline-flex items-center gap-1 ${i === indice ? "font-semibold" : "text-muted-foreground"}`}
                  onClick={() => setIndice(i)}
                >
                  {p.vista ? <CheckIcon className="size-3.5 text-success" aria-label="vista" /> : null}
                  {p.tema}
                </button>
              </li>
            ))}
          </ol>
          <Parada
            lista={lista}
            ordem={parada.ordem}
            titulo={`Parada ${indice + 1} de ${lista.paradas.length} · ${parada.tema}`}
            chamar={chamar}
          />
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="outline" disabled={indice === 0} onClick={() => setIndice(indice - 1)}>
              <ArrowLeftIcon /> Parada anterior
            </Button>
            {indice + 1 < lista.paradas.length ? (
              <Button onClick={() => setIndice(indice + 1)}>
                Próxima parada: {lista.paradas[indice + 1]!.tema} <ArrowRightIcon />
              </Button>
            ) : null}
          </div>
          {aviso === null ? (
            <Alert variant="success">
              <AlertDescription>
                Você passou por todas as paradas. Confira na cópia comentada e no PPC antes de submeter.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="warning">
              <AlertDescription>{aviso}</AlertDescription>
            </Alert>
          )}
        </>
      ) : null}
      {modo === "tudo"
        ? lista.paradas.map((p) => (
            <Parada key={p.ordem} lista={lista} ordem={p.ordem} titulo={p.tema} chamar={chamar} />
          ))
        : null}
    </section>
  );
}

function Parada({
  lista,
  ordem,
  titulo,
  chamar,
}: {
  readonly lista: ListaPendencias;
  readonly ordem: number;
  readonly titulo: string;
  readonly chamar: Chamar;
}) {
  const pendencias = pendenciasDaParada(lista, ordem);
  const emOrdem = lista.resultado.criterios.filter(
    (c) => c.ordemTema === ordem && (c.estado === "atende" || c.estado === "nao_se_aplica"),
  );
  return (
    <section aria-label={titulo} className="flex flex-col gap-3">
      <h3 className="font-semibold">{titulo}</h3>
      {pendencias.length ? (
        <ul className="flex flex-col gap-3">
          {pendencias.map((p) => (
            <CartaoPendencia key={p.chave} lista={lista} viva={p} chamar={chamar} />
          ))}
        </ul>
      ) : (
        <p className="text-sm">Nenhuma pendência neste tema nos critérios conferidos.</p>
      )}
      {emOrdem.length ? (
        <p className="text-muted-foreground text-sm">
          Em ordem nos critérios conferidos:{" "}
          {emOrdem.map((c) => (c.estado === "nao_se_aplica" ? `${c.titulo} (não se aplica)` : c.titulo)).join("; ")}.
        </p>
      ) : null}
    </section>
  );
}

type Painel =
  | { readonly tipo: "nenhum" }
  | { readonly tipo: "discordar" }
  | { readonly tipo: "sugerir" }
  | { readonly tipo: "revisarDeNovo" };

function CartaoPendencia({
  lista,
  viva,
  chamar,
}: {
  readonly lista: ListaPendencias;
  readonly viva: PendenciaViva;
  readonly chamar: Chamar;
}) {
  const api = useApi();
  const [painel, setPainel] = useState<Painel>({ tipo: "nenhum" });
  const [ocupada, setOcupada] = useState(false);
  const p = viva.pendencia;
  const provider: Provider = lista.provider ?? "claude";
  const base = { lista: lista.id, chave: viva.chave };

  const executar = async (acao: () => Promise<ListaPendencias>, depois?: () => void) => {
    setOcupada(true);
    const ok = await chamar(acao);
    setOcupada(false);
    if (ok) depois?.();
  };
  const marcar = (situacao: "aberta" | "vou_ajustar" | "resolvida", depois?: () => void) =>
    executar(() => api.chamar((c) => c["revisaoPpc.marcar"]({ ...base, situacao })), depois);

  const retirada = viva.situacao === "contestada_aceita";
  return (
    <li
      className={`flex flex-col gap-1.5 rounded-lg border p-3 ${retirada || viva.situacao === "resolvida" ? "opacity-70" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={p.estado === "nao_atende" ? "warning" : "info"}>{ROTULO_ESTADO[p.estado]}</Badge>
        <Badge
          variant={
            viva.situacao === "aberta" ? "outline" : viva.situacao === "contestada_mantida" ? "warning" : "success"
          }
        >
          {ROTULO_SITUACAO_PENDENCIA[viva.situacao]}
          {viva.situacao === "resolvida" && viva.resolvidaPor === "novaRevisao" ? ", conferida no arquivo novo" : ""}
        </Badge>
        <span className="text-muted-foreground text-xs">
          {p.tituloFicha}
          {p.origem === "ia" ? " · avaliação da IA" : " · conferido pela base"}
        </span>
      </div>
      <DetalhesPendencia pendencia={p} />
      <div className="flex flex-wrap gap-2 pt-1">
        {viva.situacao !== "vou_ajustar" ? (
          <Button size="sm" variant="outline" disabled={ocupada} onClick={() => void marcar("vou_ajustar")}>
            <WrenchIcon /> Vou ajustar
          </Button>
        ) : null}
        {viva.situacao !== "resolvida" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={ocupada}
            onClick={() => void marcar("resolvida", () => setPainel({ tipo: "revisarDeNovo" }))}
          >
            <CheckIcon /> Já resolvi
          </Button>
        ) : null}
        {viva.situacao !== "aberta" ? (
          <Button size="sm" variant="ghost" disabled={ocupada} onClick={() => void marcar("aberta")}>
            Reabrir
          </Button>
        ) : null}
        {viva.aceitaIa && !retirada ? (
          <>
            <Button size="sm" variant="outline" disabled={ocupada} onClick={() => setPainel({ tipo: "discordar" })}>
              <MessageSquareWarningIcon /> Discordo…
            </Button>
            <Button size="sm" variant="outline" disabled={ocupada} onClick={() => setPainel({ tipo: "sugerir" })}>
              <SparklesIcon /> Sugerir texto
            </Button>
          </>
        ) : null}
      </div>
      {painel.tipo === "discordar" ? (
        <Discordar
          provider={provider}
          doCodigo={p.origem === "codigo"}
          estimar={() => api.chamar((c) => c["revisaoPpc.estimarAcao"]({ ...base, acao: "contestar", provider }))}
          aoEnviar={(motivo) =>
            executar(
              () => api.chamar((c) => c["revisaoPpc.contestar"]({ ...base, motivo, provider })),
              () => setPainel({ tipo: "nenhum" }),
            )
          }
          aoFechar={() => setPainel({ tipo: "nenhum" })}
          ocupada={ocupada}
        />
      ) : null}
      {painel.tipo === "sugerir" ? (
        <Confirmar
          titulo="Pedir à IA uma redação para este ponto"
          descricao="A IA usa só o trecho do PPC, o CNCT e as normas deste critério; o que o PPC não informa vem como [completar: …]."
          botao="Pedir sugestão"
          estimar={() => api.chamar((c) => c["revisaoPpc.estimarAcao"]({ ...base, acao: "sugerir", provider }))}
          aoConfirmar={() =>
            executar(
              () => api.chamar((c) => c["revisaoPpc.sugerir"]({ ...base, provider })),
              () => setPainel({ tipo: "nenhum" }),
            )
          }
          aoFechar={() => setPainel({ tipo: "nenhum" })}
          ocupada={ocupada}
        />
      ) : null}
      {painel.tipo === "revisarDeNovo" ? (
        <RevisarDeNovo
          estimar={() => api.chamar((c) => c["revisaoPpc.estimarAcao"]({ ...base, acao: "revisarDeNovo", provider }))}
          aoEscolher={(arquivo) =>
            executar(
              () => api.chamar((c) => c["revisaoPpc.revisarDeNovo"]({ ...base, arquivo, provider })),
              () => setPainel({ tipo: "nenhum" }),
            )
          }
          aoFechar={() => setPainel({ tipo: "nenhum" })}
          ocupada={ocupada}
        />
      ) : null}
      {viva.sugestao === null ? null : <Sugestao sugestao={viva.sugestao} />}
      {viva.historico.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Histórico ({viva.historico.length})</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {viva.historico.map((e) => (
              <li key={`${e.em}|${e.acao}|${e.texto}`}>
                <span className="text-muted-foreground text-xs">{dataBrasileira(e.em)}: </span>
                {e.motivo === null ? null : <span className="italic">Você: “{e.motivo}” — </span>}
                {e.texto}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

/** A estimativa, buscada ao abrir o painel. */
function useEstimativa(estimar: (() => Promise<EstimativaAcao>) | undefined) {
  const [estimativa, setEstimativa] = useState<EstimativaAcao | undefined>(undefined);
  useEffect(() => {
    let ativo = true;
    if (estimar === undefined) return;
    estimar()
      .then((e) => ativo && setEstimativa(e))
      .catch(() => undefined);
    return () => {
      ativo = false;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- só ao abrir o painel
  }, []);
  return estimativa;
}

function Discordar({
  provider,
  doCodigo,
  estimar,
  aoEnviar,
  aoFechar,
  ocupada,
}: {
  readonly provider: Provider;
  /** Pendência da conferência automática: não vai à IA, só registra a discordância. */
  readonly doCodigo: boolean;
  readonly estimar: () => Promise<EstimativaAcao>;
  readonly aoEnviar: (motivo: string) => void;
  readonly aoFechar: () => void;
  readonly ocupada: boolean;
}) {
  const estimativa = useEstimativa(estimar);
  const [motivo, setMotivo] = useState("");
  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (motivo.trim()) aoEnviar(motivo.trim());
  };
  return (
    <form className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3" onSubmit={enviar}>
      <label htmlFor="motivo" className="font-medium text-sm">
        Por que você discorda? Um trecho do PPC ou uma norma ajudam.
      </label>
      <Textarea id="motivo" value={motivo} maxLength={1500} onChange={(e) => setMotivo(e.currentTarget.value)} />
      {doCodigo ? (
        <p className="text-muted-foreground text-xs">
          Este ponto vem da conferência automática, que só muda com o arquivo corrigido: corrija o PPC e use "Já
          resolvi" com o arquivo atualizado. A sua discordância fica registrada e pode ser exportada para a curadoria
          das regras. Não vai à IA.
        </p>
      ) : (
        <p className="text-muted-foreground text-xs">
          A IA ({provider === "claude" ? "Claude" : provider}) reavalia, mas quem decide é o app: só aceita com um
          trecho da seção do PPC que ele consiga conferir. Costume ou "a PROENS sempre aceitou" não bastam. Mesmo
          aceita, a contestação fica "para conferir" na cópia comentada.{" "}
          {estimativa === undefined ? "" : textoEstimativaAcao(estimativa)}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={ocupada || !motivo.trim()}>
          {ocupada ? <Spinner /> : null} {doCodigo ? "Registrar a discordância" : "Enviar à IA"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={aoFechar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/** Confirma uma ação: as ações com IA mostram a estimativa; apagar a lista diz o que some. */
function Confirmar({
  titulo,
  descricao,
  botao,
  estimar,
  aoConfirmar,
  aoFechar,
  ocupada,
}: {
  readonly titulo: string;
  readonly descricao: string;
  readonly botao: string;
  readonly estimar?: () => Promise<EstimativaAcao>;
  readonly aoConfirmar: () => void;
  readonly aoFechar: () => void;
  readonly ocupada: boolean;
}) {
  const estimativa = useEstimativa(estimar);
  return (
    <div role="group" aria-label={titulo} className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3 text-sm">
      <p className="font-medium">{titulo}</p>
      <p className="text-muted-foreground text-xs">
        {descricao}
        {estimativa === undefined ? "" : ` ${textoEstimativaAcao(estimativa)}`}
      </p>
      <div className="flex gap-2">
        <Button size="sm" disabled={ocupada} onClick={aoConfirmar}>
          {ocupada ? <Spinner /> : null} {botao}
        </Button>
        <Button size="sm" variant="ghost" onClick={aoFechar}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function RevisarDeNovo({
  estimar,
  aoEscolher,
  aoFechar,
  ocupada,
}: {
  readonly estimar: () => Promise<EstimativaAcao>;
  readonly aoEscolher: (arquivo: string) => void;
  readonly aoFechar: () => void;
  readonly ocupada: boolean;
}) {
  const estimativa = useEstimativa(estimar);
  const escolherDocx = ponteDesktop()?.escolherDocx;
  const [caminho, setCaminho] = useState("");
  return (
    <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3 text-sm">
      <p>
        Marcada como resolvida pela sua palavra. Quer que o app confira no arquivo atualizado? Ele reconfere só este
        critério e a situação passa a ser a do resultado.
        {estimativa === undefined ? "" : ` ${textoEstimativaAcao(estimativa)}`}
      </p>
      <div className="flex flex-wrap gap-2">
        {escolherDocx === undefined ? (
          <>
            <Input
              nativeInput
              aria-label="Caminho do arquivo atualizado (.docx)"
              placeholder="/Users/voce/Documents/PPC revisado.docx"
              value={caminho}
              onChange={(e) => setCaminho(e.currentTarget.value)}
            />
            <Button size="sm" disabled={ocupada || !caminho.trim()} onClick={() => aoEscolher(caminho.trim())}>
              {ocupada ? <Spinner /> : null} Conferir
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            disabled={ocupada}
            onClick={async () => {
              const arquivo = await escolherDocx().catch(() => null);
              if (arquivo !== null) aoEscolher(arquivo);
            }}
          >
            {ocupada ? <Spinner /> : null} Escolher o arquivo atualizado (.docx)…
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={aoFechar}>
          Agora não
        </Button>
      </div>
    </div>
  );
}

function Sugestao({ sugestao }: { readonly sugestao: SugestaoTexto }) {
  const [copiada, setCopiada] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-info/30 p-3 text-sm">
      <p className="font-medium">Sugestão da IA, para você revisar antes de usar</p>
      <p className="whitespace-pre-line rounded bg-muted/40 p-2">{sugestao.texto}</p>
      {sugestao.naoConferidos.length ? (
        <p className="text-warning-foreground">
          O app não achou estes fatos no PPC, no CNCT nem nas normas consultadas; confira antes de usar:{" "}
          {sugestao.naoConferidos.map((f) => `“${f.fato}”`).join("; ")}.
        </p>
      ) : (
        <p className="text-muted-foreground text-xs">
          O app não achou fatos fora do material; números por extenso e siglas podem não ter sido conferidos.
        </p>
      )}
      {sugestao.completar.length ? (
        <p className="text-muted-foreground text-xs">Para completar: {sugestao.completar.join("; ")}.</p>
      ) : null}
      {sugestao.observacao ? <p className="text-muted-foreground text-xs">{sugestao.observacao}</p> : null}
      <p className="text-muted-foreground text-xs">
        É uma sugestão: o app nunca altera o seu documento. Cole no Word e ajuste.
      </p>
      <div>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void navigator.clipboard
              .writeText(sugestao.texto)
              .then(() => setCopiada(true))
              .catch(() => undefined)
          }
        >
          <ClipboardCopyIcon /> {copiada ? "Copiada" : "Copiar"}
        </Button>
      </div>
    </div>
  );
}
