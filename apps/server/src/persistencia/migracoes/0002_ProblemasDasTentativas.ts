/**
 * Migração 2: a coluna `problemas` das tentativas da revisão de PPC com IA (o que a conferência recusou
 * em cada resposta), criada pela função do módulo. Arquivo de composição, como a migração 1.
 */
import * as TabelasRevisaoPpc from "../../modulos/revisao-ppc/persistencia/tabelas.ts";

export default TabelasRevisaoPpc.adicionarProblemasDasTentativas;
