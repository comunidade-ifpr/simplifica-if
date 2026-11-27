/**
 * A paleta de busca do Explorar: Ctrl+K (Cmd+K no macOS) em qualquer tela abre uma janela com um campo
 * que busca na base inteira enquanto se digita (`explorarBuscar`), com os resultados agrupados por tipo
 * (a citação reconhecida primeiro). É um combobox: as setas andam pelos resultados, Enter abre, Esc
 * fecha e devolve o foco a quem o tinha. O resultado com link `ifpr://` abre por `abrirLink`: numa tela
 * de trabalho (a revisão de PPC, a conversa), no painel do app, e a tela fica; nas outras, na página do
 * Explorar. Shift+Enter (ou Alt+clique) o abre no outro lugar. A reunião do Consepe, sem link, abre
 * sempre na página dela. Uma norma achada que tem
 * tabela de correspondência traz, logo depois do grupo dela, "Comparar com a sucessora" (ou "com a
 * anterior"), que abre o modo Comparar; a comparação vem na resposta da busca, junto com os grupos. O
 * Comparar é tela cheia, também numa tela de trabalho: põe duas normas lado a lado, o que o painel não cabe.
 * A última linha, "Perguntar à IA" (ou ⌘J no campo), leva o texto digitado como pergunta à conversa ao lado,
 * com o contexto da tela.
 *
 * Sem IA e sem rede: a busca vai ao servidor local, que lê o `kb.sqlite`.
 */
import type { ComparacaoBusca, GrupoBusca, ResultadoBusca } from "@simplifica-if/contratos-app";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { Columns2Icon, type LucideIcon, MessageSquareIcon, SearchIcon } from "lucide-react";
import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Spinner } from "../components/ui/spinner.tsx";
import { mensagemDeErro } from "../conexao/erros.ts";
import { useApi, useApp } from "../contexto.tsx";
import { ariaAtalho, ATALHO_CONVERSAR, eComando } from "../lib/teclado.ts";
import { abrirEmNovaJanela, ondeDoClique, useAbrirLink } from "../painel/abrirLink.ts";
import { contextoParaConversar, juntarPedidos } from "../painel/conversar.ts";
import { cn } from "../lib/utils.ts";
import { NOMES_TIPO } from "./colecoes.ts";
import { type Comparacao, comparacaoDaBusca } from "./comparar.ts";
import { ICONES_TIPO } from "./icones.ts";

/** Resultados por grupo. */
const LIMITE = 6;
/** O tamanho máximo da consulta (o do `EntradaBusca` do servidor); o texto colado mais longo é cortado. */
export const MAXIMO_CONSULTA = 300;
/** A espera entre a tecla e a busca, para não buscar a cada letra de quem digita rápido. */
const ESPERA_MS = 70;

interface OpcoesPaleta {
  /** O resultado vai ao painel em qualquer tela, como numa tela de trabalho ("Buscar na base" do painel). */
  readonly aoLado?: boolean;
}

interface ContextoPaleta {
  /** Abre a paleta; já aberta, sem consulta nova (o menu Ver repete o ⌘K no macOS), fica como está. */
  readonly abrir: (consulta?: string, opcoes?: OpcoesPaleta) => void;
}

const Contexto = createContext<ContextoPaleta>({ abrir: () => undefined });

export function usePaleta(): ContextoPaleta {
  return use(Contexto);
}

/** Uma opção da paleta: um resultado da busca, a comparação de uma norma achada ou perguntar à IA. */
type Opcao =
  | { readonly tipo: "resultado"; readonly resultado: ResultadoBusca }
  | { readonly tipo: "comparar"; readonly comparacao: Comparacao }
  | { readonly tipo: "perguntar" };

interface SecaoPaleta {
  readonly chave: string;
  readonly titulo: string;
  readonly Icone: LucideIcon;
  readonly opcoes: ReadonlyArray<Opcao>;
}

/** O ID da norma de um link `ifpr://norma/…`; `null` em outro link. */
const normaDoLink = (link: string | null) =>
  link?.startsWith("ifpr://norma/") ? link.slice("ifpr://norma/".length).split("#")[0]! : null;

/**
 * Os grupos da busca e, depois do primeiro com uma norma comparável, as comparações das normas achadas
 * (`comparacoes`, que vêm na mesma resposta da busca).
 */
function secoesDaPaleta(grupos: ReadonlyArray<GrupoBusca>, comparacoes: ReadonlyArray<ComparacaoBusca>): SecaoPaleta[] {
  const comparaveis = new Set(comparacoes.flatMap((c) => [c.a, c.b]));
  const depoisDe =
    comparacoes.length === 0
      ? -1
      : grupos.findIndex(
          (g) =>
            (g.tipo === "norma" || g.tipo === "dispositivo") &&
            g.resultados.some((r) => comparaveis.has(normaDoLink(r.link) ?? "")),
        );
  const secoes: SecaoPaleta[] = grupos.map((g) => ({
    chave: g.tipo,
    titulo: NOMES_TIPO[g.tipo].grupo,
    Icone: ICONES_TIPO[g.tipo],
    opcoes: g.resultados.map((resultado) => ({ tipo: "resultado", resultado })),
  }));
  if (depoisDe >= 0) {
    secoes.splice(depoisDe + 1, 0, {
      chave: "comparar",
      titulo: "Comparar normas",
      Icone: Columns2Icon,
      opcoes: comparacoes.map((c) => ({ tipo: "comparar", comparacao: comparacaoDaBusca(c) })),
    });
  }
  return secoes;
}

/** O título, a linha de contexto e o trecho de uma opção. */
function textosDaOpcao(o: Opcao): { titulo: string; detalhe: string | null; trecho: string | null; chave: string } {
  if (o.tipo === "perguntar") return { titulo: "Perguntar à IA", detalhe: null, trecho: null, chave: "perguntar" };
  return o.tipo === "resultado"
    ? {
        titulo: o.resultado.titulo,
        detalhe: o.resultado.detalhe,
        trecho: o.resultado.trecho,
        chave: `${o.resultado.link ?? o.resultado.reuniao}:${o.resultado.titulo}`,
      }
    : {
        titulo: o.comparacao.titulo,
        detalhe: o.comparacao.detalhe,
        trecho: null,
        chave: `comparar:${o.comparacao.a}:${o.comparacao.b}`,
      };
}

/** A resposta da última busca que voltou, com a consulta a que ela responde. */
type Resposta =
  | {
      readonly consulta: string;
      readonly grupos: ReadonlyArray<GrupoBusca>;
      readonly comparacoes: ReadonlyArray<ComparacaoBusca>;
    }
  | { readonly consulta: string; readonly erro: string };

/** O provedor: guarda a paleta aberta ou fechada e escuta Ctrl/Cmd+K na tela inteira. */
export function ProvedorPaleta({ children }: { readonly children: ReactNode }) {
  const [aberta, setAberta] = useState<{ readonly consulta: string; readonly aoLado: boolean } | null>(null);
  const abrir = useCallback(
    (consulta = "", opcoes: OpcoesPaleta = {}) =>
      setAberta((atual) => (atual !== null && consulta === "" ? atual : { consulta, aoLado: opcoes.aoLado ?? false })),
    [],
  );
  useEffect(() => {
    const aoTeclar = (evento: globalThis.KeyboardEvent) => {
      if (eComando(evento, "k")) {
        evento.preventDefault();
        setAberta((atual) => atual ?? { consulta: "", aoLado: false });
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);
  const valor = useMemo(() => ({ abrir }), [abrir]);
  return (
    <Contexto value={valor}>
      {children}
      {aberta === null ? null : (
        <Paleta consultaInicial={aberta.consulta} sempreAoLado={aberta.aoLado} aoFechar={() => setAberta(null)} />
      )}
    </Contexto>
  );
}

function Paleta({
  consultaInicial,
  sempreAoLado,
  aoFechar,
}: {
  readonly consultaInicial: string;
  readonly sempreAoLado: boolean;
  readonly aoFechar: () => void;
}) {
  const api = useApi();
  const app = useApp();
  const { painel } = app;
  const navegar = useNavigate();
  const roteador = useRouter();
  const abrirLink = useAbrirLink();
  // Lido ao abrir: a paleta é modal, e a tela não muda por baixo dela.
  const [aoLado] = useState(() => sempreAoLado || painel.emTelaDeTrabalho());
  const idLista = useId();
  const idTitulo = useId();
  const [consulta, setConsulta] = useState(consultaInicial);
  const [resposta, setResposta] = useState<Resposta | null>(null);
  const [ativo, setAtivo] = useState(0);
  const campo = useRef<HTMLInputElement>(null);
  const anterior = useRef<Element | null>(null);

  // O foco vai para o campo e volta, ao fechar, para quem o tinha. Volta num efeito de layout, antes dos
  // de quem monta no mesmo commit: o painel aberto pelo ↵ lê aí a origem do foco, para devolvê-lo depois.
  useLayoutEffect(() => {
    anterior.current = document.activeElement;
    campo.current?.focus();
    return () => {
      if (anterior.current instanceof HTMLElement && anterior.current.isConnected) anterior.current.focus();
    };
  }, []);

  const texto = consulta.slice(0, MAXIMO_CONSULTA).trim();
  useEffect(() => {
    if (texto === "") return;
    let vale = true;
    const espera = window.setTimeout(() => {
      api
        .chamar((cliente) => cliente.explorarBuscar({ consulta: texto, limite: LIMITE }))
        .then(
          (r) => {
            if (!vale) return;
            setResposta({ consulta: texto, grupos: r.dados.grupos, comparacoes: r.dados.comparacoes });
            setAtivo(0);
          },
          (erro: unknown) => vale && setResposta({ consulta: texto, erro: mensagemDeErro(erro) }),
        );
    }, ESPERA_MS);
    return () => {
      vale = false;
      window.clearTimeout(espera);
    };
  }, [api, texto]);

  // enquanto a busca nova não volta, ficam os resultados da anterior
  const fase =
    texto === "" ? "vazia" : resposta?.consulta !== texto ? "buscando" : "erro" in resposta ? "falhou" : "pronta";
  const lida = texto !== "" && resposta !== null && "grupos" in resposta ? resposta : null;
  const secoes = useMemo(() => (lida === null ? [] : secoesDaPaleta(lida.grupos, lida.comparacoes)), [lida]);
  // "Perguntar à IA" é a última linha, depois que a busca responde.
  const comPergunta = fase === "pronta" || fase === "falhou";
  const itens = useMemo(
    (): ReadonlyArray<Opcao> => [
      ...secoes.flatMap((s) => s.opcoes),
      ...(comPergunta ? [{ tipo: "perguntar" } as const] : []),
    ],
    [secoes, comPergunta],
  );
  const atual = Math.min(ativo, Math.max(0, itens.length - 1));
  const idOpcao = (i: number) => `${idLista}-opcao-${i}`;

  /**
   * Abre o resultado no lugar da tela (`abrirLink`), no outro, com `outro` (Shift+Enter, Alt+clique), ou numa
   * janela nova, com `janela` (⇧⌘-clique, só no desktop).
   */
  const abrirResultado = (r: ResultadoBusca, outro: boolean, janela: boolean) => {
    if (r.link !== null) {
      aoFechar();
      abrirLink(r.link, janela ? "janela" : aoLado === outro ? "tela" : "painel");
    } else if (r.reuniao !== null) {
      aoFechar();
      const destino = { to: "/explorar/reuniao", search: { id: r.reuniao } } as const;
      if (!(janela && abrirEmNovaJanela(roteador.buildLocation(destino).href))) void navegar(destino);
    }
  };

  /** A pergunta vai à conversa ao lado, com o contexto da tela; nada é enviado sem a pessoa. */
  const perguntar = () => {
    aoFechar();
    painel.conversar(juntarPedidos(contextoParaConversar(app), { texto: consulta.trim() }));
  };

  // o Comparar é tela cheia, também numa tela de trabalho: duas normas lado a lado não cabem no painel
  const abrirOpcao = (o: Opcao, outro = false, janela = false) => {
    if (o.tipo === "perguntar") {
      perguntar();
      return;
    }
    if (o.tipo === "comparar") {
      aoFechar();
      const destino = { to: "/explorar/comparar", search: { a: o.comparacao.a, b: o.comparacao.b } } as const;
      if (!(janela && abrirEmNovaJanela(roteador.buildLocation(destino).href))) void navegar(destino);
      return;
    }
    abrirResultado(o.resultado, outro, janela);
  };

  const aoTeclar = (evento: KeyboardEvent<HTMLInputElement>) => {
    if (eComando(evento.nativeEvent, "j")) {
      evento.preventDefault();
      perguntar();
    } else if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
      evento.preventDefault();
      if (itens.length === 0) return;
      const passo = evento.key === "ArrowDown" ? 1 : -1;
      setAtivo((a) => (a + passo + itens.length) % itens.length);
    } else if (evento.key === "Enter") {
      evento.preventDefault();
      const o = itens[atual];
      if (o !== undefined) abrirOpcao(o, evento.shiftKey);
    } else if (evento.key === "Escape") {
      evento.preventDefault();
      aoFechar();
    }
  };

  // o resultado ativo fica à vista ao andar com as setas
  useEffect(() => {
    document.getElementById(idOpcao(atual))?.scrollIntoView({ block: "nearest" });
  });

  let indice = 0;
  const total = itens.length;
  // o anúncio conta os resultados da busca, não as comparações oferecidas
  const resultados = lida === null ? 0 : lida.grupos.reduce((n, g) => n + g.resultados.length, 0);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]"
      onMouseDown={(evento) => {
        if (evento.target === evento.currentTarget) aoFechar();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        className="flex max-h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl"
        onKeyDown={(evento) => {
          // o foco fica na janela: Tab volta ao campo
          if (evento.key === "Tab") {
            evento.preventDefault();
            campo.current?.focus();
          }
        }}
      >
        <h2 id={idTitulo} className="sr-only">
          Buscar na base
        </h2>
        <div className="flex items-center gap-2 border-border border-b px-4">
          <SearchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={campo}
            role="combobox"
            aria-label="Buscar na base"
            aria-expanded={total > 0}
            aria-controls={idLista}
            aria-autocomplete="list"
            aria-activedescendant={total > 0 ? idOpcao(atual) : undefined}
            aria-describedby={`${idLista}-dica`}
            placeholder="Curso, campus, norma ou uma citação como “Res. CNE/CP 1/2021, art. 20”"
            value={consulta}
            maxLength={MAXIMO_CONSULTA}
            onChange={(evento) => setConsulta(evento.currentTarget.value.slice(0, MAXIMO_CONSULTA))}
            onKeyDown={aoTeclar}
            className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/80 sm:text-sm"
          />
          {fase === "buscando" ? <Spinner size="sm" /> : null}
          <kbd className="hidden rounded border border-border px-1.5 text-muted-foreground text-micro sm:inline">
            Esc
          </kbd>
        </div>
        <span id={`${idLista}-dica`} className="sr-only">
          {aoLado
            ? "Use as setas para escolher um resultado. Enter abre ao lado, e Shift+Enter, na tela. Esc fecha."
            : "Use as setas para escolher um resultado. Enter abre na tela, e Shift+Enter, ao lado. Esc fecha."}
        </span>
        <p role="status" className="sr-only">
          {fase === "pronta" ? (resultados === 0 ? "Nenhum resultado" : `${resultados} resultados`) : ""}
        </p>
        <div id={idLista} role="listbox" aria-label="Resultados" className="min-h-0 overflow-y-auto px-2 pb-2">
          {secoes.map((g) => {
            const idGrupo = `${idLista}-${g.chave}`;
            const Icone = g.Icone;
            return (
              <div key={g.chave} role="group" aria-labelledby={idGrupo}>
                {/* o título fica preso no topo enquanto o grupo dele rola */}
                <p
                  id={idGrupo}
                  role="presentation"
                  className="sticky top-0 z-10 flex items-center gap-2 bg-card px-2 pt-3 pb-1.5 font-semibold text-foreground text-micro"
                >
                  <Icone aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                  {g.titulo}
                  <span aria-hidden className="ml-1 h-px flex-1 bg-border" />
                </p>
                {g.opcoes.map((o) => {
                  const i = indice++;
                  const r = textosDaOpcao(o);
                  return (
                    <div
                      key={r.chave}
                      id={idOpcao(i)}
                      role="option"
                      aria-selected={i === atual}
                      tabIndex={-1}
                      onMouseMove={() => setAtivo(i)}
                      onClick={(evento) => {
                        const onde = ondeDoClique(evento);
                        abrirOpcao(o, onde === "outro", onde === "janela");
                      }}
                      className={cn(
                        // a margem de rolagem é a altura do título preso, que senão cobre o item ativo
                        "cursor-pointer scroll-mt-9 rounded-lg px-2 py-1.5 text-sm",
                        i === atual ? "bg-accent text-accent-foreground" : "",
                      )}
                    >
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate font-medium">{r.titulo}</span>
                        {i === atual && o.tipo === "resultado" && o.resultado.link !== null ? (
                          <span aria-hidden className="shrink-0 text-muted-foreground text-micro">
                            {aoLado ? "↵ abre ao lado · ⇧↵ na tela" : "↵ abre na tela · ⇧↵ ao lado"}
                          </span>
                        ) : null}
                      </span>
                      {r.detalhe ? (
                        <span className="block truncate text-muted-foreground text-micro">{r.detalhe}</span>
                      ) : null}
                      {r.trecho ? (
                        <span className="line-clamp-2 font-serif text-muted-foreground text-small" data-conteudo>
                          {r.trecho}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {!comPergunta ? null : (
            <div role="group" aria-label="Perguntar à IA" className="border-border border-t pt-1">
              {(() => {
                const i = indice++;
                return (
                  <div
                    id={idOpcao(i)}
                    role="option"
                    aria-selected={i === atual}
                    aria-keyshortcuts={ariaAtalho("J")}
                    tabIndex={-1}
                    onMouseMove={() => setAtivo(i)}
                    onClick={perguntar}
                    className={cn(
                      "flex cursor-pointer items-baseline gap-2 rounded-lg px-2 py-1.5 text-sm",
                      i === atual ? "bg-accent text-accent-foreground" : "",
                    )}
                  >
                    <MessageSquareIcon aria-hidden className="size-3.5 shrink-0 self-center text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">Perguntar à IA</span>{" "}
                      <span className="text-muted-foreground" data-conteudo>
                        “{texto}”
                      </span>
                    </span>
                    <kbd className="shrink-0 font-sans text-micro text-muted-foreground">{ATALHO_CONVERSAR}</kbd>
                  </div>
                );
              })()}
            </div>
          )}
          {fase === "vazia" ? (
            <p className="px-2 py-3 text-muted-foreground text-sm">
              Digite o nome de um curso, campus ou norma, um curso do catálogo, um assunto dos PPCs ou uma citação
              (“LDB, art. 36”).
            </p>
          ) : fase === "pronta" && resultados === 0 ? (
            <p className="px-2 py-3 text-muted-foreground text-sm">Nada encontrado na base. Tente outras palavras.</p>
          ) : resposta !== null && "erro" in resposta && fase === "falhou" ? (
            <p role="alert" className="px-2 py-3 text-destructive-foreground text-sm">
              Não foi possível buscar: {resposta.erro}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
