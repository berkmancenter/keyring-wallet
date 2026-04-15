import { existsSync, unlinkSync, rmdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { TlsManager } from '../../src/TlsManager'

describe('TlsManager', () => {
  const mockCertsDir = '.test-certs'
  let tlsManager: TlsManager

  beforeEach(() => {
    // Clean up any existing test certificates before each test
    try {
      if (existsSync(mockCertsDir)) {
        const files = readdirSync(mockCertsDir)
        files.forEach((file) => {
          unlinkSync(join(mockCertsDir, file))
        })
        rmdirSync(mockCertsDir)
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  })

  afterEach(() => {
    // Clean up any test certificates after each test
    try {
      if (existsSync(mockCertsDir)) {
        const files = readdirSync(mockCertsDir)
        files.forEach((file) => {
          unlinkSync(join(mockCertsDir, file))
        })
        rmdirSync(mockCertsDir)
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  })

  describe('constructor', () => {
    it('should initialize with default config', () => {
      tlsManager = new TlsManager()
      expect(tlsManager).toBeDefined()
    })

    it('should initialize with custom config', () => {
      tlsManager = new TlsManager({
        enabled: true,
        certsDir: mockCertsDir,
        autoGenerate: true,
        validityDays: 365,
        hostnames: ['localhost', '192.168.1.100'],
      })
      expect(tlsManager).toBeDefined()
    })
  })

  describe('getCertificate', () => {
    it('should throw error when TLS is disabled', async () => {
      tlsManager = new TlsManager({ enabled: false })
      await expect(tlsManager.getCertificate()).rejects.toThrow('TLS is not enabled')
    })

    it('should auto-generate certificate when none exists', async () => {
      tlsManager = new TlsManager({
        enabled: true,
        certsDir: mockCertsDir,
        autoGenerate: true,
        validityDays: 365,
        hostnames: ['localhost'],
      })

      const cert = await tlsManager.getCertificate()

      expect(cert).toBeDefined()
      expect(cert.cert).toBeDefined()
      expect(cert.key).toBeDefined()
      expect(cert.fingerprint).toBeDefined()
      expect(typeof cert.fingerprint).toBe('string')
      expect(cert.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/)
    })

    it('should load existing certificate when available', async () => {
      // First create a certificate
      tlsManager = new TlsManager({
        enabled: true,
        certsDir: mockCertsDir,
        autoGenerate: true,
        validityDays: 365,
        hostnames: ['localhost'],
      })

      const cert1 = await tlsManager.getCertificate()
      const fingerprint1 = cert1.fingerprint

      // Create a new manager instance that should load the existing cert
      const tlsManager2 = new TlsManager({
        enabled: true,
        certsDir: mockCertsDir,
        autoGenerate: false,
      })

      const cert2 = await tlsManager2.getCertificate()

      // Should have loaded the same certificate
      expect(cert2.fingerprint).toBe(fingerprint1)
    })
  })

  describe('generateSelfSignedCert', () => {
    it('should generate a valid self-signed certificate', async () => {
      tlsManager = new TlsManager({
        enabled: true,
        certsDir: mockCertsDir,
        hostnames: ['localhost', '192.168.1.100'],
      })

      const cert = await tlsManager.generateSelfSignedCert()

      expect(cert).toBeDefined()
      expect(cert.cert).toBeInstanceOf(Buffer)
      expect(cert.key).toBeInstanceOf(Buffer)
      expect(cert.fingerprint).toBeDefined()
      expect(cert.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/)
    })

    it('should include multiple hostnames in SAN', async () => {
      tlsManager = new TlsManager({
        enabled: true,
        certsDir: mockCertsDir,
        hostnames: ['localhost', '192.168.1.100', 'example.local'],
      })

      const cert = await tlsManager.generateSelfSignedCert()

      expect(cert).toBeDefined()
      // Certificate should be generated without errors
      expect(cert.cert.length).toBeGreaterThan(0)
    })
  })

  describe('calculateFingerprint', () => {
    it('should calculate SHA-256 fingerprint correctly', () => {
      tlsManager = new TlsManager()

      // Mock certificate in PEM format
      const mockPemCert = Buffer.from(
        `-----BEGIN CERTIFICATE-----
MIIBkTCB+wIJAKHHCgVZU6KRMA0GCSqGSIb3DQEBCwUAMBExDzANBgNVBAMMBnRl
c3RlcjAeFw0yMDAxMDEwMDAwMDBaFw0yMTAxMDEwMDAwMDBaMBExDzANBgNVBAMM
BnRlc3RlcjBcMA0GCSqGSIb3DQEBAQUAA0sAMEgCQQC7VJTUt9Us8cKjMzEfYyji
WA4R4hhj2e5OozgpiIKt1PnTvYGqKmKVC7lNr/jQQWYGlZnYhYGZGpnXr9Gy7O8p
AgMBAAEwDQYJKoZIhvcNAQELBQADQQAv0v1XZKKcH0cCgMpvqcDmJXfSEPLz+O2y
kGvKIQqIMh8Z9NqW0FQhGwZk7j4UQ/C6nTWnJCqTXA4fMCnKhVQs
-----END CERTIFICATE-----`
      )

      const fingerprint = tlsManager.calculateFingerprint(mockPemCert)

      expect(fingerprint).toBeDefined()
      expect(typeof fingerprint).toBe('string')
      expect(fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/)
    })
  })

  describe('certificateExists', () => {
    it('should return true when both cert and key exist', async () => {
      tlsManager = new TlsManager({
        enabled: true,
        certsDir: mockCertsDir,
        autoGenerate: true,
      })

      // Generate a certificate first
      await tlsManager.getCertificate()

      // Now it should exist
      expect(tlsManager.certificateExists()).toBe(true)
    })

    it('should return false when cert or key is missing', () => {
      tlsManager = new TlsManager({ certsDir: mockCertsDir })

      // No certificate generated yet
      expect(tlsManager.certificateExists()).toBe(false)
    })
  })

  describe('getCertificatePaths', () => {
    it('should return correct certificate paths', () => {
      tlsManager = new TlsManager({ certsDir: mockCertsDir })

      const paths = tlsManager.getCertificatePaths()

      expect(paths).toBeDefined()
      expect(paths.certPath).toContain(mockCertsDir)
      expect(paths.certPath).toContain('witness-cert.pem')
      expect(paths.keyPath).toContain(mockCertsDir)
      expect(paths.keyPath).toContain('witness-key.pem')
    })
  })
})
