/**
 * "Configurações › Aparência": o tema da interface, entre automático (como o sistema), claro e escuro.
 * A escolha fica no navegador (`tema.ts`) e vale na hora; a feita em outra janela do desktop chega pelo
 * `storage`, e o seletor acompanha.
 */
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { type OpcaoSegmented, Segmented } from "../components/ui/segmented.tsx";
import { CHAVE_TEMA, guardarPreferencia, lerPreferencia, type PreferenciaTema } from "../tema.ts";

const OPCOES: ReadonlyArray<OpcaoSegmented<PreferenciaTema>> = [
  { valor: "sistema", rotulo: "Automático", icone: <MonitorIcon aria-hidden /> },
  { valor: "claro", rotulo: "Claro", icone: <SunIcon aria-hidden /> },
  { valor: "escuro", rotulo: "Escuro", icone: <MoonIcon aria-hidden /> },
];

export function Aparencia() {
  const [preferencia, setPreferencia] = useState(lerPreferencia);
  useEffect(() => {
    const aoGuardar = (evento: StorageEvent) => {
      if (evento.key === CHAVE_TEMA || evento.key === null) setPreferencia(lerPreferencia());
    };
    window.addEventListener("storage", aoGuardar);
    return () => window.removeEventListener("storage", aoGuardar);
  }, []);
  return (
    <div className="flex flex-col items-start gap-2">
      <Segmented
        rotuloAria="Tema"
        valor={preferencia}
        opcoes={OPCOES}
        aoMudar={(valor) => {
          guardarPreferencia(valor);
          setPreferencia(valor);
        }}
      />
      <p className="text-muted-foreground text-small">O automático acompanha o tema do sistema.</p>
    </div>
  );
}
