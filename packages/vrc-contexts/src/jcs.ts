/**
 * JCS — JSON Canonicalization Scheme (RFC 8785)
 *
 * Deterministic serialization used for the VWC `credentialSubject.digest`:
 * the witness hashes the canonical form of the observed VRC so any party can
 * recompute the same digest from the same JSON data, regardless of key order
 * or which JSON library produced it.
 *
 * Implementation notes:
 * - Property names are sorted by UTF-16 code units — exactly what
 *   `Array.prototype.sort()` does with no comparator (RFC 8785 §3.2.3).
 * - Number and string serialization defers to ECMAScript's `JSON.stringify`,
 *   which is what RFC 8785 specifies (§3.2.2).
 * - `undefined` object members are dropped and `undefined` array elements
 *   become `null`, matching `JSON.stringify` behavior.
 *
 * This replaces the previous `JSON.stringify(x, Object.keys(x).sort())`
 * approach, which only sorted TOP-LEVEL keys — nested objects (proof,
 * credentialSubject, evidence…) kept arbitrary insertion order, so the
 * digest was only stable while a single code path did the serializing.
 */

/**
 * Serialize a JSON-compatible value into its RFC 8785 canonical form.
 *
 * @throws TypeError on values with no JSON representation (functions,
 *   symbols, BigInt) or non-finite numbers, same as `JSON.stringify`.
 */
export function jcsCanonicalize(value: unknown): string {
  if (value === undefined) {
    throw new TypeError('Cannot canonicalize undefined')
  }
  if (value === null || typeof value !== 'object') {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) {
      throw new TypeError(`Cannot canonicalize value of type ${typeof value}`)
    }
    return serialized
  }
  if (Array.isArray(value)) {
    return '[' + value.map((element) => (element === undefined ? 'null' : jcsCanonicalize(element))).join(',') + ']'
  }

  const record = value as Record<string, unknown>
  const parts: string[] = []
  // Default sort() compares UTF-16 code units — the JCS property order
  for (const key of Object.keys(record).sort()) {
    const member = record[key]
    if (member === undefined) continue
    parts.push(JSON.stringify(key) + ':' + jcsCanonicalize(member))
  }
  return '{' + parts.join(',') + '}'
}
