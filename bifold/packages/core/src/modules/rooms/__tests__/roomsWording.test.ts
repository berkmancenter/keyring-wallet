/**
 * A room holds messages and notes (11-03): "post" said one thing in Keyring and nothing in the other clients, which
 * call every record a note or a file. The words: a message is sent or written, a note is added or saved.
 */
import en from '../../../localization/en/en.json'

describe("the rooms' words", () => {
  test('no rooms string calls a message a post', () => {
    const said = Object.entries(en.Rooms).filter(([, v]) => typeof v === 'string' && /\bpost(s|ed|ing)?\b/i.test(v))
    expect(said).toEqual([])
  })

  test('an empty room and its notes', () => {
    expect(en.Rooms.PostsNone).toBe('No messages yet.')
    expect(en.Rooms.NotesWaiting_one).toBe('{{count}} note in this room')
    expect(en.Rooms.NotesWaiting_other).toBe('{{count}} notes in this room')
    expect(en.Rooms.NotesWaitingOpen).toBe('See notes')
  })
})
