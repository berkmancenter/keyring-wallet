/**
 * A community's join criteria, read at manifest/0.3 and at 0.2.
 *
 * The 0.3 manifests are the specification's own examples, with the digests it
 * prints for them, and its invalid examples; the 0.2 one is what a running
 * vtc-service 0.49.0 published (see fixtures/join-0.3/README.md). So the
 * digest and the reading are checked against values Keyring did not compute.
 */
import { criterionDigest, joinAsks, readManifest, type VtiCriterion, type VtiManifest } from '../module/joinManifest'

import invalidExamples from './fixtures/join-0.3/manifest-invalid-examples.json'
import specExamples from './fixtures/join-0.3/manifest-response-examples.json'
import vtc049 from './fixtures/join-0.3/vtc-0.49.0-answers.json'
import vtc1907 from './fixtures/join-0.3/vtc-789ab4c2-answers.json'

const example = (title: string): VtiManifest => {
  const found = specExamples.find((e) => e.title.startsWith(title))
  if (!found) throw new Error(`no spec example titled "${title}"`)
  return readManifest(found.document.payload as Partial<VtiManifest>, '0.3')
}
const severalWays = example('Several ways in')
const lab02 = readManifest(vtc049.manifest02.payload as Partial<VtiManifest>, '0.2')

/** A 0.3 criterion with the digest it would be published under. */
const published = (criterion: VtiCriterion): VtiCriterion => ({
  ...criterion,
  requirementsDigest: criterionDigest(criterion),
})

/**
 * The criteria a new community starts with (vti docs/03-vtc/join-criteria.md,
 * The defaults), as a vtc-service that serves 0.3 published them.
 */
const vtiDefaults = readManifest(vtc1907.manifest03.payload as Partial<VtiManifest>, '0.3')

describe('requirementsDigest', () => {
  const specCriteria = specExamples.flatMap((e) =>
    (e.document.payload.criteria as VtiCriterion[]).map((c) => [`${e.title} — ${c.id}`, c] as const)
  )

  it.each(specCriteria)('recomputes to the value the specification prints: %s', (_name, criterion) => {
    expect(criterionDigest(criterion)).toBe(criterion.requirementsDigest)
  })

  it.each(vtiDefaults.criteria.map((c) => [c.id, c] as const))(
    'recomputes to the value a running 0.3 community published: %s',
    (_id, criterion) => {
      expect(criterionDigest(criterion)).toBe(criterion.requirementsDigest)
    }
  )

  it.each(lab02.criteria.map((c) => [c.id, c] as const))(
    'recomputes to the value a running 0.2 community published: %s',
    (_id, criterion) => {
      expect(criterionDigest(criterion)).toBe(criterion.requirementsDigest)
    }
  )
})

describe('the ways in, at manifest/0.3', () => {
  it('keeps the community’s order, and reads each way’s admission and requirements', () => {
    const { ways, accepting, wire } = joinAsks(severalWays)
    expect(wire).toBe('0.3')
    expect(accepting).toBe(true)
    expect(ways.map((w) => [w.id, w.admission, w.usable])).toEqual([
      ['kernel-developer', 'automatic', true],
      ['invited', 'automatic', true],
      ['partner-member', 'automatic', true],
      ['apply', 'review', true],
    ])
    expect(ways[0].requires.vetting).toEqual({
      statements: 2,
      claims: ['name.legal'],
      methods: ['inPerson', 'video', 'priorAcquaintance'],
    })
    expect(ways[1].requires).toEqual({ invitation: true })
    expect(ways[2].requires.credentials).toEqual({ issuers: 'recognised', types: ['MembershipCredential'] })
    expect(ways[3].requiresNothing).toBe(true)
    expect(ways.every((w) => w.digest)).toBe(true)
  })

  it('suggests the first way the phone meets now, as the community decides a submission naming none', () => {
    // Nothing in hand: only the way that requires nothing is met, and it is reviewed.
    const plain = joinAsks(severalWays)
    expect(plain.suggested?.id).toBe('apply')
    expect(plain.outcomeIfMet).toBe('reviewed')
    // With an invitation, the invitation way comes first, and it admits.
    const invited = joinAsks(severalWays, { invitation: true })
    expect(invited.suggested?.id).toBe('invited')
    expect(invited.outcomeIfMet).toBe('joined')
  })

  it('never reads meeting a review criterion as admission', () => {
    const asks = joinAsks(example('Review only'))
    expect(asks.suggested?.admission).toBe('review')
    expect(asks.outcomeIfMet).toBe('reviewed')
  })

  it('reads an open community as one that admits', () => {
    const asks = joinAsks(example('Open'))
    expect(asks.suggested?.requiresNothing).toBe(true)
    expect(asks.outcomeIfMet).toBe('joined')
  })

  it('reads a criterion whose vetting parameters this version does not name', () => {
    const [way] = joinAsks(example('A criterion whose vetting parameters')).ways
    expect(way.usable).toBe(true)
    expect(way.requires.vetting).toBeDefined()
  })

  it('reads a new community’s default criteria: reviewed with nothing in hand, admitted with an invitation', () => {
    expect(joinAsks(vtiDefaults).ways.map((w) => [w.id, w.admission, w.usable])).toEqual([
      ['invited', 'automatic', true],
      ['member-credential', 'automatic', true],
      ['review', 'review', true],
    ])
    expect(joinAsks(vtiDefaults).suggested?.id).toBe('review')
    expect(joinAsks(vtiDefaults).outcomeIfMet).toBe('reviewed')
    expect(joinAsks(vtiDefaults, { invitation: true }).suggested?.id).toBe('invited')
    expect(joinAsks(vtiDefaults, { invitation: true }).outcomeIfMet).toBe('joined')
    // A credential query is not evaluated here, so it is never the suggestion.
    expect(joinAsks(vtiDefaults).ways[1].meets).toBe('unknown')
  })

  it('reads an empty list as a community that accepts no applications', () => {
    const asks = joinAsks(readManifest({ communityDid: 'did:x', criteria: [] }, '0.3'))
    expect(asks.accepting).toBe(false)
    expect(asks.suggested).toBeUndefined()
  })
})

describe('a criterion this wallet cannot read as published', () => {
  const responses = invalidExamples.filter((e) => (e as { variant?: string }).variant === 'response')
  const faultOfExample = (containing: string) => {
    const found = responses.find((e) => e.note.includes(containing))
    if (!found) throw new Error(`no invalid example noting "${containing}"`)
    return joinAsks(readManifest(found.payload as Partial<VtiManifest>, '0.3')).ways[0]
  }

  it.each([
    ['without `admission`', 'admissionMissing'],
    ['without `requirementsDigest`', 'digestMissing'],
    ['without credentialIssuers', 'issuersMissing'],
    ['neither automatic nor review', 'admissionUnknown'],
  ])('is kept and marked, for the specification’s invalid example %s', (note, because) => {
    const way = faultOfExample(note)
    expect(way.usable).toBe(false)
    expect(way.unusableBecause).toBe(because)
  })

  it('covers every invalid response example the specification gives', () => {
    expect(responses).toHaveLength(4)
  })

  it('is marked when its digest does not recompute — the admission was changed after it was digested', () => {
    const [vetted, ...rest] = severalWays.criteria
    const tampered = readManifest({ criteria: [{ ...vetted, admission: 'review' }, ...rest] }, '0.3')
    const [way] = joinAsks(tampered).ways
    expect(way.usable).toBe(false)
    expect(way.unusableBecause).toBe('digestMismatch')
    expect(way.unusableDetail).toContain(String(vetted.requirementsDigest))
  })

  it('is marked when its vetting requirements break their published shape', () => {
    const broken = published({
      id: 'vetted',
      admission: 'automatic',
      vetting: {
        version: '0.1',
        statementType: 'https://registry.trustoverip.org/dtg/vsc/vetted/1',
        minStatements: 1,
        acceptedMethods: ['video'],
        minByMethod: { inPerson: 1 },
        eligibleVetters: { role: 'vetter' },
      },
    })
    const [way] = joinAsks(readManifest({ criteria: [broken] }, '0.3')).ways
    expect(way.unusableBecause).toBe('vettingUnreadable')
    expect(way.unusableDetail).toMatch(/minByMethod/)
  })

  it('is never the suggestion, and the ways after it still are', () => {
    const unknownMode = {
      id: 'new-mode',
      admission: 'lottery',
      requirementsDigest: 'zQmVmw2GuXQsXe1yJf5xwU2TPvhP5mtwpQ5ACLwK76RAiEV',
    }
    const asks = joinAsks(
      readManifest({ criteria: [unknownMode, published({ id: 'review', admission: 'review' })] }, '0.3')
    )
    expect(asks.ways.map((w) => [w.id, w.usable, w.unusableBecause])).toEqual([
      ['new-mode', false, 'admissionUnknown'],
      ['review', true, undefined],
    ])
    expect(asks.suggested?.id).toBe('review')
  })
})

describe('the ways in, at manifest/0.2', () => {
  it('states no admission for any criterion, and suggests none', () => {
    const asks = joinAsks(lab02, { invitation: true, statements: 3 })
    expect(asks.wire).toBe('0.2')
    expect(asks.accepting).toBe(true)
    expect(asks.ways.map((w) => [w.id, w.admission, w.usable, w.requiresNothing])).toEqual([
      ['invited-member', 'unstated', true, false],
      ['vetted-member', 'unstated', true, false],
    ])
    expect(asks.ways[1].requires.vetting).toEqual({
      statements: 1,
      claims: ['name.legal'],
      methods: ['inPerson', 'video'],
    })
    // Each is a credential query this wallet does not evaluate here.
    expect(asks.suggested).toBeUndefined()
    expect(asks.outcomeIfMet).toBeUndefined()
  })

  it('does not read an empty list as "not accepting": 0.2 never said what it meant', () => {
    expect(joinAsks(readManifest({ criteria: [] }, '0.2')).accepting).toBe(true)
    expect(joinAsks({ criteria: [] }).wire).toBe('0.2')
  })
})
