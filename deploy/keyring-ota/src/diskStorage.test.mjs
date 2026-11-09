import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { createDiskStore, diskStoragePlugin, fileForKey, keyFromUri, objectKey, uriForKey } from './diskStorage.mjs'

const tempStore = async (publicUrl = 'https://ota.example.org') => {
  const dir = await mkdtemp(path.join(tmpdir(), 'keyring-ota-'))
  return { dir, store: createDiskStore({ filesDir: dir, publicUrl: () => publicUrl }) }
}

test('a key round-trips through its URI', () => {
  const key = '0192f3a4-5b6c-7d8e-9f00-112233445566/bundle.zip'
  assert.equal(keyFromUri(uriForKey(key)), key)
})

test('keys cannot leave the files directory', () => {
  for (const key of ['../escape', 'a/../../escape', '', '/etc/passwd']) {
    assert.throws(() => fileForKey('/srv/files', key), /invalid storage key/)
  }
  assert.equal(fileForKey('/srv/files', 'a/b.zip'), path.resolve('/srv/files/a/b.zip'))
})

test('a stored bundle is served from the current public URL', async () => {
  let url = 'https://first.example.org'
  const dir = await mkdtemp(path.join(tmpdir(), 'keyring-ota-'))
  const store = createDiskStore({ filesDir: dir, publicUrl: () => url })
  const uri = await store.put('b1/bundle.zip', Buffer.from('zip'))
  assert.equal(store.downloadUrl(uri), 'https://first.example.org/files/b1/bundle.zip')
  url = 'https://second.example.org'
  assert.equal(store.downloadUrl(uri), 'https://second.example.org/files/b1/bundle.zip')
})

test('readText returns the file, or null once removed', async () => {
  const { store } = await tempStore()
  const uri = await store.put('b2/manifest.json', Buffer.from('{"a":1}'))
  assert.equal(await store.readText(uri), '{"a":1}')
  await store.remove(uri)
  assert.equal(await store.readText(uri), null)
})

test('the runtime plugin resolves only its own protocol', async () => {
  const { store } = await tempStore()
  const plugin = diskStoragePlugin(store)()
  assert.equal(plugin.supportedProtocol, 'ota-disk')
  const uri = await store.put('b3/bundle.zip', Buffer.from('zip'))
  assert.deepEqual(await plugin.profiles.runtime.getDownloadUrl(uri), {
    fileUrl: 'https://ota.example.org/files/b3/bundle.zip',
  })
  await assert.rejects(plugin.profiles.runtime.getDownloadUrl('s3://bucket/key'), /not an ota-disk URI/)
})

test('files uploaded under one key are stored side by side, not over each other', async () => {
  assert.equal(objectKey('bundles/b4', 'bundle.zip'), 'bundles/b4/bundle.zip')
  assert.equal(objectKey('bundles/b4/', 'manifest.json'), 'bundles/b4/manifest.json')
  assert.equal(objectKey('bundles/b4', '../../escape'), 'bundles/b4/escape')
  assert.throws(() => objectKey('', 'bundle.zip'), /invalid upload/)
  const { store } = await tempStore()
  const zip = await store.put(objectKey('bundles/b4', 'bundle.zip'), Buffer.from('zip'))
  const manifest = await store.put(objectKey('bundles/b4', 'manifest.json'), Buffer.from('{}'))
  assert.notEqual(zip, manifest)
  assert.equal(await store.readText(zip), 'zip')
})

test('a URI derived by path arithmetic, as hot-updater derives asset URIs, maps back to its key', () => {
  const bundle = new URL(uriForKey('bundles/b5/bundle.zip'))
  assert.equal(bundle.host, 'files')
  bundle.pathname = '/assets/sha256/58/585e.br'
  assert.equal(keyFromUri(bundle.toString()), 'assets/sha256/58/585e.br')
  assert.throws(() => keyFromUri('ota-disk://bundles/b5/bundle.zip'), /not an ota-disk URI/)
})
