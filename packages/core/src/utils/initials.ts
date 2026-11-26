/**
 * A person's initials for a round avatar: the first letters of the first two words of their name, or "?" without a
 * name. Shared by the rooms identity sheet and the community directory.
 *
 * @module utils/initials
 */
export const initialsOf = (name?: string): string => {
  const letters = (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('')
  return letters || '?'
}
