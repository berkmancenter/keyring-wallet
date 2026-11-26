/**
 * The directory statement said once per rule (276.10, option A): fields that
 * read alike share a heading and a line, and nothing of the statement is
 * dropped on the way, since the request names this statement as shown.
 */
import { digestMultibase } from '@bifold/trust-tasks'
import { render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { readDirectoryDisclosure, type DisclosedField } from '../module/directoryDisclosure'
import { DirectoryDisclosureCard, groupFields } from '../screens/DirectoryDisclosureCard'

import { statement, statementBody } from './fixtures/directoryStatement'

const field = (
  label: string,
  source: DisclosedField['source'],
  defaultVisibility: DisclosedField['defaultVisibility'],
  ceiling: DisclosedField['ceiling'],
  searchable = false
): DisclosedField => ({ key: label.toLowerCase(), label, type: 'text', source, defaultVisibility, ceiling, searchable })

/** First Person First VTC's ten fields, as its statement read on 276.10. */
const firstPerson: DisclosedField[] = [
  field('Name', 'member', 'members', 'public', true),
  field('Nickname', 'member', 'admins', 'public', true),
  field('Picture', 'member', 'admins', 'public'),
  field('Pronouns', 'member', 'admins', 'public'),
  field('About', 'member', 'admins', 'public'),
  field('Links', 'member', 'admins', 'public'),
  field('Role', 'derived', 'members', 'members'),
  field('Joined', 'derived', 'admins', 'members'),
  field('DID', 'derived', 'admins', 'members'),
  field('Personhood', 'derived', 'admins', 'members'),
]

const labels = (groups: ReturnType<typeof groupFields>) =>
  groups.map((g) => g.rules.map((r) => r.fields.map(({ field: f }) => f.label)))

describe('groupFields', () => {
  it('ten fields read as two writers and five rules', () => {
    expect(labels(groupFields(firstPerson))).toEqual([
      [['Name'], ['Nickname'], ['Picture', 'Pronouns', 'About', 'Links']],
      [['Role'], ['Joined', 'DID', 'Personhood']],
    ])
  })

  it('keeps every field exactly once, with its place in the statement, under its own values', () => {
    // Out of order on purpose: a later field joins the group and rule of an earlier one.
    const mixed = [firstPerson[6], firstPerson[0], firstPerson[9], firstPerson[2], firstPerson[1], firstPerson[3]]
    const groups = groupFields(mixed)
    const placed = groups.flatMap((g) => g.rules.flatMap((r) => r.fields.map(({ index }) => index)))
    expect([...placed].sort((a, b) => a - b)).toEqual(mixed.map((_, i) => i))
    for (const g of groups) {
      for (const r of g.rules) {
        for (const { field: f, index } of r.fields) {
          expect(f).toBe(mixed[index])
          expect([f.source, f.ceiling, f.defaultVisibility, f.searchable]).toEqual([
            g.source,
            g.ceiling,
            r.defaultVisibility,
            r.searchable,
          ])
        }
      }
    }
  })
})

describe('the card', () => {
  it('one heading per writer, one line per rule, every field named', () => {
    const disclosure = { ...readDirectoryDisclosure(statement()), fields: firstPerson }
    const tree = render(
      <BasicAppContext>
        <DirectoryDisclosureCard disclosure={disclosure} community="First Person First VTC" />
      </BasicAppContext>
    )
    expect(tree.getAllByText('Directory.GroupHeading')).toHaveLength(2)
    expect(tree.getAllByText(/^Directory\.RuleShows/)).toHaveLength(5)
    firstPerson.forEach((f, i) =>
      expect(tree.getByTestId(testIdWithKey(`DirectoryDisclosureField_${i}`))).toHaveTextContent(
        // The matcher trims, so a name inside a list reads with its comma and no space.
        new RegExp(`^${f.label},?$`)
      )
    )
    // Search is said once per rule that allows it: Name's, and Nickname's.
    expect(tree.getAllByText(/Directory\.Searchable/)).toHaveLength(2)
  })

  it('shows the statement the request names: its own labels and descriptions, byte for byte', () => {
    const disclosure = readDirectoryDisclosure(statement())
    // The digest the request carries is the one over this very statement.
    expect(disclosure.statementDigest).toBe(digestMultibase(statementBody()))
    const tree = render(
      <BasicAppContext>
        <DirectoryDisclosureCard disclosure={disclosure} community="Test VTC" />
      </BasicAppContext>
    )
    statementBody().fields.forEach((f, i) => {
      const shown = tree.getByTestId(testIdWithKey(`DirectoryDisclosureField_${i}`))
      expect(shown).toHaveTextContent(f.label, { exact: false })
      if (f.description) expect(shown).toHaveTextContent(f.description, { exact: false })
    })
  })
})
