import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import * as crypto from 'crypto'
const selfsigned = require('selfsigned')

/**
 * TLS Certificate structure
 */
export interface TlsCertificate {
  /** PEM-encoded certificate */
  cert: Buffer
  /** PEM-encoded private key */
  key: Buffer
  /** SHA-256 hex fingerprint of the certificate */
  fingerprint: string
}

/**
 * TLS configuration options
 */
export interface TlsManagerConfig {
  /** Enable TLS (default: true) */
  enabled: boolean
  /** Path to custom certificate file (optional) */
  certPath?: string
  /** Path to custom key file (optional) */
  keyPath?: string
  /** Directory to store auto-generated certificates (default: .certs) */
  certsDir: string
  /** Auto-generate certificate if not found (default: true) */
  autoGenerate: boolean
  /** Certificate validity in days (default: 365) */
  validityDays: number
  /** Hostname/IP addresses for certificate SAN (default: localhost) */
  hostnames: string[]
}

/**
 * TLS Manager for witness server
 *
 * Handles:
 * - Auto-generating self-signed certificates
 * - Loading custom certificates
 * - Calculating SHA-256 fingerprints for TLS verification
 * - Certificate persistence
 */
export class TlsManager {
  private config: TlsManagerConfig
  private certPath: string
  private keyPath: string

  constructor(config: Partial<TlsManagerConfig> = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      certPath: config.certPath,
      keyPath: config.keyPath,
      certsDir: config.certsDir ?? '.certs',
      autoGenerate: config.autoGenerate ?? true,
      validityDays: config.validityDays ?? 365,
      hostnames: config.hostnames ?? ['localhost'],
    }

    // Set default paths for auto-generated certificates
    this.certPath = this.config.certPath || join(this.config.certsDir, 'witness-cert.pem')
    this.keyPath = this.config.keyPath || join(this.config.certsDir, 'witness-key.pem')
  }

  /**
   * Get or create TLS certificate
   */
  async getCertificate(): Promise<TlsCertificate> {
    if (!this.config.enabled) {
      throw new Error('TLS is not enabled')
    }

    // Try to load existing certificate
    if (existsSync(this.certPath) && existsSync(this.keyPath)) {
      try {
        return this.loadCertificate(this.certPath, this.keyPath)
      } catch (error) {
        console.warn('[TlsManager] Failed to load existing certificate:', error)
        if (!this.config.autoGenerate) {
          throw error
        }
        // Continue to auto-generation
      }
    }

    // Auto-generate certificate if enabled
    if (this.config.autoGenerate) {
      console.log('[TlsManager] Generating new self-signed certificate...')
      const cert = await this.generateSelfSignedCert()
      this.saveCertificate(cert)
      return cert
    }

    throw new Error('No certificate found and auto-generation is disabled')
  }

  /**
   * Load certificate from files
   */
  loadCertificate(certPath: string, keyPath: string): TlsCertificate {
    if (!existsSync(certPath)) {
      throw new Error(`Certificate file not found: ${certPath}`)
    }
    if (!existsSync(keyPath)) {
      throw new Error(`Key file not found: ${keyPath}`)
    }

    const cert = readFileSync(certPath)
    const key = readFileSync(keyPath)
    const fingerprint = this.calculateFingerprint(cert)

    console.log(`[TlsManager] Loaded certificate from ${certPath}`)
    console.log(`[TlsManager] Certificate fingerprint: ${fingerprint}`)

    return { cert, key, fingerprint }
  }

  /**
   * Generate self-signed certificate
   */
  async generateSelfSignedCert(): Promise<TlsCertificate> {
    const attrs = [
      { name: 'commonName', value: this.config.hostnames[0] },
      { name: 'countryName', value: 'US' },
      { name: 'organizationName', value: 'Witness Server' },
      { shortName: 'OU', value: 'VRC' },
    ]

    // Add Subject Alternative Names (SANs) for all hostnames
    const altNames = this.config.hostnames.map((hostname) => {
      // Check if it's an IP address
      if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
        return { type: 7, ip: hostname } // IP address
      } else {
        return { type: 2, value: hostname } // DNS name
      }
    })

    const options = {
      days: this.config.validityDays,
      algorithm: 'sha256' as const,
      extensions: [
        {
          name: 'basicConstraints' as const,
          cA: false,
        },
        {
          name: 'keyUsage' as const,
          keyCertSign: false,
          digitalSignature: true,
          keyEncipherment: true,
        },
        {
          name: 'extKeyUsage' as const,
          serverAuth: true,
        },
        {
          name: 'subjectAltName' as const,
          altNames,
        },
      ] as any,
    }

    const pems = await selfsigned.generate(attrs, options)

    const cert = Buffer.from(pems.cert)
    const key = Buffer.from(pems.private)
    const fingerprint = this.calculateFingerprint(cert)

    console.log('[TlsManager] Generated self-signed certificate')
    console.log(`[TlsManager] Valid for ${this.config.validityDays} days`)
    console.log(`[TlsManager] Hostnames: ${this.config.hostnames.join(', ')}`)
    console.log(`[TlsManager] Certificate fingerprint: ${fingerprint}`)

    return { cert, key, fingerprint }
  }

  /**
   * Calculate SHA-256 fingerprint of certificate
   */
  calculateFingerprint(cert: Buffer): string {
    // Parse PEM to get DER format
    const pemContent = cert.toString('utf-8')
    const base64Cert = pemContent
      .replace(/-----BEGIN CERTIFICATE-----/, '')
      .replace(/-----END CERTIFICATE-----/, '')
      .replace(/\s/g, '')

    const derBuffer = Buffer.from(base64Cert, 'base64')

    // Calculate SHA-256 hash
    const hash = crypto.createHash('sha256').update(derBuffer).digest('hex')

    // Format as colon-separated hex (common format for fingerprints)
    return (
      hash
        .toUpperCase()
        .match(/.{1,2}/g)
        ?.join(':') || hash.toUpperCase()
    )
  }

  /**
   * Save certificate to files
   */
  private saveCertificate(cert: TlsCertificate): void {
    // Ensure certs directory exists
    const dir = this.config.certsDir
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
      console.log(`[TlsManager] Created certificates directory: ${dir}`)
    }

    // Save certificate and key
    writeFileSync(this.certPath, cert.cert)
    writeFileSync(this.keyPath, cert.key)

    // Set restrictive permissions on key file (Unix-like systems)
    try {
      const fs = require('fs')
      fs.chmodSync(this.keyPath, 0o600)
    } catch (error) {
      // Ignore on Windows or if chmod fails
    }

    console.log(`[TlsManager] Saved certificate to ${this.certPath}`)
    console.log(`[TlsManager] Saved private key to ${this.keyPath}`)
  }

  /**
   * Get certificate file paths
   */
  getCertificatePaths(): { certPath: string; keyPath: string } {
    return {
      certPath: this.certPath,
      keyPath: this.keyPath,
    }
  }

  /**
   * Check if certificate exists
   */
  certificateExists(): boolean {
    return existsSync(this.certPath) && existsSync(this.keyPath)
  }

  /**
   * Delete existing certificate (for testing or regeneration)
   */
  deleteCertificate(): void {
    if (existsSync(this.certPath)) {
      const fs = require('fs')
      fs.unlinkSync(this.certPath)
      console.log(`[TlsManager] Deleted certificate: ${this.certPath}`)
    }
    if (existsSync(this.keyPath)) {
      const fs = require('fs')
      fs.unlinkSync(this.keyPath)
      console.log(`[TlsManager] Deleted key: ${this.keyPath}`)
    }
  }
}

/**
 * Load TLS configuration from environment variables
 */
export function loadTlsConfig(): TlsManagerConfig {
  const enabled = process.env.WITNESS_TLS_ENABLED !== 'false' // Default: true
  const certPath = process.env.WITNESS_TLS_CERT || undefined
  const keyPath = process.env.WITNESS_TLS_KEY || undefined
  const certsDir = process.env.WITNESS_TLS_CERTS_DIR || '.certs'
  const autoGenerate = process.env.WITNESS_TLS_AUTO_GENERATE !== 'false' // Default: true
  const validityDays = parseInt(process.env.WITNESS_TLS_VALIDITY_DAYS || '365', 10)
  const hostnames = process.env.WITNESS_TLS_HOSTNAMES?.split(',') || ['localhost']

  return {
    enabled,
    certPath,
    keyPath,
    certsDir,
    autoGenerate,
    validityDays,
    hostnames: hostnames.map((h) => h.trim()),
  }
}
