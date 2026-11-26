/**
 * The askar-shared patch, held in place by its behaviour (#654).
 *
 * askar-shared 0.6.0's `Scan.forEachRow` frees the scan but never the native entry list each `scanNext` returns, so
 * every Credo `findByQuery` (`new Scan(...).fetchAll()`) kept its decrypted rows in native memory for the life of the
 * app. The fix is a `patch:` resolution in the root `package.json`, which lives in `node_modules`, not here. A patch
 * nothing tests comes back silently when a dependency bump or a lockfile regeneration drops it, so this drives the
 * installed `Scan` against a fake native layer and counts what it frees.
 *
 * **What this does not cover:** no native askar runs here, and nothing is measured. These tests pin the frees the patch
 * exists to make. What freeing does to memory on a phone is measured separately (#654's description).
 *
 * Head for the patch, as of 2026-10-26 on `main` (bc92984a):
 *   .yarn/patches/@openwallet-foundation-askar-shared-npm-0.6.0-38cb7d527c.patch
 */
import { EntryListHandle, NativeAskar, Scan } from '@openwallet-foundation/askar-shared'
import type { Askar } from '@openwallet-foundation/askar-shared'

type FakeList = { rows: { name: string; value: string; tags: Record<string, string> }[] }

/**
 * A native layer that hands out one list per page and records every list and scan freed. `failReadingValue` makes
 * reading a row's value throw, as a native read can, inside the callback `fetchAll` gives `forEachRow`.
 */
function fakeNative(pages: FakeList[], options: { failReadingValue?: boolean } = {}) {
  const lists = new Map<string, FakeList>()
  const freed: string[] = []
  let scansFreed = 0
  let next = 0
  type At = { entryListHandle: { handle: string }; index: number }
  const entry = (o: At) => lists.get(o.entryListHandle.handle)!.rows[o.index]
  NativeAskar.register({
    scanStart: async () => ({ handle: 'scan-1' }),
    scanNext: async () => {
      if (next >= pages.length) return null
      const id = `list-${next}`
      lists.set(id, pages[next++])
      // As the React Native binding does: an EntryListHandle, whose free() calls entryListFree.
      return new EntryListHandle(id)
    },
    scanFree: () => {
      scansFreed++
    },
    entryListCount: (o: { entryListHandle: { handle: string } }) => lists.get(o.entryListHandle.handle)!.rows.length,
    entryListGetName: (o: At) => entry(o).name,
    entryListGetCategory: () => 'DidRecord',
    entryListGetValue: (o: At) => {
      if (options.failReadingValue) throw new Error('reading the value failed')
      return new TextEncoder().encode(entry(o).value)
    },
    entryListGetTags: (o: At) => JSON.stringify(entry(o).tags),
    entryListFree: (o: { entryListHandle: { handle: string } }) => {
      freed.push(o.entryListHandle.handle)
    },
  } as unknown as Askar)
  return { freed, scansFreed: () => scansFreed }
}

const row = (n: number) => ({ name: `did:peer:${n}`, value: JSON.stringify({ n }), tags: { recipientKey: `k${n}` } })
const scanOver = () => new Scan({ store: { handle: 'store-1' } as never, category: 'DidRecord' })

describe('askar-shared Scan frees the entry lists it reads (the #654 patch)', () => {
  it('fetchAll, as Credo findByQuery calls it: every row read, every list freed once, and the scan', async () => {
    const native = fakeNative([{ rows: [row(1), row(2)] }, { rows: [row(3)] }])
    const rows = await scanOver().fetchAll()
    expect(rows.map((r) => r.name)).toEqual(['did:peer:1', 'did:peer:2', 'did:peer:3'])
    expect(native.freed).toEqual(['list-0', 'list-1'])
    expect(native.scansFreed()).toBe(1)
  })

  // Through fetchAll too: forEachRow is private, and fetchAll is what Credo calls. A row that cannot be read throws
  // inside fetchAll's callback, which is the failure the patch's finally must survive.
  it('a row that cannot be read still frees the list it was in, and the scan', async () => {
    const native = fakeNative([{ rows: [row(1)] }, { rows: [row(2)] }], { failReadingValue: true })
    await expect(scanOver().fetchAll()).rejects.toThrow('reading the value failed')
    expect(native.freed).toEqual(['list-0'])
    expect(native.scansFreed()).toBe(1)
  })
})
