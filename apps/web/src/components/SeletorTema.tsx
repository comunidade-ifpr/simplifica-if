/**
 * Alterna o tema: sistema, claro e escuro, em ciclo.
 */
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useState } from "react";
import { guardarPreferencia, lerPreferencia, type PreferenciaTema } from "../tema.ts";
import { Button } from "./ui/button.tsx";

const PROXIMO: Readonly<Record<PreferenciaTema, PreferenciaTema>> = {
  sistema: "claro",
  claro: "escuro",
  escuro: "sistema",
};

const ROTULOS: Readonly<Record<PreferenciaTema, string>> = {
  sistema: "Tema do sistema",
  claro: "Tema claro",
  escuro: "Tema escuro",
};

export function SeletorTema() {
  const [preferencia, setPreferencia] = useState(lerPreferencia);
  const Icone = preferencia === "claro" ? SunIcon : preferencia === "escuro" ? MoonIcon : MonitorIcon;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="text-white [--control-icon-color:currentColor] hover:text-white [:hover,[data-pressed]]:bg-white/10"
      aria-label={`${ROTULOS[preferencia]}. Trocar para: ${ROTULOS[PROXIMO[preferencia]].toLowerCase()}`}
      title={ROTULOS[preferencia]}
      onClick={() => {
        const proxima = PROXIMO[preferencia];
        guardarPreferencia(proxima);
        setPreferencia(proxima);
      }}
    >
      <Icone />
    </Button>
  );
}
