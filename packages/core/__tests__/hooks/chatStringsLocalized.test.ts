/**
 * The chat's own words (the exchange overlay, the connected card, the confirmation) come from the locale files, and
 * every key the code names exists in English, French and Portuguese. A key missing from one language shows as the
 * key itself on that phone; a key typed wrong shows as the key everywhere. Neither fails anywhere else.
 */
import { readFileSync } from 'fs'
import path from 'path'

import { flowStatusKey } from '../../src/hooks/chat-messages'
import en from '../../src/localization/en/en.json'
import fr from '../../src/localization/fr/fr.json'
import ptBr from '../../src/localization/pt-br/pt-br.json'
import type { VrcFlowStatus } from '../../src/modules/vrc/witnessStatusStore'

const LOCALES = { en, fr, 'pt-BR': ptBr } as Record<string, unknown>

const resolve = (locale: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((at, part) => (at as Record<string, unknown> | undefined)?.[part], locale)

const STATUSES: VrcFlowStatus[] = [
  'idle',
  'connecting',
  'discovering',
  'proposed',
  'witness-active',
  'witness-fallback',
  'biometric-fallback',
  'preparing-offer',
  'sharing-witness-record',
  'offer-sent',
  'offer-received',
]

/** Every literal 'Chat.…' key the files name, in t('…') and in setStatusKey('…') or a returned key. */
function keysNamedIn(file: string): string[] {
  const source = readFileSync(path.join(__dirname, '../../src', file), 'utf8')
  return [...new Set([...source.matchAll(/'(Chat\.[A-Za-z.]+)'/g)].map((m) => m[1]))]
}

describe('the chat speaks every language it is set to', () => {
  const flowKeys = new Set(
    STATUSES.flatMap((status) =>
      [true, false].flatMap((trustTasks) =>
        [true, false].map((witnessed) => flowStatusKey(status, trustTasks, witnessed))
      )
    )
  )
  const named = ['hooks/chat-messages.tsx', 'screens/Chat.tsx', 'components/chat/ChatMessage.tsx'].flatMap(keysNamedIn)

  test.each(Object.keys(LOCALES))('every overlay status has its words in %s', (language) => {
    for (const key of flowKeys) expect([key, typeof resolve(LOCALES[language], key)]).toEqual([key, 'string'])
  })

  test.each(Object.keys(LOCALES))('every key these files name exists in %s', (language) => {
    for (const key of named) expect([key, resolve(LOCALES[language], key)]).not.toEqual([key, undefined])
  })

  // The wallet's e2e drivers find the confirmation overlay and its button by their English words (e2e/lib/flows.js:
  // "Relationship confirmed", "View contacts"), so the English stays word for word until they move to testIDs.
  test('the English the e2e drivers look for is unchanged', () => {
    expect(resolve(en, 'Chat.RelationshipConfirmed')).toMatch(/^Relationship confirmed/)
    expect(resolve(en, 'Chat.RelationshipConfirmedWith')).toMatch(/^Relationship confirmed/)
    expect(resolve(en, 'Chat.ViewContacts')).toBe('View contacts')
  })

  // The check above is only as good as the keys it finds: these must be among them.
  test('the scan finds the keys it is there for', () => {
    expect(named).toEqual(
      expect.arrayContaining([
        'Chat.Flow.TookTooLong',
        'Chat.Connected.Before',
        'Chat.ViewContacts',
        'Chat.AcceptOfferQuestion',
      ])
    )
    expect(flowKeys.size).toBeGreaterThanOrEqual(16)
  })
})
