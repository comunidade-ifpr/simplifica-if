/**
 * Os textos da seção "Atualizações" a partir do estado do servidor e do desktop (M1.10), separados
 * dos componentes para o teste de unidade.
 */
import type { EstadoAtualizacao, NovidadeBase } from "@simplifica-if/contratos-app";

/** `2026.11.20` → `20/11/2026`; outra forma passa como veio. */
export function versaoComoData(versao: string): string {
  const partes = /^(\d{4})\.(\d{2})\.(\d{2})(?:\.(\d+))?$/.exec(versao);
  if (partes === null) return versao;
  return `${partes[3]}/${partes[2]}/${partes[1]}${partes[4] === undefined ? "" : ` (${partes[4]}ª do dia)`}`;
}

/** A frase sobre a base em uso: "Base de 20/11/2026, commit abc1234, baixada pela atualização". */
export function descreverBase(estado: EstadoAtualizacao): string {
  const origem = {
    empacotada: "a que veio com o app",
    baixada: "baixada pela atualização",
    externa: "indicada por SIMPLIFICA_KB",
  }[estado.base.origem];
  const commit = estado.base.commit === null ? "" : `, commit ${estado.base.commit}`;
  return `Base de ${versaoComoData(estado.base.versao)}${commit} (${origem}).`;
}

/** A frase da situação da atualização da base e das skills. */
export function descreverSituacao(estado: EstadoAtualizacao): string {
  if (estado.desligada !== null) return `Atualização da base desligada: ${estado.desligada}.`;
  switch (estado.situacao) {
    case "conferindo":
      return "Procurando atualizações…";
    case "baixando":
      return "Baixando a atualização…";
    case "erro":
      return `A última procura falhou: ${estado.erro ?? "erro desconhecido"}. A base em uso continua a mesma.`;
    case "pronta": {
      const partes = [
        estado.pendente === null ? null : `a base de ${versaoComoData(estado.pendente)}`,
        estado.skillsPendentes === null ? null : "skills novas",
      ].filter((parte) => parte !== null);
      return `Pronta para usar: ${partes.join(" e ")}. Entra quando o app reiniciar o servidor.`;
    }
    default:
      return estado.ultimaConferencia === null
        ? "Ainda não procurou atualizações."
        : `Em dia. Última procura: ${new Date(estado.ultimaConferencia).toLocaleString("pt-BR")}.`;
  }
}

const ROTULOS_NOVIDADE: Record<string, string> = {
  "norma-nova": "Norma nova",
  "norma-retirada": "Norma retirada",
  revogacao: "Revogação",
  vigencia: "Vigência",
  "ppc-novo": "PPC novo",
  "ppc-atualizado": "PPC atualizado",
  "ppc-retirado": "PPC retirado",
  "curso-novo": "Curso novo",
  "curso-retirado": "Curso retirado",
};

export const rotuloNovidade = (novidade: NovidadeBase) => ROTULOS_NOVIDADE[novidade.tipo] ?? "Novidade";

/** Prazo sem um manifesto novo a partir do qual a tela avisa que não confirmou a base. */
export const DIAS_SEM_CONFIRMACAO = 14;

/**
 * O aviso quando o manifesto conferido por último foi gerado há mais de 14 dias: a fábrica publica
 * a cada poucos dias, e um manifesto velho pode ser rede parada ou um feed que não muda mais.
 */
export function avisoSemConfirmacao(estado: EstadoAtualizacao, agora: number): string | null {
  if (estado.desligada !== null || estado.manifestoGeradoEm === null) return null;
  const dias = (agora - Date.parse(estado.manifestoGeradoEm)) / (24 * 60 * 60 * 1000);
  if (!(dias > DIAS_SEM_CONFIRMACAO)) return null;
  return `Não foi possível confirmar que a base está atualizada: o último manifesto do canal é de ${new Date(estado.manifestoGeradoEm).toLocaleDateString("pt-BR")}. Confira a conexão ou avise a equipe do Simplifica IF.`;
}

/** O texto da confirmação de "Voltar": qual versão volta, qual sai, e que o servidor reinicia. */
export function textoConfirmarVolta(estado: EstadoAtualizacao): string | null {
  if (estado.anterior === null) return null;
  return `A base volta de ${versaoComoData(estado.base.versao)} para ${versaoComoData(estado.anterior)}, e o servidor local reinicia (uma análise em andamento adia a troca para a próxima abertura). A versão de ${versaoComoData(estado.base.versao)} não será baixada de novo; só uma mais nova.`;
}
