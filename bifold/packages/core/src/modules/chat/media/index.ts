export { IMAGE_MEDIA_TYPES, readImageHeader, sniffMediaType } from './imageHeader'
export type { ImageHeader, ImageMediaType } from './imageHeader'
export {
  MAX_ANIMATION_PIXELS,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  MAX_IMAGE_SIDE,
  checkImageAttachment,
  sizeFailure,
} from './checkAttachment'
export type { CheckedImage, ImageAttachmentDescriptor, ImageCheckFailure, ImageCheckResult } from './checkAttachment'
