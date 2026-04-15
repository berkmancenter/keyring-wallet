/**
 * WitnessChoiceModal Component
 *
 * Bottom-sheet modal that appears when a user attempts a witnessed exchange but the witness
 * is not freshly discoverable on the local network. Gives the user the choice
 * to proceed without witnessing or cancel.
 *
 * Uses the same bottom-sheet pattern as BiometricConfirmationModal for visual consistency.
 */

import React from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialIcons'

import { hitSlop } from '../../../constants'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import SafeAreaModal from '../../../components/modals/SafeAreaModal'

export interface WitnessChoiceModalProps {
  visible: boolean
  witnessName: string
  onProceedWithout: () => void
  onCancel: () => void
}

const WitnessChoiceModal: React.FC<WitnessChoiceModalProps> = ({
  visible,
  witnessName,
  onProceedWithout,
  onCancel,
}) => {
  const { ColorPalette, TextTheme } = useTheme()

  const styles = StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    safeAreaView: {
      backgroundColor: ColorPalette.brand.modalPrimaryBackground,
      borderTopRightRadius: 20,
      borderTopLeftRadius: 20,
    },
    container: {
      paddingHorizontal: 24,
      paddingBottom: 24,
    },
    headerView: {
      alignItems: 'flex-end',
      paddingTop: 12,
      paddingRight: 12,
    },
    contentContainer: {
      alignItems: 'center',
      paddingTop: 8,
    },
    iconContainer: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: '#f59e0b18',
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 20,
    },
    title: {
      ...TextTheme.headingThree,
      color: TextTheme.modalTitle?.color || TextTheme.headingThree.color,
      textAlign: 'center',
      marginBottom: 12,
    },
    message: {
      ...TextTheme.normal,
      color: TextTheme.modalNormal?.color || TextTheme.normal.color,
      textAlign: 'center',
      marginBottom: 16,
      paddingHorizontal: 16,
    },
    witnessNameHighlight: {
      ...TextTheme.normal,
      fontWeight: '600',
      color: ColorPalette.brand.primary,
    },
    infoNote: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: ColorPalette.notification.info || '#E3F2FD',
      borderRadius: 8,
      padding: 12,
      marginBottom: 24,
    },
    infoNoteText: {
      ...TextTheme.normal,
      fontSize: 13,
      color: ColorPalette.notification.infoText || TextTheme.normal.color,
      flex: 1,
      marginLeft: 8,
    },
    buttonsContainer: {
      gap: 12,
    },
  })

  return (
    <SafeAreaModal transparent={true} visible={visible} animationType="slide">
      <View style={styles.overlay}>
        <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeAreaView}>
          {/* Close button */}
          <View style={styles.headerView}>
            <TouchableOpacity
              accessibilityLabel="Close"
              accessibilityRole="button"
              testID={testIdWithKey('CloseWitnessChoiceModal')}
              onPress={onCancel}
              hitSlop={hitSlop}
            >
              <Icon name="close" size={28} color={ColorPalette.brand.modalIcon || ColorPalette.grayscale.black} />
            </TouchableOpacity>
          </View>

          <View style={styles.container}>
            <View style={styles.contentContainer}>
              {/* Warning icon */}
              <View style={styles.iconContainer}>
                <Icon name="wifi-off" size={40} color="#f59e0b" />
              </View>

              {/* Title */}
              <ThemedText style={styles.title}>Witness Unavailable</ThemedText>

              {/* Message */}
              <ThemedText style={styles.message}>
                The witness <ThemedText style={styles.witnessNameHighlight}>"{witnessName}"</ThemedText> is no longer discoverable on the local network.
              </ThemedText>

              {/* Info note */}
              <View style={styles.infoNote}>
                <Icon name="info-outline" size={20} color={ColorPalette.notification.infoIcon || '#1976D2'} />
                <ThemedText style={styles.infoNoteText}>
                  This may mean you've moved away from the witness location, or the witness has gone offline.
                </ThemedText>
              </View>
            </View>

            {/* Buttons */}
            <View style={styles.buttonsContainer}>
              <Button
                title="Proceed Without Witness"
                accessibilityLabel="Proceed without witness"
                testID={testIdWithKey('WitnessChoiceProceedWithout')}
                onPress={onProceedWithout}
                buttonType={ButtonType.Primary}
              />
              <Button
                title="Cancel"
                accessibilityLabel="Cancel"
                testID={testIdWithKey('WitnessChoiceCancel')}
                onPress={onCancel}
                buttonType={ButtonType.Secondary}
              />
            </View>
          </View>
        </SafeAreaView>
      </View>
    </SafeAreaModal>
  )
}

export default WitnessChoiceModal
