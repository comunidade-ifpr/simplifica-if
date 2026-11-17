/**
 * "Perguntar à IA sobre isto": leva ao Início com o pedido já escrito (o nome da página e o link
 * `ifpr://`, que a IA lê pelas ferramentas da base), sem enviar. A pessoa completa a pergunta, escolhe
 * a IA e envia pela caixa de sempre; o aviso de uso do primeiro uso continua valendo.
 */
import { useNavigate } from "@tanstack/react-router";
import { MessageSquareIcon } from "lucide-react";
import { Button } from "../components/ui/button.tsx";

export function PerguntarIa({ pedido }: { readonly pedido: string }) {
  const navegar = useNavigate();
  return (
    <Button size="sm" onClick={() => void navegar({ to: "/", search: { pedido } })}>
      <MessageSquareIcon /> Perguntar à IA sobre isto
    </Button>
  );
}
