import { vtcRestUrl } from '../module/vtiAgent'

describe('vtcRestUrl', () => {
  it('adds /v1 to an endpoint minted before vti #1615', () => {
    expect(vtcRestUrl('https://first.openvtc.net', 'trust-tasks')).toBe('https://first.openvtc.net/v1/trust-tasks')
    expect(vtcRestUrl('https://keyring-vti-vtc.ngrok.app/', '/trust-tasks')).toBe('https://keyring-vti-vtc.ngrok.app/v1/trust-tasks')
  })

  it('does not double the prefix on an endpoint that carries it', () => {
    expect(vtcRestUrl('https://vtc.example/v1', 'trust-tasks')).toBe('https://vtc.example/v1/trust-tasks')
    expect(vtcRestUrl('https://vtc.example/v1/', 'trust-tasks')).toBe('https://vtc.example/v1/trust-tasks')
  })

  it('keeps a path prefix the community serves under', () => {
    expect(vtcRestUrl('https://host.example/community/v1', 'trust-tasks')).toBe('https://host.example/community/v1/trust-tasks')
    expect(vtcRestUrl('https://host.example/community', 'trust-tasks')).toBe('https://host.example/community/v1/trust-tasks')
  })
})
