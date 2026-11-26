/**
 * A casca da rota `/revisao-ppc` (o roteamento por arquivo do TanStack): a tela é do módulo `revisao-ppc`
 * (`modulos/revisao-ppc/Tela.tsx`). Arquivo de composição.
 */
import { createFileRoute } from "@tanstack/react-router";
import { TelaRevisaoPpc, validarBusca } from "../modulos/revisao-ppc/Tela.tsx";

export const Route = createFileRoute("/revisao-ppc")({
  component: TelaRevisaoPpc,
  validateSearch: validarBusca,
});
