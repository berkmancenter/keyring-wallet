/**
 * The small icon and accent colour Android shows on a notification. They were
 * the upstream wallet's (a wallet glyph, its blue) until a notification was
 * first shown on a real phone. The icon is Keyring's mark, white on
 * transparent as Android requires, at the five densities; the colour is the
 * brand colour from the theme.
 */
import fs from 'fs'
import path from 'path'

const APP = path.join(__dirname, '..', '..')
const RES = path.join(APP, 'android', 'app', 'src', 'main', 'res')

// 24dp at each density.
const SIZES: Record<string, number> = { mdpi: 24, hdpi: 36, xhdpi: 48, xxhdpi: 72, xxxhdpi: 96 }

describe('the Android notification icon', () => {
  it.each(Object.entries(SIZES))('exists at %s, %i px square, with an alpha channel', (density, px) => {
    const png = fs.readFileSync(path.join(RES, `drawable-${density}`, 'ic_notification.png'))
    // PNG: 8-byte signature, then IHDR: width, height (big-endian), bit depth, colour type.
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect(png.readUInt32BE(16)).toBe(px)
    expect(png.readUInt32BE(20)).toBe(px)
    expect([4, 6]).toContain(png.readUInt8(25)) // grey+alpha or RGBA
  })

  it('is the icon the manifest names for notifications', () => {
    const manifest = fs.readFileSync(path.join(APP, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8')
    expect(manifest).toMatch(/default_notification_icon"\s+android:resource="@drawable\/ic_notification"/)
    expect(manifest).toMatch(/default_notification_color"\s+android:resource="@color\/primary"/)
  })

  it('is tinted with the brand colour from the theme', () => {
    const theme = fs.readFileSync(path.join(APP, 'src', 'keyring-theme', 'theme.ts'), 'utf8')
    const brand = theme.match(/const BRAND_PURPLE = '(#[0-9A-Fa-f]{6})'/)?.[1]
    expect(brand).toBeDefined()
    const colors = fs.readFileSync(path.join(RES, 'values', 'colors.xml'), 'utf8')
    expect(colors.toUpperCase()).toContain(`<COLOR NAME="PRIMARY">${brand!.toUpperCase()}</COLOR>`)
  })
})
