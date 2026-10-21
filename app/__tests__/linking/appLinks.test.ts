/**
 * The links Android opens in Keyring rather than a browser. An invitation is
 * shared as https://wallet.asml.berkmancenter.org/invite?oob=… or, when the
 * links service makes one, as the short /i/<id> (bifold #466). A short link
 * this filter does not claim opens in a browser, which shows the install page.
 * iOS claims the same paths through the site's apple-app-site-association.
 */
import fs from 'fs'
import path from 'path'

const manifest = fs.readFileSync(
  path.join(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
  'utf8'
)

/** Each verified app-link intent filter, as its <data> elements' attributes. */
const verifiedFilters = (): Record<string, string>[][] =>
  [...manifest.matchAll(/<intent-filter android:autoVerify="true">([\s\S]*?)<\/intent-filter>/g)].map(([, body]) =>
    [...body.matchAll(/<data ([^>]*?)\/>/g)].map(([, attrs]) =>
      Object.fromEntries([...attrs.matchAll(/android:(\w+)="([^"]*)"/g)].map(([, k, v]) => [k, v]))
    )
  )

const claims = (host: string, pathPrefix: string) =>
  verifiedFilters().some((data) =>
    data.some((d) => d.scheme === 'https' && d.host === host && d.pathPrefix === pathPrefix)
  )

describe('the invitation links Android opens in Keyring', () => {
  test('the long link: /invite on the wallet host', () => {
    expect(claims('wallet.asml.berkmancenter.org', '/invite')).toBe(true)
  })

  test('the short link: /i/ on the wallet host', () => {
    expect(claims('wallet.asml.berkmancenter.org', '/i/')).toBe(true)
  })

  test('nothing broader: not the whole wallet host, and the witness host keeps only /connect', () => {
    const data = verifiedFilters().flat()
    expect(
      data
        .filter((d) => d.host === 'wallet.asml.berkmancenter.org')
        .map((d) => d.pathPrefix)
        .sort()
    ).toEqual(['/i/', '/invite'])
    expect(data.filter((d) => d.host === 'witness.asml.berkmancenter.org').map((d) => d.pathPrefix)).toEqual([
      '/connect',
    ])
  })
})
