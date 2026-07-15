declare module '*.svg' {
  import { SvgProps } from 'react-native-svg'
  import type { FC } from 'react'
  const content: FC<SvgProps>
  export default content
}

declare module '@react-native-community/netinfo/jest/netinfo-mock'

// Minimal typings for the (untyped) Digital Credentials Consortium packages
// used by the eddsa-rdfc-2022 Data Integrity suite (see
// docs/CRYPTO_SUITE_FOLLOWUP.md). Shapes verified against the installed
// sources in the Level 0/1 spikes.
declare module '@digitalcredentials/data-integrity' {
  export interface DataIntegritySigner {
    sign(options: { data: Uint8Array | Uint8Array[] }): Promise<Uint8Array>
    id?: string
    algorithm?: string
  }

  export class DataIntegrityProof {
    constructor(options?: {
      signer?: DataIntegritySigner
      date?: string | Date
      cryptosuite: unknown
      legacyContext?: boolean
    })
    type: string
    cryptosuite: string
    verificationMethod?: string
  }
}

declare module '@digitalcredentials/eddsa-rdfc-2022-cryptosuite' {
  export const cryptosuite: {
    name: string
    requiredAlgorithm: string
    canonize: (input: unknown, options: unknown) => Promise<string>
    createVerifier: (options: { verificationMethod: unknown }) => Promise<unknown>
  }
}
