/**
 * Ferramenta 16, `etapa`: a skill informa ao app em que etapa da tarefa está. Até o Marco 1 não há
 * app que receba o aviso, e a ferramenta só confirma que não registrou nada; ela já existe no M0
 * para que as skills possam chamá-la desde o início.
 */
import { z } from "zod";
import { responder } from "../envelope.ts";
import { definirFerramenta } from "./ferramenta.ts";

const entrada = z.strictObject({
  id: z.string().min(1).max(200).describe("ID da etapa, como a skill o indica"),
  progresso: z
    .strictObject({
      feito: z.number().int().min(0).describe("itens concluídos"),
      total: z.number().int().min(1).describe("itens da etapa"),
    })
    .refine((p) => p.feito <= p.total, { message: "feito não pode passar de total" })
    .optional()
    .describe("quanto da etapa já foi feito"),
});

const dados = z.strictObject({
  /** `false` fora do app. */
  registrado: z.boolean(),
});

export const etapa = definirFerramenta({
  nome: "etapa",
  titulo: "Etapa da tarefa",
  descricao: "Informa ao app em que etapa da tarefa você está. Use só quando a skill pedir.",
  entrada,
  dados,
  executar(_entrada, { base }) {
    return responder(base, { registrado: false });
  },
  texto() {
    return "Etapa não registrada: não há app conectado a este servidor. Siga com a tarefa.";
  },
});
