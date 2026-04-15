import { GenericFn } from './fn'

export interface Setting {
  title: string
  subtitle?: string
  value?: string
  onPress?: GenericFn
  accessibilityLabel?: string
  testID?: string
  badge?: number
  toggle?: {
    value: boolean
    onValueChange: (newValue: boolean) => void
    activeColor?: string
  }
}

export interface SettingIcon {
  name: string
  size?: number
  style?: any
  action?: () => void
  accessibilityLabel?: string
  testID?: string
}

export interface SettingSection {
  header: {
    title: string
    icon: SettingIcon
    iconRight?: SettingIcon
    titleTestID?: string
  }
  data: Setting[]
}
