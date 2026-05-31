// Orders V2 Batch 28 — IndexedDB mirror for dealer in-flight edits.
//
// Per-order draft map: order_id -> { drafts: Record<itemId, DraftEntry>,
// syncedAt?: ISO }. Survives page reload, network drop, browser
// close. Server is authoritative — on mount the page reads the
// server payload and writes it back into IDB; subsequent local
// changes write to IDB first (so a power-off can't lose them)
// and debounce-sync to the server.

export interface DraftEntry {
  brand_cosh_id?: string | null
  brand_name?: string | null
  given_volume?: number | null
  volume_unit?: string | null
  price?: number | null
}

const DB_NAME = 'rt_dealer_drafts'
const DB_VERSION = 1
const STORE = 'drafts'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function readDraftMap(orderId: string): Promise<Record<string, DraftEntry>> {
  if (typeof indexedDB === 'undefined') return {}
  try {
    const db = await openDB()
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(orderId)
      req.onsuccess = () => resolve((req.result as Record<string, DraftEntry>) || {})
      req.onerror = () => resolve({})
    })
  } catch {
    return {}
  }
}

export async function writeDraftMap(orderId: string, map: Record<string, DraftEntry>): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  try {
    const db = await openDB()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(map, orderId)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch {
    // swallow — IDB is a best-effort mirror, server is authoritative
  }
}

export async function clearDraftForOrder(orderId: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  try {
    const db = await openDB()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(orderId)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch {}
}
