import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';

export function isTrustedRendererUrl(actual: string, expected: string): boolean {
  try {
    const url = new URL(actual);
    const trusted = new URL(expected);
    url.hash = '';
    trusted.hash = '';
    return !url.username && !url.password && url.href === trusted.href;
  } catch {
    return false;
  }
}

export function guardIpc(
  ipc: Pick<IpcMain, 'handle'>,
  getWindow: () => BrowserWindow | null,
  rendererUrl: string
): Pick<IpcMain, 'handle'> {
  return {
    handle(channel, listener) {
      ipc.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
        const window = getWindow();
        if (!window || window.isDestroyed() || event.sender !== window.webContents ||
            !event.senderFrame || event.senderFrame !== window.webContents.mainFrame ||
            !isTrustedRendererUrl(event.senderFrame.url, rendererUrl)) {
          return { success: false, error: 'Unauthorized IPC sender' };
        }
        return listener(event, ...args);
      });
    },
  };
}

export function secureWindow(window: BrowserWindow, rendererUrl: string): void {
  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url, rendererUrl)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!isTrustedRendererUrl(url, rendererUrl)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  contents.session.setPermissionCheckHandler(() => false);
}
