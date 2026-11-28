/**
 * The HCP views' words (backlog Section C, U1): `hcp/copy.ts`'s `hcpText`, in the language the app is showing. The
 * HCP copy lives outside the localization files (track C's choice), so the views reach it through this hook rather
 * than `t()`.
 *
 * @module connected-agents/hcp/screens/useHcpCopy
 */
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { hcpText, type HcpCopyKey, type HcpCopyLanguage } from '../copy'

/** The HCP copy language for an i18next language tag: `fr*` → `fr`, `pt*` → `ptBr`, anything else → `en`. */
export function hcpLanguageOf(language: string): HcpCopyLanguage {
  const tag = (language ?? '').toLowerCase()
  if (tag.startsWith('fr')) return 'fr'
  if (tag.startsWith('pt')) return 'ptBr'
  return 'en'
}

/** `hcpText` bound to the app's current language. */
export function useHcpCopy(): (key: HcpCopyKey, params?: Record<string, string>) => string {
  const { i18n } = useTranslation()
  const lang = hcpLanguageOf(i18n?.language ?? 'en')
  return useCallback((key: HcpCopyKey, params?: Record<string, string>) => hcpText(key, lang, params), [lang])
}
