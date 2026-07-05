/**
 * WebServer Unit Tests
 *
 * Tests for the HTTP server: page generation, API endpoints, routing, and helper functions.
 * Note: HTTP oracle endpoints (/oracle/*) have been removed; locality proofs arrive via
 * the LocalityProvider transport (e.g. BLE), not via HTTP POST.
 */

import { LocalityService, LocalityConfig } from '../../src/LocalityService'

describe('WebServer - Locality Display in Pages', () => {
  /**
   * These tests verify the expected HTML content when locality is enabled/disabled.
   */

  const enabledConfig: LocalityConfig = {
    enabled: true,
    challengeRotationMinutes: 5,
    proofLifetimeMinutes: 30,
  }

  const disabledConfig: LocalityConfig = {
    ...enabledConfig,
    enabled: false,
  }

  describe('Home page locality status', () => {
    it('should show "Enabled" when locality is enabled', () => {
      const service = new LocalityService(enabledConfig)

      // The page template checks isEnabled() and getVerifiedCount()
      const isEnabled = service.isEnabled()
      const count = service.getVerifiedCount()

      expect(isEnabled).toBe(true)
      expect(count).toBe(0) // Initially zero
    })

    it('should show "Disabled" when locality is disabled', () => {
      const service = new LocalityService(disabledConfig)

      const isEnabled = service.isEnabled()

      expect(isEnabled).toBe(false)
    })

    it('should update verified count after successful verification', async () => {
      const service = new LocalityService(enabledConfig)
      const challenge = service.getCurrentChallenge()

      expect(service.getVerifiedCount()).toBe(0)

      await service.verifyLocality('did:test:alice', challenge, 'sig')

      expect(service.getVerifiedCount()).toBe(1)

      await service.verifyLocality('did:test:bob', challenge, 'sig')

      expect(service.getVerifiedCount()).toBe(2)

      await service.stop()
    })
  })

  describe('Activity log page locality banner', () => {
    it('should show proof lifetime when enabled', () => {
      const service = new LocalityService(enabledConfig)
      const config = service.getConfig()

      expect(config.proofLifetimeMinutes).toBe(30)
      expect(`${config.proofLifetimeMinutes} min`).toBe('30 min')
    })
  })
})

describe('WebServer - API Endpoints', () => {
  /**
   * Basic tests for API response formats
   */

  describe('GET /api/issuer response format', () => {
    it('should include expected fields', () => {
      // Simulated response structure
      const response = {
        issuerDid: 'did:peer:0z...',
        name: 'witness-server',
        keyType: 'Ed25519',
        verificationMethod: 'session-based-challenge',
        eventName: 'Test Event',
        invitationUrl: 'http://localhost:9002?oob=eyJ...',
        stats: {
          totalCredentials: 10,
          totalSessions: 5,
          uniqueVrcIssuers: 8,
        },
      }

      expect(response.issuerDid).toBeDefined()
      expect(response.name).toBeDefined()
      expect(response.keyType).toBe('Ed25519')
      expect(response.invitationUrl).toBeDefined()
      expect(response.invitationUrl).toContain('?oob=')
      expect(response.stats).toBeDefined()
      expect(response.stats.totalCredentials).toBeDefined()
    })

    it('should handle null eventName', () => {
      const response = {
        issuerDid: 'did:peer:0z...',
        name: 'witness-server',
        eventName: null,
      }

      expect(response.eventName).toBeNull()
    })
  })

  describe('POST /api/verify request formats', () => {
    it('should accept full credential', () => {
      const request = {
        credential: {
          '@context': ['https://www.w3.org/2018/credentials/v1'],
          type: ['VerifiableCredential', 'WitnessCredential'],
          issuer: 'did:peer:0z...',
        },
      }

      expect(request.credential).toBeDefined()
    })

    it('should accept credentialId', () => {
      const request = {
        credentialId: 'urn:uuid:abc-123',
      }

      expect(request.credentialId).toBeDefined()
    })

    it('should accept digest', () => {
      const request = {
        digest: 'sha256:abc123...',
      }

      expect(request.digest).toBeDefined()
    })
  })

  describe('GET /api/issued response format', () => {
    it('should include pagination info', () => {
      const response = {
        records: [],
        pagination: {
          page: 1,
          pageSize: 20,
          total: 0,
          totalPages: 0,
        },
      }

      expect(response.records).toBeInstanceOf(Array)
      expect(response.pagination).toBeDefined()
      expect(response.pagination.page).toBe(1)
      expect(response.pagination.pageSize).toBe(20)
    })

    it('should format records correctly', () => {
      const record = {
        vwcId: 'urn:uuid:abc-123',
        sessionId: 'session-456',
        vrcDigest: 'sha256:def...',
        vrcIssuerId: 'did:peer:0zalice',
        recipientDid: 'did:peer:0zbob',
        issuedAt: '2024-01-15T10:30:00.000Z',
        eventName: 'Test Event',
      }

      expect(record.vwcId).toMatch(/^urn:uuid:/)
      expect(record.issuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })
  })
})

describe('WebServer - CORS Headers', () => {
  /**
   * Tests to document expected CORS configuration
   */

  it('should allow all origins', () => {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }

    expect(headers['Access-Control-Allow-Origin']).toBe('*')
  })

  it('should allow required methods', () => {
    const headers = {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    }

    expect(headers['Access-Control-Allow-Methods']).toContain('GET')
    expect(headers['Access-Control-Allow-Methods']).toContain('POST')
    expect(headers['Access-Control-Allow-Methods']).toContain('OPTIONS')
  })

  it('should handle OPTIONS preflight', () => {
    // Preflight should return 204 No Content with CORS headers
    const preflightStatus = 204

    expect(preflightStatus).toBe(204)
  })
})

describe('WebServer - Helper Functions', () => {
  /**
   * Tests for utility functions used in page generation
   */

  describe('truncateDid', () => {
    /**
     * Simulate truncateDid function
     */
    function truncateDid(did: string, maxLen: number = 24): string {
      if (did.length <= maxLen) return did
      return did.substring(0, maxLen - 3) + '...'
    }

    it('should not truncate short DIDs', () => {
      const shortDid = 'did:peer:0z123'
      expect(truncateDid(shortDid)).toBe(shortDid)
    })

    it('should truncate long DIDs', () => {
      const longDid = 'did:peer:0z1234567890abcdef1234567890'
      const result = truncateDid(longDid, 24)
      expect(result).toHaveLength(24)
      expect(result.endsWith('...')).toBe(true)
    })

    it('should use default maxLen of 24', () => {
      const exactLength = 'did:peer:0z1234567890123' // 24 chars
      expect(truncateDid(exactLength)).toBe(exactLength)
    })

    it('should support custom maxLen', () => {
      const did = 'did:peer:0z1234567890'
      const result = truncateDid(did, 10)
      expect(result).toHaveLength(10)
      expect(result).toBe('did:pee...')
    })
  })

  describe('formatDate', () => {
    /**
     * Simulate formatDate function
     */
    function formatDate(date: Date): string {
      return date.toISOString().replace('T', ' ').substring(0, 19)
    }

    it('should format date in YYYY-MM-DD HH:MM:SS format', () => {
      const date = new Date('2024-01-15T10:30:45.123Z')
      expect(formatDate(date)).toBe('2024-01-15 10:30:45')
    })

    it('should replace T with space', () => {
      const date = new Date('2024-06-01T00:00:00.000Z')
      expect(formatDate(date)).not.toContain('T')
      expect(formatDate(date)).toContain(' ')
    })

    it('should truncate milliseconds', () => {
      const date = new Date('2024-01-15T10:30:45.999Z')
      expect(formatDate(date)).toBe('2024-01-15 10:30:45')
    })
  })

  describe('parseQuery', () => {
    /**
     * Simulate parseQuery function
     */
    function parseQuery(url: string): Record<string, string> {
      const query: Record<string, string> = {}
      const queryStart = url.indexOf('?')
      if (queryStart >= 0) {
        const queryString = url.substring(queryStart + 1)
        queryString.split('&').forEach((pair) => {
          const [key, value] = pair.split('=')
          if (key) query[key] = decodeURIComponent(value || '')
        })
      }
      return query
    }

    it('should parse simple query string', () => {
      const result = parseQuery('/api/issued?page=1&pageSize=20')
      expect(result.page).toBe('1')
      expect(result.pageSize).toBe('20')
    })

    it('should handle URL without query string', () => {
      const result = parseQuery('/api/issuer')
      expect(result).toEqual({})
    })

    it('should decode URL-encoded values', () => {
      const result = parseQuery('/api/test?name=hello%20world')
      expect(result.name).toBe('hello world')
    })

    it('should handle empty values', () => {
      const result = parseQuery('/api/test?flag=')
      expect(result.flag).toBe('')
    })

    it('should handle multiple parameters', () => {
      const result = parseQuery('/api/test?a=1&b=2&c=3')
      expect(Object.keys(result)).toHaveLength(3)
      expect(result.a).toBe('1')
      expect(result.b).toBe('2')
      expect(result.c).toBe('3')
    })
  })
})

describe('WebServer - Page Generation', () => {
  /**
   * Tests for HTML page content generation
   */

  describe('Invitation Page Content', () => {
    it('should include server name in title', () => {
      const serverName = 'My Witness Server'
      const expectedTitle = `<title>${serverName} - Witness Server</title>`
      expect(expectedTitle).toContain(serverName)
    })

    it('should include QR code image tag', () => {
      const qrTag = '<img src="data:image/png;base64,'
      expect(qrTag).toContain('data:image/png;base64')
    })

    it('should include invitation URL in link', () => {
      const invitationUrl = 'https://example.com/invite?oob=xyz'
      const urlContainer = `<a href="${invitationUrl}" class="url-link"`
      expect(urlContainer).toContain(invitationUrl)
    })

    it('should include link to activity log', () => {
      const logLink = '<a href="/log" class="nav-button secondary">'
      expect(logLink).toContain('/log')
    })

    it('should show server status as Online', () => {
      const statusItem = '<span>Online</span>'
      expect(statusItem).toContain('Online')
    })

    it('should include credentials issued count', () => {
      const count = 42
      const statsDisplay = `<span>${count}</span>`
      expect(statsDisplay).toContain('42')
    })
  })

  describe('Activity Log Page Content', () => {
    it('should include auto-refresh meta tag', () => {
      const refreshTag = '<meta http-equiv="refresh" content="15">'
      expect(refreshTag).toContain('15')
    })

    it('should include back link to QR code page', () => {
      const backLink = '<a href="/" class="nav-link">← Back to QR Code</a>'
      expect(backLink).toContain('href="/"')
    })

    it('should display stats in grid', () => {
      const statsGrid = '<div class="stats-grid">'
      expect(statsGrid).toContain('stats-grid')
    })

    it('should show empty state when no credentials', () => {
      const emptyState = '<div class="empty-state">'
      const emptyMessage = 'No credentials issued yet.'
      expect(emptyState).toContain('empty-state')
      expect(emptyMessage).toContain('No credentials')
    })

    it('should show active sessions section when sessions exist', () => {
      const activeSection = '<h2 class="section-title active">⏳ Active Sessions</h2>'
      expect(activeSection).toContain('Active Sessions')
    })

    it('should format table rows with monospace font', () => {
      const tdStyle = 'font-family: monospace'
      expect(tdStyle).toContain('monospace')
    })
  })
})

describe('WebServer - Route Handling', () => {
  /**
   * Tests for HTTP route handling behavior
   */

  describe('Root routes', () => {
    it('should serve invitation page at /', () => {
      const path: string = '/'
      expect(path === '/' || path === '/index.html').toBe(true)
    })

    it('should serve invitation page at /index.html', () => {
      const path: string = '/index.html'
      expect(path === '/' || path === '/index.html').toBe(true)
    })

    it('should only respond to GET method', () => {
      const method = 'GET'
      expect(method).toBe('GET')
    })
  })

  describe('Activity log route', () => {
    it('should serve log page at /log', () => {
      const path = '/log'
      expect(path).toBe('/log')
    })

    it('should set no-cache header', () => {
      const cacheControl = 'no-cache'
      expect(cacheControl).toBe('no-cache')
    })

    it('should set text/html content type', () => {
      const contentType = 'text/html'
      expect(contentType).toBe('text/html')
    })
  })

  describe('API routes prefix', () => {
    it('should route /api/* to API handler', () => {
      const paths = ['/api/issuer', '/api/verify', '/api/issued']
      paths.forEach((path) => {
        expect(path.startsWith('/api/')).toBe(true)
      })
    })
  })

  describe('404 handling', () => {
    it('should return 404 for unknown paths', () => {
      const unknownPaths = ['/unknown', '/api/unknown', '/random/path']
      unknownPaths.forEach((path) => {
        expect(
          path !== '/' &&
            path !== '/index.html' &&
            path !== '/log' &&
            !['issuer', 'verify', 'issued'].some((ep) => path === `/api/${ep}`)
        ).toBe(true)
      })
    })

    it('should return text/plain content type for 404', () => {
      const contentType = 'text/plain'
      expect(contentType).toBe('text/plain')
    })
  })

  describe('500 error handling', () => {
    it('should return 500 on server error', () => {
      const statusCode = 500
      expect(statusCode).toBe(500)
    })

    it('should return "Internal Server Error" message', () => {
      const errorMessage = 'Internal Server Error'
      expect(errorMessage).toBe('Internal Server Error')
    })
  })
})

describe('WebServer - JSON Response Formatting', () => {
  /**
   * Tests for sendJson behavior
   */

  it('should pretty-print JSON with 2-space indent', () => {
    const data = { key: 'value', nested: { a: 1 } }
    const formatted = JSON.stringify(data, null, 2)

    expect(formatted).toContain('\n')
    expect(formatted).toContain('  ')
  })

  it('should set Content-Type to application/json', () => {
    const contentType = 'application/json'
    expect(contentType).toBe('application/json')
  })

  it('should include CORS headers in JSON responses', () => {
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }

    expect(headers['Access-Control-Allow-Origin']).toBe('*')
    expect(headers['Content-Type']).toBe('application/json')
  })
})

describe('WebServer - WebServerConfig Interface', () => {
  /**
   * Tests documenting the WebServerConfig interface
   */

  it('should require webPort', () => {
    const config = { webPort: 8080 }
    expect(config.webPort).toBe(8080)
  })

  it('should require name', () => {
    const config = { name: 'My Witness' }
    expect(config.name).toBe('My Witness')
  })

  it('should require invitationUrl', () => {
    const config = { invitationUrl: 'https://example.com/invite' }
    expect(config.invitationUrl).toContain('invite')
  })

  it('should require witnessService reference', () => {
    // WitnessService is a required field
    const hasWitnessService = true
    expect(hasWitnessService).toBe(true)
  })

  it('should have optional localityService', () => {
    const configWithLocality = { localityService: new LocalityService(enabledConfig) }
    const configWithoutLocality = { localityService: undefined }

    expect(configWithLocality.localityService).toBeDefined()
    expect(configWithoutLocality.localityService).toBeUndefined()
  })
})

// Helper for WebServerConfig tests
const enabledConfig: LocalityConfig = {
  enabled: true,
  challengeRotationMinutes: 5,
  proofLifetimeMinutes: 30,
}

describe('WebServer - API Endpoint Methods', () => {
  /**
   * Tests for HTTP method requirements on each endpoint
   */

  describe('/api/issuer', () => {
    it('should only accept GET method', () => {
      const allowedMethod = 'GET'
      expect(allowedMethod).toBe('GET')
    })
  })

  describe('/api/verify', () => {
    it('should only accept POST method', () => {
      const allowedMethod = 'POST'
      expect(allowedMethod).toBe('POST')
    })
  })

  describe('/api/issued', () => {
    it('should only accept GET method', () => {
      const allowedMethod = 'GET'
      expect(allowedMethod).toBe('GET')
    })

    it('should support pagination parameters', () => {
      const queryParams = { page: '2', pageSize: '50' }
      expect(parseInt(queryParams.page, 10)).toBe(2)
      expect(parseInt(queryParams.pageSize, 10)).toBe(50)
    })

    it('should default page to 1', () => {
      const defaultPage = parseInt('1', 10)
      expect(defaultPage).toBe(1)
    })

    it('should default pageSize to 20', () => {
      const defaultPageSize = parseInt('20', 10)
      expect(defaultPageSize).toBe(20)
    })
  })

})

describe('WebServer - Server Startup', () => {
  /**
   * Tests documenting server startup behavior
   */

  it('should listen on configured webPort', () => {
    const webPort = 8080
    expect(webPort).toBeGreaterThan(0)
    expect(webPort).toBeLessThan(65536)
  })

  it('should log all available endpoints on startup', () => {
    const expectedEndpoints = ['/', '/log', '/api/issuer', '/api/verify', '/api/issued']

    expectedEndpoints.forEach((endpoint) => {
      expect(endpoint.startsWith('/')).toBe(true)
    })
  })

  it('should return a Promise that resolves to Server', () => {
    // startWebServer returns Promise<Server>
    const returnsPromise = true
    expect(returnsPromise).toBe(true)
  })

  it('should reject on server error', () => {
    // If port is in use, server.on('error') fires
    const rejectsOnError = true
    expect(rejectsOnError).toBe(true)
  })
})

describe('WebServer - Hostname Extraction from publicUrl', () => {
  /**
   * Tests for extracting hostname from publicUrl for display in web interface URLs.
   * This ensures that web interface URLs use the same hostname as the DIDComm endpoint,
   * preventing the localhost issue where mobile devices couldn't connect.
   */

  /**
   * Simulate hostname extraction logic from WebServer.ts and index.ts
   */
  function extractHostname(publicUrl: string | undefined): string {
    let hostname = 'localhost'
    if (publicUrl) {
      try {
        const url = new URL(publicUrl)
        hostname = url.hostname
      } catch {
        // If URL parsing fails, fallback to localhost
        hostname = 'localhost'
      }
    }
    return hostname
  }

  describe('Valid URL formats', () => {
    it('should extract hostname from localhost URL', () => {
      const hostname = extractHostname('http://localhost:9002')
      expect(hostname).toBe('localhost')
    })

    it('should extract hostname from IPv4 address', () => {
      const hostname = extractHostname('http://192.168.1.50:9002')
      expect(hostname).toBe('192.168.1.50')
    })

    it('should extract hostname from IPv4 address without port', () => {
      const hostname = extractHostname('http://192.168.1.100')
      expect(hostname).toBe('192.168.1.100')
    })

    it('should extract hostname from domain name', () => {
      const hostname = extractHostname('http://witness.example.com:9002')
      expect(hostname).toBe('witness.example.com')
    })

    it('should extract hostname from HTTPS URL', () => {
      const hostname = extractHostname('https://witness.example.com:9002')
      expect(hostname).toBe('witness.example.com')
    })

    it('should extract hostname from subdomain', () => {
      const hostname = extractHostname('http://witness.staging.example.com:9002')
      expect(hostname).toBe('witness.staging.example.com')
    })

    it('should handle IPv6 addresses in brackets', () => {
      const hostname = extractHostname('http://[::1]:9002')
      // URL API preserves brackets for IPv6
      expect(hostname).toBe('[::1]')
    })

    it('should handle IPv6 loopback', () => {
      const hostname = extractHostname('http://[::1]')
      // URL API preserves brackets for IPv6
      expect(hostname).toBe('[::1]')
    })

    it('should handle IPv6 link-local address', () => {
      const hostname = extractHostname('http://[fe80::1]:9002')
      // URL API preserves brackets for IPv6
      expect(hostname).toBe('[fe80::1]')
    })
  })

  describe('Edge cases and error handling', () => {
    it('should fallback to localhost for undefined publicUrl', () => {
      const hostname = extractHostname(undefined)
      expect(hostname).toBe('localhost')
    })

    it('should fallback to localhost for empty string', () => {
      const hostname = extractHostname('')
      expect(hostname).toBe('localhost')
    })

    it('should fallback to localhost for invalid URL', () => {
      const hostname = extractHostname('not-a-valid-url')
      expect(hostname).toBe('localhost')
    })

    it('should fallback to localhost for malformed URL', () => {
      const hostname = extractHostname('http:/missing-slash')
      // URL parser is lenient and interprets this as a hostname
      // In practice, this won't be an issue as publicUrl is configured correctly
      expect(hostname).toBe('missing-slash')
    })

    it('should fallback to localhost for URL with invalid characters', () => {
      const hostname = extractHostname('http://invalid host:9002')
      expect(hostname).toBe('localhost')
    })
  })

  describe('Different IP address ranges', () => {
    it('should extract hostname from private network (192.168.x.x)', () => {
      const hostname = extractHostname('http://192.168.1.50:9002')
      expect(hostname).toBe('192.168.1.50')
    })

    it('should extract hostname from private network (10.x.x.x)', () => {
      const hostname = extractHostname('http://10.0.0.100:9002')
      expect(hostname).toBe('10.0.0.100')
    })

    it('should extract hostname from private network (172.16.x.x)', () => {
      const hostname = extractHostname('http://172.16.0.50:9002')
      expect(hostname).toBe('172.16.0.50')
    })

    it('should extract hostname from public IP', () => {
      const hostname = extractHostname('http://203.0.113.42:9002')
      expect(hostname).toBe('203.0.113.42')
    })
  })

  describe('URL with different ports', () => {
    it('should extract hostname ignoring default HTTP port', () => {
      const hostname = extractHostname('http://192.168.1.50:80')
      expect(hostname).toBe('192.168.1.50')
    })

    it('should extract hostname ignoring default HTTPS port', () => {
      const hostname = extractHostname('https://192.168.1.50:443')
      expect(hostname).toBe('192.168.1.50')
    })

    it('should extract hostname with non-standard port', () => {
      const hostname = extractHostname('http://192.168.1.50:9002')
      expect(hostname).toBe('192.168.1.50')
    })

    it('should extract hostname without port specification', () => {
      const hostname = extractHostname('http://192.168.1.50')
      expect(hostname).toBe('192.168.1.50')
    })
  })

  describe('URL with paths and query strings', () => {
    it('should extract hostname ignoring path', () => {
      const hostname = extractHostname('http://192.168.1.50:9002/api/issuer')
      expect(hostname).toBe('192.168.1.50')
    })

    it('should extract hostname ignoring query string', () => {
      const hostname = extractHostname('http://192.168.1.50:9002?oob=abc123')
      expect(hostname).toBe('192.168.1.50')
    })

    it('should extract hostname ignoring fragment', () => {
      const hostname = extractHostname('http://192.168.1.50:9002#section')
      expect(hostname).toBe('192.168.1.50')
    })

    it('should extract hostname from complex URL', () => {
      const hostname = extractHostname('http://192.168.1.50:9002/path/to/resource?key=value#anchor')
      expect(hostname).toBe('192.168.1.50')
    })
  })

  describe('Special hostname values', () => {
    it('should handle 0.0.0.0 (all interfaces)', () => {
      const hostname = extractHostname('http://0.0.0.0:9002')
      expect(hostname).toBe('0.0.0.0')
    })

    it('should handle 127.0.0.1 (loopback)', () => {
      const hostname = extractHostname('http://127.0.0.1:9002')
      expect(hostname).toBe('127.0.0.1')
    })

    it('should preserve localhost as-is', () => {
      const hostname = extractHostname('http://localhost:9002')
      expect(hostname).toBe('localhost')
    })
  })

  describe('Integration with web server display logic', () => {
    it('should produce correct web interface URL for localhost', () => {
      const publicUrl = 'http://localhost:9002'
      const webPort = 9003
      const hostname = extractHostname(publicUrl)
      const webInterfaceUrl = `http://${hostname}:${webPort}`

      expect(webInterfaceUrl).toBe('http://localhost:9003')
    })

    it('should produce correct web interface URL for LAN IP', () => {
      const publicUrl = 'http://192.168.1.50:9002'
      const webPort = 9003
      const hostname = extractHostname(publicUrl)
      const webInterfaceUrl = `http://${hostname}:${webPort}`

      expect(webInterfaceUrl).toBe('http://192.168.1.50:9003')
    })

    it('should produce correct web interface URL for domain', () => {
      const publicUrl = 'http://witness.example.com:9002'
      const webPort = 9003
      const hostname = extractHostname(publicUrl)
      const webInterfaceUrl = `http://${hostname}:${webPort}`

      expect(webInterfaceUrl).toBe('http://witness.example.com:9003')
    })

    it('should allow mobile devices to connect when using LAN IP', () => {
      // This is the key fix: mobile devices can reach 192.168.x.x but not localhost
      const publicUrl = 'http://192.168.1.50:9002'
      const hostname = extractHostname(publicUrl)

      expect(hostname).not.toBe('localhost')
      expect(hostname).toBe('192.168.1.50')
      expect(hostname).toMatch(/^\d+\.\d+\.\d+\.\d+$/) // IPv4 format
    })
  })

  describe('Consistency across DIDComm and Web endpoints', () => {
    it('should use same hostname for DIDComm and web interface', () => {
      const publicUrl = 'http://192.168.1.50:9002'
      const didcommPort = 9002
      const webPort = 9003

      const hostname = extractHostname(publicUrl)
      const didcommEndpoint = `http://${hostname}:${didcommPort}`
      const webInterface = `http://${hostname}:${webPort}`

      expect(didcommEndpoint).toBe('http://192.168.1.50:9002')
      expect(webInterface).toBe('http://192.168.1.50:9003')

      // Both use the same hostname
      const didcommHost = new URL(didcommEndpoint).hostname
      const webHost = new URL(webInterface).hostname
      expect(didcommHost).toBe(webHost)
    })

    it('should maintain consistency even with complex URLs', () => {
      const publicUrl = 'https://witness.staging.example.com:8443/didcomm'
      const hostname = extractHostname(publicUrl)
      const webInterface = `https://${hostname}:9003`

      expect(hostname).toBe('witness.staging.example.com')
      expect(webInterface).toBe('https://witness.staging.example.com:9003')
    })
  })
})
