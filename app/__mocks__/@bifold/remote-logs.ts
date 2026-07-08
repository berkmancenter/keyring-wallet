export enum RemoteLoggerEventTypes {
  ENABLE_REMOTE_LOGGING = 'RemoteLogging.Enable',
}

export type RemoteLoggerOptions = Record<string, unknown>

export const lokiTransport = jest.fn()

export class RemoteLogger {
  create() {
    return this
  }
  log() {}
  info() {}
  warn() {}
  error() {}
  debug() {}
  trace() {}
  test() {}
}
