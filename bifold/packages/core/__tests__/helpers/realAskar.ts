/**
 * Loads askar-nodejs for a suite that runs a real Askar store. Import it first, in place of
 * `import '@openwallet-foundation/askar-nodejs'`. It looks like needless indirection, and it is not: without it the
 * second such suite in a jest worker fails to load, intermittently, and main goes red (it did, once).
 *
 * Why: jest gives every test file a fresh module registry, so askar-nodejs's build/ffi/structures.js runs again in
 * each file and calls `koffi.struct('ByteBuffer', …)` again; but koffi is a native addon, loaded once per worker
 * process, and refuses a second type of the same name ("Duplicate type name 'ByteBuffer'", koffi src/ffi.cc). So the
 * two functions askar-nodejs names its types with, `koffi.struct` and `koffi.proto`, return the type this process
 * already has under that name.
 *
 * That reuse is safe only when the type was defined by this same askar-nodejs, so it is proven, not assumed: the first
 * load in a process also registers a marker type named for this askar-nodejs (its real path and version), and a type
 * already defined is reused only when this askar-nodejs's marker is there. Otherwise another copy defined it, its
 * layout may differ, and this throws rather than hand a suite a wrong memory layout. A layout comparison cannot stand
 * in for the marker: koffi's introspection shows neither member types nor a prototype's signature.
 */
import { createHash } from 'crypto'
import { realpathSync } from 'fs'
import { dirname } from 'path'

type Make = ((...args: unknown[]) => unknown) & { [REUSES]?: true }
type Koffi = Record<'struct' | 'proto', Make> & { resolve: (name: string) => unknown }

const REUSES = Symbol.for('keyring.koffi.reusesNamedTypes')

const askarPackageJson = require.resolve('@openwallet-foundation/askar-nodejs/package.json')
const askarDir = dirname(askarPackageJson)
// eslint-disable-next-line @typescript-eslint/no-require-imports -- a version read at runtime
const askarSource = `${realpathSync(askarDir)}@${require(askarPackageJson).version}`
// The copy askar-nodejs loads, so the patch reaches the one whose types it defines.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- must run before askar-nodejs loads
const koffi: Koffi = require(require.resolve('koffi', { paths: [askarDir] }))

const defined = (name: string): boolean => {
  try {
    koffi.resolve(name)
    return true
  } catch {
    return false
  }
}

const marker = `keyring_askar_types_${createHash('sha256').update(askarSource).digest('hex').slice(0, 16)}`
const definedByThisAskar = defined(marker)

for (const make of ['struct', 'proto'] as const) {
  const original = koffi[make]
  if (original[REUSES]) continue
  koffi[make] = Object.assign(
    (...args: unknown[]) => {
      const [name] = args
      if (typeof name !== 'string' || !defined(name)) return original(...args)
      if (!definedByThisAskar) {
        throw new Error(
          `realAskar: koffi already has a type named '${name}' that ${askarSource} did not define. Another copy of ` +
            'askar-nodejs (or koffi) loaded in this jest worker; its layout may differ, so it is not reused. Fix the ' +
            'install so one askar-nodejs resolves (yarn why @openwallet-foundation/askar-nodejs). Do not remove this ' +
            "helper: without it the second real-Askar suite in a worker fails with koffi's 'Duplicate type name'."
        )
      }
      return koffi.resolve(name)
    },
    { [REUSES]: true as const }
  )
}
if (!definedByThisAskar) koffi.struct(marker, { unused: 'int' })

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the patch above, on purpose
require('@openwallet-foundation/askar-nodejs')
