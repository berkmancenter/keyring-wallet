import { useTheme } from '@bifold/core'
import React from 'react'
import Svg, { Circle, Line, Path, Rect, SvgProps } from 'react-native-svg'

/**
 * The picture on the notifications onboarding step and in Settings →
 * Notifications: a phone with a banner that says only that something waits
 * (Keyring's notifications carry no content), and a bell. It replaces bifold's
 * picture, which was another wallet's artwork.
 *
 * Drawn from the theme's colours, so it follows the theme; the backdrop is the
 * brand colour at low opacity, as EmptyList's circle is, and reads on a light
 * or a dark background.
 */
const NotificationsIllustration: React.FC<SvgProps> = (props) => {
  const { ColorPalette } = useTheme()
  const brand = ColorPalette.brand.primary
  const accent = ColorPalette.brand.highlight
  const surface = ColorPalette.grayscale.white
  const quiet = ColorPalette.grayscale.lightGrey

  return (
    <Svg width="100%" height="100%" viewBox="0 0 200 200" fill="none" {...props}>
      <Circle cx={100} cy={104} r={86} fill={brand} fillOpacity={0.12} />
      {/* The phone */}
      <Rect x={62} y={28} width={76} height={144} rx={14} fill={surface} stroke={brand} strokeWidth={4} />
      <Line x1={90} y1={38} x2={110} y2={38} stroke={brand} strokeWidth={3} strokeLinecap="round" />
      <Line x1={88} y1={162} x2={112} y2={162} stroke={brand} strokeWidth={3} strokeLinecap="round" />
      {/* A banner with no words in it: only that something waits */}
      <Rect x={48} y={60} width={104} height={38} rx={9} fill={surface} stroke={brand} strokeWidth={3} />
      <Rect x={56} y={68} width={22} height={22} rx={6} fill={brand} />
      <Circle cx={67} cy={76.5} r={3.6} fill={surface} />
      <Path d="M65.6 79.5h2.8l0.9 6h-4.6z" fill={surface} />
      <Line x1={86} y1={73} x2={140} y2={73} stroke={quiet} strokeWidth={5} strokeLinecap="round" />
      <Line x1={86} y1={85} x2={124} y2={85} stroke={quiet} strokeWidth={5} strokeLinecap="round" />
      {/* The screen behind it, quiet */}
      <Rect x={74} y={110} width={52} height={8} rx={4} fill={brand} fillOpacity={0.1} />
      <Rect x={74} y={126} width={40} height={8} rx={4} fill={brand} fillOpacity={0.1} />
      {/* The bell */}
      <Circle cx={146} cy={44} r={18} fill={accent} stroke={surface} strokeWidth={3} />
      <Path d="M146 34.5c-4.4 0-7.4 3.3-7.4 7.6v4.6l-2.4 3.2h19.6l-2.4-3.2v-4.6c0-4.3-3-7.6-7.4-7.6z" fill={brand} />
      <Circle cx={146} cy={52.6} r={2.6} fill={brand} />
    </Svg>
  )
}

export default NotificationsIllustration
