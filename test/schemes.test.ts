import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkFunding, checkSchemes, loadFunding, type Scheme } from '../src/schemes'

function scheme (overrides: Partial<Scheme> = {}): Scheme {
  return {
    id: 'test-scheme',
    type: 'loan',
    name: 'Test scheme',
    provider: 'Test provider',
    summary: 'A scheme for tests.',
    url: 'https://www.example.com/test',
    checkedOn: '2026-10-01',
    eligibility: ['Any business'],
    ...overrides
  }
}

test('the example funding data is valid', () => {
  const funding = loadFunding()

  assert.equal(funding.example, true)
  assert.ok(funding.schemes.length > 0)
})

test('problems with the funding data are reported', () => {
  assert.deepEqual(checkSchemes('nope'), ['Schemes must be a list'])
  assert.deepEqual(checkSchemes([scheme()]), [])

  const problems = checkSchemes([
    scheme({ id: 'Bad Id', url: 'http://example.com', checkedOn: '09/09/2026' }),
    { ...scheme({ id: 'two' }), type: 'mortgage' },
    scheme({ id: 'two', amount: { min: 10, max: 5 } }),
    { ...scheme({ id: 'three' }), eligibility: 'everyone' }
  ])

  assert.deepEqual(problems, [
    'Bad Id: id must use lower case letters and numbers, joined by hyphens or underscores',
    'Bad Id: url must start with https://',
    'Bad Id: checkedOn must be a date like 2026-10-08',
    'two: type must be one of loan, grant, equity',
    'two: id is used more than once',
    'two: amount must have a min no bigger than its max',
    'three: eligibility must be a list of text'
  ])
})

test('the API will not start with bad funding data', () => {
  assert.throws(() => checkFunding({ schemes: [scheme()] }, 'the test data'), /Problems with the test data:\nexample must be true or false/)
})
