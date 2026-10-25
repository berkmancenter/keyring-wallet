/**
 * Guards the @scure/base patch (.yarn/patches/@scure-base-npm-2.4.0-*.patch).
 *
 * In the React Native release bundle core-js installs a
 * String.prototype.isWellFormed that throws "undefined is not a function" under
 * Hermes. Stock @scure/base picks `str.isWellFormed()` whenever that method
 * exists, so every utf8.decode threw and credo's first agent start failed —
 * TestFlight 0.2.0 (204) could not get past onboarding (2026-09-21). The patch
 * always uses scure's encodeURI-based shim. If an upgrade drops it, this fails
 * before a device does.
 */
describe('@scure/base utf8 with a broken String.prototype.isWellFormed', () => {
  const descriptor = Object.getOwnPropertyDescriptor(String.prototype, 'isWellFormed')

  afterEach(() => {
    if (descriptor) {
      Object.defineProperty(String.prototype, 'isWellFormed', descriptor)
    } else {
      delete (String.prototype as { isWellFormed?: unknown }).isWellFormed
    }
  })

  it('still encodes and decodes UTF-8', () => {
    Object.defineProperty(String.prototype, 'isWellFormed', {
      configurable: true,
      writable: true,
      value: () => {
        throw new TypeError('undefined is not a function')
      },
    })

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires -- a fresh module instance must see the broken method at init
      const { utf8 } = require('@scure/base')
      expect(Array.from(utf8.decode('abc'))).toEqual([97, 98, 99])
      expect(utf8.encode(new Uint8Array([0xe2, 0x82, 0xac]))).toBe('€')
      // Still strict: a lone surrogate is rejected by the shim.
      expect(() => utf8.decode('\ud800')).toThrow()
    })
  })
})
