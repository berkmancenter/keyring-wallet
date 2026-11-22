/**
 * `@abandonware/noble` ships no types and none are published for the fork.
 * The surface this service uses is stated in `trustTasks/NobleLocalityProvider.ts`
 * (`NobleLike` and friends); this shim only makes the dynamic import compile.
 * The module is an optional dependency — see that file's header.
 */
declare module '@abandonware/noble' {
  const noble: unknown
  export default noble
}
