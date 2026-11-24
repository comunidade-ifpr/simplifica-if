/**
 * O tema da interface, num menu com as três escolhas nomeadas: automático (como o sistema), claro e
 * escuro. Um botão que só alternasse entre elas mostraria o estado sem dizer o que o próximo clique faz.
 */
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useState } from "react";
import { guardarPreferencia, lerPreferencia, type PreferenciaTema } from "../tema.ts";
import { Button } from "./ui/button.tsx";
import { Menu, MenuGroup, MenuGroupLabel, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./ui/menu.tsx";

const OPCOES: ReadonlyArray<{
  readonly valor: PreferenciaTema;
  readonly rotulo: string;
  readonly Icone: typeof SunIcon;
}> = [
  { valor: "sistema", rotulo: "Automático (como o sistema)", Icone: MonitorIcon },
  { valor: "claro", rotulo: "Claro", Icone: SunIcon },
  { valor: "escuro", rotulo: "Escuro", Icone: MoonIcon },
];

const ehPreferencia = (valor: unknown): valor is PreferenciaTema => OPCOES.some((opcao) => opcao.valor === valor);

export function SeletorTema() {
  const [preferencia, setPreferencia] = useState(lerPreferencia);
  const atual = OPCOES.find((opcao) => opcao.valor === preferencia) ?? OPCOES[0]!;
  const rotulo = `Tema: ${atual.rotulo.toLowerCase()}`;
  return (
    <Menu>
      <MenuTrigger render={<Button variant="ghost" size="icon-sm" />} aria-label={rotulo} title={rotulo}>
        <atual.Icone />
      </MenuTrigger>
      <MenuPopup sideOffset={6}>
        <MenuGroup>
          <MenuGroupLabel>Tema</MenuGroupLabel>
          <MenuRadioGroup
            value={preferencia}
            onValueChange={(valor: unknown) => {
              if (!ehPreferencia(valor)) return;
              guardarPreferencia(valor);
              setPreferencia(valor);
            }}
          >
            {OPCOES.map(({ valor, rotulo, Icone }) => (
              // Uma escolha só: o menu fecha ao escolher (no Base UI, o `RadioItem` fica aberto por padrão).
              <MenuRadioItem key={valor} value={valor} closeOnClick>
                <span className="flex items-center gap-2">
                  <Icone aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  {rotulo}
                </span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}
