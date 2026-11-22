/**
 * Unit tests for the open Trust Task registry (R5) — registration, lookup,
 * the orchestration hooks it carries, and the duplicate-registration guard.
 * `ceremony.registry.test.ts` covers dispatch through `setupTrustTasksInbound`
 * itself, including that this registry preserves the built-in VRC/witness
 * dispatch behaviour once it moves through the registry.
 */
import { TrustTaskRegistry } from '../registry'
import type { TrustTaskDocumentHandler } from '../registry'

const noopHandler: TrustTaskDocumentHandler = async () => undefined

describe('TrustTaskRegistry', () => {
  test('register then get returns the same registration', () => {
    const registry = new TrustTaskRegistry()
    const registration = {
      typeUri: 'https://example.test/spec/demo/0.1',
      spec: { typeUri: 'https://example.test/spec/demo/0.1', isBearer: false, isProofRequired: false, isRecipientRequired: true },
      handleRequest: noopHandler,
    }
    registry.register(registration)
    expect(registry.get('https://example.test/spec/demo/0.1')).toBe(registration)
  })

  test('registering the same typeUri twice throws', () => {
    const registry = new TrustTaskRegistry()
    const typeUri = 'https://example.test/spec/demo/0.1'
    registry.register({
      typeUri,
      spec: { typeUri, isBearer: false, isProofRequired: false, isRecipientRequired: true },
      handleRequest: noopHandler,
    })
    expect(() =>
      registry.register({
        typeUri,
        spec: { typeUri, isBearer: false, isProofRequired: false, isRecipientRequired: true },
        handleRequest: noopHandler,
      })
    ).toThrow(/already registered/)
  })

  test('resolveForDocumentType strips #response and reports isResponse', () => {
    const registry = new TrustTaskRegistry()
    const typeUri = 'https://example.test/spec/demo/0.1'
    const registration = {
      typeUri,
      spec: { typeUri, isBearer: false, isProofRequired: false, isRecipientRequired: true },
      handleRequest: noopHandler,
      handleResponse: noopHandler,
    }
    registry.register(registration)

    const request = registry.resolveForDocumentType(typeUri)
    expect(request).toEqual({ registration, isResponse: false })

    const response = registry.resolveForDocumentType(`${typeUri}#response`)
    expect(response).toEqual({ registration, isResponse: true })
  })

  test('resolveForDocumentType returns undefined for an unregistered type', () => {
    const registry = new TrustTaskRegistry()
    expect(registry.resolveForDocumentType('https://example.test/spec/unknown/0.1')).toBeUndefined()
  })

  test('a registration carries its orchestration hooks unchanged', () => {
    const registry = new TrustTaskRegistry()
    const isDeterministicProposer = (a: string, b: string) => a < b
    const typeUri = 'https://example.test/spec/demo/0.1'
    registry.register({
      typeUri,
      spec: { typeUri, isBearer: false, isProofRequired: false, isRecipientRequired: true },
      orchestration: { isDeterministicProposer, minRceVersion: 7, requiresDiscovery: false },
      handleRequest: noopHandler,
    })

    const orchestration = registry.get(typeUri)?.orchestration
    expect(orchestration?.minRceVersion).toBe(7)
    expect(orchestration?.requiresDiscovery).toBe(false)
    expect(orchestration?.isDeterministicProposer?.('a', 'b')).toBe(true)
  })

  test('unregister removes an entry; list/listTypeUris reflect current registrations', () => {
    const registry = new TrustTaskRegistry()
    const typeA = 'https://example.test/spec/a/0.1'
    const typeB = 'https://example.test/spec/b/0.1'
    registry.register({ typeUri: typeA, spec: { typeUri: typeA, isBearer: false, isProofRequired: false, isRecipientRequired: true }, handleRequest: noopHandler })
    registry.register({ typeUri: typeB, spec: { typeUri: typeB, isBearer: false, isProofRequired: false, isRecipientRequired: true }, handleRequest: noopHandler })

    expect(registry.listTypeUris().sort()).toEqual([typeA, typeB].sort())
    registry.unregister(typeA)
    expect(registry.list()).toHaveLength(1)
    expect(registry.get(typeA)).toBeUndefined()
  })

  test('clear empties the registry', () => {
    const registry = new TrustTaskRegistry()
    const typeUri = 'https://example.test/spec/demo/0.1'
    registry.register({ typeUri, spec: { typeUri, isBearer: false, isProofRequired: false, isRecipientRequired: true }, handleRequest: noopHandler })
    registry.clear()
    expect(registry.list()).toHaveLength(0)
  })
})
