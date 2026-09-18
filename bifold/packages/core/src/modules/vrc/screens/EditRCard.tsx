import React from 'react'
import { useTranslation } from 'react-i18next'
import { useAgent } from '@bifold/react-hooks'

import RCardForm from './RCardForm'
import { useRCardCredential } from '../hooks/useRCardCredential'
import { RCardFormInput, formInputFromTemplate } from '../types/rcard'

const EditRCard: React.FC = () => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const { template, update } = useRCardCredential()

  const handleSubmit = async (input: RCardFormInput) => {
    const persisted = await update(input)
    if (!persisted) {
      throw new Error('Failed to update R-card template')
    }
  }

  if (!agent || !template) {
    return null
  }

  return (
    <RCardForm
      initialValues={formInputFromTemplate(template)}
      title={t('EditRCard.Title')}
      legend={t('EditRCard.Legend')}
      submitLabel={t('Global.Save')}
      onSubmit={handleSubmit}
    />
  )
}

export default EditRCard
