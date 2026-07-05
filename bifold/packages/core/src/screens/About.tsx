import React from 'react'
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useTheme } from '../contexts/theme'

const About: React.FC = () => {
  const { ColorPalette, TextTheme } = useTheme()

  const styles = StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: ColorPalette.brand.primaryBackground,
    },
    scrollContent: {
      padding: 24,
      paddingBottom: 48,
    },
    body: {
      ...TextTheme.normal,
      lineHeight: 24,
      marginBottom: 16,
    },
    bold: {
      fontWeight: '700',
    },
    heading: {
      ...TextTheme.normal,
      fontWeight: '700',
      fontSize: 18,
      marginTop: 12,
      marginBottom: 8,
    },
    bullet: {
      ...TextTheme.normal,
      lineHeight: 24,
      marginBottom: 10,
      paddingLeft: 8,
    },
    link: {
      color: ColorPalette.brand.link,
      textDecorationLine: 'underline' as const,
    },
  })

  const openLink = (url: string) => Linking.openURL(url)

  return (
    <SafeAreaView style={styles.safeArea} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.body}>
          <Text style={styles.bold}>Keyring</Text> is an open-source digital wallet that gives you full control over
          your digital identity.
        </Text>

        <Text style={styles.body}>
          Create and manage decentralized identifiers, store verifiable credentials securely on your device, and exchange
          relationship credentials with others—no centralized intermediaries required.
        </Text>

        <Text style={styles.body}>
          When you meet someone in person, you can exchange privacy-preserving credentials that prove your connection. A
          witness service can verify these exchanges happened, adding credibility without compromising privacy.
        </Text>

        <Text style={styles.heading}>Key Features:</Text>

        <Text style={styles.bullet}>
          {'\u2022 '}
          <Text style={styles.bold}>Peer-to-peer credential exchange</Text> — Issue and receive cryptographically signed
          relationship credentials directly with others
        </Text>

        <Text style={styles.bullet}>
          {'\u2022 '}
          <Text style={styles.bold}>Witness verification</Text> — Get third-party attestation that a connection occurred
          in person
        </Text>

        <Text style={styles.bullet}>
          {'\u2022 '}
          <Text style={styles.bold}>Biometric security</Text> — Your device's fingerprint or facial recognition confirms
          you're the legitimate owner
        </Text>

        <Text style={styles.bullet}>
          {'\u2022 '}
          <Text style={styles.bold}>Privacy by design</Text> — Share only what you choose; your data stays on your
          device
        </Text>

        <Text style={styles.body}>
          Built with React Native for iOS and Android, Keyring is Apache 2.0 licensed open source software developed at
          the{' '}
          <Text style={styles.link} onPress={() => openLink('https://asml.cyber.harvard.edu/')}>
            Applied Social Media Lab
          </Text>{' '}
          at Harvard's Berkman Klein Center. It extends the{' '}
          <Text
            style={styles.link}
            onPress={() => openLink('https://github.com/openwallet-foundation/bifold-wallet')}
          >
            Bifold Wallet
          </Text>{' '}
          from the{' '}
          <Text style={styles.link} onPress={() => openLink('https://openwallet.foundation/')}>
            OpenWallet Foundation
          </Text>{' '}
          and{' '}
          <Text style={styles.link} onPress={() => openLink('https://github.com/bcgov/bc-wallet-mobile')}>
            BC Wallet Mobile
          </Text>{' '}
          from the Government of British Columbia.
        </Text>

        <Text style={styles.heading}>Source Code:</Text>

        <Text style={styles.bullet}>
          {'\u2022 '}
          <Text
            style={styles.link}
            onPress={() => openLink('https://github.com/berkmancenter/keyring-wallet')}
          >
            Keyring Wallet
          </Text>
        </Text>

        <Text style={styles.bullet}>
          {'\u2022 '}
          <Text
            style={styles.link}
            onPress={() => openLink('https://github.com/berkmancenter/keyring-bifold')}
          >
            Keyring Bifold
          </Text>
        </Text>

        <View style={{ marginTop: 8 }}>
          <Text
            style={[styles.body, styles.link]}
            onPress={() => openLink('https://asml.cyber.harvard.edu/advanced-digital-identity/')}
          >
            Learn more about the project
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

export default About
