/**
 * WitnessStatusBanner Component
 *
 * Shows the active witness connection status at the top of VRC screens.
 * Displays the witness name/event and provides quick access to management.
 *
 * Appears when a witness is active; auto-hides when none is active.
 */

import React, { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Modal, Pressable } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { useWitnessConnection } from '../context/WitnessConnectionProvider'

export interface WitnessStatusBannerProps {
  /** Optional: callback when details are tapped */
  onDetailsPress?: () => void
  /** Optional: hide the banner even if connected */
  hidden?: boolean
}

/**
 * WitnessStatusBanner - Shows active witness connection status
 */
const WitnessStatusBanner: React.FC<WitnessStatusBannerProps> = ({ onDetailsPress, hidden = false }) => {
  const { connectedWitness, disconnectWitness } = useWitnessConnection()
  const [menuVisible, setMenuVisible] = useState(false)

  // Don't render if not connected or explicitly hidden
  if (!connectedWitness || hidden) {
    return null
  }

  const displayName = connectedWitness.eventName || connectedWitness.name

  const handleBannerPress = () => {
    if (onDetailsPress) {
      onDetailsPress()
    } else {
      setMenuVisible(true)
    }
  }

  const handleMenuClose = () => {
    setMenuVisible(false)
  }

  const handleViewDetails = () => {
    setMenuVisible(false)
    onDetailsPress?.()
  }

  const handleDeactivate = () => {
    setMenuVisible(false)
    disconnectWitness()
  }

  return (
    <>
      <TouchableOpacity style={styles.banner} onPress={handleBannerPress} activeOpacity={0.7}>
        <View style={styles.bannerContent}>
          <Icon name="shield-check" size={20} color="#fff" style={styles.bannerIcon} />
          <View style={styles.bannerTextContainer}>
            <Text style={styles.bannerTitle} numberOfLines={1}>
              Witness: {displayName}
            </Text>
            <Text style={styles.bannerSubtitle} numberOfLines={1}>
              {connectedWitness.name}
            </Text>
          </View>
          <Icon name="chevron-down" size={20} color="#fff" />
        </View>
      </TouchableOpacity>

      {/* Details Menu Modal */}
      <Modal visible={menuVisible} transparent={true} animationType="fade" onRequestClose={handleMenuClose}>
        <Pressable style={styles.modalOverlay} onPress={handleMenuClose}>
          <View style={styles.modalContent}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Active Witness</Text>
              <TouchableOpacity onPress={handleMenuClose}>
                <Icon name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>

            {/* Connection Details */}
            <View style={styles.detailsContainer}>
              <View style={styles.detailRow}>
                <Icon name="shield-check" size={20} color="#622C62" style={styles.detailIcon} />
                <View style={styles.detailTextContainer}>
                  <Text style={styles.detailLabel}>Name</Text>
                  <Text style={styles.detailValue}>{connectedWitness.name}</Text>
                </View>
              </View>

              {connectedWitness.eventName && (
                <View style={styles.detailRow}>
                  <Icon name="calendar" size={20} color="#667eea" style={styles.detailIcon} />
                  <View style={styles.detailTextContainer}>
                    <Text style={styles.detailLabel}>Event</Text>
                    <Text style={styles.detailValue}>{connectedWitness.eventName}</Text>
                  </View>
                </View>
              )}

              <View style={styles.detailRow}>
                <Icon name="identifier" size={20} color="#667eea" style={styles.detailIcon} />
                <View style={styles.detailTextContainer}>
                  <Text style={styles.detailLabel}>Witness DID</Text>
                  <Text style={styles.detailValue} numberOfLines={1} ellipsizeMode="middle">
                    {connectedWitness.issuerDid}
                  </Text>
                </View>
              </View>
            </View>

            {/* Actions */}
            <View style={styles.actionsContainer}>
              {onDetailsPress && (
                <TouchableOpacity style={styles.actionButton} onPress={handleViewDetails}>
                  <Icon name="information-outline" size={20} color="#667eea" />
                  <Text style={styles.actionButtonText}>View Details</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity style={[styles.actionButton, styles.deactivateButton]} onPress={handleDeactivate}>
                <Icon name="shield-off-outline" size={20} color="#dc3545" />
                <Text style={[styles.actionButtonText, styles.deactivateButtonText]}>Deactivate Witness</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  banner: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    backgroundColor: '#622C62',
    borderBottomColor: '#4A1F4B',
  },
  bannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bannerIcon: {
    marginRight: 8,
  },
  bannerTextContainer: {
    flex: 1,
    marginRight: 8,
  },
  bannerTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 2,
  },
  bannerSubtitle: {
    fontSize: 12,
    color: '#fff',
    opacity: 0.9,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    paddingBottom: 32,
    paddingHorizontal: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  detailsContainer: {
    marginBottom: 20,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  detailIcon: {
    marginRight: 12,
    marginTop: 2,
  },
  detailTextContainer: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  actionsContainer: {
    marginTop: 8,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#667eea',
    marginBottom: 12,
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#667eea',
    marginLeft: 8,
  },
  deactivateButton: {
    borderColor: '#dc3545',
  },
  deactivateButtonText: {
    color: '#dc3545',
  },
})

export default WitnessStatusBanner
