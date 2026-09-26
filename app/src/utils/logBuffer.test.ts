import { LOG_BUFFER_CAPACITY, clearLogBuffer, getRecentLogLines, recordLogLine } from './logBuffer'

const at = (start: number, seconds: number) => new Date(start + seconds * 1000)

describe('the log buffer keeps what happened, not the mediator polling', () => {
  beforeEach(() => clearLogBuffer())
  const t0 = Date.parse('2026-09-25T09:00:00.000Z')

  test('a vetting line from 30 minutes back survives half an hour of polling', () => {
    recordLogLine(
      'info',
      ['[TrustTasks:VtaClient] asked the vetter https://trusttasks.org/spec/vetting/request/0.1'],
      at(t0, 0)
    )
    // Half an hour of an idle app: every second a status-request, its status
    // answer, and a service lookup — 5,400 lines, enough to flush 3,000 twice.
    for (let s = 1; s <= 1800; s++) {
      recordLogLine('debug', ['Pack outbound message https://didcomm.org/messagepickup/3.0/status-request'], at(t0, s))
      recordLogLine(
        'info',
        ['Received message with type https://didcomm.org/messagepickup/3.0/status', { message_count: 0 }],
        at(t0, s)
      )
      recordLogLine('debug', ["Retrieving services for connection '1' (Mediator)"], at(t0, s))
    }
    const lines = getRecentLogLines()
    expect(lines.length).toBeLessThan(LOG_BUFFER_CAPACITY)
    expect(lines.some((l) => l.includes('vetting/request'))).toBe(true)
    const summaries = lines.filter((l) => l.includes('mediator polling in this minute'))
    // One per minute, the current one included.
    expect(summaries.length).toBeGreaterThanOrEqual(30)
    expect(summaries[1]).toMatch(
      /60 status requests, 60 statuses, 60 service lookups, no messages \(180 lines collapsed\)/
    )
  })

  test('polling that carries a message waiting, or trouble, is kept as it came', () => {
    recordLogLine(
      'info',
      ['Received message with type https://didcomm.org/messagepickup/3.0/status', { message_count: 2 }],
      at(t0, 1)
    )
    recordLogLine('warn', ['messagepickup/3.0/status-request failed'], at(t0, 2))
    recordLogLine('debug', ['Pack outbound message https://didcomm.org/messagepickup/3.0/status-request'], at(t0, 3))
    const lines = getRecentLogLines()
    expect(lines.filter((l) => l.includes('message_count'))).toHaveLength(1)
    expect(lines.some((l) => l.includes('WARN') && l.includes('failed'))).toBe(true)
    expect(lines[lines.length - 1]).toMatch(/1 status requests/)
  })

  test('every other line is kept, in order', () => {
    recordLogLine('info', ['first'], at(t0, 0))
    recordLogLine('debug', ['Pack outbound message https://didcomm.org/messagepickup/3.0/status-request'], at(t0, 1))
    recordLogLine('info', ['second'], at(t0, 61))
    const lines = getRecentLogLines()
    expect(lines[0]).toMatch(/first$/)
    expect(lines[1]).toMatch(/mediator polling in this minute: 1 status requests/)
    expect(lines[2]).toMatch(/second$/)
  })
})
