/**
 * LocalityPreflightModal
 *
 * The witness-connect pre-flight sheet (locality-plan.md §8.4 row 2, §10.3
 * items 8 and 11). Shown at most once per install, right after a NEW witness
 * connection completes, primed by `WitnessConnectionProvider`'s
 * `localityPreflight` state. Two concerns share this one sheet rather than
 * two — §8.4's governing principle is that locality "must not add a second
 * question to the ceremony", and both concerns are pre-ceremony, about the
 * same radio leg, at the same moment: (1) priming the OS Bluetooth
 * permission request before it fires (item 8), and (2) naming what the
 * locality assertion discloses if confirmed — venue, time window, witness
 * name (§9.1) — before it happens rather than after (item 11's remaining
 * "what will be shared" half; the three-state reader/renderer half of item
 * 11 already exists in `WitnessCredentialHandler.ts`).
 *
 * Two states, matching §8.4's sequencing exactly:
 *  - Offer: always shown first, regardless of whether this witness's policy
 *    is `offered` or `required` (the wallet can't reliably tell those apart
 *    from discovery alone — see the plan's §8.2; only `required` is
 *    distinguishable, via `requiredExt`).
 *  - Required-refusal: shown only if the user declines AND
 *    `getWitnessLocalityRequirement` confirmed `required` — "say so now...
 *    never mid-ceremony."
 *
 * Declining reuses the SAME `useLocalityConfirmation` setting Settings →
 * Secure Exchanges exposes (`resolveLocalityPreflight` flips it) — there is
 * no separate per-session "should this session advertise" flag to invent.
 *
 * Self-contained container, mounted once at the root beside
 * `RelationshipProposalModal`, same bottom-sheet visual pattern.
 *
 * SCOPE NOTE, stated so it isn't overclaimed: this component requests the
 * Android 31+ runtime permissions the native module's manifest actually
 * declares (`BLUETOOTH_ADVERTISE`, `BLUETOOTH_SCAN`). It does NOT request
 * pre-API-31 `ACCESS_FINE_LOCATION` — the manifest doesn't declare that
 * permission at all (locality-plan.md §10.3 item 9's own write-up), so
 * requesting it here would silently no-op; adding it is a manifest change,
 * not a sheet change, and is left as a known gap rather than papered over.
 * iOS never shows this sheet — there is no native peripheral to prime a
 * permission for yet.
 */

import React, { useState } from 'react'
import { Linking, StyleSheet, View } from 'react-native'
import { PERMISSIONS, RESULTS, request } from 'react-native-permissions'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import SafeAreaModal from '../../../components/modals/SafeAreaModal'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { useWitnessConnection } from '../context/WitnessConnectionProvider'

/** Best-effort: request both permissions the manifest declares; granted only if both are. */
async function requestBluetoothPermissions(): Promise<boolean> {
  const advertise = await request(PERMISSIONS.ANDROID.BLUETOOTH_ADVERTISE)
  const scan = await request(PERMISSIONS.ANDROID.BLUETOOTH_SCAN)
  return advertise === RESULTS.GRANTED && scan === RESULTS.GRANTED
}

const LocalityPreflightModal: React.FC = () => {
  const { localityPreflight, resolveLocalityPreflight } = useWitnessConnection()
  const { ColorPalette } = useTheme()
  const [busy, setBusy] = useState(false)
  // Only reached when the user declines a `required` witness — §8.4's
  // second, harder message, never shown first.
  const [showRequiredRefusal, setShowRequiredRefusal] = useState(false)

  if (!localityPreflight) return null
  const { witness, required } = localityPreflight
  const eventLabel = witness.eventName || witness.name

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
      paddingTop: 24,
    },
    title: {
      textAlign: 'center',
      marginBottom: 12,
    },
    body: {
      textAlign: 'center',
      marginBottom: 16,
    },
    buttonSpacer: {
      height: 12,
    },
  })

  const finish = (allow: boolean) => {
    setShowRequiredRefusal(false)
    resolveLocalityPreflight(allow)
  }

  const onAllow = async () => {
    setBusy(true)
    try {
      await requestBluetoothPermissions()
    } finally {
      setBusy(false)
      // Allowed is allowed regardless of the OS grant outcome — a denial
      // here surfaces later as `windowLost`/no observation, not as a
      // second prompt (§7.1's explicit-negative states already cover it).
      finish(true)
    }
  }

  const onNotNow = () => {
    if (required) {
      setShowRequiredRefusal(true)
      return
    }
    finish(false)
  }

  const onOpenSettings = async () => {
    await Linking.openSettings()
    finish(false)
  }

  const onContinueWithoutLocality = () => {
    finish(false)
  }

  return (
    <SafeAreaModal visible transparent animationType="slide">
      <View style={styles.overlay}>
        <SafeAreaView style={styles.safeAreaView} edges={['bottom']}>
          <View style={styles.container}>
            {showRequiredRefusal ? (
              <>
                <ThemedText
                  variant="headingThree"
                  style={styles.title}
                  testID={testIdWithKey('LocalityPreflightRequiredTitle')}
                  accessibilityRole="header"
                >
                  {`${eventLabel} requires in-person confirmation`}
                </ThemedText>
                <ThemedText style={styles.body}>
                  {`Exchanges here need Bluetooth confirmation that you're at the venue. You can allow it in
                  Settings, or continue without it and this exchange won't carry that confirmation.`}
                </ThemedText>
                <Button
                  title="Open settings"
                  accessibilityLabel="Open settings"
                  testID={testIdWithKey('LocalityPreflightOpenSettings')}
                  buttonType={ButtonType.Primary}
                  onPress={onOpenSettings}
                />
                <View style={styles.buttonSpacer} />
                <Button
                  title="Continue without it"
                  accessibilityLabel="Continue without it"
                  testID={testIdWithKey('LocalityPreflightContinueWithoutLocality')}
                  buttonType={ButtonType.Secondary}
                  onPress={onContinueWithoutLocality}
                />
              </>
            ) : (
              <>
                <ThemedText
                  variant="headingThree"
                  style={styles.title}
                  testID={testIdWithKey('LocalityPreflightTitle')}
                  accessibilityRole="header"
                >
                  {`${eventLabel} can confirm in-person meetings. Allow Bluetooth?`}
                </ThemedText>
                <ThemedText style={styles.body}>
                  If you allow it, exchanges here can be confirmed as in-person. The confirmation names the venue,
                  a time window, and this witness — not your exact location or who else you meet.
                </ThemedText>
                <Button
                  title="Allow"
                  accessibilityLabel="Allow"
                  testID={testIdWithKey('LocalityPreflightAllow')}
                  buttonType={ButtonType.Primary}
                  onPress={onAllow}
                  disabled={busy}
                />
                <View style={styles.buttonSpacer} />
                <Button
                  title="Not now"
                  accessibilityLabel="Not now"
                  testID={testIdWithKey('LocalityPreflightNotNow')}
                  buttonType={ButtonType.Secondary}
                  onPress={onNotNow}
                  disabled={busy}
                />
              </>
            )}
          </View>
        </SafeAreaView>
      </View>
    </SafeAreaModal>
  )
}

export default LocalityPreflightModal
