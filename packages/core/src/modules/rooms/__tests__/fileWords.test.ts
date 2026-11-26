/**
 * A room file's words: its size in decimal units with the language's decimal mark, and its type as the sharer gave
 * it, else the name's extension.
 */
import { fileIcon, fileSizeText, fileTypeText } from '../components/fileWords'
import { toInertText } from '../inertText'

const t = ((key: string, options: { n: number | string }) => `${options.n} ${key.slice(-2)}`) as never

describe('fileSizeText', () => {
  test.each([
    [0, 'en', '1 KB'],
    [999, 'en', '1 KB'],
    [84_000, 'en', '84 KB'],
    [999_499, 'en', '999 KB'],
    [1_200_000, 'en', '1.2 MB'],
    [1_200_000, 'fr', '1,2 MB'],
    [1_200_000, 'pt-BR', '1,2 MB'],
    [25_000_000, 'en', '25 MB'],
  ])('%d bytes in %s', (bytes, language, text) => {
    expect(fileSizeText(t, bytes, language)).toBe(text)
  })
})

describe('fileTypeText', () => {
  test('the type the sharer gave, then the extension, then nothing', () => {
    expect(fileTypeText({ mediaType: 'application/pdf', name: toInertText('a.bin') })).toBe('PDF')
    expect(fileTypeText({ mediaType: 'application/x-unknown', name: toInertText('notes.md') })).toBe('MD')
    expect(fileTypeText({ name: toInertText('README') })).toBeUndefined()
  })

  test('icons follow the claimed type', () => {
    expect(fileIcon({ mediaType: 'application/pdf' })).toBe('file-pdf-box')
    expect(fileIcon({ mediaType: 'image/png' })).toBe('file-image-outline')
    expect(fileIcon({})).toBe('file-outline')
  })
})
