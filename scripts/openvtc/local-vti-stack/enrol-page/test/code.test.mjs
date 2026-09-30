import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enrolmentCode, CROCKFORD } from '../code.mjs'

test('enrolment code test vector', () => {
  const code = enrolmentCode('AAAAAAAAAAAAAAAAAAAAAA', 'did:peer:2.Vz6MkTEST')
  console.log(`vector: nonce="AAAAAAAAAAAAAAAAAAAAAA" did="did:peer:2.Vz6MkTEST" -> ${code}`)
  assert.equal(code, 'N4SP-X7H6')
})

test('code shape', () => {
  const code = enrolmentCode('x', 'did:peer:2.Vz6Mkabc')
  assert.match(code, new RegExp(`^[${CROCKFORD}]{4}-[${CROCKFORD}]{4}$`))
})
