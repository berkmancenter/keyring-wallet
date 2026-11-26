import i18n from 'i18next'

import en from '../../src/localization/en/en.json'
import fr from '../../src/localization/fr/fr.json'
import ptBr from '../../src/localization/pt-br/pt-br.json'

/**
 * Make the app's own i18n instance (localization/index.ts) speak `lng`, with our real locale files, as the app does
 * before any screen. react-i18next is mocked to return keys, so this reaches only what reads the instance itself:
 * dates (utils/localDay.ts appDateWords). The codes are the app's own: 'pt-BR', not 'pt-br'.
 */
export async function speak(lng: 'en' | 'fr' | 'pt-BR'): Promise<void> {
  if (!i18n.isInitialized) {
    await i18n.init({
      lng,
      fallbackLng: 'en',
      resources: { en: { translation: en }, fr: { translation: fr }, 'pt-BR': { translation: ptBr } },
      initAsync: false,
    })
  }
  await i18n.changeLanguage(lng)
}
