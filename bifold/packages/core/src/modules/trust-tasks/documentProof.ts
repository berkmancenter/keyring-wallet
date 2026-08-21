/**
 * Document proofs and digests for Trust Task documents — the implementation
 * lives in @bifold/trust-tasks (shared with the witness-server
 * since 2026-08-20). This module re-exports it so the wallet's import paths
 * and test mocks (`jest.mock('../documentProof')`) stay stable.
 */
export * from '@bifold/trust-tasks'
