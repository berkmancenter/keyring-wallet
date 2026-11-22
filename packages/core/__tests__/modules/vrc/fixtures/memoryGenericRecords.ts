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
    // Copies, as a real store deserializes: changing a record read here changes nothing until it is written back.
    findAllByQuery: jest.fn(async (query: Record<string, string>) =>
      records
        .filter((record) => Object.entries(query).every(([key, value]) => record.tags[key] === value))
        .map((record) => ({ ...record, content: { ...record.content }, tags: { ...record.tags } }))
    ),
    update: jest.fn(async (record: MemoryRecord) => {
      const index = records.findIndex((existing) => existing.id === record.id)
      if (index < 0) throw new Error(`no record ${record.id}`)
      records[index] = record
    }),
    deleteById: jest.fn(async (id: string) => {
      const index = records.findIndex((record) => record.id === id)
      if (index >= 0) records.splice(index, 1)
    }),
  }
}
