import { useCallback } from 'react'
import { useAgent } from '@bifold/react-hooks'
import { RecordNotFoundError, W3cCredentialRecord } from '@credo-ts/core'
import Toast from 'react-native-toast-message'
import { useTranslation } from 'react-i18next'

import { useOpenIDCredentials } from '../../openid/context/OpenIDCredentialRecordProvider'
import { RelationshipDidRepository } from '../repositories/RelationshipDidRepository'
import { toRawCredential } from '../utils/rcardDisplayUtils'
import { OpenIDCredentialType } from '../../openid/types'
import { ToastType } from '../../../components/toast/BaseToast'

/**
 * A record that is already gone is what removal wants, so it is not a failure. Anything else (a store that cannot be
 * read or written) is: it is rethrown so the removal reports failure instead of success over what it never deleted.
 */
function unlessAlreadyGone(error: unknown): void {
  if (error instanceof RecordNotFoundError || (error as Error | undefined)?.name === 'RecordNotFoundError') return
  throw error
}

interface DeleteContactParams {
  issuerId: string
  connectionId: string | null
}

interface UseDeleteContactReturn {
  deleteContact: (params: DeleteContactParams) => Promise<boolean>
  findCredentialsByIssuer: (issuerId: string) => W3cCredentialRecord[]
}

/**
 * Hook to handle deleting a contact and all associated data:
 * - All W3C credentials where issuer.id matches
 * - The DIDComm connection
 * - The RelationshipDidRecord
 */
export const useDeleteContact = (): UseDeleteContactReturn => {
  const { agent } = useAgent()
  const { t } = useTranslation()
  const {
    openIdState: { w3cCredentialRecords },
    removeCredential,
  } = useOpenIDCredentials()

  /**
   * Extract issuer ID from a W3C credential record
   */
  const extractIssuerId = (credential: W3cCredentialRecord): string | null => {
    try {
      const issuerValue = toRawCredential(credential)?.issuer

      if (typeof issuerValue === 'string') {
        return issuerValue
      }

      if (issuerValue && typeof issuerValue === 'object' && 'id' in issuerValue) {
        return issuerValue.id
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(
        '[VRC:DeleteContact] Issuer extraction error:',
        error instanceof Error ? error.message : String(error)
      )
    }
    return null
  }

  /**
   * Find all W3C credentials that have the given issuer ID
   */
  const findCredentialsByIssuer = useCallback(
    (issuerId: string): W3cCredentialRecord[] => {
      return w3cCredentialRecords.filter((cred) => {
        const credIssuerId = extractIssuerId(cred)
        return credIssuerId === issuerId
      })
    },
    [w3cCredentialRecords]
  )

  /**
   * Delete a contact and all associated data
   * Returns true if successful, false otherwise
   */
  const deleteContact = useCallback(
    async ({ issuerId, connectionId }: DeleteContactParams): Promise<boolean> => {
      if (!agent) {
        return false
      }

      try {
        // 1. Find and delete all credentials from this issuer
        const credentialsToDelete = findCredentialsByIssuer(issuerId)
        for (const credential of credentialsToDelete) {
          await removeCredential(credential, OpenIDCredentialType.W3cCredential)
        }

        // 2. Delete the DIDComm connection and associated OOB record (if exists)
        if (connectionId) {
          try {
            // Get the connection record to find its outOfBandId
            const connection = await agent.modules.didcomm.connections.getById(connectionId)
            const outOfBandId = connection?.outOfBandId

            // Delete the connection first
            await agent.modules.didcomm.connections.deleteById(connectionId)

            // Delete the associated OOB record to prevent duplicate invitation errors
            if (outOfBandId) {
              try {
                await agent.modules.didcomm.oob.deleteById(outOfBandId)
              } catch (oobError) {
                unlessAlreadyGone(oobError)
              }
            }
          } catch (connectionError) {
            unlessAlreadyGone(connectionError)
          }
        }

        // 3. Delete the RelationshipDidRecord
        try {
          const repository = agent.dependencyManager.resolve(RelationshipDidRepository)
          const record = await repository.findByCounterpartyRelationshipDid(agent.context, issuerId)
          if (record) {
            await repository.delete(agent.context, record)
          }
        } catch (relationshipError) {
          // Finding none returns null; a throw here is the store failing, unless the record went in between.
          unlessAlreadyGone(relationshipError)
        }

        // Show success toast
        Toast.show({
          type: ToastType.Success,
          text1: t('ContactDetails.ContactRemoved'),
        })

        return true
      } catch (_error) {
        // Show error toast
        Toast.show({
          type: ToastType.Error,
          text1: t('Error.Title1032'),
        })
        return false
      }
    },
    [agent, findCredentialsByIssuer, removeCredential, t]
  )

  return {
    deleteContact,
    findCredentialsByIssuer,
  }
}
