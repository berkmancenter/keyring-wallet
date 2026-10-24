/**
 * hot-updater 0.36.18's Kysely adapter writes `enabled` and
 * `should_force_update` as JavaScript booleans when the provider is sqlite
 * (it converts only the JSON columns), and better-sqlite3 binds only numbers,
 * strings, bigints, buffers and null: every bundle insert failed with
 * "SQLite3 can only bind numbers, strings, bigints, buffers, and null".
 * The adapter reads both columns back with Boolean(), so binding 1/0 round-trips.
 */
const coerce = (value) => (typeof value === 'boolean' ? (value ? 1 : 0) : value)
const coerceArgs = (args) => args.map((arg) => (Array.isArray(arg) ? arg.map(coerce) : coerce(arg)))

const BINDING_METHODS = new Set(['all', 'get', 'run', 'iterate'])

const wrapStatement = (statement) =>
  new Proxy(statement, {
    get(target, property) {
      const value = target[property]
      if (typeof value !== 'function') return value
      if (BINDING_METHODS.has(property)) return (...args) => value.apply(target, coerceArgs(args))
      return value.bind(target)
    },
  })

/** A better-sqlite3 database whose statements bind booleans as 1/0. */
export const withBooleanBinding = (database) =>
  new Proxy(database, {
    get(target, property) {
      const value = target[property]
      if (property === 'prepare') return (sql) => wrapStatement(value.call(target, sql))
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
