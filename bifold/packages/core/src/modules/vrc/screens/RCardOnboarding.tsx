import React from 'react'
import { useTranslation } from 'react-i18next'
import { Agent } from '@credo-ts/core'

import { DispatchAction } from '../../../contexts/reducers/store'
import { useStore } from '../../../contexts/store'
import { storeRCardTemplate } from '../services/rCardCredential'
import { bifoldLoggerInstance } from '../../../services/bifoldLogger'
import { RCardFormInput, buildRCardTemplate, extractFormInputFromJCard } from '../types/rcard'
import RCardForm from './RCardForm'

interface RCardOnboardingProps {
  agent?: Agent | null
}

const RCardOnboarding: React.FC<RCardOnboardingProps> = ({ agent }) => {
  const { t } = useTranslation()
  const [, dispatch] = useStore()

  const handleSubmit = async (formState: RCardFormInput) => {
    try {
      const template = buildRCardTemplate(formState)

      if (!agent) {
        dispatch({ type: DispatchAction.R_CARD_TEMPLATE_STAGED, payload: [template] })
        dispatch({ type: DispatchAction.DID_SETUP_R_CARD })

        const formData = extractFormInputFromJCard(template.jcard)
        bifoldLoggerInstance.info(
          'R-card onboarding completed (staged in state, will migrate to Credo when agent is ready)',
          {
            id: template.id,
            templateId: template.templateId,
            label: template.label,
            firstName: formData.firstName,
            lastName: formData.lastName,
            email: formData.email,
            organization: formData.organization,
            storedInCredo: false,
            timestamp: new Date().toISOString(),
          }
        )
        return
      }

      const persisted = await storeRCardTemplate(template, agent)

      if (!persisted) {
        bifoldLoggerInstance.warn('Failed to persist R-card to Credo, staging for later migration', {
          id: template.id,
          templateId: template.templateId,
        })
        dispatch({ type: DispatchAction.R_CARD_TEMPLATE_STAGED, payload: [template] })
      } else {
        dispatch({ type: DispatchAction.R_CARD_CREDENTIAL_SYNCED, payload: [template] })
        const formData = extractFormInputFromJCard(template.jcard)
        bifoldLoggerInstance.info('R-card onboarding completed successfully', {
          id: template.id,
          templateId: template.templateId,
          label: template.label,
          firstName: formData.firstName,
          lastName: formData.lastName,
          email: formData.email,
          organization: formData.organization,
          storedInCredo: true,
          timestamp: new Date().toISOString(),
        })
      }

      dispatch({ type: DispatchAction.DID_SETUP_R_CARD })
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error))
      bifoldLoggerInstance.error(
        'Error during R-card credential storage',
        {
          errorType: error instanceof Error ? error.constructor.name : typeof error,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
          agentAvailable: !!agent,
        },
        errorObj
      )
      throw errorObj
    }
  }

  return (
    <RCardForm
      title={t('RCardOnboarding.Title')}
      legend={t('RCardOnboarding.Legend')}
      submitLabel={t('Global.Continue')}
      onSubmit={handleSubmit}
    />
  )
}

export default RCardOnboarding
