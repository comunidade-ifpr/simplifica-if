/** O menu do app, em pt-BR (M1.14); no macOS, com o menu do app antes de Arquivo. */
import { Menu, type MenuItemConstructorOptions } from "electron";

export function menuAplicacao(opcoes: { readonly nome: string; readonly desenvolvimento: boolean }): Menu {
  const { nome, desenvolvimento } = opcoes;
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
      submenu: [mac ? { role: "close", label: "Fechar janela" } : { role: "quit", label: "Sair" }],
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
