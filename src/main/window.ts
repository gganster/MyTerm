import { join } from 'node:path'
import { BrowserWindow, nativeTheme, screen, shell } from 'electron'
import { getPreferences, updatePreferences } from './services/preferences'
import type { WindowState } from '@shared/schema/preferences'

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

/**
 * Keeps a restored window on a display that currently exists.
 *
 * Saved coordinates can point at a monitor that has since been unplugged, which
 * would restore the window off-screen where the user cannot reach it.
 */
function visibleBounds(state: WindowState): Partial<Electron.Rectangle> {
  const size = { width: state.width, height: state.height }
  if (state.x === undefined || state.y === undefined) return size

  const onSomeDisplay = screen.getAllDisplays().some((display) => {
    const { x, y, width, height } = display.workArea
    return (
      state.x! >= x - 40 &&
      state.y! >= y - 40 &&
      state.x! < x + width &&
      state.y! < y + height
    )
  })

  return onSomeDisplay ? { ...size, x: state.x, y: state.y } : size
}

export function createWindow(): BrowserWindow {
  const preferences = getPreferences()

  const window = new BrowserWindow({
    ...visibleBounds(preferences.window),
    minWidth: 720,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    // Painted behind the renderer until first paint: avoids a white flash in
    // dark mode and a dark one in light mode.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181d' : '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  if (preferences.window.maximized) window.maximize()

  window.on('ready-to-show', () => window.show())
  window.on('closed', () => {
    mainWindow = null
  })

  // Persisting is debounced inside the preferences store, so dragging an edge
  // does not hammer the disk.
  const rememberGeometry = (): void => {
    if (window.isDestroyed()) return
    const maximized = window.isMaximized()
    // While maximized, getBounds() reports the maximized rectangle; keeping the
    // previous restored size means unmaximising returns where the user was.
    const bounds = maximized ? getPreferences().window : window.getBounds()
    updatePreferences({
      window: {
        width: bounds.width,
        height: bounds.height,
        ...(maximized ? {} : { x: window.getBounds().x, y: window.getBounds().y }),
        maximized,
      },
    })
  }

  window.on('resize', rememberGeometry)
  window.on('move', rememberGeometry)
  window.on('maximize', rememberGeometry)
  window.on('unmaximize', rememberGeometry)

  // The renderer only ever loads local content. Any navigation is a bug or an
  // attack; both are refused.
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow = window
  return window
}

export function focusMainWindow(): void {
  const window = getMainWindow()
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}
