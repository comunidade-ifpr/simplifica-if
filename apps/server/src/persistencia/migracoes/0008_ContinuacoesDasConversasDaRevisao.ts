/**
 * Migração 8: a conversa ligada a uma revisão de PPC segue a cadeia de continuações com outra IA
 * (`docs/plans/multitarefa.md`, decisão 12). Só o módulo `revisao-ppc` muda, pela função dele: as linhas de
 * `revisao_ppc_conversas` passam à última da cadeia, e os gatilhos sobre `conversas` as levam daí em diante.
 */
import * as TabelasRevisaoPpc from "../../modulos/revisao-ppc/persistencia/tabelas.ts";

export default TabelasRevisaoPpc.seguirContinuacoesDasConversas;
