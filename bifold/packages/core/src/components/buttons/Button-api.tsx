import { View } from 'react-native'

export enum ButtonType {
  Critical,
  Primary,
  Secondary,
  Tertiary,
  ModalCritical,
  ModalPrimary,
  ModalSecondary,
  ModalTertiary,
}

export interface ButtonProps extends React.PropsWithChildren {
  title: string
  buttonType: ButtonType
  accessibilityLabel?: string
  accessibilityHint?: string
  maxfontSizeMultiplier?: number
  testID?: string
  onPress?: () => void
  disabled?: boolean
}

export enum ButtonState {
  Default = 'default',
  Disabled = 'disabled',
  Active = 'active',
}

export enum ButtonStyleNames {
  Critical_Default = 'Critical' + '_' + ButtonState.Default,
  Critical_Disabled = 'Critical' + '_' + ButtonState.Disabled,
  Critical_Active = 'Critical' + '_' + ButtonState.Active,
}

export type Button = React.FC<ButtonProps & React.RefAttributes<View>>
