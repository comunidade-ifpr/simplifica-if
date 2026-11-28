/**
 * A revisão na janela compacta, ao lado do Word (`/revisao-ppc?id=…&compacto=1`; `docs/plans/multitarefa.md`,
 * "Modo compacto ao lado do Word"): só o que serve para corrigir, numa coluna de uns 380 px.
 *
 * - Em cima, a dica de deixar o Word à esquerda (a coluna cobre a área dos balões de comentário), o PPC com
 *   "N de M feitas" e a conferência ao salvar ("Salvo às 14:32 · conferido sem IA" e o que mudou).
 * - O filtro por gravidade e a lista, com uma pendência aberta por vez: o trecho (com "Copiar trecho", para
 *   achar no Word com Ctrl+F), "Feito" (F no teclado), a norma (no painel, que cobre a coluna) e "Sugerir
 *   texto". A pendência que o salvamento resolveu diz "Resolvido ao salvar"; a que ele trouxe, "Novo".
 * - No rodapé, "Conversas desta revisão" (recolhida) e a caixa curta da conversa ao lado (a mesma da aba
 *   Conversar): a da pendência aberta (o rascunho com o PPC e a pendência, ou a conversa que já nasceu
 *   dela) ou, sem pendência aberta, a conversa da revisão que já estava; a resposta abre na coluna, no
 *   painel, e "Voltar" volta à lista. Na entrada, a caixa toma a conversa do painel se ela é desta revisão
 *   ou se o rascunho está intocado; abrir outra pendência leva a caixa à conversa dela, mas só se a caixa
 *   está numa conversa desta revisão e sem rascunho escrito de outra. Nunca puxa de volta uma conversa
 *   livre, de outra origem ou o rascunho de "Nova conversa" que a pessoa deixou no painel: aí, como com o
 *   rascunho de outra, a caixa oferece a da pendência (ou da revisão), e o que está escrito vai junto. A
 *   conversa desta revisão que a pessoa escolhe em "Conversas desta revisão" (ou a nova) fica na caixa, sem
 *   a oferta, até outra pendência abrir.
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
import { rascunhoIntocado } from "../../painel/ControlePainel.ts";
import { type AoAbrirLink, useAbrirLink } from "../../painel/abrirLink.ts";
import { ponteDesktop } from "../../ponte-desktop.ts";
import { useFocoNaPendencia, useRevisao, useRevisaoNaTela } from "./contexto.ts";
import { ConversasDaRevisao } from "./ConversasDaRevisao.tsx";
import { ehConversaDaRevisao, lerOrigem, pedidoDaRevisao } from "./conversa.ts";
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

  // A caixa curta pergunta sobre a revisão: a conversa da pendência aberta, ou a da revisão que já estava.
  // Na entrada (ou noutra lista), ela fica com a conversa do painel se é desta revisão ou se está vazia;
  // depois, abrir outra pendência leva a caixa à conversa dela, só se ela está numa desta revisão e sem
  // rascunho escrito de outra (senão, a caixa oferece a da pendência).
  const aberta = estado.aberta;
  const listaId = estado.lista?.id;
  const ligada = useRef<{ readonly lista: string; readonly aberta: string | null } | undefined>(undefined);
  useEffect(() => {
    const lista = app.revisao.obter().lista;
    const completo = pedidoDaRevisao(app, aberta);
    // A conversa que já existe só abre: as fichas já foram nela (a do PPC tirada não volta a cada pendência).
    const pedido =
      completo?.conversa === undefined ? completo : { ...completo, fichas: [], ofertas: completo.ofertas ?? [] };
    if (pedido === undefined || lista === undefined || lista.id !== listaId) return;
    const antes = ligada.current;
    ligada.current = { lista: listaId, aberta };
    const atual = app.painel.obter().conversa;
    const naRevisao = ehConversaDaRevisao(atual, lista);
    const mesma =
      atual.origem?.chave === pedido.origem?.chave || (pedido.conversa !== undefined && atual.id === pedido.conversa);
    const podeTrocar = mesma || atual.texto.trim() === "";
    if (antes === undefined || antes.lista !== listaId) {
      // A conversa livre, a de outra origem ou o rascunho de "Nova conversa" ficam: a caixa oferece a desta.
      if (naRevisao ? aberta !== null && podeTrocar : rascunhoIntocado(atual))
        app.painel.conversar(pedido, { mostrar: false });
      return;
    }
    if (antes.aberta === aberta || aberta === null || !naRevisao || !podeTrocar) return;
    app.painel.conversar(pedido, { mostrar: false });
  }, [app, listaId, aberta]);
  // A conversa desta revisão que a pessoa escolheu ("Conversas desta revisão", a nova), com a pendência que
  // estava aberta: a caixa fica nela, sem oferecer a da pendência, até outra pendência abrir.
  const [escolhida, setEscolhida] = useState<{ readonly origem: string; readonly aberta: string | null }>();
  const escolher = () => {
    const origem = app.painel.obter().conversa.origem?.chave;
    if (origem !== undefined) setEscolhida({ origem, aberta: app.revisao.obter().aberta });
  };
  // A caixa está onde a tela pede: numa conversa desta revisão e, com uma pendência aberta, na dela (ou na
  // que a pessoa escolheu).
  const caixaNaRevisao = useSyncExternalStore(app.painel.observar, () => {
    const lista = app.revisao.obter().lista;
    if (lista === undefined) return true;
    const atual = app.painel.obter().conversa;
    if (!ehConversaDaRevisao(atual, lista)) return false;
    const pendencia = app.revisao.obter().aberta;
    if (pendencia === null) return true;
    if (escolhida !== undefined && escolhida.aberta === pendencia && escolhida.origem === atual.origem?.chave)
      return true;
    return (
      (atual.origem !== undefined && lerOrigem(atual.origem.chave)?.pendencia === pendencia) ||
      (atual.id !== undefined && lista.conversas.some((c) => c.conversa === atual.id && c.pendencia === pendencia))
    );
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
        <ConversasDaRevisao compacta aoEscolher={escolher} />
        {caixaNaRevisao ? null : (
          <div className="flex flex-col items-start gap-1.5 px-1 pb-2 text-small">
            <p className="text-muted-foreground">
              {rascunhoDeOutra
                ? `A caixa está com o rascunho de outra conversa. O que está escrito vai junto para a desta ${aberta === null ? "revisão" : "pendência"}.`
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
              {aberta === null ? "Conversar sobre esta revisão" : "Conversar sobre esta pendência"}
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
