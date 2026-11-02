// What a page of Messages or a room says, read from its source. Pure: no driver.

/** The handles on a page for an id with this prefix (`RoomName_`, `RoomOfferRow_`), first seen first. */
export const roomHandles = (page, prefix) =>
  [...new Set([...String(page).matchAll(new RegExp(`${prefix}([A-Za-z0-9_-]+)`, "g"))].map((m) => m[1]))];

/** The room's failure states: none of these is on the page of a room that read and posted. */
const TROUBLE = [
  "RoomPostsFailed",
  "RoomPostsUnavailable",
  "RoomReadFailed",
  "RoomPollFailed",
  "RoomHostConflict",
  "RoomComposerUnavailable",
  "RoomPostNotSent",
];

/** Which failure states the page shows. */
export const troubleOn = (page) => TROUBLE.filter((id) => String(page).includes(id));
