/**
 * Ferramenta 16, `etapa`: a skill informa ao app em que etapa da tarefa está. O app (M1.9) lê a
 * chamada nos eventos da conversa e mostra o indicador de etapas; o servidor do app responde
 * `registrado: true`. Fora do app (o executável stdio), a ferramenta só confirma que não registrou nada.
 */
import * as Schema from "effect/Schema";
import { inteiro, opcional, texto } from "../esquema.ts";
import { definirFerramenta } from "./ferramenta.ts";

// a descrição vem antes da checagem: anotada depois, ela ficaria na checagem e sumiria do JSON Schema
const Progresso = Schema.Struct({
  feito: inteiro({ minimo: 0 }).annotate({ description: "itens concluídos" }),
  total: inteiro({ minimo: 1 }).annotate({ description: "itens da etapa" }),
})
  .annotate({ description: "quanto da etapa já foi feito" })
  .check(Schema.makeFilter((p) => p.feito <= p.total || "feito não pode passar de total"));

export const Entrada = Schema.Struct({
  id: texto({ minimo: 1, maximo: 200 }, "ID da etapa, como a skill o indica"),
  progresso: opcional(Progresso),
});

export const Dados = Schema.Struct({
  /** `false` fora do app. */
  registrado: Schema.Boolean,
});

export const etapa = definirFerramenta({
  nome: "etapa",
  titulo: "Etapa da tarefa",
  descricao: "Informa ao app em que etapa da tarefa você está. Use só quando a skill pedir.",
  entrada: Entrada,
  dados: Dados,
  texto({ dados }) {
    return dados.registrado
      ? "Etapa registrada no app. Siga com a tarefa."
      : "Etapa não registrada: não há app conectado a este servidor. Siga com a tarefa.";
  },
});
