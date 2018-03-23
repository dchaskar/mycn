import { PoolOptions } from "./exported-definitions"

export interface Closable {
  close(): Promise<void>
}

export interface Pool<C extends Closable> {
  readonly singleUse: C
  grab(): Promise<C>
  release(db: C)
  close(): Promise<void>
}

interface PoolItem<C extends Closable> {
  db: C
  releaseTime: number
}

export async function createPool<C extends Closable>(provider: () => Promise<C>, options: PoolOptions = {}): Promise<Pool<C>> {
  if (!options.logError)
    options.logError = console.log
  if (!options.connectionTtl)
    options.connectionTtl = 60
  let closed = false
  let singleUse = await provider()
  let available = [] as PoolItem<C>[]
  let cleaning: any | null = null

  return {
    get singleUse() {
      if (closed)
        throw new Error(`Cannot use the main connection, the pool is closed`)
      return singleUse
    },
    grab: async () => {
      if (closed)
        throw new Error(`Invalid call to "grab", the pool is closed`)
      let pi = available.pop()
      if (pi)
        return pi.db
      return provider()
    },
    release: (db: C) => {
      available.push({ db, releaseTime: Date.now() })
      if (closed)
        cleanOldConnections(true)
      else
        startCleaning()
    },
    close: async () => {
      if (closed)
        throw new Error(`Invalid call to "close", the pool is already closed`)
      closed = true
      await singleUse.close()
    }
  }

  function startCleaning() {
    if (cleaning !== null)
      return
    cleaning = setInterval(() => {
      cleanOldConnections()
      if (available.length === 0) {
        clearInterval(cleaning)
        cleaning = null
      }
    }, 20000) // 20 seconds
  }

  function cleanOldConnections(force = false) {
    let olderThanTime = Date.now() - 1000 * options.connectionTtl!
    let index: number
    for (index = 0; index < available.length; ++index) {
      if (!force && available[index].releaseTime > olderThanTime)
        break
      available[index].db.close().catch(options.logError)
    }
    if (index > 0)
      available = available.slice(index)
  }
}
