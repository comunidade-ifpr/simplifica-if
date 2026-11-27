/**
 * O menu do app, em pt-BR (M1.14); no macOS, com o menu do app antes de Arquivo. O menu Arquivo traz "Abrir
 * em nova janela" (⇧⌘N, Ctrl+Shift+N: a tela da janela em foco numa janela nova). O menu Ver traz os
 * atalhos da interface (Buscar na base, ⌘K; Mostrar ou esconder o painel, ⌘\; Perguntar à IA, ⌘J), que a
 * própria interface atende no teclado. No Windows e no Linux, o menu só os mostra (`registerAccelerator:
 * false`). No macOS, essa opção não vale: a tecla vai primeiro à página e só chega ao menu se a página não
 * a tratou (`preventDefault`). Escolhidos no menu, ou com a tecla que a página deixou passar, vão à janela por
 * `aoAtalho`, que os manda à janela em foco; a interface não repete o atalho (a paleta aberta fica como está).
 */
import type { AtalhoMenu } from "@simplifica-if/contratos-app/ponte";
import { Menu, type MenuItemConstructorOptions } from "electron";

export function menuAplicacao(opcoes: {
  readonly nome: string;
  readonly desenvolvimento: boolean;
  readonly aoAtalho: (atalho: AtalhoMenu) => void;
}): Menu {
  const { nome, desenvolvimento, aoAtalho } = opcoes;
  const mac = process.platform === "darwin";
  const modelo: Array<MenuItemConstructorOptions> = [
    ...(mac
      ? [
          {
            label: nome,
            submenu: [
              { role: "about", label: `Sobre o ${nome}` },
              { type: "separator" },
              { role: "hide", label: `Ocultar o ${nome}` },
              { role: "hideOthers", label: "Ocultar os outros" },
              { role: "unhide", label: "Mostrar tudo" },
              { type: "separator" },
              { role: "quit", label: `Sair do ${nome}` },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: "Arquivo",
      submenu: [
        {
          label: "Abrir em nova janela",
          accelerator: "CommandOrControl+Shift+N",
          registerAccelerator: false,
          click: () => aoAtalho("novaJanela"),
        },
        { type: "separator" },
        mac ? { role: "close", label: "Fechar janela" } : { role: "quit", label: "Sair" },
      ],
    },
    {
      label: "Editar",
      submenu: [
        { role: "undo", label: "Desfazer" },
        { role: "redo", label: "Refazer" },
        { type: "separator" },
        { role: "cut", label: "Recortar" },
        { role: "copy", label: "Copiar" },
        { role: "paste", label: "Colar" },
        { role: "selectAll", label: "Selecionar tudo" },
      ],
    },
    {
      label: "Ver",
      submenu: [
        {
          label: "Buscar na base",
          accelerator: "CommandOrControl+K",
          registerAccelerator: false,
          click: () => aoAtalho("buscar"),
        },
        {
          label: "Mostrar ou esconder o painel",
          accelerator: "CommandOrControl+\\",
          registerAccelerator: false,
          click: () => aoAtalho("painel"),
        },
        {
          label: "Perguntar à IA",
          accelerator: "CommandOrControl+J",
          registerAccelerator: false,
          click: () => aoAtalho("conversar"),
        },
        { type: "separator" },
        { role: "reload", label: "Recarregar" },
        ...(desenvolvimento
          ? [{ role: "toggleDevTools", label: "Ferramentas do desenvolvedor" } satisfies MenuItemConstructorOptions]
          : []),
        { type: "separator" },
        { role: "resetZoom", label: "Tamanho real" },
        { role: "zoomIn", label: "Aumentar" },
        { role: "zoomOut", label: "Diminuir" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Tela cheia" },
      ],
    },
    {
      label: "Janela",
      role: "window",
      submenu: [
        { role: "minimize", label: "Minimizar" },
        { role: "zoom", label: "Zoom" },
      ],
    },
  ];
  return Menu.buildFromTemplate(modelo);
}
