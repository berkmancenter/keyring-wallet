/**
 * Words for a room's file: its size in the app's language ("84 KB", "1,2 Mo") and a short name for the type the
 * sharer gave it ("PDF"). The type is only what the post says it is: the bytes are never sniffed here, and the
 * sheet says it is the type as shared, not a verified one.
 *
 * @module rooms/components/fileWords
 */
import type { TFunction } from 'i18next'

import type { RoomFile } from '../types'

/** Languages that write a decimal comma. */
const DECIMAL_COMMA = /^(fr|pt)/i

/** "84 KB", "1.2 MB", "12 MB": decimal units (1 KB = 1000 bytes), one decimal under 10 MB, at least 1 KB. */
export function fileSizeText(t: TFunction, bytes: number, language = 'en'): string {
  const decimal = (n: number) => (DECIMAL_COMMA.test(language) ? String(n).replace('.', ',') : String(n))
  if (bytes < 1_000_000) return t('Rooms.SizeKB', { n: Math.max(1, Math.round(bytes / 1000)) }) as string
  const mb = bytes / 1_000_000
  return t('Rooms.SizeMB', { n: decimal(mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb)) }) as string
}

const TYPE_NAMES: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/heic': 'HEIC',
  'image/gif': 'GIF',
  'image/webp': 'WEBP',
  'text/plain': 'TXT',
  'text/csv': 'CSV',
  'application/zip': 'ZIP',
}

/** "PDF" for the type the sharer gave, else the name's extension; undefined when neither says. */
export function fileTypeText(file: Pick<RoomFile, 'mediaType' | 'name'>): string | undefined {
  if (file.mediaType && TYPE_NAMES[file.mediaType]) return TYPE_NAMES[file.mediaType]
  const extension = /\.([A-Za-z0-9]{1,5})$/.exec(String(file.name))?.[1]
  return extension?.toUpperCase()
}

/** The icon for a file's claimed type. */
export function fileIcon(file: Pick<RoomFile, 'mediaType'>): string {
  if (file.mediaType === 'application/pdf') return 'file-pdf-box'
  if (file.mediaType?.startsWith('image/')) return 'file-image-outline'
  return 'file-outline'
}
