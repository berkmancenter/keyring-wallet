declare module '*.svg' {
  import { SvgProps } from 'react-native-svg'
  const content: React.FC<SvgProps>
  export default content
}

declare module '*.png'
declare module '*.jpg'

// Minimal typings for the (untyped) Digital Credentials Consortium packages
// used by the eddsa-rdfc-2022 Data Integrity suite. Mirrors
// bifold/packages/core/declarations.d.ts (the app typechecks bifold sources
// with this tsconfig, which cannot see bifold's own ambient declarations).
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
declare module '*.jpeg'

declare module 'react-native-argon2'
