/**
 * WitnessConnections Screen
 *
 * Displays all witness connections and allows the user to:
 * - See which witness is currently active
 * - Switch the active witness (only one active at a time)
 * - Remove a witness connection
 *
 * To connect to a witness, scan their QR code or click their invitation link —
 * witness connections are established the same way as any other contact.
 */

import React, { useEffect, useRef, useState } from 'react'
import {
  View,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Animated,
} from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { useWitnessConnection } from '../context/WitnessConnectionProvider'
import type { ConnectedWitness } from '../context/WitnessConnectionProvider'

/**
 * Format a date for display
 */
const formatDate = (date: Date): string => {
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Shorten a DID for display
 */
const shortenDid = (did: string): string => {
  if (did.length <= 24) return did
  return `${did.substring(0, 12)}...${did.substring(did.length - 8)}`
}

const WitnessConnections: React.FC = () => {
  const { ColorPalette, TextTheme } = useTheme()
  const {
    allWitnessConnections,
    connectedWitness,
    setActiveWitness,
    removeWitness,
    disconnectWitness,
    recentlyAutoActivatedWitness,
    clearAutoActivatedNotification,
  } = useWitnessConnection()

  // Notification banner state
  const [notificationName, setNotificationName] = useState<string | null>(null)
  const [notificationType, setNotificationType] = useState<'success' | 'info' | null>(null)
  const notificationOpacity = useRef(new Animated.Value(0)).current
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Track the previous connected witness to detect changes
  const prevConnectedWitnessRef = useRef<string | undefined>(undefined)
  const isMountedRef = useRef(false)

  const dismissNotification = () => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = null
    }
    Animated.timing(notificationOpacity, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setNotificationName(null)
      setNotificationType(null)
    })
  }

  // Show notification when connectedWitness changes (manual selection or deselection)
  useEffect(() => {
    // Skip on initial mount
    if (!isMountedRef.current) {
      isMountedRef.current = true
      prevConnectedWitnessRef.current = connectedWitness?.connectionId
      return
    }

    const prevId = prevConnectedWitnessRef.current
    const currId = connectedWitness?.connectionId

    // No change
    if (prevId === currId) return

    // Clear auto-activated notification if it exists (we'll show our own)
    if (recentlyAutoActivatedWitness) {
      clearAutoActivatedNotification()
    }

    // Determine notification content
    if (currId && connectedWitness) {
      // A witness was selected (new or different)
      setNotificationName(connectedWitness.name)
      setNotificationType('success')
    } else {
      // All witnesses were deselected
      setNotificationName('')
      setNotificationType('info')
    }

    // Update the ref
    prevConnectedWitnessRef.current = currId

    // Fade in
    Animated.timing(notificationOpacity, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start()

    // Auto-dismiss after 5 seconds
    dismissTimerRef.current = setTimeout(dismissNotification, 5000)

    return () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedWitness, clearAutoActivatedNotification])

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: ColorPalette.brand.primaryBackground,
    },
    notification: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      marginHorizontal: 16,
      marginTop: 12,
      borderRadius: 8,
    },
    notificationSuccess: {
      backgroundColor: '#28a745',
    },
    notificationInfo: {
      backgroundColor: '#6c757d',
    },
    notificationText: {
      ...TextTheme.normal,
      color: '#fff',
      marginLeft: 8,
      flex: 1,
    },
    listContent: {
      padding: 16,
    },
    witnessItem: {
      backgroundColor: ColorPalette.brand.secondaryBackground,
      borderRadius: 10,
      padding: 16,
      marginBottom: 12,
      flexDirection: 'row',
      alignItems: 'center',
    },
    activeWitnessItem: {
      borderWidth: 2,
      borderColor: ColorPalette.brand.primary,
    },
    radioContainer: {
      marginRight: 12,
    },
    witnessInfo: {
      flex: 1,
    },
    witnessName: {
      ...TextTheme.bold,
      fontSize: 16,
      color: TextTheme.normal.color,
      marginBottom: 2,
    },
    activeWitnessName: {
      color: ColorPalette.brand.primary,
    },
    eventName: {
      ...TextTheme.normal,
      fontSize: 13,
      color: ColorPalette.grayscale.mediumGrey,
      marginBottom: 2,
    },
    witnessDid: {
      ...TextTheme.normal,
      fontSize: 11,
      color: ColorPalette.grayscale.mediumGrey,
      fontFamily: 'monospace',
      marginBottom: 2,
    },
    connectedDate: {
      ...TextTheme.normal,
      fontSize: 11,
      color: ColorPalette.grayscale.mediumGrey,
    },
    activeBadge: {
      backgroundColor: ColorPalette.brand.primary,
      borderRadius: 4,
      paddingHorizontal: 6,
      paddingVertical: 2,
      alignSelf: 'flex-start',
      marginBottom: 4,
    },
    activeBadgeText: {
      color: '#fff',
      fontSize: 10,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    removeButton: {
      padding: 8,
      marginLeft: 4,
    },
    emptyContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      paddingVertical: 64,
    },
    emptyIcon: {
      marginBottom: 16,
      opacity: 0.4,
    },
    emptyTitle: {
      ...TextTheme.bold,
      fontSize: 18,
      color: TextTheme.normal.color,
      textAlign: 'center',
      marginBottom: 8,
    },
    emptySubtext: {
      ...TextTheme.normal,
      fontSize: 14,
      color: ColorPalette.grayscale.mediumGrey,
      textAlign: 'center',
      lineHeight: 20,
    },
    sectionHeader: {
      ...TextTheme.normal,
      fontSize: 12,
      color: ColorPalette.grayscale.mediumGrey,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: 8,
      marginTop: 4,
    },
  })

  const handleRemove = (witness: ConnectedWitness) => {
    Alert.alert(
      'Remove Witness',
      `Remove "${witness.name}"? This will delete the contact and its connection from your wallet.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removeWitness(witness.connectionId),
        },
      ]
    )
  }

  const renderWitnessItem = ({ item }: { item: ConnectedWitness }) => {
    const isActive = connectedWitness?.connectionId === item.connectionId

    const handlePress = () => {
      if (isActive) {
        // Deselect this witness
        disconnectWitness()
      } else {
        // Select this witness
        setActiveWitness(item.connectionId)
      }
    }

    return (
      <TouchableOpacity
        style={[styles.witnessItem, isActive && styles.activeWitnessItem]}
        onPress={handlePress}
        accessible={true}
        accessibilityRole="radio"
        accessibilityState={{ checked: isActive }}
        accessibilityLabel={`${item.name}${isActive ? ', active witness, tap to deselect' : ''}`}
      >
        {/* Radio indicator */}
        <View style={styles.radioContainer}>
          <Icon
            name={isActive ? 'radiobox-marked' : 'radiobox-blank'}
            size={24}
            color={isActive ? ColorPalette.brand.primary : ColorPalette.grayscale.mediumGrey}
          />
        </View>

        {/* Witness info */}
        <View style={styles.witnessInfo}>
          {isActive && (
            <View style={styles.activeBadge}>
              <ThemedText style={styles.activeBadgeText}>Active</ThemedText>
            </View>
          )}
          <ThemedText style={[styles.witnessName, isActive && styles.activeWitnessName]}>
            {item.name}
          </ThemedText>
          {item.eventName && (
            <ThemedText style={styles.eventName}>📅 {item.eventName}</ThemedText>
          )}
          <ThemedText style={styles.witnessDid}>{shortenDid(item.issuerDid)}</ThemedText>
          <ThemedText style={styles.connectedDate}>
            Connected {formatDate(item.connectedAt)}{isActive ? ' • Tap to deselect' : ''}
          </ThemedText>
        </View>

        {/* Remove button */}
        <TouchableOpacity
          style={styles.removeButton}
          onPress={() => handleRemove(item)}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${item.name}`}
        >
          <Icon name="close-circle-outline" size={22} color={ColorPalette.grayscale.mediumGrey} />
        </TouchableOpacity>
      </TouchableOpacity>
    )
  }

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Icon
        name="shield-off-outline"
        size={64}
        color={ColorPalette.grayscale.mediumGrey}
        style={styles.emptyIcon}
      />
      <ThemedText style={styles.emptyTitle}>No Witness Connections</ThemedText>
      <ThemedText style={styles.emptySubtext}>
        To connect to a witness, scan their QR code or tap their invitation link. Witness connections work
        just like regular contacts — you'll be added here automatically.
      </ThemedText>
    </View>
  )

  return (
    <View style={styles.container}>
      {/* Selection/Deselection notification */}
      {notificationName !== null && (
        <Animated.View
          style={[
            styles.notification,
            notificationType === 'success' ? styles.notificationSuccess : styles.notificationInfo,
            { opacity: notificationOpacity },
          ]}
        >
          <Icon
            name={notificationType === 'success' ? 'check-circle' : 'information-outline'}
            size={20}
            color="#fff"
          />
          <ThemedText style={styles.notificationText}>
            {notificationType === 'success'
              ? `"${notificationName}" is now your active witness`
              : 'No active witness selected'}
          </ThemedText>
          <TouchableOpacity
            onPress={dismissNotification}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Dismiss notification"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="close" size={18} color="#fff" />
          </TouchableOpacity>
        </Animated.View>
      )}

      <FlatList
        data={allWitnessConnections}
        keyExtractor={(item) => item.connectionId}
        renderItem={renderWitnessItem}
        contentContainerStyle={[
          styles.listContent,
          allWitnessConnections.length === 0 && { flex: 1 },
        ]}
        ListHeaderComponent={
          allWitnessConnections.length > 0 ? (
            <ThemedText style={styles.sectionHeader}>
              {allWitnessConnections.length} witness{allWitnessConnections.length === 1 ? '' : 'es'} — tap to select or deselect
            </ThemedText>
          ) : null
        }
        ListEmptyComponent={renderEmpty}
      />
    </View>
  )
}

export default WitnessConnections
