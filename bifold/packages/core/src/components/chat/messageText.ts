/**
 * What a chat message reads as in words: the timeline's bubble text, a reply's quote of it, and the message toast.
 * One rule, so the three cannot drift apart.
 *
 * @module components/chat/messageText
 */

import type { ChatEventRecord } from '../../modules/chat/records/ChatEventRecord'

/**
 * Its text; else, with no caption, the photo label for a photo this phone kept, or the unsupported label for an
 * attachment it could not check or save (never called a photo); else nothing.
 */
export function messageTextOf(
  record: Pick<ChatEventRecord, 'content' | 'attachments'>,
  labels: { photo?: string; unsupported?: string }
): string {
  if (record.content?.text) return record.content.text
  if (record.attachments?.some((a) => !('unsupported' in a))) return labels.photo ?? ''
  if (record.attachments?.length) return labels.unsupported ?? ''
  return ''
}
