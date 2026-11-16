// Talks to the map engine worker: each call gets an id and a promise for its answer.
import { useCallback, useEffect, useRef } from 'react'
import type { EngineCall, EngineResponse } from '../worker/messages'

export type EngineFn = (req: EngineCall, onProgress?: (text: string) => void) => Promise<EngineResponse>

export function useEngine(): EngineFn {
  const worker = useRef<Worker | null>(null)
  const waiting = useRef(new Map<number, (r: EngineResponse) => void>())
  const listening = useRef(new Map<number, (text: string) => void>())
  const nextId = useRef(1)
  // Calls made before the worker starts wait here.
  const queue = useRef<{ id: number; req: EngineCall }[]>([])

  useEffect(() => {
    const w = new Worker(new URL('../worker/engine.worker.ts', import.meta.url), { type: 'module' })
    const pending = waiting.current
    const progress = listening.current
    w.onmessage = (e: MessageEvent<EngineResponse>) => {
      if (e.data.type === 'progress') {
        progress.get(e.data.id)?.(e.data.text)
        return
      }
      progress.delete(e.data.id)
      const done = pending.get(e.data.id)
      if (!done) return
      pending.delete(e.data.id)
      done(e.data)
    }
    w.onerror = () => {
      for (const [id, done] of pending) done({ id, type: 'error', message: 'The map engine stopped. Reload the page to start it again.' })
      pending.clear()
    }
    worker.current = w
    for (const q of queue.current) w.postMessage({ ...q.req, id: q.id })
    queue.current = []
    return () => {
      w.terminate()
      worker.current = null
      for (const [id, done] of pending) done({ id, type: 'cancelled' })
      pending.clear()
    }
  }, [])

  return useCallback((req: EngineCall, onProgress?: (text: string) => void) => {
    const id = nextId.current++
    if (onProgress) listening.current.set(id, onProgress)
    return new Promise<EngineResponse>((resolve) => {
      waiting.current.set(id, resolve)
      if (worker.current) worker.current.postMessage({ ...req, id })
      else queue.current.push({ id, req })
    })
  }, [])
}
