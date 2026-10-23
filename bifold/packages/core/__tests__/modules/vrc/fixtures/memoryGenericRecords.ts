/** An in-memory stand-in for agent.genericRecords: save, query by tags, delete by id. */
export interface MemoryRecord {
  id: string
  content: Record<string, unknown>
  tags: Record<string, string>
}

export function memoryGenericRecords(initial: MemoryRecord[] = []) {
  const records: MemoryRecord[] = [...initial]
  let next = initial.length
  return {
    records,
    save: jest.fn(async ({ content, tags }: { content: Record<string, unknown>; tags: Record<string, string> }) => {
      const record = { id: `record-${++next}`, content, tags }
      records.push(record)
      return record
    }),
    findAllByQuery: jest.fn(async (query: Record<string, string>) =>
      records.filter((record) => Object.entries(query).every(([key, value]) => record.tags[key] === value))
    ),
    deleteById: jest.fn(async (id: string) => {
      const index = records.findIndex((record) => record.id === id)
      if (index >= 0) records.splice(index, 1)
    }),
  }
}
