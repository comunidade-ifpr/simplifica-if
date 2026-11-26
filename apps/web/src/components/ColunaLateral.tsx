/**
 * A coluna de um painel ao lado (o de leitura), com a largura ajustável: a alça na borda esquerda arrasta
 * (ou, com o foco nela, as setas), e o duplo clique volta à largura padrão. A largura escolhida fica
 * guardada no navegador e vale para todas as telas que usam a mesma `chave`; sem escolha, vale a classe
 * da largura padrão. A coluna nunca passa de 75% da janela nem fica mais estreita que 20rem.
 */
import { type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from "react";
import { cn } from "../lib/utils.ts";

const MINIMA = 320;
const FRACAO_MAXIMA = 0.75;
const PASSO_TECLADO = 32;

/** A largura dentro dos limites, para uma janela de `janela` pixels. */
export function limitarLargura(largura: number, janela: number): number {
  return Math.round(Math.min(Math.max(largura, MINIMA), Math.max(MINIMA, janela * FRACAO_MAXIMA)));
}

function lerLargura(chave: string): number | undefined {
  try {
    const valor = Number(window.localStorage.getItem(chave));
    return Number.isFinite(valor) && valor > 0 ? valor : undefined;
  } catch {
    return undefined;
  }
}

function guardarLargura(chave: string, largura: number | undefined): void {
  try {
    if (largura === undefined) window.localStorage.removeItem(chave);
    else window.localStorage.setItem(chave, String(largura));
  } catch {
    // Sem armazenamento: a largura vale até recarregar.
  }
}

export function ColunaLateral({
  chave,
  classePadrao,
  rotulo,
  children,
}: {
  /** Onde a largura fica guardada no navegador. */
  readonly chave: string;
  /** A largura antes de a pessoa escolher uma (classe do Tailwind). */
  readonly classePadrao: string;
  /** O nome da alça para o leitor de tela. */
  readonly rotulo: string;
  readonly children: ReactNode;
}) {
  const [largura, setLargura] = useState(() => lerLargura(chave));
  const coluna = useRef<HTMLDivElement>(null);
  const arrasto = useRef<{ x: number; largura: number } | undefined>(undefined);
  // A última largura do arrasto, para guardá-la ao soltar sem esperar o React redesenhar.
  const ultima = useRef(largura);

  const atual = () => coluna.current?.getBoundingClientRect().width ?? MINIMA;
  const definir = (nova: number | undefined, guardar: boolean) => {
    const limitada = nova === undefined ? undefined : limitarLargura(nova, window.innerWidth);
    ultima.current = limitada;
    setLargura(limitada);
    if (guardar) guardarLargura(chave, limitada);
  };

  const aoApertar = (evento: PointerEvent<HTMLDivElement>) => {
    if (evento.button !== 0) return;
    // Sem a seleção de texto que o arrasto faria; o foco, que o `preventDefault` tira, vem à mão (as setas).
    evento.preventDefault();
    evento.currentTarget.focus();
    evento.currentTarget.setPointerCapture(evento.pointerId);
    arrasto.current = { x: evento.clientX, largura: atual() };
  };
  // A alça fica à esquerda da coluna: arrastar para a esquerda alarga.
  const aoMover = (evento: PointerEvent<HTMLDivElement>) => {
    const inicio = arrasto.current;
    if (inicio !== undefined) definir(inicio.largura + inicio.x - evento.clientX, false);
  };
  const aoSoltar = (evento: PointerEvent<HTMLDivElement>) => {
    if (arrasto.current === undefined) return;
    arrasto.current = undefined;
    evento.currentTarget.releasePointerCapture(evento.pointerId);
    guardarLargura(chave, ultima.current);
  };
  const teclado = (evento: KeyboardEvent<HTMLDivElement>) => {
    const passo = { ArrowLeft: PASSO_TECLADO, ArrowRight: -PASSO_TECLADO }[evento.key];
    if (passo !== undefined) {
      evento.preventDefault();
      definir(atual() + passo, true);
    } else if (evento.key === "Home") {
      evento.preventDefault();
      definir(undefined, true);
    }
  };

  return (
    <div
      ref={coluna}
      className={cn("relative h-full shrink-0 max-w-[75vw] min-w-80", largura === undefined && classePadrao)}
      style={largura === undefined ? undefined : { width: largura }}
    >
      {/* A faixa de pegar é mais larga que a borda que se vê; fica por cima da borda do painel. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={rotulo}
        aria-valuenow={largura}
        aria-valuemin={MINIMA}
        tabIndex={0}
        title="Arraste para ajustar a largura (duplo clique volta à padrão)"
        className="nao-imprimir group absolute inset-y-0 -left-1.5 z-10 flex w-3 cursor-col-resize justify-center outline-none"
        onPointerDown={aoApertar}
        onPointerMove={aoMover}
        onPointerUp={aoSoltar}
        onPointerCancel={aoSoltar}
        onDoubleClick={() => definir(undefined, true)}
        onKeyDown={teclado}
      >
        <span className="h-full w-0.5 bg-transparent transition-colors group-hover:bg-ring group-focus-visible:bg-ring group-active:bg-ring" />
      </div>
      {children}
    </div>
  );
}

/** A largura do painel de leitura, a mesma na conversa e na revisão de PPC. */
export const CHAVE_LARGURA_LEITURA = "simplifica-if:largura-leitura";
