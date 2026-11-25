// Rule 3: an exported <Name>Ids map contributes every string value, nested or not.
export const FixtureScreenIds = {
  root: 'FixtureScreenRoot',
  steps: {
    first: 'FixtureScreenStepFirst',
    second: 'FixtureScreenStepSecond',
  },
  count: 3,
} as const

export const OtherIds = { only: 'FixtureOtherOnly' }

// Not exported and not named *Ids: neither contributes.
const privateIds = { hidden: 'FixtureHidden' }
export const fixtureLabels = { label: 'FixtureLabelNotAnId' }
export const useFixture = () => ({ privateIds, fixtureLabels })
