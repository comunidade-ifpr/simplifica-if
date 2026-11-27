/**
 * A revisão na janela compacta, ao lado do Word (`/revisao-ppc?id=…&compacto=1`; `docs/plans/multitarefa.md`,
 * "Modo compacto ao lado do Word"): só o que serve para corrigir, numa coluna de uns 380 px.
 *
 * - Em cima, a dica de deixar o Word à esquerda (a coluna cobre a área dos balões de comentário), o PPC com
 *   "N de M feitas" e a conferência ao salvar ("Salvo às 14:32 · conferido sem IA" e o que mudou).
 * - O filtro por gravidade e a lista, com uma pendência aberta por vez: o trecho (com "Copiar trecho", para
 *   achar no Word com Ctrl+F), "Feito" (F no teclado), a norma (no painel, que cobre a coluna) e "Sugerir
 *   texto". A pendência que o salvamento resolveu diz "Resolvido ao salvar"; a que ele trouxe, "Novo".
 * - No rodapé, a caixa curta da conversa ao lado da revisão (a mesma da aba Conversar), com o PPC e a
 *   pendência aberta como fichas; a resposta abre na coluna, no painel, e "Voltar" volta à lista. A caixa
 *   toma a conversa do painel só na entrada e só se ela não tem rascunho de outra conversa (aí, oferece a
 *   da revisão); depois, abrir outra pendência só troca a ficha da pendência, sem repor a do PPC que a
 *   pessoa tirou nem puxar de volta a conversa que ela trocou no painel.
 *
 * O app não mexe no Word: "Copiar trecho" e "Sugerir texto" levam o texto à área de transferência.
 */
import type { PendenciaViva } from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import { BookOpenIcon, CheckIcon, SparklesIcon, Undo2Icon } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { AvisoErro } from "../../components/AvisoErro.tsx";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { LinhaExpansivel } from "../../components/ui/linha-expansivel.tsx";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../components/ui/menu.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";
import { useApp } from "../../contexto.tsx";
import { horaDe } from "../../lib/formato.ts";
import { nomeDoArquivo } from "../../lib/texto.ts";
import { cn } from "../../lib/utils.ts";
import { CaixaDaConversaAoLado } from "../../painel/AbaConversar.tsx";
import type { ConversaDoPainel, PedidoConversa } from "../../painel/ControlePainel.ts";
import { type AoAbrirLink, useAbrirLink } from "../../painel/abrirLink.ts";
import { ponteDesktop } from "../../ponte-desktop.ts";
import { useFocoNaPendencia, useRevisao, useRevisaoNaTela } from "./contexto.ts";
import { pedidoDaRevisao } from "./conversa.ts";
import { providerDaRevisao } from "./ControleRevisao.ts";
import { nomeIa } from "./FaixaIa.tsx";
import { IndicadorGravidade } from "./IndicadorGravidade.tsx";
import { Confirmar, FILETE, Sugestao, Trecho } from "./LinhaPendencia.tsx";
import {
  contagens,
  descreverCurso,
  doFiltro,
  type FiltroGravidade,
  gravidadeDe,
  idDaLinha,
  linhasConferencia,
  linkDoPpc,
  localizacao,
  ordenar,
  principais,
  textoFeitas,
  versaoDoPpc,
} from "./lista.ts";
import { DICA_TECLADO, teclasDaLista } from "./teclado.ts";

/** O título da moldura compacta, que a revisão dá ao ligar o modo. */
export const TITULO_COMPACTO = "Acompanhando o PPC";

/** A conversa do painel é a da revisão do `pedido` (a mesma origem, ou a conversa que a lista guarda). */
const daRevisao = (conversa: ConversaDoPainel, pedido: PedidoConversa): boolean =>
  conversa.apagada !== true &&
  ((conversa.origem !== undefined && conversa.origem.chave === pedido.origem?.chave) ||
    (pedido.conversa !== undefined && conversa.id === pedido.conversa));

/** Só a ficha da pendência do pedido, sem a do PPC nem as ofertas. */
const soPendencia = (pedido: PedidoConversa): PedidoConversa => ({
  ...(pedido.origem === undefined ? {} : { origem: pedido.origem }),
  fichas: (pedido.fichas ?? []).filter((ficha) => ficha.chave.startsWith("pendencia:")),
});

/** Os filtros por gravidade; o glifo é só visual (o leitor de tela lê o nome). */
const FILTROS: ReadonlyArray<{ readonly valor: FiltroGravidade; readonly nome: string; readonly glifo?: string }> = [
  { valor: "tudo", nome: "Tudo" },
  { valor: "corrigir", nome: "Corrigir", glifo: "●" },
  { valor: "conferir", nome: "Conferir", glifo: "◐" },
];

export function VistaCompacta() {
  const [estado, revisao] = useRevisao();
  const app = useApp();
  const abrirLink = useAbrirLink();
  const [filtro, setFiltro] = useState<FiltroGravidade>("tudo");
  const [dica, setDica] = useState(true);
  const ponte = ponteDesktop();
  const dicaTeclado = useId();

  useRevisaoNaTela();
  useFocoNaPendencia("compacta");

  // A caixa curta pergunta sobre a revisão. Na entrada (ou noutra lista), ela fica com a conversa da
  // revisão, salvo se o painel tem o rascunho de outra (a caixa oferece a da revisão); depois, a pendência
  // aberta troca só a ficha da pendência, e só na conversa da revisão.
  const aberta = estado.aberta;
  const listaId = estado.lista?.id;
  const ligada = useRef<{ readonly lista: string; readonly aberta: string | null } | undefined>(undefined);
  useEffect(() => {
    const pedido = pedidoDaRevisao(app, aberta);
    if (pedido === undefined || listaId === undefined) return;
    const antes = ligada.current;
    ligada.current = { lista: listaId, aberta };
    const atual = app.painel.obter().conversa;
    const naRevisao = daRevisao(atual, pedido);
    if (antes === undefined || antes.lista !== listaId) {
      if (naRevisao) app.painel.conversar(soPendencia(pedido), { mostrar: false });
      else if (atual.texto.trim() === "") app.painel.conversar(pedido, { mostrar: false });
      return;
    }
    if (!naRevisao || antes.aberta === aberta) return;
    if (antes.aberta !== null) app.painel.tirarFicha(`pendencia:${antes.aberta}`);
    app.painel.conversar(soPendencia(pedido), { mostrar: false });
  }, [app, listaId, aberta]);
  const caixaNaRevisao = useSyncExternalStore(app.painel.observar, () => {
    const pedido = pedidoDaRevisao(app, null);
    return pedido === undefined || daRevisao(app.painel.obter().conversa, pedido);
  });
  const rascunhoDeOutra = useSyncExternalStore(
    app.painel.observar,
    () => app.painel.obter().conversa.texto.trim() !== "",
  );

  const lista = estado.lista;
  if (lista === undefined) return null;

  const r = lista.resultado;
  const c = contagens(lista);
  const lidas = principais(lista);
  const versaoPpc = versaoDoPpc(lista);
  const linhas = ordenar(doFiltro(lidas, filtro));
  const a = estado.acompanhamento;
  const conferencia = a.ultima === undefined ? undefined : linhasConferencia(a.ultima, horaDe(a.ultima.em));
  const windows = ponte?.janela.plataforma === "win32";

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pt-3">
        {dica ? (
          <div role="note" className="flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-small">
            <p className="flex-1">
              Deixe o Word à esquerda{windows ? " (⊞+←)" : ""}: esta coluna fica sempre à vista e cobre a área dos
              balões de comentário.
            </p>
            <Button size="sm" variant="ghost" onClick={() => setDica(false)}>
              Entendi
            </Button>
          </div>
        ) : null}

        <header className="flex flex-col gap-0.5">
          <h1 className="break-words font-semibold text-heading">
            {descreverCurso(r.curso) ?? nomeDoArquivo(lista.arquivoOriginal)}
          </h1>
          <p className="text-muted-foreground text-small tabular-nums">{textoFeitas(c)}</p>
        </header>

        <section aria-label="Conferência ao salvar" className="flex flex-col gap-1 rounded-xl border border-border p-3">
          <div role="status" className="flex flex-col gap-0.5 text-small tabular-nums">
            {conferencia === undefined ? (
              <p className="text-muted-foreground">Salve no Word para conferir.</p>
            ) : (
              <>
                <p className={cn("font-semibold", a.ultima?.tipo === "falhou" && "text-grav-conferir-texto")}>
                  {conferencia.linha}
                </p>
                <p className="text-muted-foreground">{conferencia.detalhe}</p>
              </>
            )}
          </div>
          {a.pedeArquivo && ponte !== undefined ? (
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() => void revisao.escolherAcompanhadoDeNovo()}
            >
              Escolher o arquivo de novo
            </Button>
          ) : null}
          {a.erro === undefined ? null : <AvisoErro erro={a.erro} />}
        </section>
        {estado.erro === undefined ? null : <AvisoErro erro={estado.erro} />}

        <div role="group" aria-label="Filtrar por gravidade" className="flex flex-wrap gap-1.5">
          {FILTROS.map((f) => (
            <button
              key={f.valor}
              type="button"
              aria-pressed={filtro === f.valor}
              onClick={() => setFiltro(f.valor)}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 font-semibold text-small tabular-nums hover:border-input aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background"
            >
              {f.glifo === undefined ? null : <span aria-hidden>{f.glifo}</span>}
              {f.nome} {doFiltro(lidas, f.valor).length}
            </button>
          ))}
        </div>

        <p id={dicaTeclado} hidden>
          {DICA_TECLADO}
        </p>
        {linhas.length ? (
          <ul
            aria-label="Pendências"
            aria-describedby={dicaTeclado}
            className="border-border border-t"
            onKeyDown={(evento) => teclasDaLista(evento, lista, estado.marcando, revisao)}
          >
            {linhas.map((v) => (
              <li key={v.chave} data-chave={v.chave}>
                <LinhaCompacta
                  id={idDaLinha(v.chave, "compacta")}
                  viva={v}
                  aoAbrirLink={abrirLink}
                  linkNoPpc={`${linkDoPpc(lista.id, versaoPpc)}#p-${v.chave}`}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-small">Nada aqui, nos critérios lidos.</p>
        )}
      </div>
      <section aria-label="Conversa sobre esta revisão" className="shrink-0 border-border border-t p-2">
        {caixaNaRevisao ? null : (
          <div className="flex flex-col items-start gap-1.5 px-1 pb-2 text-small">
            <p className="text-muted-foreground">
              {rascunhoDeOutra
                ? "A caixa está com o rascunho de outra conversa. Trocar pela desta revisão apaga o rascunho."
                : "A caixa está com outra conversa."}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const pedido = pedidoDaRevisao(app, aberta);
                if (pedido !== undefined) app.painel.conversar(pedido, { mostrar: false });
              }}
            >
              Conversar sobre esta revisão
            </Button>
          </div>
        )}
        <CaixaDaConversaAoLado aoEnviada={() => app.painel.mostrar("conversar")} />
      </section>
    </div>
  );
}

/** Uma pendência na coluna estreita: a gravidade, onde está e o título; aberta, o trecho e as ações. */
function LinhaCompacta({
  id,
  viva,
  aoAbrirLink,
  linkNoPpc,
}: {
  readonly id: string;
  readonly viva: PendenciaViva;
  readonly aoAbrirLink: AoAbrirLink;
  readonly linkNoPpc: string;
}) {
  const [estado, revisao] = useRevisao();
  const [sugerindo, setSugerindo] = useState(false);
  const p = viva.pendencia;
  const gravidade = gravidadeDe(p);
  const feita = viva.situacao === "resolvida";
  const retirada = viva.situacao === "contestada_aceita";
  const aberta = estado.aberta === viva.chave;
  const realcada = estado.acompanhamento.realce.has(viva.chave);
  const nova = estado.novas.has(viva.chave);
  const marcando = estado.marcando === viva.chave;
  const ocupada = estado.acaoPendencia === viva.chave;
  const erro = estado.erroPendencia?.chave === viva.chave ? estado.erroPendencia.erro : undefined;
  const onde = localizacao(p);
  const nome = nomeIa(providerDaRevisao(estado));

  const cabecalho = (
    <div className={cn("flex flex-col gap-0.5 px-1", (feita || retirada) && "opacity-60")}>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-small">
        <IndicadorGravidade gravidade={gravidade} apagado={feita || retirada} />
        {realcada ? <span className="text-grav-ok-texto">Resolvido ao salvar</span> : null}
        {!realcada && feita ? <span className="text-grav-ok-texto">Feito</span> : null}
        {retirada ? <Badge variant="retirado">Retirado</Badge> : null}
        {nova ? <Badge variant="novo">Novo</Badge> : null}
        {onde === null ? null : <span className="text-muted-foreground">{onde}</span>}
      </span>
      <span className={cn("font-medium text-body", aberta ? "" : "line-clamp-2", feita && "line-through decoration-1")}>
        {p.titulo}
      </span>
    </div>
  );

  return (
    <LinhaExpansivel
      id={id}
      atalhos="F"
      className={cn(
        "transition-colors duration-1000 motion-reduce:transition-none",
        realcada && "bg-grav-ok/15 duration-150",
      )}
      aberta={aberta}
      aoAlternar={() => {
        setSugerindo(false);
        revisao.alternarPendencia(viva.chave);
      }}
      cabecalho={cabecalho}
    >
      <div className="flex flex-col gap-3 px-1">
        {p.trecho === null ? (
          <p className="text-small">{p.oQueFazer}</p>
        ) : (
          <Trecho trecho={p.trecho} filete={FILETE[gravidade]} aoVerNoPpc={() => aoAbrirLink(linkNoPpc, "painel")} />
        )}
        {viva.sugestao === null ? null : <Sugestao sugestao={viva.sugestao} nome={nome} />}
        <div className="flex flex-wrap items-center gap-1.5">
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
          {p.fontes.length === 1 ? (
            <Button
              size="sm"
              variant="ghost"
              title={p.fontes[0]!.rotulo}
              onClick={() => aoAbrirLink(p.fontes[0]!.link, "painel")}
            >
              <BookOpenIcon /> Norma
            </Button>
          ) : p.fontes.length > 1 ? (
            <Menu>
              <MenuTrigger render={<Button size="sm" variant="ghost" />}>
                <BookOpenIcon /> Normas
              </MenuTrigger>
              <MenuPopup align="start">
                {p.fontes.map((fonte) => (
                  <MenuItem key={fonte.link} onClick={() => aoAbrirLink(fonte.link, "painel")}>
                    {fonte.rotulo}
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          ) : null}
          {viva.aceitaIa && !retirada && !feita ? (
            <Button size="sm" variant="ghost" disabled={ocupada} onClick={() => setSugerindo(true)}>
              <SparklesIcon /> {viva.sugestao === null ? "Sugerir texto" : "Sugerir outro"}
            </Button>
          ) : null}
        </div>
        {sugerindo && aberta ? (
          <Confirmar
            titulo={`Pedir ao ${nome} uma redação para este ponto`}
            descricao="A IA usa só o trecho do PPC, o CNCT e as normas deste critério; o que o PPC não informa vem marcado para você completar."
            botao="Pedir sugestão"
            estimar={() => revisao.estimarAcao(viva.chave, "sugerir")}
            aoConfirmar={() =>
              void revisao.sugerir(viva.chave).then((ok) => {
                if (ok) setSugerindo(false);
              })
            }
            aoFechar={() => {
              setSugerindo(false);
              revisao.limparErroPendencia(viva.chave);
            }}
            ocupada={ocupada}
          />
        ) : null}
        {erro === undefined ? null : <AvisoErro erro={erro} />}
      </div>
    </LinhaExpansivel>
  );
}
