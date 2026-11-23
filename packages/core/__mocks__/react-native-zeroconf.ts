/**
 * Mock for react-native-zeroconf
 * Used in testing witness discovery functionality
 */

export default class Zeroconf {
  private listeners: { [key: string]: Function[] } = {}

  on(event: string, handler: Function) {
    if (!this.listeners[event]) {
      this.listeners[event] = []
    }
    this.listeners[event].push(handler)
  }

  removeListener(event: string, handler: Function) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter((h) => h !== handler)
    }
  }

  scan(_type: string, _protocol: string, _domain: string) {
    // Mock implementation - does nothing in tests
  }

  stop() {
    // Mock implementation - does nothing in tests
  }

  // Test helper to simulate service discovery
  _emitResolved(service: any) {
    if (this.listeners['resolved']) {
      this.listeners['resolved'].forEach((handler) => handler(service))
    }
  }

  // Test helper to simulate service removal
  _emitRemove(service: any) {
    if (this.listeners['remove']) {
      this.listeners['remove'].forEach((handler) => handler(service))
    }
  }
}
