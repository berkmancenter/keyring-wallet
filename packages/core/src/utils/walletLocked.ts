/**
 * Emitted on DeviceEventEmitter when the wallet locks or the person logs out
 * (auth's `lockOutUser`), with the `LockoutReason`, so what is kept in memory
 * only while the wallet is open can be dropped then.
 */
export const WALLET_LOCKED_EVENT = 'WalletLocked'
