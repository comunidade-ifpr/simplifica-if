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
