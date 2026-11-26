/**
 * The rooms switch is the way every member turns data rooms off, so it reads as a setting, not as work in progress,
 * and calls them by the same name the rooms screens use in each language.
 */
import en from '../../../localization/en/en.json'
import fr from '../../../localization/fr/fr.json'
import ptBr from '../../../localization/pt-br/pt-br.json'

test.each([
  ['en', en, 'Data rooms', 'Turn data rooms on or off', 'Rooms'],
  ['fr', fr, 'Salons de données', 'Activer ou désactiver les salons de données', 'Salons'],
  ['pt-br', ptBr, 'Salas de dados', 'Ativar ou desativar as salas de dados', 'Salas'],
])(
  '%s: the rooms switch says data rooms, in the word the rooms screens use',
  (_lang, words, label, hint, screensWord) => {
    expect(words.Settings.FeatureRooms).toBe(label)
    expect(words.Settings.ToggleFeatureRooms).toBe(hint)
    expect(label.toLowerCase()).toContain(screensWord.toLowerCase())
    expect(words.Rooms.Rooms).toBe(screensWord)
  }
)
