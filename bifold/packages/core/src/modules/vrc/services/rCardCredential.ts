import { Agent, JsonTransformer, W3cCredential, W3cCredentialRecord, W3cCredentialRepository } from '@credo-ts/core'

import {
  RCardFormInput,
  RCardTemplate,
  JCard,
  buildJCardFromFormInput,
  LEGACY_SHARED_TEMPLATE_ID,
  DEFAULT_LABEL,
} from '../types/rcard'
import { DTG_CONTEXT_URL, RCARD_CONTEXT_URL } from '../types/relationshipContext'
import { selectCredentialContexts } from '../utils/selectCredentialContexts'
import { createVrcLogger } from '../vrc-logging'

/** The custom tags set on an RCardTemplate record (setTags in buildRCardTemplateW3cCredentialRecord). */
interface RCardTemplateTags {
  templateId?: string
  active?: string
}
const rCardTags = (record: W3cCredentialRecord): RCardTemplateTags => record.getTags() as unknown as RCardTemplateTags

/**
 * Build an exchanged RelationshipCard (RCard) credential from the local
 * R-Card template, per the DTG spec:
 *
 * - `type`: ["VerifiableCredential", "RelationshipCard"]
 * - `issuer`: my relationship DID (bare string)
 * - `credentialSubject.id`: the counterparty's relationship DID
 * - `credentialSubject.card`: the jCard (RFC 7095) from the local template
 *
 * The RCard is a separate VDS exchanged alongside the VRC — it carries the
 * human-readable contact info (name/email/org) that used to be embedded in
 * the VRC's issuer object.
 *
 * @returns the unsigned credential JSON, or undefined when no template exists
 */
export const buildRCardCredential = async (
  agent: Agent,
  myRelationshipDid: string,
  counterpartyRelationshipDid: string,
  options?: { useVc20?: boolean; useDi?: boolean }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any | undefined> => {
  const template = await loadRCardTemplate(agent)
  if (!template?.jcard) {
    return undefined
  }

  // Backdate issuance to tolerate clock skew between devices (same allowance
  // as the VRC builder — the holder rejects credentials dated in its future).
  const CLOCK_SKEW_ALLOWANCE_MS = 5 * 60 * 1000
  const issuanceTimestamp = new Date(Date.now() - CLOCK_SKEW_ALLOWANCE_MS).toISOString()

  if (options?.useVc20) {
    // VCDM 2.0 shape — the peer announced RCE protocol v2. Proof-context
    // rules live in selectCredentialContexts (shared with the VRC builder).
    return {
      '@context': selectCredentialContexts(options ?? {}, [DTG_CONTEXT_URL, RCARD_CONTEXT_URL]),
      type: ['VerifiableCredential', 'RelationshipCard'],
      issuer: myRelationshipDid,
      validFrom: issuanceTimestamp,
      credentialSubject: {
        id: counterpartyRelationshipDid,
        card: template.jcard,
      },
    }
  }

  // Legacy VCDM 1.1 shape for pre-VC-2.0 peers
  return {
    '@context': selectCredentialContexts({ useVc20: false }, [DTG_CONTEXT_URL, RCARD_CONTEXT_URL]),
    type: ['VerifiableCredential', 'RelationshipCard'],
    issuer: myRelationshipDid,
    issuanceDate: issuanceTimestamp,
    credentialSubject: {
      id: counterpartyRelationshipDid,
      card: template.jcard,
    },
  }
}

/**
 * Converts RCardTemplate (with jCard) to W3cCredentialRecord for storage in Credo/Askar
 *
 * NOTE: We use W3cCredential (unsigned) instead of W3cJsonLdVerifiableCredential (requires proof).
 * This allows us to save the R-card as a template without a cryptographic proof.
 * The credential can be signed later when needed using agent.w3cCredentials.signCredential().
 *
 * The jCard is stored in the credentialSubject following the Relationship Card Credential spec.
 */
export const buildRCardTemplateW3cCredentialRecord = (
  rCardTemplate: RCardTemplate,
  options?: { active?: boolean }
): W3cCredentialRecord => {
  const w3cCredentialJson = {
    id: rCardTemplate.id,
    '@context': rCardTemplate['@context'],
    type: rCardTemplate.type,
    issuer: rCardTemplate.issuer || 'urn:aries:bifold:r-card',
    issuanceDate: rCardTemplate.issuanceDate || new Date().toISOString(),
    credentialSubject: {
      id: rCardTemplate.id,
      templateId: rCardTemplate.templateId,
      label: rCardTemplate.label,
      jcard: rCardTemplate.jcard,
    },
    // Placeholder proof: credo 0.6 validates stored credentials as W3cJsonLdVerifiableCredential,
    // which requires a proof. The template is unsigned; a real proof is created when the
    // credential is signed at exchange time.
    proof: {
      type: 'Ed25519Signature2018',
      created: rCardTemplate.issuanceDate || new Date().toISOString(),
      proofPurpose: 'assertionMethod',
      verificationMethod: 'urn:aries:bifold:r-card#template',
      jws: 'template-placeholder',
    },
  }

  const w3cCredential = JsonTransformer.fromJSON(w3cCredentialJson, W3cCredential)
  const record = new W3cCredentialRecord({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    credentialInstances: [{ credential: w3cCredential as any }],
  })
  // Custom tags (credo 0.6 restricts the typed constructor tags to expandedTypes).
  // `active` marks the one profile `loadRCardTemplate(agent)` (no profileId)
  // resolves for an exchange — see §4.1/§4.3 of the editable-multi-profile plan.
  record.setTags({
    type: 'RCardTemplate',
    isSelfIssued: 'true',
    templateId: rCardTemplate.templateId,
    active: String(options?.active ?? false),
  })

  return record
}

/**
 * One-time fixup for R-Card template records created by pre-credo-0.6 app
 * versions: those were stored WITHOUT a proof, but credo 0.6 parses stored
 * credentials as W3cJsonLdVerifiableCredential whose class validation requires
 * one — `record.getTags()` throws and crashes any consumer that touches the
 * record (e.g. the OpenID credential provider). Add the same placeholder proof
 * that buildRCardTemplateW3cCredentialRecord uses for new templates.
 */
export const migrateRCardTemplateProofs = async (agent: Agent): Promise<void> => {
  const logger = createVrcLogger(agent, { module: 'vrc', component: 'rCardCredential' })

  try {
    const repository = agent.dependencyManager.resolve(W3cCredentialRepository)
    const records = await repository.findByQuery(agent.context, { type: 'RCardTemplate' })

    for (const record of records) {
      // credo 0.5 records stored `credential`; the 0.6 class-transform setter
      // moves it into `credentialInstances`, but access both shapes to be safe
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyRecord = record as any
      const credential = anyRecord.credentialInstances?.[0]?.credential ?? anyRecord.credential
      if (!credential || typeof credential === 'string' || credential.proof) {
        continue
      }
      credential.proof = {
        type: 'Ed25519Signature2018',
        created: credential.issuanceDate || new Date().toISOString(),
        proofPurpose: 'assertionMethod',
        verificationMethod: 'urn:aries:bifold:r-card#template',
        jws: 'template-placeholder',
      }
      await repository.update(agent.context, record)
      logger.info('Added placeholder proof to legacy R-Card template record', { id: record.id })
    }
  } catch (error) {
    logger.error('Failed to migrate legacy R-Card template records', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Converts W3cCredentialRecord back to RCardTemplate format (with jCard)
 */
export const extractRCardTemplateFromW3cRecord = (record: W3cCredentialRecord): RCardTemplate => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w3cCred = record.encoded as W3cCredential | any

  const contexts = w3cCred.contexts || w3cCred.context || w3cCred['@context'] || []
  const rawSubject = w3cCred.credentialSubject
  const subject = Array.isArray(rawSubject) ? rawSubject[0] : rawSubject

  const id = w3cCred && 'id' in w3cCred ? (w3cCred as any).id : subject && 'id' in subject ? (subject as any).id : ''

  const claims =
    subject && 'claims' in subject && typeof (subject as any).claims === 'object' ? (subject as any).claims : {}

  const jcard =
    claims && 'jcard' in claims ? (claims as any).jcard : subject && 'jcard' in subject ? (subject as any).jcard : null

  const templateId =
    claims && 'templateId' in claims
      ? (claims as any).templateId
      : subject && 'templateId' in subject
      ? (subject as any).templateId
      : 'rcard-basic-1'

  const label =
    claims && 'label' in claims
      ? (claims as any).label
      : subject && 'label' in subject
      ? (subject as any).label
      : DEFAULT_LABEL

  if (!jcard || !Array.isArray(jcard) || jcard[0] !== 'vcard') {
    const logger = createVrcLogger(null, { module: 'vrc', component: 'rCardCredential' })
    logger.warn('extractRCardTemplateFromW3cRecord: Invalid or missing jCard, creating minimal template')
    return {
      id: id || `urn:uuid:${Date.now()}`,
      '@context': Array.isArray(contexts) ? contexts : [contexts],
      type: Array.isArray(w3cCred.type) ? w3cCred.type : [w3cCred.type],
      templateId,
      label,
      jcard: ['vcard', []],
    }
  }

  return {
    id,
    '@context': Array.isArray(contexts) ? contexts : [contexts],
    type: Array.isArray(w3cCred.type) ? w3cCred.type : [w3cCred.type],
    templateId,
    label,
    jcard: jcard as JCard,
    issuer: typeof w3cCred.issuer === 'string' ? w3cCred.issuer : w3cCred.issuer?.id || w3cCred.issuer,
    issuanceDate: w3cCred.issuanceDate,
  }
}

/**
 * Replaces the jCard of an existing R-card template record in place, keyed by
 * `templateId`. Unlike storeRCardTemplate (create), this preserves the
 * record's Credo id and tags via repository.update() rather than save(), so
 * editing a profile never creates a second, duplicate record.
 */
export const updateRCardTemplate = async (
  profileId: string,
  input: RCardFormInput,
  agent: Agent
): Promise<boolean> => {
  const logger = createVrcLogger(agent, { module: 'vrc', component: 'rCardCredential' })

  try {
    if (!agent.context) {
      logger.error('updateRCardTemplate: Agent context is not available')
      throw new Error('Agent context is not available - agent may not be initialized')
    }

    const repository = agent.dependencyManager.resolve(W3cCredentialRepository)
    const records = await repository.findByQuery(agent.context, {
      type: 'RCardTemplate',
      templateId: profileId,
    })

    const record = records[0]
    if (!record) {
      logger.warn('updateRCardTemplate: No existing R-card template found for profileId', { profileId })
      return false
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const credential = record.encoded as any
    const subject = Array.isArray(credential.credentialSubject)
      ? credential.credentialSubject[0]
      : credential.credentialSubject
    subject.claims = {
      ...subject.claims,
      jcard: buildJCardFromFormInput(input),
      label: input.label?.trim() || subject.claims?.label || DEFAULT_LABEL,
    }

    await repository.update(agent.context, record)

    logger.info('R-card template updated in Credo', { profileId })
    return true
  } catch (error) {
    logger.error('updateRCardTemplate: Update operation failed', {
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    })
    return false
  }
}

/**
 * Loads an R-card template from Credo/Askar.
 *
 * With no `profileId`, resolves whichever profile is tagged `active` — the
 * one an exchange should offer. This is what deep DIDComm event-handling code
 * (buildRCardCredential, buildLegacyIssuerObject) calls, unchanged, since it
 * only ever has `agent` in scope, never the app's Redux store where
 * `activeProfileId` also lives. With a `profileId`, resolves that *specific*
 * profile regardless of which is active — used by profile-management UI.
 */
export const loadRCardTemplate = async (
  agent: Agent | null,
  profileId?: string
): Promise<RCardTemplate | undefined> => {
  const logger = createVrcLogger(agent, { module: 'vrc', component: 'rCardCredential' })

  if (!agent) {
    logger.warn('loadRCardTemplate: Agent is null or undefined')
    return undefined
  }

  try {
    const repository = agent.dependencyManager.resolve(W3cCredentialRepository)
    const records = await repository.findByQuery(
      agent.context,
      profileId ? { type: 'RCardTemplate', templateId: profileId } : { type: 'RCardTemplate', active: 'true' }
    )

    if (records.length === 0) {
      return undefined
    }

    const template = extractRCardTemplateFromW3cRecord(records[0])
    return template
  } catch (error) {
    logger.error('Failed to load R-card template', {
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    })
    return undefined
  }
}

/**
 * Loads every profile a wallet holds, plus which one is active — the source
 * for the "My Profiles" list and for populating RCardState.profiles on sync.
 */
export const loadAllRCardTemplates = async (
  agent: Agent | null
): Promise<{ profiles: RCardTemplate[]; activeProfileId?: string }> => {
  const logger = createVrcLogger(agent, { module: 'vrc', component: 'rCardCredential' })

  if (!agent) {
    logger.warn('loadAllRCardTemplates: Agent is null or undefined')
    return { profiles: [] }
  }

  try {
    const repository = agent.dependencyManager.resolve(W3cCredentialRepository)
    const records = await repository.findByQuery(agent.context, { type: 'RCardTemplate' })
    const active = records.find((record) => rCardTags(record).active === 'true')

    return {
      profiles: records.map(extractRCardTemplateFromW3cRecord),
      activeProfileId: active ? extractRCardTemplateFromW3cRecord(active).id : undefined,
    }
  } catch (error) {
    logger.error('Failed to load R-card templates', {
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    })
    return { profiles: [] }
  }
}

/**
 * Marks one profile active (the one an exchange offers) and every other
 * RCardTemplate record inactive. Enforcing "at most one active" here, at the
 * single point that writes the tag, is simpler than trying to keep it an
 * invariant across every call site that could otherwise flip it.
 */
export const setActiveRCardProfile = async (agent: Agent, profileId: string): Promise<boolean> => {
  const logger = createVrcLogger(agent, { module: 'vrc', component: 'rCardCredential' })

  try {
    const repository = agent.dependencyManager.resolve(W3cCredentialRepository)
    const records = await repository.findByQuery(agent.context, { type: 'RCardTemplate' })
    const target = records.find((record) => rCardTags(record).templateId === profileId)
    if (!target) {
      logger.warn('setActiveRCardProfile: No profile found for profileId', { profileId })
      return false
    }

    for (const record of records) {
      const shouldBeActive = record.id === target.id
      if (rCardTags(record).active === String(shouldBeActive)) {
        continue
      }
      record.setTags({ active: String(shouldBeActive) })
      await repository.update(agent.context, record)
    }

    logger.info('Active R-card profile set', { profileId })
    return true
  } catch (error) {
    logger.error('Failed to set active R-card profile', {
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    })
    return false
  }
}

/**
 * One-time fixup for a pre-multi-profile install: its single RCardTemplate
 * record still carries the old shared templateId constant. Mints it a
 * per-instance templateId (equal to its own id) and marks it active, so it
 * becomes "the first profile" with no data migration mechanism beyond this.
 * A no-op (returns undefined) once that record no longer exists — i.e. after
 * the first successful adoption, or on an install that never had one.
 */
export const adoptLegacyRCardTemplate = async (agent: Agent): Promise<RCardTemplate | undefined> => {
  const logger = createVrcLogger(agent, { module: 'vrc', component: 'rCardCredential' })

  try {
    const repository = agent.dependencyManager.resolve(W3cCredentialRepository)
    const records = await repository.findByQuery(agent.context, {
      type: 'RCardTemplate',
      templateId: LEGACY_SHARED_TEMPLATE_ID,
    })
    const record = records[0]
    if (!record) {
      return undefined
    }

    // The credential's own embedded id (RCardTemplate.id, e.g. "urn:uuid:...")
    // — NOT record.id, which is Credo's own separate storage-record id.
    const newTemplateId = extractRCardTemplateFromW3cRecord(record).id
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const credential = record.encoded as any
    const subject = Array.isArray(credential.credentialSubject)
      ? credential.credentialSubject[0]
      : credential.credentialSubject
    subject.claims = { ...subject.claims, templateId: newTemplateId }
    record.setTags({ templateId: newTemplateId, active: 'true' })

    await repository.update(agent.context, record)

    logger.info('Adopted legacy R-card template as the first profile', { profileId: newTemplateId })
    return extractRCardTemplateFromW3cRecord(record)
  } catch (error) {
    logger.error('Failed to adopt legacy R-card template', {
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    })
    return undefined
  }
}

/**
 * Deletes one specific R-card profile from Credo/Askar. Guarding against
 * deleting the last remaining profile, or the active one without picking a
 * replacement first, is the caller's job (useRCardCredential) — this
 * function does exactly what it's told.
 */
export const deleteRCardTemplate = async (agent: Agent, profileId: string): Promise<void> => {
  const logger = createVrcLogger(agent, { module: 'vrc', component: 'rCardCredential' })

  try {
    if (!agent.w3cCredentials) {
      logger.warn('deleteRCardTemplate: agent.w3cCredentials is not available')
      return
    }

    const repository = agent.dependencyManager.resolve(W3cCredentialRepository)
    const records = await repository.findByQuery(agent.context, {
      type: 'RCardTemplate',
      templateId: profileId,
    })

    for (const record of records) {
      await agent.w3cCredentials.deleteById(record.id)
    }
    logger.info('deleteRCardTemplate: Successfully completed deletion', { profileId, recordCount: records.length })
  } catch (error) {
    logger.error('Failed to delete R-card template', {
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    })
    throw error
  }
}

/**
 * Stores R-card template using Credo/Askar
 *
 * NOTE: Assumes no OTHER record for this same profile (by templateId) already
 * exists — creates a new record unconditionally. Editing an existing profile
 * is updateRCardTemplate's job, not this function's. Multiple *different*
 * profiles (Phase 2) are fine — each gets its own record.
 */
export const storeRCardTemplate = async (template: RCardTemplate, agent: Agent): Promise<boolean> => {
  const logger = createVrcLogger(agent, { module: 'vrc', component: 'rCardCredential' })
  let w3cRecord: W3cCredentialRecord | undefined

  try {
    if (!agent.context) {
      logger.error('storeRCardTemplate: Agent context is not available')
      throw new Error('Agent context is not available - agent may not be initialized')
    }

    const repository = agent.dependencyManager.resolve(W3cCredentialRepository)
    // The very first profile a wallet ever gets becomes active by default;
    // a profile added later (Phase 2's "add profile") does not.
    const existing = await repository.findByQuery(agent.context, { type: 'RCardTemplate' })
    w3cRecord = buildRCardTemplateW3cCredentialRecord(template, { active: existing.length === 0 })
    await repository.save(agent.context, w3cRecord)

    logger.info('R-card template stored in Credo', {
      id: template.id,
      templateId: template.templateId,
    })

    return true
  } catch (saveError) {
    const errorDetails = {
      errorType: saveError instanceof Error ? saveError.constructor.name : typeof saveError,
      errorMessage: saveError instanceof Error ? saveError.message : String(saveError),
      errorStack: saveError instanceof Error ? saveError.stack : undefined,
      recordId: w3cRecord?.id,
    }

    logger.error('storeRCardTemplate: Save operation failed', errorDetails)
    return false
  }
}
