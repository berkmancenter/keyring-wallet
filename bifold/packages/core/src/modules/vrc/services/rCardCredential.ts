import { Agent, JsonTransformer, W3cCredential, W3cCredentialRecord, W3cCredentialRepository } from '@credo-ts/core'

import { RCardTemplate, JCard } from '../types/rcard'
import { createVrcLogger } from '../vrc-logging'

/**
 * Converts RCardTemplate (with jCard) to W3cCredentialRecord for storage in Credo/Askar
 *
 * NOTE: We use W3cCredential (unsigned) instead of W3cJsonLdVerifiableCredential (requires proof).
 * This allows us to save the R-card as a template without a cryptographic proof.
 * The credential can be signed later when needed using agent.w3cCredentials.signCredential().
 *
 * The jCard is stored in the credentialSubject following the Relationship Card Credential spec.
 */
export const buildRCardTemplateW3cCredentialRecord = (rCardTemplate: RCardTemplate): W3cCredentialRecord => {
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
  }

  const w3cCredential = JsonTransformer.fromJSON(w3cCredentialJson, W3cCredential)
  const record = new W3cCredentialRecord({
    credential: w3cCredential as any,
    tags: {
      type: 'RCardTemplate',
      isSelfIssued: 'true',
      templateId: rCardTemplate.templateId,
    },
  })

  return record
}

/**
 * Converts W3cCredentialRecord back to RCardTemplate format (with jCard)
 */
export const extractRCardTemplateFromW3cRecord = (record: W3cCredentialRecord): RCardTemplate => {
  const w3cCred = record.credential as W3cCredential | any

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
      : 'Default business card'

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
 * Loads R-card template from Credo/Askar
 */
export const loadRCardTemplate = async (agent: Agent | null): Promise<RCardTemplate | undefined> => {
  const logger = createVrcLogger(agent, { module: 'vrc', component: 'rCardCredential' })

  if (!agent) {
    logger.warn('loadRCardTemplate: Agent is null or undefined')
    return undefined
  }

  try {
    const repository = agent.dependencyManager.resolve(W3cCredentialRepository)
    const records = await repository.findByQuery(agent.context, {
      type: 'RCardTemplate',
    })

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
 * Deletes R-card template from Credo/Askar
 */
export const deleteRCardTemplate = async (agent: Agent): Promise<void> => {
  const logger = createVrcLogger(agent, { module: 'vrc', component: 'rCardCredential' })

  try {
    if (!agent.w3cCredentials) {
      logger.warn('deleteRCardTemplate: agent.w3cCredentials is not available')
      return
    }

    const repository = agent.dependencyManager.resolve(W3cCredentialRepository)
    const records = await repository.findByQuery(agent.context, {
      type: 'RCardTemplate',
    })

    for (const record of records) {
      await agent.w3cCredentials.removeCredentialRecord(record.id)
    }
    logger.info('deleteRCardTemplate: Successfully completed deletion', { recordCount: records.length })
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
 * NOTE: During onboarding on a fresh install, there should be NO existing R-card records.
 * We don't need to delete anything - we just save the template.
 */
export const storeRCardTemplate = async (template: RCardTemplate, agent: Agent): Promise<boolean> => {
  const logger = createVrcLogger(agent, { module: 'vrc', component: 'rCardCredential' })
  let w3cRecord: W3cCredentialRecord | undefined

  try {
    if (!agent.context) {
      logger.error('storeRCardTemplate: Agent context is not available')
      throw new Error('Agent context is not available - agent may not be initialized')
    }

    w3cRecord = buildRCardTemplateW3cCredentialRecord(template)
    const repository = agent.dependencyManager.resolve(W3cCredentialRepository)
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
