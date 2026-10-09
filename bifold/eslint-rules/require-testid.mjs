// require-testid: every interactive JSX element carries a testID, or sits under a JSX
// ancestor that does. The test drivers find controls by testID; an untagged control is
// one the harness has to reach through text or layout, which breaks on the next copy or
// layout change. A spread attribute may carry testID, so an element with one is treated
// as tagged. A control inside a View with pointerEvents="none" is display only (the row
// takes the press), so it is exempt.

const INTERACTIVE_NAMES = new Set([
  'Pressable',
  'PressableOpacity',
  'TouchableOpacity',
  'TouchableWithoutFeedback',
  'TouchableHighlight',
  'TextInput',
  'Switch',
  'Button',
  'IconButton',
  'Link',
  'LimitedTextInput',
  'CheckBoxRow',
])

const INTERACTIVE_PROPS = new Set(['onPress', 'onChangeText', 'onValueChange'])

const elementName = (nameNode) => {
  if (!nameNode) return ''
  if (nameNode.type === 'JSXIdentifier') return nameNode.name
  if (nameNode.type === 'JSXMemberExpression') {
    return `${elementName(nameNode.object)}.${elementName(nameNode.property)}`
  }
  if (nameNode.type === 'JSXNamespacedName') {
    return `${nameNode.namespace.name}:${nameNode.name.name}`
  }
  return ''
}

const lastSegment = (name) => name.split('.').pop()

const attributeNamed = (opening, attrName) =>
  opening.attributes.find((attr) => attr.type === 'JSXAttribute' && attr.name?.name === attrName)

const hasSpread = (opening) => opening.attributes.some((attr) => attr.type === 'JSXSpreadAttribute')

const literalValue = (attr) => {
  if (!attr || !attr.value) return undefined
  if (attr.value.type === 'Literal') return attr.value.value
  if (attr.value.type === 'JSXExpressionContainer' && attr.value.expression.type === 'Literal') {
    return attr.value.expression.value
  }
  return undefined
}

const isInteractive = (opening) => {
  const name = lastSegment(elementName(opening.name))
  if (INTERACTIVE_NAMES.has(name)) return true
  return opening.attributes.some((attr) => attr.type === 'JSXAttribute' && INTERACTIVE_PROPS.has(attr.name?.name))
}

const isTagged = (opening) => Boolean(attributeNamed(opening, 'testID')) || hasSpread(opening)

const isPointerEventsNoneView = (opening) =>
  lastSegment(elementName(opening.name)) === 'View' && literalValue(attributeNamed(opening, 'pointerEvents')) === 'none'

const coveredByAncestor = (node, sourceCode, context) => {
  const ancestors = sourceCode.getAncestors ? sourceCode.getAncestors(node) : context.getAncestors()
  return ancestors.some((ancestor) => {
    if (ancestor.type !== 'JSXElement') return false
    const opening = ancestor.openingElement
    return Boolean(attributeNamed(opening, 'testID')) || isPointerEventsNoneView(opening)
  })
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'interactive JSX elements carry a testID, or sit under a JSX ancestor that does',
    },
    schema: [],
    messages: {
      missing: '{{name}} needs a testID (or a tagged ancestor)',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode()
    return {
      JSXOpeningElement(node) {
        if (!isInteractive(node)) return
        if (isTagged(node)) return
        if (coveredByAncestor(node, sourceCode, context)) return
        context.report({
          node,
          messageId: 'missing',
          data: { name: elementName(node.name) },
        })
      },
    }
  },
}
