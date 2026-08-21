// Preload runs sandboxed: only `electron`'s contextBridge and ipcRenderer are
// available here. No Node module may be imported (ARCHI § Sécurité).
// The typed API surface is defined in task 03; this is the bootstrap.
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('myterm', {})
