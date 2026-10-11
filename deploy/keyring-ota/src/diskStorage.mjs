/**
 * Bundles on this server's own disk, under data/files/.
 *
 * A stored object is named `ota-disk://files/<key>`. The update check turns that
 * into `<OTA_PUBLIC_URL>/files/<key>` when it answers a phone, so the public
 * address (a tunnel in the spike) can change without touching stored rows.
 *
 * The host part is fixed: hot-updater treats a storage URI like s3://bucket/key
 * and derives related objects (a bundle's content-addressed assets) by path
 * arithmetic on the pathname only, so the key must live entirely in the path.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const PROTOCOL = 'ota-disk'

/** The file for a key, refusing anything that would leave the files directory. */
export const fileForKey = (filesDir, key) => {
  const root = path.resolve(filesDir)
  const file = path.resolve(root, key)
  if (!key || file === root || !file.startsWith(root + path.sep)) {
    throw new Error(`invalid storage key: ${key}`)
  }
  return file
}

export const HOST = 'files'

export const keyFromUri = (storageUri) => {
  const url = new URL(storageUri)
  if (url.protocol !== `${PROTOCOL}:` || url.host !== HOST) throw new Error(`not an ${PROTOCOL} URI: ${storageUri}`)
  return url.pathname.replace(/^\/+/, '').split('/').map(decodeURIComponent).join('/')
}

/**
 * The object key for an upload, as hot-updater's own storage plugins form it
 * (`createStorageKeyBuilder`): the CLI uploads several files under one key
 * (the bundle archive, its manifest), and each is stored at `<key>/<file name>`.
 */
export const objectKey = (key, filename) => {
  const name = path.basename(String(filename ?? ''))
  if (!key || !name || name === '.' || name === '..') throw new Error(`invalid upload: key ${key}, file ${filename}`)
  return `${String(key).replace(/^\/+|\/+$/g, '')}/${name}`
}

export const uriForKey = (key) => `${PROTOCOL}://${HOST}/${key.split('/').map(encodeURIComponent).join('/')}`

export const createDiskStore = ({ filesDir, publicUrl }) => ({
  async put(key, bytes) {
    const file = fileForKey(filesDir, key)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, bytes)
    return uriForKey(key)
  },
  async remove(storageUri) {
    await rm(fileForKey(filesDir, keyFromUri(storageUri)), { force: true })
  },
  async readText(storageUri) {
    try {
      return await readFile(fileForKey(filesDir, keyFromUri(storageUri)), 'utf8')
    } catch {
      return null
    }
  },
  downloadUrl(storageUri) {
    const key = keyFromUri(storageUri)
    return `${publicUrl()}/files/${key.split('/').map(encodeURIComponent).join('/')}`
  },
  file(key) {
    return fileForKey(filesDir, key)
  },
})

/** The runtime storage plugin hot-updater's server uses to answer update checks. */
export const diskStoragePlugin = (store) => () => ({
  name: 'keyringDiskStorage',
  supportedProtocol: PROTOCOL,
  profiles: {
    runtime: {
      getDownloadUrl: async (storageUri) => ({ fileUrl: store.downloadUrl(storageUri) }),
      readText: async (storageUri) => store.readText(storageUri),
    },
  },
})
