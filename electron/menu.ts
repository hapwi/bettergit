import { BrowserWindow, Menu } from "electron";

export function setupApplicationMenu(): void {
  const sendToRenderer = (channel: string) => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused) focused.webContents.send(channel);
  };

  const template: Electron.MenuItemConstructorOptions[] = [
    { role: "appMenu" },
    {
      label: "File",
      submenu: [
        {
          label: "New Terminal Tab",
          accelerator: "CmdOrCtrl+T",
          click: () => sendToRenderer("terminal:new-tab"),
        },
        {
          label: "Split Pane Right",
          accelerator: "CmdOrCtrl+D",
          click: () => sendToRenderer("terminal:split-vertical"),
        },
        {
          label: "Split Pane Down",
          accelerator: "CmdOrCtrl+Shift+D",
          click: () => sendToRenderer("terminal:split-horizontal"),
        },
        { type: "separator" },
        {
          label: "Close",
          accelerator: "CmdOrCtrl+W",
          click: () => sendToRenderer("app:close-pane-or-window"),
        },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
