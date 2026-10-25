/**
 * A community card as a pass: the community's own colour and pattern, its monogram or logo, its name once, what the
 * card is, one date and, when it is soon, how long it has left. Shaped like a payment card (1.586:1), so a stack of
 * them reads like a wallet: the top strip (monogram, name, kind) is what shows when the pass is tucked behind another.
 *
 * Until the community's look is known (useCommunityBrand), the pass is a neutral dark face with the same white text,
 * so nothing but the colour changes when it arrives.
 *
 * @module trust-tasks/components/CommunityPass
 */
import React from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import Svg, { Circle, G, Path } from 'react-native-svg'

import { testIdWithKey } from '../../../utils/testable'
import type { CommunityBrand, PassPattern } from '../module/communityBrand'
import type { Known } from '../module/useCommunityBrand'
import type { PassFace } from '../screens/communityPass'

/** The pass's shape (ID-1, as a payment card). */
export const PASS_ASPECT = 1.586
/** The strip that shows when a pass is tucked behind the next one. */
export const PASS_STRIP = 62
const NEUTRAL = '#4A4F57'

function Pattern({ pattern }: { pattern: PassPattern }) {
  const stroke = { stroke: '#FFFFFF', strokeOpacity: 0.13, fill: 'none' }
  return (
    <Svg
      width="100%"
      height="100%"
      viewBox="0 0 358 226"
      preserveAspectRatio="xMidYMid slice"
      style={StyleSheet.absoluteFill}
    >
      {pattern === 'waves' ? (
        <G {...stroke} strokeWidth={1.4}>
          {[120, 138, 156, 174, 192, 210].map((y) => (
            <Path key={y} d={`M0 ${y} Q 45 ${y - 16} 90 ${y} T 180 ${y} T 270 ${y} T 360 ${y}`} />
          ))}
        </G>
      ) : pattern === 'stripes' ? (
        <G stroke="#FFFFFF" strokeOpacity={0.11} strokeWidth={7}>
          {[120, 160, 200, 240].map((x) => (
            <Path key={x} d={`M${x} -10L${x + 220} 210`} />
          ))}
        </G>
      ) : pattern === 'rings' ? (
        <G {...stroke} strokeWidth={1.2}>
          {[30, 52, 74, 96, 118].map((r) => (
            <Circle key={r} cx={330} cy={200} r={r} />
          ))}
        </G>
      ) : (
        <G fill="#FFFFFF" fillOpacity={0.13}>
          {[150, 168, 186].flatMap((y, row) =>
            [0, 1, 2, 3, 4].map((i) => <Circle key={`${y}-${i}`} cx={250 + i * 20 + (row % 2) * 10} cy={y} r={2.5} />)
          )}
        </G>
      )}
    </Svg>
  )
}

export interface CommunityPassProps {
  face: PassFace
  brand: Known<CommunityBrand>
  /** The pass in front: its dates show. A pass behind shows its strip only. */
  front: boolean
  onPress: () => void
  /** A problem with the card the Wallet knows of ("Revoked"), as the card before the pass showed it. */
  status?: string
}

export const CommunityPass: React.FC<CommunityPassProps> = ({ face, brand, front, onPress, status }) => {
  const look = brand.known ? brand.value : undefined
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={status ? `${face.accessibilityLabel}, ${status}` : face.accessibilityLabel}
      testID={testIdWithKey('CommunityPass')}
      style={[styles.pass, { backgroundColor: look?.color ?? NEUTRAL }]}
    >
      {look ? <Pattern pattern={look.pattern} /> : null}
      <View style={styles.strip}>
        <View style={styles.mark} testID={testIdWithKey('CommunityPassMark')}>
          {look?.logo ? (
            <Image
              source={{ uri: look.logo }}
              style={styles.logo}
              accessibilityIgnoresInvertColors
              testID={testIdWithKey('CommunityPassLogo')}
            />
          ) : (
            <Text style={styles.monogram}>{look?.monogram ?? ''}</Text>
          )}
        </View>
        <View style={styles.titleBlock}>
          <Text style={styles.title} numberOfLines={1} testID={testIdWithKey('CommunityPassTitle')}>
            {face.title}
          </Text>
          {face.agent ? (
            <Text style={styles.note} numberOfLines={1} testID={testIdWithKey('CommunityPassAgent')}>
              {face.agent}
            </Text>
          ) : front && face.unnamedNote ? (
            <Text style={styles.note} numberOfLines={1}>
              {face.unnamedNote}
            </Text>
          ) : null}
        </View>
        {status ? (
          <Text style={styles.statusPill} testID={testIdWithKey('CommunityPassStatus')}>
            {status}
          </Text>
        ) : face.lapsing ? (
          <Text style={styles.pill} testID={testIdWithKey('CommunityPassLapsing')}>
            {face.lapsing}
          </Text>
        ) : null}
        <Text style={styles.kind} numberOfLines={1}>
          {face.kind}
        </Text>
      </View>
      {front ? (
        <View style={styles.fields}>
          {face.field ? (
            <View style={styles.fieldBlock}>
              <Text style={styles.label}>{face.field.label}</Text>
              <Text style={styles.value}>{face.field.value}</Text>
            </View>
          ) : null}
          {face.secondField ? (
            <View style={[styles.fieldBlock, styles.right]}>
              <Text style={styles.label}>{face.secondField.label}</Text>
              <Text style={styles.secondValue}>{face.secondField.value}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  pass: {
    width: '100%',
    aspectRatio: PASS_ASPECT,
    borderRadius: 14,
    overflow: 'hidden',
    // The same elevation on every pass: Android orders siblings by elevation and only falls back to drawing order
    // when it is equal, so a front pass lifted higher would turn the stack over on Android but not on iOS.
    elevation: 4,
    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -1 },
  },
  strip: { height: PASS_STRIP, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  mark: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: { width: 36, height: 36 },
  monogram: { color: '#FFFFFF', fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },
  titleBlock: { flex: 1, minWidth: 0 },
  title: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  note: { color: '#FFFFFF', opacity: 0.8, fontSize: 13 },
  pill: {
    backgroundColor: '#FFE8B3',
    color: '#5C3B00',
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  statusPill: {
    backgroundColor: '#FDE2E4',
    color: '#8A1020',
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  kind: {
    color: '#FFFFFF',
    opacity: 0.85,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  fields: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  fieldBlock: { gap: 2 },
  right: { alignItems: 'flex-end' },
  label: {
    color: '#FFFFFF',
    opacity: 0.75,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  value: { color: '#FFFFFF', fontSize: 24, fontWeight: '600' },
  secondValue: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
})

export default CommunityPass
