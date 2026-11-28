/**
 * Migração 7: várias conversas ao lado por revisão de PPC, uma pasta por conversa (`docs/plans/multitarefa.md`,
 * decisão 12). Só o módulo `revisao-ppc` muda, pela função dele: a tabela `revisao_ppc_conversas`, com a
 * conversa que a lista guardava. Arquivo de composição, como as migrações 1 a 6.
 */
import * as TabelasRevisaoPpc from "../../modulos/revisao-ppc/persistencia/tabelas.ts";

export default TabelasRevisaoPpc.separarConversasDaRevisao;
