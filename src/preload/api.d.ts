import type { MyTermApi } from './index'

declare global {
  interface Window {
    myterm: MyTermApi
  }
}

export {}
