/**
 * The chat events shown as a line in the timeline rather than a bubble: a
 * change to the chat itself, not something said in it (today, a timer set for
 * disappearing messages). The timeline passes every one through, in order;
 * what each line says, and which of several changes is in force, is decided
 * where the event type is defined (the timer module).
 *
 * @module chat/systemEvents
 */

import type { ChatEventType } from './chatEvent'

export const SYSTEM_EVENT_TYPES: ReadonlySet<ChatEventType> = new Set<ChatEventType>(['timer'])
