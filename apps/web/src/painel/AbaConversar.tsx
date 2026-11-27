/**
 * A aba Conversar do painel do app (`docs/plans/multitarefa.md`, "Conversa ao lado"): a conversa ao lado
 * da tela, uma conversa livre como as outras (todas as skills, com web), que aparece na lista de conversas.
 *
 * - Antes da primeira mensagem, o rascunho: as fichas de contexto que a tela mandou, a caixa e a IA, que se
 *   pode trocar até o envio (a da origem, senão a última usada; outra origem traz a dela). No envio, o
 *   módulo da origem prepara a conversa (a revisão grava o PPC na pasta e a abre, `OrigensConversa`); sem
 *   origem de módulo, a livre cria a pasta e a abre. A mensagem vai com as fichas que ficaram.
 * - Depois, a `VistaConversa` com o controle que a aba pegou no `GerenteConversas`; as fichas novas que a
 *   tela mandar entram acima da caixa, para a próxima mensagem.
 * - "⤢" leva a conversa à tela cheia (`/conversa?id=…`) e guarda de onde saiu; enquanto ela está lá, a aba
 *   diz "Aberta na tela cheia", com "Trazer de volta", que volta a essa tela. "Nova conversa" volta ao
 *   rascunho de uma livre. A conversa apagada sai da aba, que diz "Conversa apagada".
 * - A mensagem que não sai (o aviso de uso não aceito, a conversa que não estava pronta) volta à caixa com
 *   as fichas; o que a pessoa escreveu ou o que chegou enquanto ela se preparava não se perde.
 */
import { AvisoNaoAceito } from "@simplifica-if/contratos-app";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Maximize2Icon, PlusIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AvisoErro } from "../components/AvisoErro.tsx";
import { AvisoUsoPendente } from "../components/AvisoUso.tsx";
import { CaixaPedido } from "../components/CaixaPedido.tsx";
import { Button } from "../components/ui/button.tsx";
import type { Api } from "../conexao/api.ts";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { rotaParaGuardar } from "../continuidade/conferir.ts";
import { useApi, useApp, useControleConversa, useEstadoConversa, usePainel } from "../contexto.tsx";
import { type ControleConversa, ehAvisoNaoAceito } from "../conversa/ControleConversa.ts";
import { FichasNaCaixa, useFocoDasFichas } from "../conversa/FichasContexto.tsx";
import { rascunhoDaContinuacao } from "../conversa/continuacao.ts";
import { VistaConversa } from "../conversa/VistaConversa.tsx";
import { EscolhaIa } from "../tarefas/comecar.tsx";
import type { EscolhaDaIa } from "../tarefas/modelos.ts";
import { tituloDoPedido } from "../tarefas/textos.ts";
import { useAbrirLink } from "./abrirLink.ts";
import type { MensagemAoLado, MensagemPreparada } from "./ControlePainel.ts";

/**
 * A conversa livre: na primeira mensagem, a pasta nova com o título do pedido e a conversa nela. O aviso de
 * uso é conferido antes: a recusa não deixa uma pasta vazia por tentativa.
 */
async function prepararLivre(api: Api, mensagem: MensagemAoLado): Promise<MensagemPreparada> {
  const prontas = mensagem.fichas.flatMap((f) => (f.ficha === undefined ? [] : [f.ficha]));
  if (mensagem.conversa !== undefined) return { conversa: mensagem.conversa, fichas: prontas };
  const preferencias = await api.chamar((c) => c["preferencias.ler"]({}));
  if (preferencias.avisoAceitoEm === undefined) throw new AvisoNaoAceito();
  const { pasta } = await api.chamar((c) => c["pasta.criar"]({ titulo: tituloDoPedido(mensagem.texto) }));
  const { sessao } = await api.chamar((c) => c["conversa.iniciar"]({ ...mensagem.ia, pastaTrabalho: pasta }));
  return { conversa: sessao, fichas: prontas };
}

export function AbaConversar() {
  const [estado, painel] = usePainel();
  const conversa = estado.conversa;
  const navegar = useNavigate();
  const naTelaCheia = useRouterState({
    select: (s) =>
      conversa.id !== undefined &&
      s.location.pathname === "/conversa" &&
      (s.location.search as { readonly id?: unknown }).id === conversa.id,
  });

  if (conversa.apagada === true) {
    return (
      <div className="flex flex-col items-start gap-3 px-4 py-6 text-sm">
        <p className="text-muted-foreground">Conversa apagada.</p>
        <Button size="sm" variant="outline" onClick={painel.novaConversa}>
          <PlusIcon /> Nova conversa
        </Button>
      </div>
    );
  }
  if (naTelaCheia) {
    return (
      <div className="flex flex-col items-start gap-3 px-4 py-6 text-sm">
        <p className="text-muted-foreground">Aberta na tela cheia.</p>
        <Button size="sm" variant="outline" onClick={() => void navegar({ href: conversa.voltarPara ?? "/" })}>
          Trazer de volta
        </Button>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="nao-imprimir flex items-center gap-1 border-border border-b px-2 py-1">
        <Button size="sm" variant="ghost" onClick={painel.novaConversa} disabled={conversa.id === undefined}>
          <PlusIcon /> Nova conversa
        </Button>
        {conversa.id === undefined ? null : <BotaoTelaCheia id={conversa.id} />}
      </div>
      {conversa.id === undefined ? (
        // Outra origem traz a IA dela (decisão 11) e uma caixa sem o erro da anterior.
        <Rascunho key={conversa.origem?.chave ?? "livre"} />
      ) : (
        <ConversaAberta key={conversa.id} id={conversa.id} />
      )}
    </div>
  );
}

/** "⤢": a conversa vai à tela cheia, e a aba passa a dizer "Aberta na tela cheia". */
function BotaoTelaCheia({ id }: { readonly id: string }) {
  const navegar = useNavigate();
  const { painel } = useApp();
  // Sem o `compacto=1`: ⤢ desliga o modo compacto, e "Trazer de volta" volta à tela inteira.
  const aqui = useRouterState({
    select: (s) => rotaParaGuardar(s.location.pathname, s.location.search as Record<string, unknown>),
  });
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      className="ml-auto"
      aria-label="Abrir a conversa na tela cheia"
      title="Abrir a conversa na tela cheia"
      onClick={() => {
        painel.levarATelaCheia(aqui);
        void navegar({ to: "/conversa", search: { id } });
      }}
    >
      <Maximize2Icon />
    </Button>
  );
}

function Rascunho() {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-y-auto px-3 pt-3 pb-3">
      <p className="text-muted-foreground text-sm">
        Pergunte à IA sem sair da tela. O que está nas fichas vai junto com a pergunta; tire o que não quiser mandar.
      </p>
      <CaixaAoLado controle={undefined} />
    </div>
  );
}

function ConversaAberta({ id }: { readonly id: string }) {
  const controle = useControleConversa(id);
  const aoAbrirLink = useAbrirLink();
  const { painel } = useApp();
  if (controle === undefined) return null;
  return (
    <VistaConversa
      controle={controle}
      aoAbrirLink={aoAbrirLink}
      // A conversa que continua esta com outra IA fica na aba, com a caixa que a continuação trouxe.
      aoContinuar={({ sessao, continuacao }) =>
        painel.continuada(
          id,
          sessao,
          continuacao === undefined ? { texto: "", fichas: [] } : rascunhoDaContinuacao(continuacao),
        )
      }
      estreita
      caixa={<CaixaAoLado controle={controle} />}
    />
  );
}

/**
 * A caixa da conversa ao lado fora do painel (a caixa curta da janela compacta): a mesma conversa, as mesmas
 * fichas e o mesmo texto da aba Conversar. `aoEnviada` diz que a mensagem foi, para quem a mostra abrir a
 * resposta.
 */
export function CaixaDaConversaAoLado({ aoEnviada }: { readonly aoEnviada: () => void }) {
  const [estado] = usePainel();
  const controle = useControleConversa(estado.conversa.id);
  // Outra origem traz a IA dela (decisão 11), como o rascunho da aba.
  return <CaixaAoLado key={estado.conversa.origem?.chave ?? "livre"} controle={controle} aoEnviada={aoEnviada} />;
}

/** A caixa do painel: as fichas, a IA (antes da primeira mensagem), o aviso da origem e o texto. */
function CaixaAoLado({
  controle,
  aoEnviada,
}: {
  readonly controle: ControleConversa | undefined;
  readonly aoEnviada?: () => void;
}) {
  const api = useApi();
  const { conversas, origens } = useApp();
  const [estado, painel] = usePainel();
  const conversa = estado.conversa;
  const [ia, setIa] = useState<EscolhaDaIa>(() => ({ provider: conversa.origem?.ia ?? conversas.ultimaIa() }));
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<MensagemErro>();
  const origem = conversa.origem;
  const aviso = useSyncExternalStore(origens.observar, () => (origem === undefined ? null : origens.aviso(origem)));
  const caixa = useRef<HTMLDivElement>(null);
  const foco = useFocoDasFichas(caixa, conversa.fichas);

  // O pedido que acabou de chegar (o trecho, a pendência, ⌘J) põe o foco na caixa, com o cursor no fim.
  useEffect(() => {
    if (conversa.focar !== true) return;
    const campo = caixa.current?.querySelector("textarea");
    if (campo != null) {
      campo.focus();
      campo.setSelectionRange(campo.value.length, campo.value.length);
    }
    painel.focou();
  }, [conversa.focar, painel]);

  const tirar = (chave: string) => {
    foco.tirando(chave);
    painel.tirarFicha(chave);
  };

  const por = (chave: string) => {
    foco.pondo(chave);
    painel.porOferta(chave);
  };

  const enviar = async () => {
    const escrito = conversa.texto;
    const texto = escrito.trim();
    if (texto === "" || enviando) return;
    const fichas = conversa.fichas;
    const geracao = painel.geracaoDaConversa();
    setEnviando(true);
    setErro(undefined);
    painel.avisoDeUso(false);
    try {
      const mensagem: MensagemAoLado = { conversa: conversa.id, fichas, ia, texto };
      const pronto = await ((origem === undefined ? undefined : origens.preparar(origem, mensagem)) ??
        prepararLivre(api, mensagem));
      if (conversa.id === undefined) conversas.escolherIa(ia.provider);
      const pego = conversas.pegar(pronto.conversa);
      try {
        await pego.controle.aposAbrir();
        // A pessoa pode ter ido a outra conversa no painel enquanto esta se preparava: a mensagem vai à
        // conversa preparada, sem mexer na caixa da outra.
        const naMesma = () => painel.geracaoDaConversa() === geracao;
        if (naMesma()) {
          painel.enviada(pronto.conversa, { texto: escrito, chaves: fichas.map((f) => f.chave) });
          aoEnviada?.();
        }
        const resultado = await pego.controle.enviar(texto, pronto.fichas);
        if (resultado !== "enviada" && naMesma()) painel.devolver(escrito, fichas, resultado === "avisoNaoAceito");
      } finally {
        pego.soltar();
      }
    } catch (falha) {
      if (ehAvisoNaoAceito(falha)) painel.avisoDeUso(true);
      else setErro(explicarErro(falha));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div ref={caixa} className="pointer-events-auto flex flex-col gap-2 rounded-2xl bg-card">
      <FichasNaCaixa fichas={conversa.fichas} ofertas={conversa.ofertas} aoTirar={tirar} aoPor={por} />
      {aviso === null ? null : <p className="text-micro text-warning-foreground">{aviso}</p>}
      <CaixaComControle
        controle={controle}
        texto={conversa.texto}
        aoMudar={painel.escreverTexto}
        aoEnviar={() => void enviar()}
        enviando={enviando}
        rotuloEnviando={conversa.id === undefined ? "Abrindo a conversa…" : "Enviando…"}
        direita={conversa.id === undefined ? <EscolhaIa compacta valor={ia} aoMudar={setIa} /> : undefined}
        abaixo={
          conversa.avisoUso === true ? <AvisoUsoPendente /> : erro === undefined ? undefined : <AvisoErro erro={erro} />
        }
      />
    </div>
  );
}

/** A `CaixaPedido` com o "Interromper" da conversa, quando há uma respondendo. */
function CaixaComControle({
  controle,
  texto,
  ...resto
}: {
  readonly controle: ControleConversa | undefined;
  readonly texto: string;
  readonly aoMudar: (texto: string) => void;
  readonly aoEnviar: () => void;
  readonly enviando: boolean;
  readonly rotuloEnviando: string;
  readonly direita: ReactNode;
  readonly abaixo: ReactNode;
}) {
  if (controle === undefined) return <Caixa texto={texto} interromper={undefined} {...resto} />;
  return <CaixaDaConversa controle={controle} texto={texto} {...resto} />;
}

function CaixaDaConversa({
  controle,
  ...resto
}: Omit<Parameters<typeof Caixa>[0], "interromper"> & { readonly controle: ControleConversa }) {
  const estado = useEstadoConversa(controle);
  const ocupada = estado.fase === "respondendo" || estado.fase === "interrompendo";
  return (
    <Caixa
      {...resto}
      interromper={
        ocupada
          ? { aoInterromper: () => void controle.interromper(), interrompendo: estado.fase === "interrompendo" }
          : undefined
      }
    />
  );
}

function Caixa({
  texto,
  aoMudar,
  aoEnviar,
  enviando,
  rotuloEnviando,
  direita,
  abaixo,
  interromper,
}: {
  readonly texto: string;
  readonly aoMudar: (texto: string) => void;
  readonly aoEnviar: () => void;
  readonly enviando: boolean;
  readonly rotuloEnviando: string;
  readonly direita: ReactNode;
  readonly abaixo: ReactNode;
  readonly interromper: { readonly aoInterromper: () => void; readonly interrompendo: boolean } | undefined;
}) {
  return (
    <CaixaPedido
      rotulo="Pergunta à IA"
      placeholder="Pergunte sobre o que está na tela"
      valor={texto}
      aoMudar={aoMudar}
      aoEnviar={aoEnviar}
      enviando={enviando}
      rotuloEnviando={rotuloEnviando}
      interromper={interromper}
      direita={direita}
      abaixo={abaixo}
    />
  );
}
