/**
 * Build-time stand-in for bifold's `modules/rooms/sample/sampleRooms`, substituted by `metro.config.js`'s
 * `resolveRequest` unless `ROOMS_SAMPLE=1`. A store build carries no sample rooms at all: with this stub in
 * place, `useRoomsService` sees no sample service (`sampleRoomsBundled` is false), and Developer settings
 * offer no rooms switch. The sample's marker string is therefore absent from the bundle, which
 * `scripts/ci/check-no-rooms-sample.sh` checks on every release bundle CI builds.
 */
export const createSampleRoomsService = undefined
