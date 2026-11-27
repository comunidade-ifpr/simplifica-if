/**
 * A ficha de um critério da revisão no Ler (`ifpr://revisao-ppc/<lista>/criterio/<ID>`), em linguagem de
 * quem revisa (`docs/plans/tarefas.md`, "Os critérios são da tarefa, não da base"): o código, a
 * criticidade e como o app confere; "Neste PPC" (o estado do critério nesta revisão, a pendência com o
 * trecho, a marcação dela e "Ir à pendência", que abre a revisão se ela não está na tela); o que confere;
 * por que (as normas, que abrem no Ler, com a situação de vigência; o CNCT, no curso da revisão; a
 * referência externa, só pelo nome); o que conta como atendido e como não atendido; e quando fica "a conferir". É critério da
 * tarefa, não fonte normativa: não aparece no Explorar.
 *
 * Vem de `revisaoPpc.criterio`. Com a lista aberta na revisão, a leitura se refaz a cada mudança dela,
 * para o "Neste PPC" acompanhar a pendência marcada como feita.
 */
import type { FichaCriterio, SituacaoPendencia } from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { CheckIcon } from "lucide-react";
import { type ReactNode, useId } from "react";
import { useApi, useApp, useJanelaCompacta } from "../../contexto.tsx";
import { vigenciaDaNorma } from "../../explorar/colecoes.ts";
import { SituacaoVigencia } from "../../explorar/Vigencia.tsx";
import { useCarga } from "../../leitor/carga.ts";
import { BotaoLink, ComCarga } from "../../leitor/pecas.tsx";
import type { AoAbrirLink } from "../../painel/abrirLink.ts";
import { dispositivoPorExtenso, nomeCurtoLink } from "../../tarefas/textos.ts";
import { useRevisao } from "./contexto.ts";
import { comoConfere, nomeCriticidade, nomeDaReferencia, nomeEstadoCriterio } from "./criterio.ts";
import { GlifoGravidade } from "./IndicadorGravidade.tsx";
import { TIPO_LINK } from "./lista.ts";

/** "arts. 61, 62 e 63" a partir de `art61`, `art62`, `art63`; os outros dispositivos, por extenso. */
function dispositivosPorExtenso(dispositivos: ReadonlyArray<string>): string {
  const nomes = dispositivos.map(dispositivoPorExtenso);
  const artigos = nomes.every((n) => /^art\. [^,]+$/.test(n)) ? nomes.map((n) => n.slice("art. ".length)) : null;
  const juntar = (itens: ReadonlyArray<string>) =>
    itens.length <= 1 ? (itens[0] ?? "") : `${itens.slice(0, -1).join(", ")} e ${itens.at(-1)}`;
  if (artigos !== null && artigos.length > 1) return `arts. ${juntar(artigos)}`;
  return juntar(nomes);
}

function Bloco({ rotulo, children }: { readonly rotulo: ReactNode; readonly children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1.5">
      <h3 id={id} className="font-semibold text-muted-foreground text-small">
        {rotulo}
      </h3>
      {children}
    </section>
  );
}

/** A situação da pendência marcada, como a lista a diz; a aberta não diz nada. */
const SITUACOES: Readonly<Record<SituacaoPendencia, string | null>> = {
  aberta: null,
  resolvida: "Feito",
  contestada_aceita: "Retirado",
  contestada_mantida: "Mantido",
};

function NestePpc({ lista, ficha }: { readonly lista: string; readonly ficha: FichaCriterio }) {
  const app = useApp();
  const [, revisao] = useRevisao();
  const navegar = useNavigate();
  const [janela] = useJanelaCompacta();
  const naRevisao = useRouterState({
    select: (s) => s.location.pathname === "/revisao-ppc" && (s.location.search as { id?: unknown }).id === lista,
  });
  const { estado: situacao, mensagem, pendencia } = ficha.nestePpc;
  const gravidade = situacao === "nao_atende" ? "corrigir" : situacao === "a_conferir" ? "conferir" : null;
  // A lista na tela rola até a pendência e a foca (`focar`); de outra tela ou com outra revisão aberta, a
  // revisão do critério abre antes. Na janela compacta, o painel cobre a coluna: ele se fecha.
  const irParaPendencia = (chave: string) => {
    revisao.irParaPendencia(lista, chave);
    if (janela.ligada && naRevisao) app.painel.fechar();
    if (!naRevisao) void navegar({ to: "/revisao-ppc", search: { id: lista } });
  };
  const marcada = pendencia === null ? null : SITUACOES[pendencia.situacao];
  return (
    <section aria-label="Neste PPC" className="flex flex-col gap-1.5 rounded-xl bg-muted/60 p-3 text-small">
      <h3 className="font-semibold text-muted-foreground">Neste PPC</h3>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1.5 font-semibold">
          {gravidade === null ? (
            situacao === "atende" ? (
              <CheckIcon aria-hidden className="size-3.5 text-grav-ok-texto" />
            ) : null
          ) : (
            <GlifoGravidade gravidade={gravidade} />
          )}
          <span>{nomeEstadoCriterio(situacao).replace(/^./, (c) => c.toUpperCase())}</span>
        </span>
        {marcada === null ? null : (
          <span className={pendencia?.situacao === "resolvida" ? "text-grav-ok-texto" : "text-muted-foreground"}>
            · {marcada}
          </span>
        )}
        {/* Com pendência, ela diz o mesmo que a decisão: o título dela vem abaixo. */}
        {mensagem === "" || pendencia !== null ? null : <span className="text-muted-foreground">{mensagem}</span>}
      </p>
      {pendencia === null ? null : (
        <div className="flex flex-col gap-1">
          <p className={pendencia.situacao === "resolvida" ? "line-through decoration-1" : undefined}>
            {pendencia.titulo}
            {pendencia.secao === null ? null : <span className="text-muted-foreground"> · {pendencia.secao}</span>}
          </p>
          {pendencia.trecho === null ? null : (
            <blockquote className="border-border border-l-2 pl-3 font-serif text-muted-foreground">
              {pendencia.trecho}
            </blockquote>
          )}
          <p>
            <button type="button" className="text-left link-grifo" onClick={() => irParaPendencia(pendencia.chave)}>
              Ir à pendência
            </button>
          </p>
        </div>
      )}
    </section>
  );
}

/** Uma referência do "Por que": a norma abre no Ler, com o selo de vigência; o CNCT, no curso; a externa, só o nome. */
function Referencia({
  referencia: n,
  aoAbrirLink,
}: {
  readonly referencia: FichaCriterio["normas"][number];
  readonly aoAbrirLink: AoAbrirLink;
}) {
  const nome = nomeDaReferencia(n, nomeCurtoLink);
  const rotulo = n.dispositivos.length === 0 ? nome : `${nome}, ${dispositivosPorExtenso(n.dispositivos)}`;
  return (
    <li className="flex flex-wrap items-center gap-x-2">
      {n.link === null ? (
        <span>{rotulo}</span>
      ) : (
        <BotaoLink link={n.link} aoAbrirLink={aoAbrirLink}>
          {rotulo}
        </BotaoLink>
      )}
      {n.tipo === "norma" ? (
        <SituacaoVigencia
          vigencia={vigenciaDaNorma({ status_vigencia: n.vigencia })}
          className="font-normal text-micro"
        />
      ) : n.tipo === "externo" ? (
        <span className="text-muted-foreground text-micro">referência externa, sem texto na base</span>
      ) : null}
    </li>
  );
}

export function LeitorCriterio({
  lista,
  id,
  aoAbrirLink,
}: {
  readonly lista: string;
  readonly id: string;
  readonly aoAbrirLink: AoAbrirLink;
}) {
  const api = useApi();
  const [estado] = useRevisao();
  // A lista aberta na revisão: a leitura se refaz quando ela muda (o "Neste PPC"); a chave começa pelo
  // prefixo da lista, que sai da memória com a revisão apagada ou refeita.
  const versao = estado.lista?.id === lista ? `@${estado.lista.atualizadaEm}` : "";
  const lido = useCarga(`${TIPO_LINK}:${lista}/criterio/${id}${versao}`, () =>
    api.chamar((c) => c["revisaoPpc.criterio"]({ lista, id })),
  );
  return (
    <ComCarga carga={lido} titulo="Não foi possível ler este critério">
      {(ficha) => (
        <article aria-label="Critério da revisão" className="@container leitor-impressao flex flex-col gap-5">
          <header className="flex flex-col gap-1.5">
            <p className="font-semibold text-muted-foreground text-small">Critério da tarefa “Revisar um PPC”</p>
            <h2 className="break-words text-title">{ficha.titulo}</h2>
            <p className="text-muted-foreground text-small">
              <span className="font-mono">{ficha.id}</span>
              {ficha.criticidade === null ? null : ` · ${nomeCriticidade(ficha.criticidade)}`}
              {" · "}
              <span className="font-semibold">Como o app confere:</span> {comoConfere(ficha)}
              {ficha.justificativa === null ? null : ` ${ficha.justificativa}`}
            </p>
          </header>

          <NestePpc lista={lista} ficha={ficha} />

          {ficha.pergunta === null ? null : (
            <Bloco rotulo="O que confere">
              <p className="max-w-[68ch] text-body">{ficha.pergunta}</p>
            </Bloco>
          )}

          {ficha.normas.length === 0 ? null : (
            <Bloco rotulo="Por que">
              <ul className="flex flex-col gap-1 text-small">
                {ficha.normas.map((n) => (
                  <Referencia key={n.norma} referencia={n} aoAbrirLink={aoAbrirLink} />
                ))}
              </ul>
            </Bloco>
          )}

          {ficha.atendido === null && ficha.naoAtendido === null ? null : (
            <div className="grid gap-4 @lg:grid-cols-2">
              {ficha.atendido === null ? null : (
                <Bloco
                  rotulo={
                    <span className="inline-flex items-center gap-1.5">
                      <CheckIcon aria-hidden className="size-3.5 text-grav-ok-texto" /> Conta como atendido
                    </span>
                  }
                >
                  <p className="text-small">{ficha.atendido}</p>
                </Bloco>
              )}
              {ficha.naoAtendido === null ? null : (
                <Bloco
                  rotulo={
                    <span className="inline-flex items-center gap-1.5">
                      <GlifoGravidade gravidade="corrigir" /> Não atendido
                    </span>
                  }
                >
                  <p className="text-small">{ficha.naoAtendido}</p>
                </Bloco>
              )}
            </div>
          )}

          {ficha.aConferir === null ? null : (
            <Bloco rotulo="Quando fica “a conferir”">
              <p className="text-small">{ficha.aConferir}</p>
            </Bloco>
          )}

          <p className="text-muted-foreground text-micro">
            Critério da revisão prévia do app: ajuda a revisar, não é norma nem parecer da PROENS.
          </p>
        </article>
      )}
    </ComCarga>
  );
}
