import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { StackScreenProps } from '@react-navigation/stack'
import { useAgent } from '@bifold/react-hooks'

import RCardForm from './RCardForm'
import { useRCardCredential } from '../hooks/useRCardCredential'
import { RCardFormInput, formInputFromTemplate } from '../types/rcard'
import { Screens, SettingStackParams } from '../../../types/navigators'

type EditRCardProps = StackScreenProps<SettingStackParams, Screens.EditRCard>

/** `route.params.profileId` given: edit that profile. Omitted: create a new one. */
const EditRCard: React.FC<EditRCardProps> = ({ route, navigation }) => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const { profiles, update, create } = useRCardCredential()

  const profileId = route.params?.profileId
  const profile = profileId ? profiles.find((p) => p.id === profileId) : undefined

  // Names which profile this screen is acting on in the nav header itself —
  // with more than one profile, a static "Edit Your Profile" title doesn't
  // say which one, and the form below it may be scrolled out of view.
  useEffect(() => {
    navigation.setOptions({ title: profile ? profile.label : t('EditRCard.CreateTitle') })
  }, [navigation, profile, t])

  const handleSubmit = async (input: RCardFormInput) => {
    if (profileId) {
      const persisted = await update(profileId, input)
      if (!persisted) {
        throw new Error('Failed to update R-card template')
      }
      navigation.goBack()
      return
    }

    const created = await create(input)
    if (!created) {
      throw new Error('Failed to create R-card template')
    }
    navigation.goBack()
  }

  if (!agent) {
    return null
  }
  // Asked to edit a specific profile, but it isn't loaded (yet, or it was
  // deleted out from under this screen) — nothing sensible to show.
  if (profileId && !profile) {
    return null
  }

  return (
    <RCardForm
      initialValues={profile ? formInputFromTemplate(profile) : undefined}
      title={profileId ? t('EditRCard.Title') : t('EditRCard.CreateTitle')}
      legend={profileId ? t('EditRCard.Legend') : t('EditRCard.CreateLegend')}
      submitLabel={t('Global.Save')}
      onSubmit={handleSubmit}
    />
  )
}

export default EditRCard
