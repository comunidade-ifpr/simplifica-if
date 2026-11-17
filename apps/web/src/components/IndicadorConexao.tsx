/**
 * O estado da conexão com o servidor local, no cabeçalho, só quando foge do normal: conectando, ou a
 * próxima tentativa com o motivo da queda (em termos da pessoa, M1.14) e "Tentar agora". Conectado, não
 * mostra nada; a região `status` fica na página, vazia, para o leitor de tela anunciar a queda.
 */
import { useEffect, useState } from "react";
import { mensagemFalha } from "../conexao/ingresso.ts";
import type { EstadoConexao } from "../conexao/Conexao.ts";
import { useApi, useEstadoConexao } from "../contexto.tsx";
import { cn } from "../lib/utils.ts";
import { Button } from "./ui/button.tsx";

/** Os segundos que faltam até `instante`, atualizados a cada segundo. */
function useSegundosAte(instante: number | undefined): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (instante === undefined) return;
    const relogio = window.setInterval(() => setAgora(Date.now()), 1000);
    return () => window.clearInterval(relogio);
  }, [instante]);
  return instante === undefined ? 0 : Math.max(0, Math.ceil((instante - agora) / 1000));
}

type ForaDoNormal = Exclude<EstadoConexao, { readonly fase: "conectada" }>;

function textoConexao(estado: ForaDoNormal, segundos: number): string {
  switch (estado.fase) {
    case "conectando":
      return estado.tentativa === 0 ? "Conectando…" : "Reconectando…";
    case "reconectando":
      return segundos > 0 ? `Sem conexão. Nova tentativa em ${segundos} s` : "Sem conexão. Tentando de novo…";
    case "sem-servidor":
      return "Sem conexão";
  }
}

export function IndicadorConexao() {
  const estado = useEstadoConexao();
  const api = useApi();
  const segundos = useSegundosAte(estado.fase === "reconectando" ? estado.proximaEm : undefined);
  return (
    <div className="ml-auto shrink-0 lg:min-w-0 lg:shrink" role="status" aria-live="polite" data-fase={estado.fase}>
      {estado.fase === "conectada" ? null : (
        <div
          className="flex min-w-0 items-center gap-2 rounded-full bg-black/25 px-3 py-1 text-sm text-white"
          title={textoConexao(estado, segundos)}
        >
          <span
            aria-hidden
            className={cn(
              "size-2.5 shrink-0 rounded-full ring-1 ring-white/70",
              estado.fase === "conectando" ? "bg-warning motion-safe:animate-pulse" : "bg-destructive",
            )}
          />
          {/* Em janela estreita o cabeçalho não tem lugar para a frase: fica a bolinha, com a frase na dica e
              no leitor de tela, e o "Tentar agora" inteiro. */}
          <span
            className="sr-only lg:not-sr-only lg:truncate"
            title={estado.fase === "reconectando" ? mensagemFalha(estado.motivo) : undefined}
          >
            {textoConexao(estado, segundos)}
          </span>
          {estado.fase === "reconectando" ? (
            <Button size="xs" variant="outline" className="shrink-0" onClick={api.reconectarAgora}>
              Tentar agora
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
