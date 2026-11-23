import { describe, it } from 'node:test'
import { createRequire } from 'node:module'
import tsParser from '@typescript-eslint/parser'

import rule from './require-testid.mjs'

const require = createRequire(import.meta.url)
const { FlatRuleTester } = require('eslint/use-at-your-own-risk')

FlatRuleTester.describe = describe
FlatRuleTester.it = it
FlatRuleTester.itOnly = it.only

const tester = new FlatRuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
})

const missing = (name) => ({ messageId: 'missing', data: { name } })

tester.run('require-testid', rule, {
  valid: [
    {
      name: 'tagged Pressable',
      code: `const A = () => <Pressable onPress={go} testID={testIdWithKey('Go')} />`,
    },
    {
      name: 'Switch under a tagged Pressable row',
      code: `const A = () => (
        <Pressable onPress={go} testID={testIdWithKey('Row')}>
          <Switch value={on} onValueChange={set} />
        </Pressable>
      )`,
    },
    {
      name: 'Switch under a pointerEvents none View',
      code: `const A = () => (
        <View pointerEvents="none">
          <Switch value={on} />
        </View>
      )`,
    },
    {
      name: 'spread props may carry the testID',
      code: `const A = (props) => <TouchableOpacity {...props} />`,
    },
    {
      name: 'a plain View is not interactive',
      code: `const A = () => <View style={s.row}><Text>hi</Text></View>`,
    },
  ],
  invalid: [
    {
      name: 'untagged Pressable',
      code: `const A = () => <Pressable onPress={go} />`,
      errors: [missing('Pressable')],
    },
    {
      name: 'custom element with onPress',
      code: `const A = () => <Row onPress={go} />`,
      errors: [missing('Row')],
    },
    {
      name: 'Link without testID',
      code: `const A = () => <Link linkText={t('x')} onPress={go} />`,
      errors: [missing('Link')],
    },
    {
      name: 'an untagged ancestor does not cover the control',
      code: `const A = () => (
        <View style={s.row}>
          <Switch value={on} onValueChange={set} />
        </View>
      )`,
      errors: [missing('Switch')],
    },
  ],
})
