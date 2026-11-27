import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'
import { AGENT_COLORS } from '../components/agentStyle'

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0C1118' },
  camera: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22, paddingHorizontal: 16 },
  title: { fontFamily: 'SourceSans3-Bold', fontSize: 21, color: '#FFFFFF', textAlign: 'center' },
  frame: { width: 232, height: 232 },
  link: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  linkText: { fontFamily: 'SourceSans3-Bold', fontSize: 17, color: '#FFFFFF', textDecorationLine: 'underline' },
  paste: { padding: 16, gap: 12, backgroundColor: '#F4F4F5' },
  label: { fontFamily: 'SourceSans3-Bold', fontSize: 17, color: AGENT_COLORS.text },
  input: {
    borderWidth: 1.5,
    borderColor: AGENT_COLORS.primary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'SourceSans3-Regular',
    fontSize: 16,
    color: AGENT_COLORS.text,
    backgroundColor: '#FFFFFF',
  },
})

export interface ConnectScanViewProps {
  /**
   * The camera, which reads a code and calls `onLink` with it. Passed in, so this view holds no camera permission
   * logic and a render test needs no camera.
   */
  camera: React.ReactNode
  /** A link read by the camera or pasted: the same path from here on (`scan` in the pairing machine). */
  onLink: (link: string) => void
}

/**
 * "Scan the code in your terminal" (§6 "Scan step"; canvas frame 2), with "Paste the link instead", the path that
 * needs no camera (§6, Accessibility). A pasted link goes where a scanned one goes.
 */
const ConnectScanView: React.FC<ConnectScanViewProps> = ({ camera, onLink }) => {
  const { t } = useTranslation()
  const [pasting, setPasting] = useState(false)
  const [link, setLink] = useState('')
  const pasted = link.trim()

  return (
    <View style={styles.screen} testID={testIdWithKey('ConnectScan')}>
      <View style={styles.camera}>
        <ThemedText style={styles.title} accessibilityRole="header">
          {t('ConnectedAgents.ScanTitle')}
        </ThemedText>
        {pasting ? null : <View style={styles.frame}>{camera}</View>}
        {pasting ? null : (
          <TouchableOpacity
            style={styles.link}
            onPress={() => setPasting(true)}
            testID={testIdWithKey('ConnectScanPaste')}
            accessibilityRole="button"
            accessibilityLabel={t('ConnectedAgents.PasteLinkInstead')}
          >
            <ThemedText style={styles.linkText}>{t('ConnectedAgents.PasteLinkInstead')}</ThemedText>
          </TouchableOpacity>
        )}
      </View>
      {pasting ? (
        <View style={styles.paste}>
          <ThemedText style={styles.label}>{t('ConnectedAgents.PasteLinkInstead')}</ThemedText>
          <TextInput
            style={styles.input}
            value={link}
            onChangeText={setLink}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={t('ConnectedAgents.PasteLinkInstead')}
            testID={testIdWithKey('ConnectScanLink')}
          />
          <Button
            title={t('Global.Continue')}
            buttonType={ButtonType.Primary}
            onPress={() => pasted && onLink(pasted)}
            disabled={!pasted}
            testID={testIdWithKey('ConnectScanLinkContinue')}
            accessibilityLabel={t('Global.Continue')}
          />
        </View>
      ) : null}
    </View>
  )
}

export default ConnectScanView
