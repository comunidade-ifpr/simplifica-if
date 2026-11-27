/**
 * O tema claro ou escuro: segue o sistema por padrão, ou a escolha da pessoa, guardada no navegador. A
 * classe `dark` no `<html>` liga as cores escuras (`index.css`); o `index.html` aplica o tema antes do
 * React montar, para não piscar. No desktop, a janela é avisada da escolha: o fundo dela e os botões do
 * sistema acompanham (`PonteDesktop.janela.temaDoApp`).
 */
import { ponteDesktop } from "./ponte-desktop.ts";

export type PreferenciaTema = "sistema" | "claro" | "escuro";

export const CHAVE_TEMA = "simplifica-if:tema";

const consultaEscuro = () => window.matchMedia("(prefers-color-scheme: dark)");

export function lerPreferencia(): PreferenciaTema {
  try {
    const valor = window.localStorage.getItem(CHAVE_TEMA);
    return valor === "claro" || valor === "escuro" ? valor : "sistema";
  } catch {
    return "sistema";
  }
}

export function temaEscuro(preferencia: PreferenciaTema, sistemaEscuro: boolean): boolean {
  return preferencia === "escuro" || (preferencia === "sistema" && sistemaEscuro);
}

export function aplicarTema(preferencia: PreferenciaTema): void {
  // Antes da classe: com a escolha "claro" ou "escuro", o desktop faz o `prefers-color-scheme` segui-la.
  void ponteDesktop()
    ?.janela.temaDoApp(preferencia)
    .catch(() => undefined);
  document.documentElement.classList.toggle("dark", temaEscuro(preferencia, consultaEscuro().matches));
}

export function guardarPreferencia(preferencia: PreferenciaTema): void {
  try {
    if (preferencia === "sistema") window.localStorage.removeItem(CHAVE_TEMA);
    else window.localStorage.setItem(CHAVE_TEMA, preferencia);
  } catch {
    // Sem armazenamento: a escolha vale até recarregar.
  }
  aplicarTema(preferencia);
}

/**
 * Acompanha o tema do sistema enquanto a preferência for "sistema", e a escolha feita em outra janela do app
 * (no desktop, com várias janelas: o `storage` avisa as outras da mesma origem).
 */
export function acompanharSistema(): () => void {
  const consulta = consultaEscuro();
  const aoMudar = () => aplicarTema(lerPreferencia());
  const aoGuardar = (evento: StorageEvent) => {
    if (evento.key === CHAVE_TEMA || evento.key === null) aoMudar();
  };
  consulta.addEventListener("change", aoMudar);
  window.addEventListener("storage", aoGuardar);
  return () => {
    consulta.removeEventListener("change", aoMudar);
    window.removeEventListener("storage", aoGuardar);
  };
}
