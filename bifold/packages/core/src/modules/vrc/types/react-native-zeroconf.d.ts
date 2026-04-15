/**
 * Type declarations for react-native-zeroconf
 *
 * This package provides mDNS service discovery for React Native
 */

declare module 'react-native-zeroconf' {
  /**
   * Service information returned by Zeroconf
   */
  export interface ZeroconfService {
    /** Service name */
    name: string
    /** Service type (e.g., 'http') */
    type: string
    /** Protocol (e.g., 'tcp') */
    protocol: string
    /** Domain (e.g., 'local.') */
    domain: string
    /** Host address */
    host: string
    /** Port number */
    port: number
    /** IPv4 addresses */
    addresses?: string[]
    /** TXT records as key-value pairs */
    txt?: Record<string, string>
  }

  /**
   * Zeroconf class for mDNS service discovery
   */
  export default class Zeroconf {
    /**
     * Start scanning for services
     * @param type - Service type (e.g., 'http', 'witness')
     * @param protocol - Protocol (e.g., 'tcp', 'udp')
     * @param domain - Domain (e.g., 'local.')
     */
    scan(type?: string, protocol?: string, domain?: string): void

    /**
     * Stop scanning for services
     */
    stop(): void

    /**
     * Register event listener
     * @param event - Event name ('start', 'stop', 'found', 'resolved', 'remove', 'update', 'error')
     * @param listener - Event handler
     */
    on(event: 'start', listener: () => void): void
    on(event: 'stop', listener: () => void): void
    on(event: 'found', listener: (service: ZeroconfService) => void): void
    on(event: 'resolved', listener: (service: ZeroconfService) => void): void
    on(event: 'remove', listener: (service: ZeroconfService) => void): void
    on(event: 'update', listener: (service: ZeroconfService) => void): void
    on(event: 'error', listener: (error: Error) => void): void

    /**
     * Remove event listener
     * @param event - Event name
     * @param listener - Event handler
     */
    removeListener(event: string, listener: (...args: any[]) => void): void

    /**
     * Get all discovered services
     */
    getServices(): Record<string, ZeroconfService>

    /**
     * Publish a service (Android only)
     */
    publishService(
      type: string,
      protocol: string,
      domain: string,
      name: string,
      port: number,
      txt?: Record<string, string>
    ): void

    /**
     * Unpublish a service (Android only)
     */
    unpublishService(name: string): void
  }
}
