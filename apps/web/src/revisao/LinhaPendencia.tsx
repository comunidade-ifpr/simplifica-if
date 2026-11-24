/**
 * Uma pendência da lista, numa linha que abre e fecha (uma aberta por vez). Recolhida: a gravidade
 * (glifo e palavra), o título da pendência em até duas linhas e onde ela está no documento, com "Novo"
 * ou "Retirado" quando couber. Aberta: a explicação em texto comum, o que falta como lista (o servidor
 * manda as três partes separadas), o que fazer, o trecho do PPC (na serifada, com
 * o filete da cor da gravidade, o rótulo "Trecho no PPC" e "Copiar trecho"), as fontes pelo nome (o link `ifpr://` abre o painel de leitura) e as ações: "Feito"
 * (ou "Desfazer"), "Sugerir texto" e, no ⋯, "Discordar", "Reconferir com o arquivo novo" e "Detalhes".
 *
 * Cada ação com IA mostra a estimativa antes de confirmar; a sugestão nunca é aplicada ao documento.
 * As ações (`sugerir`, `contestar`, `revisarDeNovo`, `marcar`) passam pelo `ControleRevisao`, que
 * também unifica a recuperação quando o servidor pede o arquivo de novo.
 */
import type { EstimativaAcao, PendenciaViva, SugestaoTexto } from "@simplifica-if/contratos-app";
import { CheckIcon, ClipboardCopyIcon, EllipsisIcon, FileSearchIcon, SparklesIcon, Undo2Icon } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { AvisoErro } from "../components/AvisoErro.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { LinhaExpansivel } from "../components/ui/linha-expansivel.tsx";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import { useRevisao } from "../contexto.tsx";
import { dataCurta } from "../lib/formato.ts";
import { ponteDesktop } from "../ponte-desktop.ts";
import { cn } from "~/lib/utils";
import { providerDaRevisao } from "./ControleRevisao.ts";
import { nomeIa } from "./FaixaIa.tsx";
import { textoEstimativaAcao } from "./ia.ts";
import { IndicadorGravidade } from "./IndicadorGravidade.tsx";
import { gravidadeDe, localizacao } from "./lista.ts";

type Painel = "nenhum" | "sugerir" | "discordar" | "reconferir" | "detalhes";

const FILETE = { corrigir: "border-grav-corrigir", conferir: "border-grav-conferir" } as const;

export function LinhaPendencia({
  id,
  viva,
  aoAbrirLink,
  linkNoPpc,
}: {
  readonly id: string;
  readonly viva: PendenciaViva;
  readonly aoAbrirLink: (link: string) => void;
  /** O trecho no PPC revisado (`ifpr://revisao/…#p-<chave>`), para "Ver no PPC". */
  readonly linkNoPpc: string;
}) {
  const [estado, revisao] = useRevisao();
  const p = viva.pendencia;
  const gravidade = gravidadeDe(p);
  const feita = viva.situacao === "resolvida";
  const retirada = viva.situacao === "contestada_aceita";
  const onde = localizacao(p);
  const faltas = p.faltas.map((falta) => falta.trim()).filter(Boolean);
  const [painelEscolhido, setPainel] = useState<Painel>("nenhum");

  const aberta = estado.aberta === viva.chave;
  const nova = estado.novas.has(viva.chave);
  const marcando = estado.marcando === viva.chave;
  const ocupada = estado.acaoPendencia === viva.chave;
  const erro = estado.erroPendencia?.chave === viva.chave ? estado.erroPendencia.erro : undefined;
  const pedeArquivo =
    typeof estado.origemArquivoDeNovo === "object" &&
    estado.origemArquivoDeNovo.pendencia === viva.chave &&
    ponteDesktop()?.escolherDocx !== undefined;
  const provider = providerDaRevisao(estado);

  // Fechada a linha, os painéis abertos nela fecham também.
  const painel = aberta ? painelEscolhido : "nenhum";

  const fecharPainel = () => {
    setPainel("nenhum");
    revisao.limparErroPendencia(viva.chave);
  };

  const rodar = (acao: Promise<boolean>) => {
    void acao.then((ok) => {
      if (ok) setPainel("nenhum");
    });
  };

  const cabecalho = (
    <div className={cn("flex items-start gap-3", (feita || retirada) && "opacity-60")}>
      <span className="w-[5.5rem] shrink-0 pt-0.5">
        <IndicadorGravidade gravidade={gravidade} apagado={feita || retirada} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn("font-medium text-heading", aberta ? "" : "line-clamp-2", feita && "line-through decoration-1")}
        >
          {p.titulo}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-small">
          {onde === null ? null : <span>{onde}</span>}
          {feita ? <span className="text-grav-ok-texto">Feito</span> : null}
          {viva.situacao === "contestada_mantida" ? <span>Mantido</span> : null}
          {retirada ? <Badge variant="retirado">Retirado</Badge> : null}
          {nova ? <Badge variant="novo">Novo</Badge> : null}
        </span>
      </span>
    </div>
  );

  return (
    <LinhaExpansivel
      id={id}
      aberta={aberta}
      aoAlternar={() => {
        setPainel("nenhum");
        revisao.alternarPendencia(viva.chave);
      }}
      cabecalho={cabecalho}
    >
      <div className="flex flex-col gap-5 pt-1 pl-[calc(5.5rem+0.75rem)]">
        {retirada ? (
          <p className="text-muted-foreground text-small">Retirado: a IA conferiu o trecho que você indicou.</p>
        ) : null}
        {viva.situacao === "contestada_mantida" ? (
          <p className="text-muted-foreground text-small">Mantido: sua observação foi registrada.</p>
        ) : null}
        {feita && viva.resolvidaPor === "revisarDeNovo" ? (
          <p className="text-muted-foreground text-small">Feito: conferido no arquivo novo.</p>
        ) : null}
        {p.explicacao === null ? null : (
          <p className="max-w-[68ch] whitespace-pre-line text-body" data-explicacao>
            {p.explicacao}
          </p>
        )}
        {faltas.length ? (
          <div className="flex max-w-[68ch] flex-col gap-1.5">
            <Rotulo>O que falta</Rotulo>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-body marker:text-muted-foreground">
              {faltas.map((falta, i) => (
                // a lista não muda de ordem, e a IA pode repetir um item
                // oxlint-disable-next-line react/no-array-index-key
                <li key={i}>{falta}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="flex max-w-[68ch] flex-col gap-1.5">
          <Rotulo>{gravidade === "corrigir" ? "O que fazer" : "O que conferir"}</Rotulo>
          <p className="whitespace-pre-line text-body">{p.oQueFazer}</p>
        </div>
        {p.trecho === null ? null : (
          <Trecho trecho={p.trecho} filete={FILETE[gravidade]} aoVerNoPpc={() => aoAbrirLink(linkNoPpc)} />
        )}
        {p.fontes.length ? (
          <div className="flex max-w-[68ch] flex-col gap-1.5">
            <Rotulo>{p.fontes.length === 1 ? "Fonte" : "Fontes"}</Rotulo>
            <ul className="flex flex-col gap-1 text-small">
              {p.fontes.map((fonte) => (
                <li key={fonte.link}>
                  <button
                    type="button"
                    className="cursor-pointer text-left text-link underline underline-offset-2 hover:no-underline"
                    onClick={() => aoAbrirLink(fonte.link)}
                  >
                    {fonte.rotulo}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {viva.sugestao === null ? null : <Sugestao sugestao={viva.sugestao} nome={nomeIa(provider)} />}

        <div className="flex flex-wrap items-center gap-2">
          {feita || retirada ? (
            <Button
              size="sm"
              variant="outline"
              disabled={marcando}
              onClick={() => void revisao.marcar(viva.chave, "aberta")}
            >
              <Undo2Icon /> Desfazer
            </Button>
          ) : (
            <Button size="sm" disabled={marcando} onClick={() => void revisao.marcar(viva.chave, "resolvida")}>
              {marcando ? <Spinner /> : <CheckIcon />} Feito
            </Button>
          )}
          {viva.aceitaIa && !retirada && !feita ? (
            <Button size="sm" variant="ghost" disabled={ocupada} onClick={() => setPainel("sugerir")}>
              <SparklesIcon /> {viva.sugestao === null ? "Sugerir texto" : "Sugerir outro texto"}
            </Button>
          ) : null}
          <Menu>
            <MenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label="Mais ações" title="Mais ações" />}>
              <EllipsisIcon />
            </MenuTrigger>
            <MenuPopup align="start">
              {viva.aceitaIa && !retirada ? (
                <MenuItem onClick={() => setPainel("discordar")}>Discordar</MenuItem>
              ) : null}
              {p.origem === "ia" && viva.aceitaIa ? (
                <MenuItem onClick={() => setPainel("reconferir")}>Reconferir com o arquivo novo</MenuItem>
              ) : null}
              <MenuItem onClick={() => setPainel("detalhes")}>Detalhes</MenuItem>
            </MenuPopup>
          </Menu>
        </div>

        {painel === "sugerir" ? (
          <Confirmar
            titulo={`Pedir ao ${nomeIa(provider)} uma redação para este ponto`}
            descricao="A IA usa só o trecho do PPC, o CNCT e as normas deste critério; o que o PPC não informa vem marcado para você completar."
            botao="Pedir sugestão"
            estimar={() => revisao.estimarAcao(viva.chave, "sugerir")}
            aoConfirmar={() => rodar(revisao.sugerir(viva.chave))}
            aoFechar={fecharPainel}
            ocupada={ocupada}
          />
        ) : null}
        {painel === "discordar" ? (
          <Discordar
            nome={nomeIa(provider)}
            doCodigo={p.origem === "codigo"}
            estimar={() => revisao.estimarAcao(viva.chave, "contestar")}
            aoEnviar={(motivo) => rodar(revisao.contestar(viva.chave, motivo))}
            aoFechar={fecharPainel}
            ocupada={ocupada}
          />
        ) : null}
        {painel === "reconferir" ? (
          <Reconferir
            estimar={() => revisao.estimarAcao(viva.chave, "revisarDeNovo")}
            aoEscolher={(arquivo) => rodar(revisao.revisarDeNovo(viva.chave, arquivo))}
            aoFechar={fecharPainel}
            ocupada={ocupada}
          />
        ) : null}
        {painel === "detalhes" ? <Detalhes viva={viva} aoFechar={fecharPainel} /> : null}
        {erro === undefined ? null : <AvisoErro erro={erro} />}
        {erro !== undefined && pedeArquivo ? (
          <Button variant="outline" className="self-start" onClick={() => rodar(revisao.escolherArquivoDeNovo())}>
            Escolher o arquivo de novo
          </Button>
        ) : null}
      </div>
    </LinhaExpansivel>
  );
}

/** O rótulo de uma parte da pendência aberta: discreto, para o texto abaixo dele falar mais alto. */
function Rotulo({ children }: { readonly children: ReactNode }) {
  return <p className="font-semibold text-muted-foreground text-small">{children}</p>;
}

/**
 * O trecho do PPC, com o rótulo discreto, "Ver no PPC" (o documento inteiro no painel de leitura, rolado
 * e destacado no trecho, para ler o contexto) e "Copiar trecho" (para achar no Word com Ctrl+F). A seção
 * já está no cabeçalho da linha. A citação não é botão: a pessoa seleciona o texto.
 */
function Trecho({
  trecho,
  filete,
  aoVerNoPpc,
}: {
  readonly trecho: string;
  readonly filete: string;
  readonly aoVerNoPpc: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="flex max-w-[68ch] flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <Rotulo>Trecho no PPC</Rotulo>
        <span className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={aoVerNoPpc}>
            <FileSearchIcon /> Ver no PPC
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void navigator.clipboard
                .writeText(trecho)
                .then(() => setCopiado(true))
                .catch(() => undefined)
            }
          >
            <ClipboardCopyIcon /> {copiado ? "Trecho copiado" : "Copiar trecho"}
          </Button>
        </span>
      </div>
      <blockquote className={cn("border-l-[3px] pl-4 font-serif text-quote", filete)}>{trecho}</blockquote>
    </div>
  );
}

/** A estimativa da ação, buscada ao abrir o painel. */
function useEstimativa(estimar: () => Promise<EstimativaAcao>) {
  const [estimativa, setEstimativa] = useState<EstimativaAcao | undefined>(undefined);
  useEffect(() => {
    let vivo = true;
    estimar()
      .then((e) => vivo && setEstimativa(e))
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- só ao abrir o painel
  }, []);
  return estimativa === undefined ? "" : textoEstimativaAcao(estimativa);
}

function Painel({ titulo, children }: { readonly titulo: string; readonly children: ReactNode }) {
  return (
    <div role="group" aria-label={titulo} className="flex max-w-[68ch] flex-col gap-2 rounded-xl bg-muted/60 p-3">
      <p className="font-semibold text-small">{titulo}</p>
      {children}
    </div>
  );
}

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
  readonly estimar: () => Promise<EstimativaAcao>;
  readonly aoConfirmar: () => void;
  readonly aoFechar: () => void;
  readonly ocupada: boolean;
}) {
  const estimativa = useEstimativa(estimar);
  return (
    <Painel titulo={titulo}>
      <p className="text-muted-foreground text-small">
        {descricao} {estimativa}
      </p>
      <div className="flex gap-2">
        <Button size="sm" disabled={ocupada} onClick={aoConfirmar}>
          {ocupada ? <Spinner /> : null} {botao}
        </Button>
        <Button size="sm" variant="ghost" onClick={aoFechar}>
          Cancelar
        </Button>
      </div>
    </Painel>
  );
}

function Discordar({
  nome,
  doCodigo,
  estimar,
  aoEnviar,
  aoFechar,
  ocupada,
}: {
  readonly nome: string;
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
    <Painel titulo="Discordar">
      <form className="flex flex-col gap-2" onSubmit={enviar}>
        <label htmlFor="motivo-discordar" className="text-small">
          Por que você discorda? Um trecho do PPC ou uma norma ajudam.
        </label>
        <Textarea
          id="motivo-discordar"
          value={motivo}
          maxLength={1500}
          onChange={(e) => setMotivo(e.currentTarget.value)}
        />
        <p className="text-muted-foreground text-small">
          {doCodigo
            ? "Este ponto vem da conferência automática, que só muda com o arquivo corrigido. Sua discordância fica registrada e ajuda a corrigir a regra; não vai à IA."
            : `O ${nome} reavalia, mas quem decide é o app: só retira o ponto com um trecho do PPC que ele consiga conferir. ${estimativa}`}
        </p>
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={ocupada || !motivo.trim()}>
            {ocupada ? <Spinner /> : null} {doCodigo ? "Registrar" : `Enviar ao ${nome}`}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={aoFechar}>
            Cancelar
          </Button>
        </div>
      </form>
    </Painel>
  );
}

function Reconferir({
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
    <Painel titulo="Reconferir com o arquivo novo">
      <p className="text-muted-foreground text-small">
        O app lê só este critério no arquivo corrigido, e a situação passa a ser a do resultado. {estimativa}
      </p>
      <div className="flex flex-wrap gap-2">
        {escolherDocx === undefined ? (
          <>
            <Input
              nativeInput
              aria-label="Caminho do arquivo corrigido (.docx)"
              placeholder="/Users/voce/Documents/PPC corrigido.docx"
              value={caminho}
              onChange={(e) => setCaminho(e.currentTarget.value)}
              className="max-w-md"
            />
            <Button size="sm" disabled={ocupada || !caminho.trim()} onClick={() => aoEscolher(caminho.trim())}>
              {ocupada ? <Spinner /> : null} Reconferir
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
            {ocupada ? <Spinner /> : null} Escolher o arquivo corrigido
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={aoFechar}>
          Cancelar
        </Button>
      </div>
    </Painel>
  );
}

function Detalhes({ viva, aoFechar }: { readonly viva: PendenciaViva; readonly aoFechar: () => void }) {
  const p = viva.pendencia;
  return (
    <Painel titulo="Detalhes">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-small">
        <dt className="text-muted-foreground">Critério</dt>
        <dd>
          {p.tituloFicha} <span className="text-muted-foreground">({p.ficha})</span>
        </dd>
        <dt className="text-muted-foreground">Quem apontou</dt>
        <dd>
          {p.origem === "ia"
            ? "a conferência com IA, com o trecho e as normas conferidos pelo app"
            : "a conferência automática"}
        </dd>
        <dt className="text-muted-foreground">Tema</dt>
        <dd>{p.tema}</dd>
        {p.tambemEm.length ? (
          <>
            <dt className="text-muted-foreground">Também em</dt>
            <dd>{p.tambemEm.map((t) => t.titulo).join("; ")}</dd>
          </>
        ) : null}
      </dl>
      {viva.historico.length ? (
        <ul className="flex flex-col gap-1 text-small">
          {viva.historico.map((e) => (
            <li key={`${e.em}|${e.acao}|${e.texto}`}>
              <span className="text-muted-foreground tabular-nums">{dataCurta(e.em)}: </span>
              {e.motivo === null ? null : <span className="italic">Você: “{e.motivo}”. </span>}
              {e.texto}
            </li>
          ))}
        </ul>
      ) : null}
      <div>
        <Button size="sm" variant="ghost" onClick={aoFechar}>
          Fechar
        </Button>
      </div>
    </Painel>
  );
}

function Sugestao({ sugestao, nome }: { readonly sugestao: SugestaoTexto; readonly nome: string }) {
  const [copiada, setCopiada] = useState(false);
  return (
    <div className="flex max-w-[68ch] flex-col gap-2">
      <Rotulo>Sugestão do {nome}, para você revisar antes de usar</Rotulo>
      <p className="whitespace-pre-line rounded-xl bg-muted/60 p-4 font-serif text-quote">{sugestao.texto}</p>
      {sugestao.naoConferidos.length ? (
        <p className="text-grav-conferir-texto text-small">
          O app não achou estes fatos no PPC, no CNCT nem nas normas consultadas; confira antes de usar:{" "}
          {sugestao.naoConferidos.map((f) => `“${f.fato}”`).join("; ")}.
        </p>
      ) : null}
      {sugestao.completar.length ? (
        <p className="text-muted-foreground text-small">Para completar: {sugestao.completar.join("; ")}.</p>
      ) : null}
      {sugestao.observacao ? <p className="text-muted-foreground text-small">{sugestao.observacao}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
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
        <span className="text-muted-foreground text-small">O app nunca altera o seu documento.</span>
      </div>
    </div>
  );
}
