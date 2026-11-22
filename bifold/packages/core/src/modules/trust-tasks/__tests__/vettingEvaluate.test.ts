import {
  addIsoDuration,
  evaluateStatements,
  expiryUnder,
  parseIsoDuration,
  statementFacts,
  type StatementFacts,
  type VettingRequirements,
} from '@bifold/trust-tasks'

// The knobs a real community publishes (openvtc docs/design/vetting-process.md
// §6.2). None of them had a client-side check until now; the community applied
// them at intake and the applicant learned the outcome as a bare refusal.

describe('ISO 8601 durations', () => {
  it('reads the forms the published requirements use', () => {
    expect(parseIsoDuration('P120D')).toMatchObject({ days: 120 })
    expect(parseIsoDuration('P14D')).toMatchObject({ days: 14 })
    expect(parseIsoDuration('P1Y2M3W4D')).toMatchObject({ years: 1, months: 2, weeks: 3, days: 4 })
    expect(parseIsoDuration('PT36H')).toMatchObject({ hours: 36 })
    expect(parseIsoDuration('P1DT2H30M')).toMatchObject({ days: 1, hours: 2, minutes: 30 })
  })

  it('refuses what it cannot read rather than guessing', () => {
    // "P0.5D" means something; whatever we picked would be a guess, and a
    // guess about a deadline is worse than an admission.
    for (const bad of ['', 'P', 'PT', '120D', 'P0.5D', 'P-1D', 'banana', 'P1H']) {
      expect(parseIsoDuration(bad)).toBeUndefined()
    }
  })

  it('adds months as calendar arithmetic, not as 30 days', () => {
    // 31 January + 1 month is the end of February, not 2 or 3 March. A client
    // that approximates disagrees with the server exactly at the boundaries,
    // which is where deadlines sit.
    const jan31 = new Date('2026-01-31T12:00:00Z')
    expect(addIsoDuration(jan31, parseIsoDuration('P1M')!).toISOString()).toBe('2026-02-28T12:00:00.000Z')
    const leap = new Date('2024-01-31T12:00:00Z')
    expect(addIsoDuration(leap, parseIsoDuration('P1M')!).toISOString()).toBe('2024-02-29T12:00:00.000Z')
    expect(addIsoDuration(jan31, parseIsoDuration('P1Y')!).toISOString()).toBe('2027-01-31T12:00:00.000Z')
  })

  it('adds days and below exactly', () => {
    const t = new Date('2026-03-01T00:00:00Z')
    expect(addIsoDuration(t, parseIsoDuration('P120D')!).toISOString()).toBe('2026-06-29T00:00:00.000Z')
    expect(addIsoDuration(t, parseIsoDuration('PT90M')!).toISOString()).toBe('2026-03-01T01:30:00.000Z')
  })

  it('says when a statement stops counting', () => {
    expect(expiryUnder('2026-01-01T00:00:00Z', 'P120D')?.toISOString()).toBe('2026-05-01T00:00:00.000Z')
    expect(expiryUnder('not a date', 'P120D')).toBeUndefined()
    expect(expiryUnder('2026-01-01T00:00:00Z', 'nonsense')).toBeUndefined()
  })
})

const JOIN = 'did:peer:4applicant'
const NOW = new Date('2026-06-01T00:00:00Z')

const statement = (over: Partial<StatementFacts> = {}): StatementFacts => ({
  issuer: 'did:peer:4vetter-a',
  subject: JOIN,
  signedAt: '2026-05-01T00:00:00Z',
  method: 'inPerson',
  identityCommitment: 'zCommitment',
  declaredRelationship: 'none',
  ...over,
})

const requirements = (over: Partial<VettingRequirements> = {}): VettingRequirements => ({
  minStatements: 1,
  acceptedMethods: ['inPerson', 'video', 'priorAcquaintance'],
  maxStatementAge: 'P120D',
  ...over,
})

describe('statementFacts', () => {
  it('reads an endorsement credential as the vetter writes it', () => {
    const facts = statementFacts({
      issuer: 'did:peer:4vetter-a',
      validFrom: '2026-05-01T00:00:00Z',
      validUntil: '2026-08-29T00:00:00Z',
      credentialSubject: {
        id: JOIN,
        endorsement: { method: 'video', identityCommitment: 'zC', declaredRelationship: 'sameEmployer' },
      },
    })
    expect(facts).toMatchObject({
      issuer: 'did:peer:4vetter-a',
      subject: JOIN,
      signedAt: '2026-05-01T00:00:00Z',
      expiresAt: '2026-08-29T00:00:00Z',
      method: 'video',
      declaredRelationship: 'sameEmployer',
    })
  })

  it('tolerates a statement that omits what it does not claim', () => {
    expect(statementFacts({ issuer: 'did:x', credentialSubject: { id: JOIN } })).toMatchObject({
      issuer: 'did:x',
      method: undefined,
    })
  })
})

describe('evaluateStatements', () => {
  it('counts a good statement', () => {
    const e = evaluateStatements([statement()], requirements(), JOIN, NOW)
    expect(e.meets).toBe(true)
    expect(e.counted).toHaveLength(1)
    expect(e.needs).toEqual([])
  })

  it('discounts a statement older than the published limit', () => {
    const e = evaluateStatements([statement({ signedAt: '2026-01-01T00:00:00Z' })], requirements(), JOIN, NOW)
    expect(e.meets).toBe(false)
    expect(e.discounted).toMatchObject([{ reason: 'too-old' }])
    expect(e.needs).toEqual([{ kind: 'statements', n: 1 }])
  })

  it('honours the statement’s own expiry even when the limit is unreadable', () => {
    // The vetter stamped validUntil from the community's limit at signing
    // time; a limit we cannot parse now does not un-expire it.
    const e = evaluateStatements(
      [statement({ expiresAt: '2026-05-02T00:00:00Z' })],
      requirements({ maxStatementAge: 'nonsense' }),
      JOIN,
      NOW
    )
    expect(e.discounted).toMatchObject([{ reason: 'expired' }])
  })

  it('says so when the published limit cannot be read', () => {
    // No limit was applied, so this count is more optimistic than the
    // community's — which the applicant should be told, not spared.
    const e = evaluateStatements([statement()], requirements({ maxStatementAge: 'P0.5D' }), JOIN, NOW)
    expect(e.unreadableMaxAge).toBe('P0.5D')
    expect(e.meets).toBe(true)
  })

  it('does not let one vetter speak twice', () => {
    const two = [statement(), statement({ signedAt: '2026-05-02T00:00:00Z' })]
    const e = evaluateStatements(two, requirements({ minStatements: 2 }), JOIN, NOW)
    expect(e.counted).toHaveLength(1)
    expect(e.discounted).toMatchObject([{ reason: 'duplicate-vetter' }])
    expect(e.needs).toEqual([{ kind: 'statements', n: 1 }])
  })

  it('counts two distinct vetters', () => {
    const e = evaluateStatements(
      [statement(), statement({ issuer: 'did:peer:4vetter-b' })],
      requirements({ minStatements: 2 }),
      JOIN,
      NOW
    )
    expect(e.meets).toBe(true)
    expect(e.counted).toHaveLength(2)
  })

  it('applies per-method floors', () => {
    const e = evaluateStatements(
      [statement({ method: 'video' }), statement({ issuer: 'did:peer:4vetter-b', method: 'video' })],
      requirements({ minStatements: 2, minByMethod: { inPerson: 1 } }),
      JOIN,
      NOW
    )
    expect(e.meets).toBe(false)
    expect(e.needs).toEqual([{ kind: 'method', method: 'inPerson', n: 1 }])
  })

  it('drops a method the community does not accept at all', () => {
    const e = evaluateStatements(
      [statement({ method: 'carrierPigeon' })],
      requirements({ acceptedMethods: ['inPerson'] }),
      JOIN,
      NOW
    )
    expect(e.discounted).toMatchObject([{ reason: 'method-not-accepted' }])
  })

  it('drops a statement about somebody else', () => {
    // A phone vetted before holds statements naming an older join DID, and the
    // mediator can redeliver one at any time.
    const e = evaluateStatements([statement({ subject: 'did:peer:4someone-else' })], requirements(), JOIN, NOW)
    expect(e.discounted).toMatchObject([{ reason: 'wrong-subject' }])
  })

  it('keeps the majority commitment when consistency is required', () => {
    const e = evaluateStatements(
      [
        statement(),
        statement({ issuer: 'did:peer:4vetter-b' }),
        statement({ issuer: 'did:peer:4vetter-c', identityCommitment: 'zDifferent' }),
      ],
      requirements({ minStatements: 2, independence: { requireConsistentIdentityCommitment: true } }),
      JOIN,
      NOW
    )
    expect(e.counted).toHaveLength(2)
    expect(e.discounted).toMatchObject([{ reason: 'commitment-mismatch' }])
    expect(e.meets).toBe(true)
  })

  it('leaves commitments alone when the community does not require consistency', () => {
    const e = evaluateStatements(
      [statement(), statement({ issuer: 'did:peer:4vetter-b', identityCommitment: 'zDifferent' })],
      requirements({ minStatements: 2 }),
      JOIN,
      NOW
    )
    expect(e.counted).toHaveLength(2)
  })

  it('flags an exceeded relationship cap without refusing the application', () => {
    // The community refers these for review rather than refusing them, so the
    // count still stands and the warning sits beside it.
    const e = evaluateStatements(
      [
        statement({ declaredRelationship: 'family' }),
        statement({ issuer: 'did:peer:4vetter-b', declaredRelationship: 'family' }),
      ],
      requirements({
        minStatements: 2,
        independence: { maxByDeclaredRelationship: { family: 0, sameEmployer: 1 } },
      }),
      JOIN,
      NOW
    )
    expect(e.meets).toBe(true)
    expect(e.independenceOk).toBe(false)
    expect(e.exceededCaps).toEqual([{ relationship: 'family', limit: 0, seen: 2 }])
  })

  it('leaves a cap that is met alone', () => {
    const e = evaluateStatements(
      [statement({ declaredRelationship: 'sameEmployer' })],
      requirements({ independence: { maxByDeclaredRelationship: { sameEmployer: 1 } } }),
      JOIN,
      NOW
    )
    expect(e.independenceOk).toBe(true)
  })

  it('asks for exactly what is still missing', () => {
    const e = evaluateStatements([], requirements({ minStatements: 3, minByMethod: { inPerson: 2 } }), JOIN, NOW)
    expect(e.needs).toEqual([
      { kind: 'statements', n: 3 },
      { kind: 'method', method: 'inPerson', n: 2 },
    ])
  })
})
