/**
 * O estado da conexão com o servidor local, no cabeçalho: conectado, conectando, ou a próxima tentativa
 * com o motivo da queda (em termos da pessoa, M1.14) e "Tentar agora".
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

export function textoConexao(estado: EstadoConexao, segundos: number): string {
  switch (estado.fase) {
    case "conectada":
      return "Conectado";
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
  const cor =
    estado.fase === "conectada" ? "bg-success" : estado.fase === "conectando" ? "bg-warning" : "bg-destructive";
  return (
    <div className="flex items-center gap-2 text-sm" role="status" aria-live="polite" data-fase={estado.fase}>
      <span
        aria-hidden
        className={cn(
          "size-2.5 rounded-full ring-1 ring-white/70",
          cor,
          estado.fase === "conectando" && "motion-safe:animate-pulse",
        )}
      />
      <span title={estado.fase === "reconectando" ? mensagemFalha(estado.motivo) : undefined}>
        {textoConexao(estado, segundos)}
      </span>
      {estado.fase === "reconectando" ? (
        <Button size="xs" variant="outline" onClick={api.reconectarAgora}>
          Tentar agora
        </Button>
      ) : null}
    </div>
  );
}
