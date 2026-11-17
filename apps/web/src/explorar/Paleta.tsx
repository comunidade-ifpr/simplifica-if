/**
 * A paleta de busca do Explorar: Ctrl+K (Cmd+K no macOS) em qualquer tela abre uma janela com um campo
 * que busca na base inteira enquanto se digita (`explorarBuscar`), com os resultados agrupados por tipo
 * (a citação reconhecida primeiro). É um combobox: as setas andam pelos resultados, Enter abre, Esc
 * fecha e devolve o foco a quem o tinha. Um resultado abre a página dele no Explorar.
 *
 * Sem IA e sem rede: a busca vai ao servidor local, que lê o `kb.sqlite`.
 */
import type { GrupoBusca, ResultadoBusca } from "@simplifica-if/contratos-app";
import { useNavigate } from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Spinner } from "../components/ui/spinner.tsx";
import { mensagemDeErro } from "../conexao/erros.ts";
import { useApi } from "../contexto.tsx";
import { cn } from "../lib/utils.ts";
import { NOMES_TIPO } from "./colecoes.ts";

/** Resultados por grupo. */
const LIMITE = 6;
/** O tamanho máximo da consulta (o do `EntradaBusca` do servidor); o texto colado mais longo é cortado. */
export const MAXIMO_CONSULTA = 300;
/** A espera entre a tecla e a busca, para não buscar a cada letra de quem digita rápido. */
const ESPERA_MS = 70;

interface ContextoPaleta {
  readonly abrir: (consulta?: string) => void;
}

const Contexto = createContext<ContextoPaleta>({ abrir: () => undefined });

export function usePaleta(): ContextoPaleta {
  return use(Contexto);
}

/** "Ctrl+K" ou "⌘K", conforme o sistema. */
export function atalhoPaleta(): string {
  return /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl+K";
}

/** O destino de um resultado no Explorar. */
export function destinoResultado(
  r: ResultadoBusca,
): { to: "/explorar/ver"; search: { link: string } } | { to: "/explorar/reuniao"; search: { id: string } } | null {
  if (r.link !== null) return { to: "/explorar/ver", search: { link: r.link } };
  if (r.reuniao !== null) return { to: "/explorar/reuniao", search: { id: r.reuniao } };
  return null;
}

/** A resposta da última busca que voltou, com a consulta a que ela responde. */
type Resposta =
  | { readonly consulta: string; readonly grupos: ReadonlyArray<GrupoBusca> }
  | { readonly consulta: string; readonly erro: string };

/** O provedor: guarda a paleta aberta ou fechada e escuta Ctrl/Cmd+K na tela inteira. */
export function ProvedorPaleta({ children }: { readonly children: ReactNode }) {
  const [aberta, setAberta] = useState<{ readonly consulta: string } | null>(null);
  const abrir = useCallback((consulta = "") => setAberta({ consulta }), []);
  useEffect(() => {
    const aoTeclar = (evento: globalThis.KeyboardEvent) => {
      if ((evento.metaKey || evento.ctrlKey) && !evento.altKey && evento.key.toLowerCase() === "k") {
        evento.preventDefault();
        setAberta((atual) => atual ?? { consulta: "" });
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);
  const valor = useMemo(() => ({ abrir }), [abrir]);
  return (
    <Contexto value={valor}>
      {children}
      {aberta === null ? null : <Paleta consultaInicial={aberta.consulta} aoFechar={() => setAberta(null)} />}
    </Contexto>
  );
}

function Paleta({ consultaInicial, aoFechar }: { readonly consultaInicial: string; readonly aoFechar: () => void }) {
  const api = useApi();
  const navegar = useNavigate();
  const idLista = useId();
  const idTitulo = useId();
  const [consulta, setConsulta] = useState(consultaInicial);
  const [resposta, setResposta] = useState<Resposta | null>(null);
  const [ativo, setAtivo] = useState(0);
  const campo = useRef<HTMLInputElement>(null);
  const anterior = useRef<Element | null>(null);

  // o foco vai para o campo e volta, ao fechar, para quem o tinha
  useEffect(() => {
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
            setResposta({ consulta: texto, grupos: r.dados.grupos });
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
  const grupos = texto !== "" && resposta !== null && "grupos" in resposta ? resposta.grupos : [];
  const itens = grupos.flatMap((g) => g.resultados);
  const atual = Math.min(ativo, Math.max(0, itens.length - 1));
  const idOpcao = (i: number) => `${idLista}-opcao-${i}`;

  const abrirResultado = (r: ResultadoBusca) => {
    const destino = destinoResultado(r);
    if (destino === null) return;
    aoFechar();
    void navegar(destino);
  };

  const aoTeclar = (evento: KeyboardEvent<HTMLInputElement>) => {
    if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
      evento.preventDefault();
      if (itens.length === 0) return;
      const passo = evento.key === "ArrowDown" ? 1 : -1;
      setAtivo((a) => (a + passo + itens.length) % itens.length);
    } else if (evento.key === "Enter") {
      evento.preventDefault();
      const r = itens[atual];
      if (r !== undefined) abrirResultado(r);
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
          <kbd className="hidden rounded border border-border px-1.5 text-muted-foreground text-xs sm:inline">Esc</kbd>
        </div>
        <span id={`${idLista}-dica`} className="sr-only">
          Use as setas para escolher um resultado e Enter para abrir. Esc fecha.
        </span>
        <p role="status" className="sr-only">
          {fase === "pronta" ? (total === 0 ? "Nenhum resultado" : `${total} resultados`) : ""}
        </p>
        <div id={idLista} role="listbox" aria-label="Resultados" className="min-h-0 overflow-y-auto p-2">
          {grupos.map((g) => {
            const idGrupo = `${idLista}-${g.tipo}`;
            return (
              <div key={g.tipo} role="group" aria-labelledby={idGrupo} className="mb-2">
                <p
                  id={idGrupo}
                  role="presentation"
                  className="px-2 pt-1 pb-1 font-semibold text-muted-foreground text-xs uppercase tracking-wide"
                >
                  {NOMES_TIPO[g.tipo].grupo}
                </p>
                {g.resultados.map((r) => {
                  const i = indice++;
                  return (
                    <div
                      key={`${r.link ?? r.reuniao}:${r.titulo}`}
                      id={idOpcao(i)}
                      role="option"
                      aria-selected={i === atual}
                      tabIndex={-1}
                      onMouseMove={() => setAtivo(i)}
                      onClick={() => abrirResultado(r)}
                      className={cn(
                        "cursor-pointer rounded-lg px-2 py-1.5 text-sm",
                        i === atual ? "bg-accent text-accent-foreground" : "",
                      )}
                    >
                      <span className="block truncate font-medium">{r.titulo}</span>
                      {r.detalhe ? (
                        <span className="block truncate text-muted-foreground text-xs">{r.detalhe}</span>
                      ) : null}
                      {r.trecho ? (
                        <span className="line-clamp-2 text-muted-foreground text-xs" data-conteudo>
                          {r.trecho}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {fase === "vazia" ? (
            <p className="px-2 py-3 text-muted-foreground text-sm">
              Digite o nome de um curso, campus ou norma, um curso do catálogo, um assunto dos PPCs ou uma citação
              (“LDB, art. 36”). A busca é na base do app, sem IA.
            </p>
          ) : fase === "pronta" && total === 0 ? (
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
