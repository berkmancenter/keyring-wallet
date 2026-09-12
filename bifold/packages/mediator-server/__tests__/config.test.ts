import { DEFAULT_LABEL, DEFAULT_PORT, DEFAULT_WALLET_ID, resolveConfig, walletFilePath } from '../src/config'

const withUrl = (env: NodeJS.ProcessEnv = {}) => ({ MEDIATOR_PUBLIC_URL: 'https://example.trycloudflare.com', ...env })

describe('resolveConfig', () => {
  it('defaults everything but the public URL', () => {
    const config = resolveConfig(withUrl())

    expect(config.port).toBe(DEFAULT_PORT)
    expect(config.label).toBe(DEFAULT_LABEL)
    expect(config.walletId).toBe(DEFAULT_WALLET_ID)
    expect(config.walletKey).toBe(`${DEFAULT_WALLET_ID}-key`)
    expect(config.invitationPath).toBeUndefined()
    expect(config.verbose).toBe(false)
  })

  it('rejects a missing public URL, naming the command that supplies it', () => {
    expect(() => resolveConfig({})).toThrow(/MEDIATOR_PUBLIC_URL is required/)
    expect(() => resolveConfig({})).toThrow(/yarn mediator/)
  })

  it('rejects a public URL with no scheme, which would otherwise mint an unreachable invitation', () => {
    expect(() => resolveConfig({ MEDIATOR_PUBLIC_URL: 'example.trycloudflare.com' })).toThrow(/must start with http/)
  })

  it('strips trailing slashes so the invitation URL has one separator, not two', () => {
    expect(resolveConfig({ MEDIATOR_PUBLIC_URL: 'https://example.com//' }).publicUrl).toBe('https://example.com')
  })

  it.each(['0', '65536', 'not-a-port', '3010.5'])('rejects the invalid port %s', (port) => {
    expect(() => resolveConfig(withUrl({ MEDIATOR_PORT: port }))).toThrow(/MEDIATOR_PORT must be an integer/)
  })

  it('honours an explicit port, label, wallet and invitation path', () => {
    const config = resolveConfig(
      withUrl({
        MEDIATOR_PORT: '4001',
        MEDIATOR_LABEL: 'Demo Mediator',
        MEDIATOR_WALLET_ID: 'demo',
        MEDIATOR_WALLET_KEY: 'demo-key',
        MEDIATOR_WALLET_PATH: '/tmp/demo-wallet',
        MEDIATOR_INVITATION_PATH: '/tmp/demo-wallet/invitation.txt',
        MEDIATOR_VERBOSE: 'true',
      })
    )

    expect(config).toMatchObject({
      port: 4001,
      label: 'Demo Mediator',
      walletId: 'demo',
      walletKey: 'demo-key',
      storagePath: '/tmp/demo-wallet',
      invitationPath: '/tmp/demo-wallet/invitation.txt',
      verbose: true,
    })
  })

  it('derives the wallet key from the wallet id when only the id is set', () => {
    expect(resolveConfig(withUrl({ MEDIATOR_WALLET_ID: 'demo' })).walletKey).toBe('demo-key')
  })

  it('treats blank overrides as absent rather than as empty values', () => {
    const config = resolveConfig(withUrl({ MEDIATOR_LABEL: '   ', MEDIATOR_WALLET_ID: '' }))

    expect(config.label).toBe(DEFAULT_LABEL)
    expect(config.walletId).toBe(DEFAULT_WALLET_ID)
  })
})

describe('walletFilePath', () => {
  it('names the sqlite file after the wallet id, inside the storage path', () => {
    const config = resolveConfig(withUrl({ MEDIATOR_WALLET_PATH: '/tmp/w', MEDIATOR_WALLET_ID: 'demo' }))

    expect(walletFilePath(config)).toBe('/tmp/w/demo.db')
  })
})
