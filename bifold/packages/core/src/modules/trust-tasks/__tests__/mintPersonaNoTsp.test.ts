import { VtaClient } from '../module/VtaClient'

// 227 gate, VTA Farm: a VTA adds `#tsp` to a persona by default when it and its
// mediator speak TSP (VTI vta-service did_webvh/document.rs:47-67), and a
// community then pushes to that persona over TSP first. Across two mediators
// those pushes (an invitation, a vetter grant) never reached the phone, and the
// community falls back to DIDComm only after an hour. So a persona is minted
// DIDComm-only: the mint says so explicitly, and an explicit `false` wins over
// the VTA's default (VTI document.rs, its own test at :1038).

describe('a persona is minted without a TSP service', () => {
  function client() {
    const vta = new VtaClient({} as never, 'did:webvh:agent', {} as never)
    const task = jest
      .spyOn(vta as unknown as { task: (...args: unknown[]) => Promise<unknown> }, 'task')
      .mockResolvedValue({ did: 'did:webvh:minted' })
    return { vta, task }
  }

  it('asks the VTA for no #tsp, with the mediator service and without becoming primary', async () => {
    const { vta, task } = client()
    await vta.mintPersona({ contextId: 'vta', serverId: 'control', label: 'keyring-x' })
    expect(task).toHaveBeenCalledTimes(1)
    const payload = task.mock.calls[0][1] as Record<string, unknown>
    expect(payload).toMatchObject({
      contextId: 'vta',
      serverId: 'control',
      label: 'keyring-x',
      addMediatorService: true,
      addTspService: false,
      setPrimary: false,
    })
  })

  it('says so for a serverless mint too', async () => {
    const { vta, task } = client()
    await vta.mintPersona({ contextId: 'vta', didUrl: 'https://agent.example/p/x' })
    const payload = task.mock.calls[0][1] as Record<string, unknown>
    expect(payload.addTspService).toBe(false)
    expect(payload.url).toBe('https://agent.example/p/x')
  })
})
