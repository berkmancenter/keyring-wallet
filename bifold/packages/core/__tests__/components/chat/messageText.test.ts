import { messageTextOf } from '../../../src/components/chat/messageText'

const labels = { photo: '📷 Photo', unsupported: 'Unsupported attachment' }
const photo = { id: 'a1', mediaType: 'image/jpeg' as const, byteCount: 1000, width: 10, height: 10, file: 'a1.jpg' }
const refused = { id: 'a2', unsupported: 'unsupported-type' as const }

test('its text, whatever it carries', () => {
  expect(messageTextOf({ content: { format: 'text/plain', text: 'look' }, attachments: [photo] }, labels)).toBe('look')
})

test('no caption: a photo this phone kept is a photo; one it could not show is never called one', () => {
  expect(messageTextOf({ attachments: [photo] }, labels)).toBe('📷 Photo')
  expect(messageTextOf({ attachments: [refused] }, labels)).toBe('Unsupported attachment')
})

test('nothing to say: nothing is invented', () => {
  expect(messageTextOf({}, labels)).toBe('')
  expect(messageTextOf({ attachments: [photo] }, {})).toBe('')
})
