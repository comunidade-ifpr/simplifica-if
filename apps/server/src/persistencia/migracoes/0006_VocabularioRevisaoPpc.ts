/**
 * Migração 6: vocabulário unificado da revisão de PPC (`hibrido`/`focal`/`tematico`/`transversal` e
 * estados em minúsculas `atende`/`nao_atende`/`a_conferir`/`nao_se_aplica`) nos registros já gravados.
 * Arquivo de composição, como as migrações 1 a 5.
 */
import * as TabelasRevisaoPpc from "../../modulos/revisao-ppc/persistencia/tabelas.ts";

export default TabelasRevisaoPpc.migrarVocabularioRevisaoPpc;
