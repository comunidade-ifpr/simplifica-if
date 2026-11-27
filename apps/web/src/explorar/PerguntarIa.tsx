/**
 * "Perguntar à IA sobre isto": leva a página à conversa ao lado (a aba Conversar do painel), sem sair da
 * tela: o documento vira ficha de contexto (o link `ifpr://`, que a IA lê pelas ferramentas da base), e a
 * caixa pode vir com o começo da pergunta. A pessoa completa, escolhe a IA e envia; o aviso de uso do
 * primeiro uso continua valendo.
 */
import { MessageSquareIcon } from "lucide-react";
import { Button } from "../components/ui/button.tsx";
import { useApp } from "../contexto.tsx";
import type { PedidoConversa } from "../painel/ControlePainel.ts";

export function PerguntarIa({ pedido }: { readonly pedido: () => PedidoConversa }) {
  const { painel } = useApp();
  return (
    <Button size="sm" onClick={() => painel.conversar(pedido())}>
      <MessageSquareIcon /> Perguntar à IA sobre isto
    </Button>
  );
}
