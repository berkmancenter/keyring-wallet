import { formatIssuedVrcLine, ISSUED_VRC_MARKER, logIssuedVrcJson, slimCredentialForLog } from '../vrc-credential-log'

const PEM = '-----BEGIN CERTIFICATE-----\n' + 'A'.repeat(800) + '\n-----END CERTIFICATE-----'

const vrc = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  type: ['VerifiableCredential', 'RelationshipCredential'],
  issuerScope: 'pairwise',
  evidence: [{ attestation: { format: 'android-key-attestation-v3', certificateChain: [PEM, PEM] } }],
  proof: { type: 'DataIntegrityProof', cryptosuite: 'eddsa-rdfc-2022', proofValue: 'z' + 'b'.repeat(600) },
}

describe('vrc-credential-log', () => {
  it('elides PEM chains and long strings but keeps structure', () => {
    const slim = slimCredentialForLog(vrc) as any
    expect(slim.evidence[0].attestation.certificateChain).toEqual([
      `<PEM #1: ${PEM.length} chars>`,
      `<PEM #2: ${PEM.length} chars>`,
    ])
    expect(slim.proof.proofValue).toBe('<omitted 601 chars>')
    expect(slim.proof.cryptosuite).toBe('eddsa-rdfc-2022')
    expect(slim.issuerScope).toBe('pairwise')
  })

  it('formats one single-line, parseable marker line without PEM material', () => {
    const line = formatIssuedVrcLine('ISSUER', 'ex-1', '-', vrc)
    expect(line.startsWith(`${ISSUED_VRC_MARKER} side=ISSUER exchange=ex-1 record=- {`)).toBe(true)
    expect(line).not.toContain('\n')
    expect(line).not.toContain('BEGIN CERTIFICATE')
    const parsed = JSON.parse(line.slice(line.indexOf('{')))
    expect(parsed.type).toContain('RelationshipCredential')
  })

  it('logs via console.log, ignores non-objects and never throws', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    logIssuedVrcJson('RECEIVER', 'ex-2', 'rec-1', vrc)
    logIssuedVrcJson('RECEIVER', 'ex-2', 'rec-1', null)
    const circular: any = {}
    circular.self = circular
    expect(() => logIssuedVrcJson('RECEIVER', 'ex-2', 'rec-1', circular)).not.toThrow()
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})
