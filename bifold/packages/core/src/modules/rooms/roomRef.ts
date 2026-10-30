/**
 * What tells a room the community named none apart: its DID's last path segment, whole, else the end of its SCID
 * after "…", as a community's (`unnamedRef`). Shown with "(no name published yet)" (`Rooms.RoomById`), never as a
 * cut of the ID that reads like a name: the last 10 characters of `…:community-a-vtc` read "nity-a-vtc" (276.9).
 *
 * @module rooms/roomRef
 */
export function roomRef(roomId: string): string {
  const parts = roomId.split(':')
  const webvh = parts[1] === 'webvh'
  if (webvh && parts.length >= 5) {
    try {
      const last = decodeURIComponent(parts[parts.length - 1])
      if (last) return last
    } catch {
      // Not a path a person could read: the end of the SCID below.
    }
  }
  return `…${(webvh && parts[2] ? parts[2] : roomId).slice(-6)}`
}
