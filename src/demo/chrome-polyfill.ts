/**
 * Minimal Chrome API polyfill for running StyleSnap core on the web.
 * Makes chrome.storage.local use an in-memory Map, runtime calls become noops.
 * Must be imported before any module that references `chrome.*`.
 */
const storage = new Map<string, any>()

if (typeof window !== 'undefined' && !(window as any).chrome) {
  (window as any).chrome = {
    runtime: {
      id: 'demo',
      lastError: undefined,
      sendMessage(..._args: any[]): Promise<void> {
        const cb = typeof _args[_args.length - 1] === 'function' ? _args.pop() : undefined
        if (cb) setTimeout(() => cb(), 0)
        return Promise.resolve()
      },
      onMessage: { addListener: () => {}, removeListener: () => {} },
      getManifest: () => ({ version: 'demo' }),
    },
    storage: {
      local: {
        get(keys: string | string[] | Record<string, any>, callback?: Function) {
          const result: Record<string, any> = {}
          const list = Array.isArray(keys) ? keys : typeof keys === 'object' ? Object.keys(keys) : [keys]
          for (const k of list) result[k] = storage.get(k)
          if (callback) callback(result)
          return Promise.resolve(result)
        },
        set(items: Record<string, any>, callback?: Function) {
          for (const [k, v] of Object.entries(items)) storage.set(k, v)
          if (callback) callback()
          return Promise.resolve()
        },
        remove(keys: string | string[], callback?: Function) {
          for (const k of (Array.isArray(keys) ? keys : [keys])) storage.delete(k)
          if (callback) callback()
          return Promise.resolve()
        },
        getBytesInUse(_keys: any, callback?: Function) {
          if (callback) callback(0)
          return Promise.resolve(0)
        },
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  }
}
