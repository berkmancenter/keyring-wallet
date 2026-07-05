/**
 * WitnessVerifiedBanner Component
 *
 * Displays a "Verified by Witness" banner on credential offer screens
 * when the credential is being offered after a successful witness verification.
 *
 * This banner indicates that the connection/exchange has been verified by a
 * trusted witness before the credential was offered.
 */

import React, { useEffect, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { witnessStatusStore, WitnessStatusMessage } from '../witnessStatusStore'
import { testIdWithKey } from '../../../utils/testable'

export interface WitnessVerifiedBannerProps {
  /** The connection ID to check for witness verification */
  connectionId?: string
  /** Optional: Hide the banner even if verified */
  hidden?: boolean
}

/**
 * WitnessVerifiedBanner - Shows "Verified by Witness" indicator on credential offers
 *
 * Checks if the connection has a 'witness-complete' status, indicating that
 * a witness verification was successfully completed before the credential offer.
 */
const WitnessVerifiedBanner: React.FC<WitnessVerifiedBannerProps> = ({ connectionId, hidden = false }) => {
  const { ColorPalette: _ColorPalette, TextTheme } = useTheme()
  const [witnessStatus, setWitnessStatus] = useState<WitnessStatusMessage | null>(null)

  useEffect(() => {
    if (!connectionId || hidden) {
      return
    }

    // Check for existing witness completion status
    const checkWitnessStatus = () => {
      const statuses = witnessStatusStore.getStatuses(connectionId)
      // Find a 'witness-complete' status
      const completeStatus = statuses.find((s) => s.status === 'witness-complete')
      setWitnessStatus(completeStatus || null)
    }

    // Initial check
    checkWitnessStatus()

    // Listen for status updates
    const handleStatusUpdate = ({ connectionId: updatedConnectionId }: { connectionId: string }) => {
      if (updatedConnectionId === connectionId) {
        checkWitnessStatus()
      }
    }

    witnessStatusStore.on('statusUpdate', handleStatusUpdate)

    return () => {
      witnessStatusStore.off('statusUpdate', handleStatusUpdate)
    }
  }, [connectionId, hidden])

  // Don't render if no connectionId, hidden, or no witness verification
  if (!connectionId || hidden || !witnessStatus) {
    return null
  }

  const styles = StyleSheet.create({
    banner: {
      backgroundColor: 'rgba(163, 73, 164, 0.15)',
      borderColor: '#A349A4',
      borderWidth: 1,
      borderRadius: 8,
      marginHorizontal: 15,
      marginTop: 16,
      marginBottom: 8,
      paddingHorizontal: 16,
      paddingVertical: 12,
      flexDirection: 'row',
      alignItems: 'center',
    },
    iconContainer: {
      marginRight: 12,
    },
    textContainer: {
      flex: 1,
    },
    title: {
      ...TextTheme.bold,
      fontSize: 14,
      color: '#A349A4',
      marginBottom: 2,
    },
    subtitle: {
      ...TextTheme.normal,
      fontSize: 12,
      color: '#A349A4',
      opacity: 0.9,
    },
  })

  // Format witness name for display
  const witnessName = witnessStatus.witnessName || 'Witness'

  return (
    <View style={styles.banner} testID={testIdWithKey('WitnessVerifiedBanner')}>
      <View style={styles.iconContainer}>
        <Icon
          name="check-decagram"
          size={28}
          color="#A349A4"
          testID={testIdWithKey('WitnessVerifiedIcon')}
        />
      </View>
      <View style={styles.textContainer}>
        <ThemedText style={styles.title} testID={testIdWithKey('WitnessVerifiedTitle')}>
          Verified Exchange
        </ThemedText>
        <ThemedText style={styles.subtitle} testID={testIdWithKey('WitnessVerifiedSubtitle')}>
          Verified by {witnessName}
        </ThemedText>
      </View>
      <Icon name="check-circle" size={20} color="#A349A4" />
    </View>
  )
}

export default WitnessVerifiedBanner
