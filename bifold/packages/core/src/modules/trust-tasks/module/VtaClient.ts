/**
 * VtaClient — the phone as the manager of a personal VTA.
 *
 * Under §2.4 B of `community_vetting_subtask.md` every Keyring user has a VTA
 * of their own, and Keyring is its manager the way upstream's terminal client
 * and browser plugin are: it enrols once, then asks the agent to mint personas,
 * releases their keys for the moments the phone must act as one, and answers
 * the agent's questions. This is that surface, over the same DIDComm v2
 * transport the community leg uses (`VtiMediatorTransport`): a VTA advertises
 * the same kind of mediator a VTC does.
 *
 * What the wire looks like, measured against `vta-service` 0.28 at
 * `53a7cde4`: a Trust Task to a VTA travels as a DIDComm message of the
 * framework's **binding envelope type** whose body IS the Trust Task document
 * (`vta-service/src/messaging/handlers.rs`, `handle_trust_task`), and the
 * authcrypt sender is the authenticated caller — its ACL entry decides what it
 * may ask. The reply is a framework result or error document in a message of
 * the same envelope type.
 *
 * Deliberately separate from `vtiAgent` (the phone ↔ community leg): the two
 * present different identities — the manager identity here, a persona there —
 * and either can exist without the other.
 *
 * @module trust-tasks/module/VtaClient
 */

import type { Agent } from '@credo-ts/core'
import { chooseAgentLabel, verifiedAgentName, vtaNameFrom, type AgentLabel, type AgentNameDocument } from './agentLabel'
import { utils } from '@credo-ts/core'
import type { DidCommV2PlaintextMessage } from '@credo-ts/didcomm'

import { TRUST_TASK_V2_ENVELOPE_TYPE, signCompactJws, signDocumentProof, tsp } from '@bifold/trust-tasks'

import {
  PCS_ERROR,
  PCS_PROBE_APPLICATION_ID,
  PCS_VTA_TASK,
  pcsErrorCode,
  type ApplicationsCreatePayload,
  type PcsApplication,
  type ProvePayload,
  type VerifyAttestationPayload,
  PCS_FAMILY,
  DISCOVERY_TASK,
  DISCOVERY_TASK_03,
} from './pcsVtaPayloads'

import {
  EPHEMERAL_KMS_BACKEND,
  heldInMemory,
  importVtaKey,
  inMemoryKeyId,
  isInMemoryKeyId,
  type VtaExportedKey,
} from './vtaKeys'
import {
  authcryptTo,
  createVtiClientDid,
  resolveVtiMediator,
  resolveDidDocumentRetrying,
  vtiClientIdentityFromDid,
  VtiMediatorSession,
  type VtiClientIdentity,
  type VtiMediatorEndpoints,
} from './VtiMediatorTransport'
import type { VtiIdentityStore, VtiManagerIdentity, VtiMintRequest, VtiPersona } from './VtiIdentityStore'
import {
  PCS_VETTER_TASK,
  type AttestPayload,
  type RootAcceptPayload,
  type RootRequestPayload,
  type RootRequestWire,
  type TokenDrawWire,
  type TokensAbandonPayload,
  type TokensAcceptPayload,
  type TokensRequestPayload,
  type VetterShowPayload,
  type VetterStanding,
} from './pcsVetterTasks'
import { VtiRefusal, isHiddenVettingType } from './vtiAgent'
import {
  STEP_UP_REQUEST_TYPES,
  StepUpDeclined,
  approveResponsePayload,
  approveResponseTypesFor,
  stepUpRequestOf,
  type StepUpRequest,
} from './stepUp'
import { isDigestMultibase } from './vettingShape'
import { TaskVersions } from './taskVersions'
import { chooseCarriage, type Carriage } from './tspCapability'
import {
  GenericRecordsTspPeerRevisionStore,
  isFreshV1,
  packTrustTaskForPeer,
  tspSessionForManager,
  unpackTrustTaskFromPeer,
  type TspPeerRevisionStore,
  type TspSessionIdentity,
} from './vtiTsp'
import { GenericRecordsTspProbeStore, runTspProbe, type TspProbeOutcome, type TspProbeStore } from './tspProbe'
import { purposeForDocumentType } from './proofPurpose'
import { checkVtaReply } from './vtaReplyProof'
import { releaseWarn } from './releaseLog'
import { didOfKeyId, isAgentsOwnDid, isAgentsOwnPersona } from './agentOwnIdentity'
import { besideQueue, inReadLane, VTA_HEARTBEAT_BESIDE, VTA_READ_LANE_SIZE } from './vtaReadLane'
import {
  DECLARATIVE_POLICY_ID,
  DECLARATIVE_POLICY_NAME,
  DECLARATIVE_POLICY_PRIORITY,
  EXT_KEY_APPROVER_SETS,
  EXT_KEY_RULES,
  synthesizeRego,
  validateApprovals,
} from './approvalsPolicy'
import { EMPTY_APPROVALS, modelFromExt, ruleForWire, withKeySwapped, type ApprovalsModel } from './approvalRules'
import { registerOtaApplyBlocker } from '../../../utils/otaApply'

const LOG_PREFIX = '[TrustTasks:VtaClient]'

/**
 * How long a persona mint may take. A first mint against a DID host includes
 * the VTA opening a TSP relationship with that host: on the VTA Farm (227
 * gate, 09-30) the answer left the VTA 31.2 s after the request, just after a
 * 30 s wait had given up, and the persona was minted with nobody to take it.
 * A warm mint took 6 s. Two minutes leaves room for a slow host.
 */
export const MINT_TIMEOUT_MS = 120_000

/** How many keyed requests `VtaClient` remembers the attempts of. */
const MAX_KEYED_REQUESTS_REMEMBERED = 32
const TASK_ERROR = 'https://trusttasks.org/spec/trust-task-error/'

/**
 * multibase base58btc, as every PCS identifier and blinded half is published:
 * `z` then the base58 alphabet, which excludes 0, O, I and l.
 */
const MULTIBASE_BASE58 = /^z[1-9A-HJ-NP-Za-km-z]+$/
const PROBLEM_REPORT = 'https://didcomm.org/report-problem/2.0/problem-report'

/** The tasks this client speaks, by the URIs `vta-sdk` registers. */
export const VTA_TASK = {
  whoAmI: 'https://trusttasks.org/spec/auth/whoami/0.1',
  /** End sessions: `{ all: true }` ends every session of the caller (vta-sdk RevokeSessions::AllMine; 0.1 is no longer served). */
  revokeSession: 'https://trusttasks.org/spec/auth/revoke-session/0.2',
  configShow: 'https://trusttasks.org/spec/config/show/0.1',
  contextsList: 'https://trusttasks.org/spec/vta/contexts/list/1.0',
  contextsCreate: 'https://trusttasks.org/spec/vta/contexts/create/1.0',
  didsList: 'https://trusttasks.org/spec/vta/webvh/dids/list/1.0',
  didsCreate: 'https://trusttasks.org/spec/vta/webvh/dids/create/1.0',
  didsCreate11: 'https://trusttasks.org/spec/vta/webvh/dids/create/1.1',
  /** 1.2 adds only OPTIONAL request members (`didMethod`, `scidAlsoKnownAs`); 1.1's payload is a valid 1.2 one. */
  didsCreate12: 'https://trusttasks.org/spec/vta/webvh/dids/create/1.2',
  keysExportSecret: 'https://trusttasks.org/spec/keys/export-secret/0.1',
  serversList: 'https://trusttasks.org/spec/vta/webvh/servers/list/1.0',
  consentRequest: 'https://trusttasks.org/spec/task-consent/request/0.1',
  consentDecision: 'https://trusttasks.org/spec/task-consent/decision/0.1',
  /** decision/0.2 adds only OPTIONAL members; a 0.1 decision re-typed as 0.2 means the same (trust-tasks-tf ce07a039 task-consent/decision/0.2 spec.md:122-124). */
  consentDecision02: 'https://trusttasks.org/spec/task-consent/decision/0.2',
  consentGranted: 'https://trusttasks.org/spec/task-consent/granted/0.1',
  aclSwapKey: 'https://trusttasks.org/spec/acl/swap-key/0.1',
  // The canonical ACL family (vta-sdk trust_tasks.rs:222-260), each gated by
  // `require_manage()` (vta-service trust_tasks/acl.rs:27-55, 57-84, 207-234).
  aclList: 'https://trusttasks.org/spec/acl/list/0.1',
  aclGrant: 'https://trusttasks.org/spec/acl/grant/0.1',
  aclRevoke: 'https://trusttasks.org/spec/acl/revoke/0.1',
  aclUpdate: 'https://trusttasks.org/spec/acl/update/0.1',
  // acl/*/0.2 (trust-tasks-tf ce07a039, released in #715), asked first and
  // stepped down from on `unsupportedVersion` (taskVersions.ts). vta-service
  // v0.52.0 serves only 0.1 (trust_tasks/mod.rs:2245-2256).
  aclList02: 'https://trusttasks.org/spec/acl/list/0.2',
  aclGrant02: 'https://trusttasks.org/spec/acl/grant/0.2',
  aclRevoke02: 'https://trusttasks.org/spec/acl/revoke/0.2',
  aclUpdate02: 'https://trusttasks.org/spec/acl/update/0.2',
  /** 0.3 (vta-service #2324, in v0.67.0): 0.2's entries; `pageSize` is `limit`, `cursor`/`truncated` are `nextCursor`. */
  aclList03: 'https://trusttasks.org/spec/acl/list/0.3',
  // Only "Send me a test request" sends these (approvalRules.ts TEST_REQUEST_TASKS).
  contextsDelete: 'https://trusttasks.org/spec/vta/contexts/delete/1.0',
  /** 1.1 (trust-tasks-tf #967, vta-service 1afebe27): 1.0's payload plus `abandonHostCopies`, default false. */
  contextsDelete11: 'https://trusttasks.org/spec/vta/contexts/delete/1.1',
  // The approval rules' row (vta-sdk trust_tasks.rs:2048-2060). Writing is super-admin.
  policyGet: 'https://trusttasks.org/spec/policy/get/0.1',
  policyUpsert: 'https://trusttasks.org/spec/policy/upsert/0.2',
  /** 0.3: the same request; the answer's `created` is spelled `wasCreated` (trust-tasks-tf f27ea5387). */
  policyUpsert03: 'https://trusttasks.org/spec/policy/upsert/0.3',
  // The vault, for trigger-link sign-in (oobSignInAgent). vta-sdk's own client
  // sends every vault task at 0.1 (client/vault.rs:35-279, VTI 03a3562f);
  // 0.1 is deprecated in favour of 0.2 (trust_tasks.rs:701-846), which the VTA
  // also serves.
  vaultList: 'https://trusttasks.org/spec/vault/list/0.1',
  vaultList02: 'https://trusttasks.org/spec/vault/list/0.2',
  vaultUpsert: 'https://trusttasks.org/spec/vault/upsert/0.1',
  vaultUpsert02: 'https://trusttasks.org/spec/vault/upsert/0.2',
  vaultList03: 'https://trusttasks.org/spec/vault/list/0.3',
  vaultUpsert03: 'https://trusttasks.org/spec/vault/upsert/0.3',
  // 0.4 (trust-tasks-tf f27ea5387): the same vault-entry shape as 0.3 (vault/_shared/0.3); list's `pageSize` is
  // `limit` and its answer's `cursor`/`truncated` are `nextCursor`; upsert's `created` is `wasCreated`.
  vaultList04: 'https://trusttasks.org/spec/vault/list/0.4',
  vaultUpsert04: 'https://trusttasks.org/spec/vault/upsert/0.4',
  vaultSignTrustTask: 'https://trusttasks.org/spec/vault/sign-trust-task/0.1',
  vaultSignTrustTask02: 'https://trusttasks.org/spec/vault/sign-trust-task/0.2',
} as const

/**
 * Each family this client speaks in more than one version, in the order to
 * ask: newest first, except where agents in use serve only the older one.
 *
 * @versionLadder
 */
export const VTA_TASK_VERSIONS = {
  // Newest first. The agents in use share no version: vta-service v0.60.0 to 0d3f268e serve acl/* only at 0.1,
  // and v0.67.0 (#2323, #2324) only acl/{grant,revoke,update}/0.2 and acl/list/0.3. So one of them steps down on a
  // refusal whichever is asked first. That needs the refusal to reach the phone: over TSP a refused 0.2 once did
  // not (al-phone, 10-05), so a TSP-only agent before v0.67.0 is the case to watch.
  aclList: [VTA_TASK.aclList03, VTA_TASK.aclList02, VTA_TASK.aclList],
  aclGrant: [VTA_TASK.aclGrant02, VTA_TASK.aclGrant],
  aclRevoke: [VTA_TASK.aclRevoke02, VTA_TASK.aclRevoke],
  aclUpdate: [VTA_TASK.aclUpdate02, VTA_TASK.aclUpdate],
  // 0.2 first. The agents in use share no version: vta-service v0.60.0 to v0.66.0 serve only 0.1, and from
  // 0d3f268e (2026-10-28, #2313, what first.openvtc.net runs) only 0.2. So one of them steps down on a refusal
  // whichever is asked first, and 0.2 is where agents are going. This client sends only 0.1's members, which are a
  // valid 0.2 decision. The step-down needs the refusal to reach the phone: over TSP it once did not (al-phone,
  // 10-05), so a TSP-only agent at 0.60-0.66 is the case to watch.
  consentDecision: [VTA_TASK.consentDecision02, VTA_TASK.consentDecision],
  // 0.2 first: the reference rungs signed identify and grant with 0.2 against
  // VTI main 03a3562f (ref-23, ref-24). The payload is the same in both.
  vaultSignTrustTask: [VTA_TASK.vaultSignTrustTask02, VTA_TASK.vaultSignTrustTask],
  // 0.4 first, then 0.3. The agents in use share no version: vta-service v0.22.0 to v0.66.0 serve 0.1 to 0.3
  // (0.2 and 0.3 converted down to the 0.1 handler, trust_tasks/wire_v0_2.rs), and from 0d3f268e (2026-10-28,
  // #2309, what first.openvtc.net runs) the same edge takes only 0.4. So an agent before 0d3f268e answers 0.4 with
  // a refusal and is asked 0.3. 0.1 and 0.2 are withdrawn in the 2027-01-01 batch and 0.3 in 2027-04-01's. Each
  // version gets its own spellings (vaultPayloadFor), and both answers are read back.
  vaultList: [VTA_TASK.vaultList04, VTA_TASK.vaultList03, VTA_TASK.vaultList02, VTA_TASK.vaultList],
  vaultUpsert: [VTA_TASK.vaultUpsert04, VTA_TASK.vaultUpsert03, VTA_TASK.vaultUpsert02, VTA_TASK.vaultUpsert],
  // 1.2 first, then 1.1. vta-service serves 1.1 from v0.49.0 (2026-10-02) and 1.2 from v0.65.0 (2026-10-26);
  // VTI main serves only 1.2 (#2318), so the next release refuses 1.1. A 0.60-0.64 agent steps down to 1.1 on a
  // refusal. 1.0 is withdrawn in the 2027-01-01 batch and 1.1 in 2027-04-01's. The payload is the same in all three.
  didsCreate: [VTA_TASK.didsCreate12, VTA_TASK.didsCreate11, VTA_TASK.didsCreate],
  // 0.3 first: 0d3f268e (#2310 batch) serves only policy/upsert/0.3; v0.60.0 to v0.66.0 only 0.2.
  policyUpsert: [VTA_TASK.policyUpsert03, VTA_TASK.policyUpsert],
  // 0.3 first: every VTA in use serves it (pcsVtaPayloads.ts DISCOVERY_TASK_03).
  discovery: [DISCOVERY_TASK_03, DISCOVERY_TASK],
  // 1.1 first. vta-service serves only 1.0 up to v0.66.0, both in v0.67.0, and only 1.1 from 61c23f20 (#2332,
  // 2026-10-29: v0.68.0 and the nightlies). An agent before v0.67.0 steps down to 1.0 on a refusal. The test
  // request's context holds nothing, so 1.1's host settling has nothing to do and the payload is the same in both.
  contextsDelete: [VTA_TASK.contextsDelete11, VTA_TASK.contextsDelete],
} as const

/** The `type` of the DIDComm message a sealed vault secret travels in (vta-sdk didcomm_session.rs:567-570; informational). */
export const VAULT_SECRET_MESSAGE_TYPE = 'https://trusttasks.org/spec/vault/_shared/0.1/vault-secret'

/** A vault entry's metadata as `vault/list` and `vault/upsert` answer it — never the secret. */
export interface VtaVaultEntry {
  id: string
  contextId?: string
  targets?: { kind?: string; did?: string; [key: string]: unknown }[]
  label?: string
  /** `did-self-issued` at 0.1, `didSelfIssued` at 0.2. */
  secretKind?: string
  /** The DID the entry signs as, derived by the VTA from the secret (vti-common vault/mod.rs:118-127). */
  principalDid?: string
  /** Absent when active (vti-common vault/mod.rs:128-135). */
  status?: string
  version?: number
  [key: string]: unknown
}

/**
 * `vault/_shared` SealedEnvelope, the one variant Keyring makes (vta-service trust_tasks/vault.rs:168-188):
 * `didcomm-authcrypt` at 0.1, `didcommAuthcrypt` from 0.2 (vaultPayloadFor spells it for the version sent).
 */
export type VtaSealedSecret = { envelope: 'didcomm-authcrypt' | 'didcommAuthcrypt'; jwe: string }

/**
 * A vault payload spelled for the version it is sent in. vault 0.1 spells its enums in kebab case and 0.2 on in
 * camel case (trust-tasks vault/_shared 0.1 vs 0.2 and 0.3: `secretKind`, a target's `kind`, a sealed secret's
 * `envelope`); the VTA validates each version against its own schema, so a payload built once in 0.1's spelling is
 * invalid at 0.2 and 0.3. Callers build in 0.1's spelling; values with no camel form (`did`, `custom`) are unchanged.
 */
export function vaultPayloadFor<P extends Record<string, unknown>>(uri: string, payload: P): P {
  const minor = Number(/\/vault\/[a-z-]+\/0\.(\d+)$/.exec(uri)?.[1] ?? 1)
  if (minor < 2) return payload
  const camel = (value: unknown) =>
    typeof value === 'string' ? value.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) : value
  const out: Record<string, unknown> = { ...payload }
  if ('secretKind' in out) out.secretKind = camel(out.secretKind)
  if (Array.isArray(out.targets)) {
    out.targets = out.targets.map((target) =>
      target && typeof target === 'object' ? { ...target, kind: camel((target as { kind?: unknown }).kind) } : target
    )
  }
  const sealed = out.sealedSecret as { envelope?: unknown } | undefined
  if (sealed && typeof sealed === 'object') out.sealedSecret = { ...sealed, envelope: camel(sealed.envelope) }
  // 0.4 names a page's size `limit` (vault/list/0.4).
  if (minor >= 4 && 'pageSize' in out) {
    out.limit = out.pageSize
    delete out.pageSize
  }
  return out as P
}

/** Is this one of the 0.2 access-list URIs, or acl/list/0.3 (the same entries; a revoke may answer `entry: null`)? */
const isAcl02 = (uri: string) => /\/acl\/[a-z-]+\/0\.2$|\/acl\/list\/0\.3$/.test(uri)

/**
 * A full administrator's authority as an `acl/_shared/0.2` entry spells it:
 * every context, every key, up to the granter's own ceiling — what a 0.1 admin
 * entry with no scopes and no allowedKeys meant (acl/_shared/0.2 CONVENTIONS.md
 * §8, lines 175-189). 0.2 makes all three REQUIRED (acl-entry.schema.json:12-18).
 */
export const FULL_ADMIN_AUTHORITY_02 = {
  act: { scope: 'all' },
  keys: { scope: 'all' },
  capabilities: { scope: 'ceiling' },
} as const

/** What a VTA sends an approver: the request document's payload (`consent_request.rs`). */
export interface VtaConsentRequest {
  challenge: string
  taskType: string
  payloadDigest: string
  requester: string
  approverSet: string
  minApprovals: number
  excludeRequester?: boolean
  expiresAt: string
  sideEffects?: unknown
  exposure?: unknown
  effects?: unknown
  subject?: string
  origin?: string
  [key: string]: unknown
}

export interface VtaWhoAmI {
  /** The VTA answers `roles` (array) and `scopes` (`ctx:<id>`), per its whoami spec. */
  roles?: string[]
  scopes?: string[]
  capabilities?: string[]
  role?: string
  contexts?: string[]
  [key: string]: unknown
}

/** An agent context for Keyring's personas, used when the agent has one (IN-259). */
export const PERSONA_CONTEXT_ID = 'keyring'
/** The context every agent starts with. */
const DEFAULT_CONTEXT_ID = 'vta'

export interface VtaContext {
  id: string
  name?: string
  did?: string
  [key: string]: unknown
}

/** `vta/webvh/dids/create/1.0`'s answer — the persona, and the VTA's ids for its keys. */
export interface VtaMintedDid {
  did: string
  contextId: string
  serverId?: string
  scid: string
  signingKeyId: string
  kaKeyId: string
  /** From dids/create 1.1 on: the VTA serves the DID's log itself. */
  serverless?: boolean
  didDocument?: unknown
  [key: string]: unknown
}

/**
 * One row of a VTA's access list, as the canonical `AclEntry` spells it
 * (vta-sdk protocols/acl_management/entry.rs:174-233; the published schema is
 * `acl/_shared/0.1/acl-entry`). Only what Keyring reads is typed; the rest of a
 * row is ignored. `scopes` absent or empty on an admin row means unrestricted:
 * the agent's full administrator (vti-common acl/mod.rs:868-870).
 */
export interface VtaAclEntry {
  subject: string
  role: string
  scopes?: string[]
  label?: string
  /** RFC 3339; absent means the row never expires. */
  expiresAt?: string
  createdAt?: string
  createdBy?: string
  /**
   * The entry's capability narrowing, from `ext["org.openvtc.capabilities"]`.
   *
   * **Absent is not empty.** Absent means the entry holds everything its role
   * implies; an empty array would mean narrowed to nothing, which is why
   * upstream omits the member rather than sending `[]`
   * (`vta-sdk/.../acl_management/entry.rs` `capabilities_into_ext`). The
   * narrowing rides `ext` because the published `acl/*` schemas are
   * `additionalProperties: false` and the concept is ecosystem-local.
   */
  capabilities?: string[]
  /**
   * What the entry may act on, as stated (0.2) or as implied by the shape
   * (0.1). Prefer this over {@link scopes} for any decision: `scopes` is the
   * 0.1 wire member and cannot distinguish "everywhere" from "nowhere".
   */
  act?: AclAuthority
  /**
   * The capability narrowing, as stated. `ceiling` means everything the role
   * implies; `listed` names capabilities; `none` holds nothing. Absent means
   * the agent answered 0.1 with no narrowing in `ext`, which also means
   * everything the role implies.
   */
  capabilityScope?: { stated: 'ceiling' } | { stated: 'none' } | { stated: 'listed'; capabilities: string[] }
}

/** Where an entry's capability narrowing travels in the 0.1 shape, the VTA's own extension member. */
export const CAPABILITIES_EXT_MEMBER = 'org.openvtc.capabilities'

/**
 * An entry's authority over contexts and capabilities, read from whichever
 * `acl/_shared` shape the agent answered in.
 *
 * **0.1 states authority by shape, 0.2 states it outright**, and the registry
 * says why it changed: 0.1's `scopes` was "a list whose emptiness meant
 * `everywhere` for one role and `nowhere` for another, depending on a
 * maintainer convention the wire could not carry"
 * (`specs/acl/_shared/0.2/acl-entry.schema.json`). 0.2 replaces it with an
 * explicit `act` scope — `all`, `none`, or a non-empty context list — and
 * makes `capabilities` a declared member with the same three shapes
 * (`ceiling`, `none`, `listed`), rather than an extension.
 *
 * vta-service 0.60 serves `acl/list/0.1` only (its discovery list names no
 * 0.2), so 0.1 is what agents answer today. This client asks for both, so the
 * 0.2 shape is read rather than silently seen as an entry with no contexts and
 * no narrowing — which would refuse a phone that is in fact allowed.
 */
export type AclAuthority =
  | { stated: 'all' }
  | { stated: 'none' }
  | { stated: 'contexts'; contexts: string[] }
  /** 0.1 only: the shape is all the wire carried, so the role decides what empty means. */
  | { stated: 'byShape'; contexts: string[] }

/** The schema's bound on an entry's label (acl-entry.schema.json `label.maxLength`). */
const ACL_LABEL_MAX = 256

/**
 * The capability narrowing out of an entry's `ext`, or nothing when the entry
 * is not narrowed. An empty array on the wire is kept as an empty array: it
 * would mean "narrowed to nothing", which is not the same as unnarrowed.
 */
function capabilitiesFrom(ext: unknown): { capabilities?: string[] } {
  if (!ext || typeof ext !== 'object') return {}
  const value = (ext as Record<string, unknown>)[CAPABILITIES_EXT_MEMBER]
  if (!Array.isArray(value)) return {}
  return { capabilities: value.filter((c): c is string => typeof c === 'string') }
}

/** One of 0.2's three-shape scopes, when the member is one. */
function statedScope(value: unknown): { scope: string; contexts?: unknown; grants?: unknown } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const scope = (value as { scope?: unknown }).scope
  return typeof scope === 'string' ? (value as { scope: string }) : undefined
}

const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []

/** What the entry may act on: 0.2's stated `act`, else what 0.1's `scopes` shape carries. */
function actFrom(raw: Record<string, unknown>): { act?: AclAuthority } {
  const stated = statedScope(raw.act)
  if (stated) {
    if (stated.scope === 'all') return { act: { stated: 'all' } }
    if (stated.scope === 'none') return { act: { stated: 'none' } }
    if (stated.scope === 'contexts') return { act: { stated: 'contexts', contexts: stringsOf(stated.contexts) } }
    return {}
  }
  // 0.1: the list is all there is, and an empty one means different things for
  // different roles — so it is marked as read-by-shape rather than resolved
  // here, and the caller applies its maintainer's convention knowingly.
  if (Array.isArray(raw.scopes)) return { act: { stated: 'byShape', contexts: stringsOf(raw.scopes) } }
  return {}
}

/** The capability narrowing: 0.2's stated `capabilities`, else 0.1's `ext` member. */
function capabilityScopeFrom(raw: Record<string, unknown>): {
  capabilityScope?: { stated: 'ceiling' } | { stated: 'none' } | { stated: 'listed'; capabilities: string[] }
} {
  const stated = statedScope(raw.capabilities)
  if (stated) {
    if (stated.scope === 'ceiling') return { capabilityScope: { stated: 'ceiling' } }
    if (stated.scope === 'none') return { capabilityScope: { stated: 'none' } }
    if (stated.scope === 'listed') {
      // Each grant names its capability; a resource qualifier may narrow it
      // further, which nothing here reads yet.
      const grants = Array.isArray(stated.grants) ? stated.grants : []
      const capabilities = grants
        .map((g) => (g && typeof g === 'object' ? (g as { capability?: unknown }).capability : undefined))
        .filter((c): c is string => typeof c === 'string')
      return { capabilityScope: { stated: 'listed', capabilities } }
    }
    return {}
  }
  const fromExt = capabilitiesFrom(raw.ext).capabilities
  return fromExt ? { capabilityScope: { stated: 'listed', capabilities: fromExt } } : {}
}

/** Read an `AclEntry` off the wire, keeping only the members Keyring uses; undefined if it is not one. */
function aclEntryFrom(value: unknown): VtaAclEntry | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.subject !== 'string' || typeof raw.role !== 'string') return undefined
  const text = (key: string) => (typeof raw[key] === 'string' ? { [key]: raw[key] as string } : {})
  return {
    subject: raw.subject,
    role: raw.role,
    // `scopes` is the entry's **context** list (the wire form of
    // `allowed_contexts`), not its capabilities — reading it as capabilities is
    // how this first went wrong.
    ...(Array.isArray(raw.scopes) ? { scopes: raw.scopes.filter((s): s is string => typeof s === 'string') } : {}),
    ...capabilitiesFrom(raw.ext),
    ...actFrom(raw),
    ...capabilityScopeFrom(raw),
    ...text('label'),
    ...text('expiresAt'),
    ...text('createdAt'),
    ...text('createdBy'),
  }
}

/**
 * The entries in an `acl/list` answer, as this client reads them.
 *
 * Exported so a test can put a **wire** document through the real parser
 * rather than hand-building what it imagines the parser returns. That
 * distinction is not academic: the hidden-vetting tests once faked the parsed
 * shape with the capability in the wrong member, agreeing with a parser bug
 * and passing over it. `__tests__/hiddenVettingAcl.test.ts` validates the
 * documents it passes here against the registry's own `acl/_shared` schemas,
 * so wire shape and parse are each checked by something that is not the other.
 */
export function parseAclEntries(raw: unknown): VtaAclEntry[] {
  const entries = Array.isArray(raw) ? raw : []
  return entries.map(aclEntryFrom).filter((e): e is VtaAclEntry => e !== undefined)
}

/**
 * How a log line names this phone's agent beside a task type: not at all, for
 * hidden vetting.
 *
 * The vtiAgent side of this redaction keeps a vetter's DID out of the log
 * (`isHiddenVettingType`). These lines name no vetter — the agent is the
 * person's own — but `<agent DID> … vta/pcs/applications/create` still says
 * *this person applied with private vetting*, and the phone's log leaves the
 * device in remote logs and testers' problem reports. Half a privacy fix is
 * not one.
 */
function agentNamedFor(type: string, vtaDid: string): string {
  return isHiddenVettingType(type) ? 'its agent' : vtaDid
}

/** The `{entry}` wrapper that `acl/grant` and `acl/revoke` answer with. */
function answeredEntry(task: string, answer: unknown): VtaAclEntry {
  const entry = aclEntryFrom((answer as { entry?: unknown } | undefined)?.entry)
  if (!entry) throw new Error(`${LOG_PREFIX} the VTA's answer to ${task} carries no entry`)
  return entry
}

const nowSec = () => Math.floor(Date.now() / 1000)

const CONSENT_REQUIRED = 'auth:consent_required'

/**
 * The consent challenge inside a refusal, when that is what the refusal is.
 *
 * The challenge normally rides in `details`, but a VTA drops `details` that
 * exceed the framework's size bound and sends the code alone — which one signed
 * request per approver reaches at three approvers (2026-09-21, "error `details`
 * exceeds the framework bound and was dropped"). The task is still held, so a
 * bare `auth:consent_required` is read as held too: there is nothing to relay
 * and no digest to wait on, but re-submitting still collects the grant.
 */
export function consentPendingOf(
  error: unknown
): { payloadDigest?: string; requests: Record<string, unknown>[]; omitted?: number } | undefined {
  if (!(error instanceof VtiRefusal)) return undefined
  const details = error.details as
    | {
        reason?: string
        payloadDigest?: string
        consentRequestsOmitted?: number
        consentRequests?: (Record<string, unknown> & { payload?: { payloadDigest?: string } })[]
      }
    | undefined
  if (details?.reason === CONSENT_REQUIRED) {
    const requests = details.consentRequests ?? []
    // Since vti #1680 the challenge's core members — `payloadDigest` among them
    // — are always in `details`; only the signed requests are dropped when they
    // do not fit, and `consentRequestsOmitted` counts them. Read the digest from
    // `details` first, so the grant can still be waited on precisely.
    const omitted = typeof details.consentRequestsOmitted === 'number' ? details.consentRequestsOmitted : undefined
    return {
      payloadDigest: details.payloadDigest ?? requests[0]?.payload?.payloadDigest,
      requests,
      ...(omitted !== undefined ? { omitted } : {}),
    }
  }
  if (details === undefined && (error.code === CONSENT_REQUIRED || error.message.includes(CONSENT_REQUIRED))) {
    return { requests: [] }
  }
  return undefined
}

/**
 * What a VTA's DID document tells a client: the mediator it is reached through.
 * A VTA's `#vta-didcomm` service names the mediator's DID as its endpoint; the
 * mediator's own document then carries the URLs.
 */
export async function resolveVtaMediator(agent: Agent, vtaDid: string): Promise<VtiMediatorEndpoints> {
  const doc = await resolveDidDocumentRetrying(agent, vtaDid)
  const services = (doc.service ?? []) as { type?: string; serviceEndpoint?: unknown }[]
  const endpoints = services
    .filter((s) => String(s.type) === 'DIDCommMessaging')
    .flatMap((s) => (Array.isArray(s.serviceEndpoint) ? s.serviceEndpoint : [s.serviceEndpoint]))
  const mediatorDid = endpoints
    .map((e) => (typeof e === 'string' ? e : (e as { uri?: string })?.uri))
    .find((uri) => typeof uri === 'string' && uri.startsWith('did:'))
  if (!mediatorDid) throw new Error(`${LOG_PREFIX} ${vtaDid} advertises no DIDComm mediator`)
  return resolveVtiMediator(agent, mediatorDid)
}

/**
 * The agent has nowhere to publish a new identity: no DID-hosting server is
 * registered with it, and the app names no serverless base URL. Only the
 * agent's operator can fix this, so it is not worth retrying.
 */
export class PersonaHostMissing extends Error {
  constructor(readonly vtaDid?: string) {
    super(`${LOG_PREFIX} the agent has no DID host to publish a new identity on`)
    this.name = 'PersonaHostMissing'
  }
}

/**
 * A swap whose outcome could not be settled: neither the key the phone signed
 * in with nor the successor it sent is accepted by the VTA right now, or the
 * VTA could not be asked. Both keys stay recorded — either may be the live one
 * — and the next connect asks again.
 */
/**
 * The key swap went through — the agent holds the new key and the phone has
 * recorded it — but signing in as the new key failed. Not a failed link: the
 * sign-in is the ordinary one from here, and is retried (the 227 iOS link
 * failure, where it stalled after the mediator's authenticate).
 */
export class SwapDoneSignInFailed extends Error {
  constructor(
    readonly newDid: string,
    readonly cause: unknown
  ) {
    super(
      `${LOG_PREFIX} key swap done; signing in as the new key failed: ${cause instanceof Error ? cause.message : String(cause)}`
    )
    this.name = 'SwapDoneSignInFailed'
  }
}

/**
 * The agent kept the key the phone signed in with: the swap onto the long-term
 * key did not happen, and asking the agent confirmed it. Why, for a sentence
 * rather than "the app doesn't know why" (#287's device check, Run A, 10-05):
 * `held`, an approval rule held the swap for consent until the wait ran out;
 * `refused`, the agent answered no; `noAnswer`, it did not answer at all. The
 * message is the original one, for Details.
 */
export class KeySwapNotDone extends Error {
  constructor(
    readonly why: 'held' | 'refused' | 'noAnswer',
    readonly cause: unknown
  ) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'KeySwapNotDone'
  }
}

/** Why a swap the agent confirmed it did not make failed. */
export function keySwapNotDone(error: unknown): KeySwapNotDone {
  const why = consentPendingOf(error) ? 'held' : error instanceof VtiRefusal ? 'refused' : 'noAnswer'
  return new KeySwapNotDone(why, error)
}

export class ManagerKeyUnresolved extends Error {
  constructor(
    readonly vtaDid: string,
    readonly current: string,
    readonly next: string,
    /** Whether the VTA refused both keys outright, rather than one of them going unanswered. */
    readonly refusedBoth: boolean,
    /** What each probe got, for the log. */
    readonly detail: string
  ) {
    // Worded for the link machine's reading of a connect failure: only the
    // VTA's refusal of both keys reads as access revoked ("not in ACL"); a key
    // that went unanswered reads as a dropped session, which is retried.
    super(
      refusedBoth
        ? `${LOG_PREFIX} ${vtaDid} accepts neither of this phone's keys after a key swap (not in ACL); both are kept`
        : `${LOG_PREFIX} could not ask ${vtaDid} which of this phone's keys it knows after a key swap; both are kept and the next connect asks again`
    )
    this.name = 'ManagerKeyUnresolved'
  }
}

/**
 * The VTA's refusal of a sender it holds no live grant for. An envelope from a
 * DID not in the ACL, or whose entry has lapsed, is refused before dispatch as
 * a trust-task error `permissionDenied` whose reason is the ACL's own
 * `forbidden: DID not in ACL: <did>` / `forbidden: ACL entry expired: <did>`
 * (vta-service `messaging/auth.rs` `auth_for_trust_task_envelope`,
 * `trust_tasks/mod.rs` `reject_trust_task(PermissionDenied)`, vti-common
 * `acl/mod.rs` `check_acl_entry`); the reason travels as the error's
 * `message`. Read from the ACL's own words rather than the code alone, since
 * `permissionDenied` also covers policy refusals that say nothing about which
 * key the VTA knows. For a probe this is conclusive: the key is not (or no
 * longer) on the ACL.
 *
 * The one test for "this phone's agent no longer accepts this phone" (IN-350):
 * the link, the device screens and the persona inbox all read it from here.
 * It reads any error's message, so a refusal wrapped by the caller (the persona
 * inbox's) still counts. The words alone do not say WHO refused: a community
 * words its own ACL refusal the same way (vtc-service acl/storage.rs:85). Apply
 * it only to an error from a call to this phone's own agent, never to one from
 * a community.
 */
const NOT_ON_ACL = /not in (the )?ACL|ACL entry expired/i
export function refusedAsNotOnAcl(error: unknown): boolean {
  return error instanceof Error && NOT_ON_ACL.test(error.message)
}

/**
 * Harness-only: what to do with the answer to the next `acl/swap-key`.
 * `drop` — let the VTA perform the swap, then discard its answer as if the
 * socket had dropped, and recover in place. `drop-and-stop` — the same, but
 * leave the successor pending and fail, as an app killed mid-swap would, so a
 * relaunch's connect is what recovers. Honoured only in a `__DEV__` build; a
 * release build never drops an answer whatever is set.
 */
export type VtaSwapTestHook = 'drop' | 'drop-and-stop' | undefined
let swapTestHook: VtaSwapTestHook

/** Build-time wiring for the e2e harness, like `setPeerLegCarriage`: called once from the app's container. */
export function setVtaSwapTestHook(mode: string | undefined): void {
  swapTestHook = mode === 'drop' || mode === 'drop-and-stop' ? mode : undefined
}

/** The hook in force: always undefined outside a `__DEV__` build. */
export function activeSwapTestHook(): VtaSwapTestHook {
  return typeof __DEV__ !== 'undefined' && __DEV__ ? swapTestHook : undefined
}

type Probe = { kind: 'live' } | { kind: 'refused'; detail: string } | { kind: 'unknown'; detail: string }

/** Documents the agent sends of its own accord: never the answer to a task this client asked. */
const UNSOLICITED = new Set<string>([VTA_TASK.consentRequest, VTA_TASK.consentGranted, ...STEP_UP_REQUEST_TYPES])

/** Persona mints running now, by VTA and community (see `ensurePersona`). */
const personasInFlight = new Map<string, Promise<VtiPersona>>()

/** A task dropped from the queue before it was sent ({@link VtaClient.dropQueued}). */
export class VtaTaskDropped extends Error {
  constructor(readonly taskType: string) {
    super(`${LOG_PREFIX} ${taskType} was dropped before it was sent`)
    this.name = 'VtaTaskDropped'
  }
}

/**
 * The task was sent and nothing answered it inside its own timeout.
 *
 * It was a bare `Error` with no code and, off TSP, **no log line at all**.
 * That is why we could not say why `vta/pcs/prove` did not answer on
 * 2026-10-15: a 90-second wait that ends in silence left nothing behind in the
 * report to read. A caller can now word it, and the line below records it.
 */
export class VtaNoAnswer extends Error {
  readonly code = 'vta:noAnswer'
  constructor(
    readonly taskType: string,
    readonly waitedMs: number
  ) {
    super(`${LOG_PREFIX} the VTA did not answer ${taskType} within ${Math.round(waitedMs / 1000)} s`)
    this.name = 'VtaNoAnswer'
  }
}

/** TSP no-answers in a row that open the breaker (vta-sdk `REPLY_TIMEOUT_BREAKER`). */
export const REPLY_TIMEOUT_BREAKER = 2
/**
 * How long the breaker holds asks before one probe, step by step: 30 s, then 60, 120, and 300 s from then on, the VTA's
 * own window for a peer it found not collecting its inbox (VTI #1978, `UncollectedPeers`). A fixed 300 s would notice
 * a quick recovery up to five minutes late; greeting every few seconds only adds to an inbox already full.
 */
export const REPLIES_STALLED_STEPS_MS = [30_000, 60_000, 120_000, 300_000] as const

/**
 * The reply breaker for one agent, kept across the clients the phone makes for it (D7FG-2Y9J: each reconnect built a
 * new client, so a hold opened at 14:52:00 was forgotten four seconds later and the agent was greeted again every
 * ~40 s). Opened by {@link REPLY_TIMEOUT_BREAKER} unanswered TSP asks in a row; each opening holds the next step of
 * {@link REPLIES_STALLED_STEPS_MS}; any word from the agent closes it and starts the steps over.
 */
/**
 * Whether a VTA task only reads: a type whose last segment before the version
 * is `whoami`, `list`, `show`, `status` or `get`. Only such a task is sent
 * again over DIDComm after a TSP 1.0 ask went unanswered (cutover plan §6.2,
 * change 2); anything else could run twice. Unversioned types do not match.
 * The slash before the verb is load-bearing: it keeps `auth/revoke-session`,
 * `keys/export-secret` and the like out.
 */
export function isReadOnlyVtaTask(type: string): boolean {
  return /\/(whoami|list|show|status|get)\/\d+(\.\d+)*$/.test(type)
}

/** A task asked for and not yet started: `start` sends it and settles when its answer (or failure) is in. */
interface QueuedTask {
  ticket: number
  type: string
  start: () => Promise<void>
}

export class TspReplyBreaker {
  /** TSP asks in a row that got no answer; any reply resets it. */
  noAnswerInARow = 0
  /** Set while open; asks wait until this time, then one goes as a probe. */
  private stalledUntil?: number
  private step = 0
  private earlyProbeTaken = false

  /** Open: replies have stopped reaching this phone. */
  get open(): boolean {
    return this.stalledUntil !== undefined
  }

  /** Whether an ask must wait now (open, and inside its hold). */
  holding(now: number): boolean {
    return this.stalledUntil !== undefined && now < this.stalledUntil
  }

  /** A reply came: closed, and the steps start over. Answers whether it had been open. */
  replied(): boolean {
    const was = this.open
    this.noAnswerInARow = 0
    this.stalledUntil = undefined
    this.step = 0
    this.earlyProbeTaken = false
    return was
  }

  /** One more ask unanswered. Answers the hold just opened, in ms, when this one opened it. */
  unanswered(now: number): number | undefined {
    this.noAnswerInARow += 1
    if (this.noAnswerInARow < REPLY_TIMEOUT_BREAKER) return undefined
    const holdMs = REPLIES_STALLED_STEPS_MS[Math.min(this.step, REPLIES_STALLED_STEPS_MS.length - 1)]
    this.step += 1
    this.stalledUntil = now + holdMs
    this.earlyProbeTaken = false
    return holdMs
  }

  /**
   * Back in the foreground, or on a new network: the moments a receive leg that died comes back, so the hold ends
   * early once per step and the next ask goes as the probe. Answers whether it did.
   */
  allowEarlyProbe(now: number): boolean {
    if (!this.holding(now) || this.earlyProbeTaken) return false
    this.earlyProbeTaken = true
    this.stalledUntil = now
    return true
  }
}

/**
 * Not sent: the last asks over TSP got no answer, so replies are not reaching
 * this phone (vta-sdk `VtaError::RepliesNotArriving`). Sending more would only
 * queue more replies the phone cannot collect, or be dropped by a VTA that
 * found it not collecting.
 */
export class VtaRepliesNotArriving extends Error {
  constructor(
    readonly taskType: string,
    readonly consecutiveTimeouts: number
  ) {
    super(`${LOG_PREFIX} ${taskType} not sent; replies are not reaching this phone`)
    this.name = 'VtaRepliesNotArriving'
  }
}

export class VtaClient {
  private session?: VtiMediatorSession
  private mediator?: VtiMediatorEndpoints
  private identity?: VtiClientIdentity
  /**
   * Tasks are fully serialised (one in flight), so there is at most one reply
   * to wait for. The only thing to guard against is a stale message the mediator
   * redelivers at connect time — measured: a queued refusal of an earlier
   * unsigned `whoami` "answered" a later signed one. A message that arrived
   * before the current request was sent cannot be its reply, so it is dropped.
   * A reply is matched by its thread (see `deliver`); only a reply that names
   * no thread falls back to arriving next, with a warning.
   */
  /**
   * The ids each keyed request was sent with, by its idempotency key, so a
   * retry with the same key also takes an answer threaded to an earlier
   * attempt. The VTA answers a keyed retry by replaying the first attempt's
   * recorded reply as it was (vta-service trust_tasks/idempotency.rs:249-253),
   * whose document is threaded to that first attempt; and the first attempt's
   * own answer may arrive after it gave up. Either is this request's answer.
   * In memory, and only for keyed requests: no other task's threading loosens.
   */
  private attemptsByKey = new Map<string, string[]>()

  /** The tasks on the wire, each waiting for its reply (more than one only in the read lane, vtaReadLane.ts). */
  private pendings = new Map<
    number,
    {
      resolve: (plaintext: DidCommV2PlaintextMessage) => void
      sentAt: number
      /** What the reply may name as its thread: our DIDComm message, our document, our thread. */
      ids: Set<string>
      /** Of `ids`, those an earlier attempt of the same keyed request was sent with. */
      earlier?: Set<string>
    }
  >()
  private nextSlot = 0
  /** The tasks on the wire now: what a task queued behind them logs that it waits on. */
  private inFlight = new Map<number, { type: string; since: number; id: string }>()
  /**
   * Whether this session's agent threads its replies. Until one comes back threaded, and for the rest of a session
   * where one did not, every task goes one at a time: an unthreaded reply can be matched only to the one task on the
   * wire. Cleared at each (re)connect.
   */
  private replyThreading: 'unknown' | 'threaded' | 'unthreaded' = 'unknown'
  /** When an unanswered TSP ask last counted against the breaker: an ask sent before then was on the wire with it. */
  private lastStrikeAt = 0
  /** The manager's TSP identity, when this build and this wallet can supply one. */
  private tsp?: TspSessionIdentity
  /** §4.2's per-peer decision, taken once per session. */
  private readonly carriageByPeer = new Map<string, Carriage>()
  /** Whether the VTA has been greeted (§7.2.2) this session; cleared by an ask over TSP that got no answer. */
  private greeted = false
  private peerRevisionStore?: TspPeerRevisionStore
  private probeStore?: TspProbeStore
  /**
   * What each peer was observed to write in; a fresh TSP 1.0 record lets a
   * session speak TSP 1.0 unprobed. Made on first use: a session that never
   * speaks TSP never touches it.
   */
  private get peerRevisions(): TspPeerRevisionStore {
    return (this.peerRevisionStore ??=
      this.options.peerRevisionStore ?? new GenericRecordsTspPeerRevisionStore(this.agent))
  }
  /** When each peer was last probed, and how it went (`tspProbe.ts`); made on first use. */
  private get probes(): TspProbeStore {
    return (this.probeStore ??= this.options.probeStore ?? new GenericRecordsTspProbeStore(this.agent))
  }
  /** The probe running now, for this session; one at a time. */
  private probing?: Promise<TspProbeOutcome | 'skipped'>
  /**
   * What the probe's answer may name as its thread. `answered` is set the
   * moment it arrives, so an answer that comes before the wait has begun (while
   * the frames are still being sent) is not lost.
   */
  private probeWaiter?: { ids: Set<string>; answered: boolean; resolve: () => void }
  /** Whether the VTA has sent this session anything at all: the evidence it is up (a probe's "down" vs "silent"). */
  private heardFromAgent = false
  /** This agent's reply breaker: the caller's, shared by every client it makes for the agent, else this client's own. */
  private readonly breaker: TspReplyBreaker
  /** Tasks asked for and not yet started, oldest first. */
  private waiting: QueuedTask[] = []
  /** Lane tasks on the wire now; and whether a task that runs alone is. */
  private readsRunning = 0
  private aloneRunning = false
  /** Each task's place in the queue; {@link dropQueued} drops those not yet sent. */
  private tickets = 0
  private droppedThrough = 0
  /** Stop the waits of the tasks in flight ({@link dropQueued}). */
  private cancelInFlight = new Set<() => void>()

  /**
   * Drop every task queued and not yet sent, and stop waiting for the one in
   * flight: each fails with {@link VtaTaskDropped}. For a phone about to
   * unlink, whose startup tasks (whoami … device/list) would otherwise go
   * first and leave no time to tell the agent (227 gate, U4); an answer to the
   * dropped one, if it comes, is taken for no task. Tasks asked for after this
   * run as usual, at once.
   */
  dropQueued(): void {
    this.droppedThrough = this.tickets
    for (const cancel of [...this.cancelInFlight]) cancel()
  }

  /** Keep a keyed attempt's ids; the oldest keys go first, past a few dozen. */
  private rememberAttempt(key: string, ids: string[]): void {
    const all = [...(this.attemptsByKey.get(key) ?? []), ...ids]
    this.attemptsByKey.delete(key)
    this.attemptsByKey.set(key, all)
    while (this.attemptsByKey.size > MAX_KEYED_REQUESTS_REMEMBERED) {
      const oldest = this.attemptsByKey.keys().next().value
      if (oldest === undefined) break
      this.attemptsByKey.delete(oldest)
    }
  }

  /** A reply came: the breaker closes and the steps start over. */
  private repliesArrived(): void {
    if (this.breaker.replied()) this.options.onRepliesStalled?.(false)
  }

  /** Whether replies have stopped reaching this phone: the breaker is open. */
  get repliesStalled(): boolean {
    return this.breaker.open
  }

  private deliver(plaintext: DidCommV2PlaintextMessage): void {
    // Anything from the agent shows replies reach this phone again.
    this.repliesArrived()
    // The probe's answer is the probe's, never a task's, and goes nowhere else.
    const probe = this.probeWaiter
    if (probe) {
      const refs = [
        plaintext.thid,
        (plaintext as { pthid?: string }).pthid,
        (plaintext.body as { threadId?: unknown } | undefined)?.threadId,
      ]
      if (refs.some((ref) => typeof ref === 'string' && probe.ids.has(ref))) {
        this.probeWaiter = undefined
        probe.answered = true
        probe.resolve()
        return
      }
    }
    this.heardFromAgent = true
    // A granted notice answers a wait, never a task.
    const body = plaintext.body as { type?: string; payload?: { payloadDigest?: string } } | undefined
    if (body?.type === VTA_TASK.consentGranted) {
      const digest = body.payload?.payloadDigest
      const wake = digest ? this.grantWaiters.get(digest) : undefined
      if (wake) {
        this.grantWaiters.delete(digest as string)
        wake()
      }
      this.options.onInbound?.(plaintext)
      return
    }
    // What the agent sends of its own accord is never a task's answer: a
    // consent request taken as the reply to a heartbeat sent just before it
    // arrived never reached the approvals (push finding F3, 09-29).
    if (body?.type && UNSOLICITED.has(body.type)) {
      this.options.onInbound?.(plaintext)
      return
    }
    if (this.pendings.size === 0) {
      this.options.onInbound?.(plaintext)
      return
    }
    // Upstream threads every reply to its request: the DIDComm reply's `thid`
    // names our message (vta-service messaging/service.rs:673-677), the reply
    // document's `threadId` names our request (vta-mobile-core reply.rs); a
    // TSP reply carries the document's in `thid` (vtiTsp.ts).
    const threadRefs = [
      plaintext.thid,
      (plaintext as { pthid?: string }).pthid,
      (body as { threadId?: unknown } | undefined)?.threadId,
    ].filter((ref): ref is string => typeof ref === 'string' && ref.length > 0)
    if (threadRefs.length > 0) {
      const match = [...this.pendings].find(([, p]) => threadRefs.some((ref) => p.ids.has(ref)))
      if (!match) {
        // Threaded to another request: a late answer to an earlier task.
        this.options.onInbound?.(plaintext)
        return
      }
      const [slot, pending] = match
      if (pending.earlier && threadRefs.some((ref) => pending.earlier?.has(ref)))
        this.agent.config.logger.info(
          `${LOG_PREFIX} took the answer to an earlier attempt of the same keyed request (${body?.type ?? 'no type'})`
        )
      if (this.replyThreading === 'unknown') {
        this.replyThreading = 'threaded'
        if (this.readLaneSize > 1)
          this.agent.config.logger.info(
            `${LOG_PREFIX} ${this.vtaDid} threads its replies: up to ${this.readLaneSize} reads at a time this session`
          )
      }
      this.pendings.delete(slot)
      pending.resolve(plaintext)
      return
    }
    // No thread at all: the old rule, the next message after the request — but
    // never one older than it (a poll draining the queue) — and say so. With
    // more than one task on the wire there is no telling whose it is: none
    // takes it, and the rest of the session goes one at a time.
    const [only] = this.pendings.size === 1 ? [...this.pendings] : []
    const sentAt = only ? only[1].sentAt : Math.min(...[...this.pendings.values()].map((p) => p.sentAt))
    const stale = typeof plaintext.created_time === 'number' && plaintext.created_time * 1000 < sentAt - 5000
    if (stale) {
      this.options.onInbound?.(plaintext)
      return
    }
    this.replyThreading = 'unthreaded'
    if (!only) {
      this.agent.config.logger.warn(
        `${LOG_PREFIX} a reply with no thread came while ${this.pendings.size} tasks were on the wire; taken by none, and one at a time from now (${body?.type ?? 'no type'})`
      )
      this.options.onInbound?.(plaintext)
      return
    }
    this.agent.config.logger.warn(
      `${LOG_PREFIX} a reply with no thread was taken as the answer to the task in flight (${body?.type ?? 'no type'})`
    )
    this.pendings.delete(only[0])
    only[1].resolve(plaintext)
  }

  private get readLaneSize(): number {
    return Math.max(1, this.options.readLaneSize ?? VTA_READ_LANE_SIZE)
  }

  /** Whether a task of `type` goes beside the queue now (vtaReadLane.ts, besideQueue). */
  private goesBeside(type: string): boolean {
    return (
      (this.options.heartbeatBeside ?? VTA_HEARTBEAT_BESIDE) && this.replyThreading === 'threaded' && besideQueue(type)
    )
  }

  /** Grants this client is waiting for, by the payload digest the VTA names. */
  private grantWaiters = new Map<string, () => void>()
  /** Which version of each family this agent was found to serve (taskVersions.ts). */
  private readonly versions = new TaskVersions(
    (family, from, to) =>
      this.agent.config.logger.info(
        `${LOG_PREFIX} ${agentNamedFor(from, this.vtaDid)} does not serve ${from}; asking ${to} (${family})`
      ),
    // The version in use, once per family: what shows when an older one's fallback can go.
    (family, uri) => this.agent.config?.logger?.info(`${LOG_PREFIX} ${family} answered in ${uri}`)
  )

  constructor(
    private readonly agent: Agent,
    readonly vtaDid: string,
    private readonly store: VtiIdentityStore,
    private readonly options: {
      onError?: (error: Error) => void
      /** Anything the VTA sends that is not the answer to a task — a consent request, a granted notice. */
      onInbound?: (plaintext: DidCommV2PlaintextMessage) => void
      /** A task was held for an approver's consent; the wait is on. */
      onConsentPending?: (info: { taskType: string; payloadDigest?: string }) => void
      /** How long to wait for approvers before giving up on a held task. */
      consentWaitMs?: number
      /**
       * The agent asks for a step-up on a task: ask the person, showing the
       * agent's `reason` as it is. Answer `approve` or `deny`; throw when the
       * person could not be asked (nothing is sent then). Without it, the
       * refusal stands.
       */
      onStepUp?: (request: StepUpRequest, context: { taskType: string }) => Promise<'approve' | 'deny'>
      /** How long a fresh session drains the mediator's backlog before the first send. */
      connectDrainMs?: number
      /** How long to wait for the answer to `acl/swap-key`. */
      swapTimeoutMs?: number
      /** How long each `whoami` asked while settling a swap waits for its answer. */
      probeTimeoutMs?: number
      /** The agent's reply breaker, shared across the clients made for it; a client of its own when absent. */
      breaker?: TspReplyBreaker
      /** Replies stopped reaching this phone (the breaker opened), or came back. */
      onRepliesStalled?: (stalled: boolean) => void
      /** Where peer revisions are kept; the wallet's generic records when absent. */
      peerRevisionStore?: TspPeerRevisionStore
      /** Where probe outcomes are kept; the wallet's generic records when absent. */
      probeStore?: TspProbeStore
      /** How many read-lane tasks may be on the wire at once (vtaReadLane.ts); its default when absent. */
      readLaneSize?: number
      /** Whether the heartbeat goes beside the queue (vtaReadLane.ts); its default when absent. */
      heartbeatBeside?: boolean
    } = {}
  ) {
    this.breaker = options.breaker ?? new TspReplyBreaker()
  }

  /** The probe in flight, if any — for tests and for a caller that wants to wait for it. */
  get probeInFlight(): Promise<TspProbeOutcome | 'skipped'> | undefined {
    return this.probing
  }

  /** The DID this phone presents to its VTA — enrolled on the VTA's ACL. */
  get managerDid(): string | undefined {
    return this.identity?.did
  }

  get isConnected(): boolean {
    return this.session?.isOpen === true
  }

  /**
   * Mint the manager identity if this phone has none for this VTA yet. Minting
   * is separate from connecting because enrolment sits between them: the VTA's
   * operator has to admit this DID before a session can be opened.
   */
  async ensureManagerIdentity(): Promise<string> {
    const existing = await this.store.getManager(this.vtaDid)
    if (existing) return existing.did
    this.mediator ??= await resolveVtaMediator(this.agent, this.vtaDid)
    const did = await createVtiClientDid(this.agent, this.mediator)
    await this.store.setManager({ vtaDid: this.vtaDid, did, createdAt: new Date().toISOString() })
    return did
  }

  async connect(): Promise<void> {
    if (this.session?.isOpen) return
    this.mediator ??= await resolveVtaMediator(this.agent, this.vtaDid)
    const did = await this.ensureManagerIdentity()
    // A swap this phone never saw the end of — the answer was lost, or the app
    // was killed while waiting for it — is settled before anything signs as
    // either key; settling leaves the session open as the key the VTA knows.
    const record = await this.store.getManager(this.vtaDid)
    if (record?.pendingNext) {
      this.agent.config.logger.info(
        `${LOG_PREFIX} a key swap is pending on connect (${record.pendingNext.did}); asking the VTA which key it knows`
      )
      await this.resolvePendingSwap(record)
      return
    }
    await this.openAs(did)
  }

  /** Open the session as `did`. */
  private async openAs(did: string): Promise<void> {
    this.mediator ??= await resolveVtaMediator(this.agent, this.vtaDid)
    this.identity = await vtiClientIdentityFromDid(this.agent, did)
    // Best effort: a wallet whose manager key cannot back TSP ports simply
    // stays on DIDComm, and §4.2 says so rather than failing the connect.
    // A temporary did:key stays on DIDComm: TSP delivery to a just-granted
    // key is not exercised upstream either (the VTA plugin leads with DIDComm
    // for its ephemeral did:key), and the key lasts only until the swap.
    this.tsp = did.startsWith('did:key:')
      ? undefined
      : await tspSessionForManager(this.agent, did).catch(() => undefined)
    this.greeted = false
    // Not the breaker: a fresh socket is no evidence replies arrive, and the breaker is the agent's, not this
    // session's (D7FG-2Y9J: resetting it here, at every reconnect, was half of why the hold never held).
    this.carriageByPeer.clear()
    this.heardFromAgent = false
    this.replyThreading = 'unknown'
    this.probeWaiter = undefined
    const session = new VtiMediatorSession(this.agent, this.identity, this.mediator, {
      onError: (error) => this.options.onError?.(error),
      onMessage: (plaintext) => this.deliver(plaintext),
      // The VTA answers the way it was asked, so a request sent over TSP comes
      // back over TSP. Opened here and handed to the same `deliver` a DIDComm
      // reply reaches — unpacking presents the document in the plaintext shape
      // every caller already reads.
      ...(this.tsp
        ? {
            onTspFrame: async (bytes: Uint8Array) => {
              const opened = await unpackTrustTaskFromPeer(this.tsp as TspSessionIdentity, bytes, did)
              if (!opened) return
              // What the agent writes in decides how later sessions speak to it (§6.2, row 3).
              await this.peerRevisions
                .observe(opened.unpacked.sender, opened.unpacked.revision, tsp.peekRevision(bytes).minor)
                .catch(() => undefined)
              this.deliver(opened.plaintext)
            },
          }
        : {}),
    })
    await session.start()
    this.session = session
    // Live delivery flushes whatever the mediator has queued for this DID —
    // and this DID is persisted, so that backlog can include stale replies from
    // earlier sessions. No reply to any request of ours can exist yet, so a
    // short drain with nothing pending discards the backlog before the first send.
    await new Promise((resolve) => setTimeout(resolve, this.options.connectDrainMs ?? 2000))
  }

  /** Ask the session to prove its socket answers (back in the foreground); one that does not is reopened. */
  checkAlive(): void {
    this.session?.checkAlive()
  }

  async disconnect(): Promise<void> {
    await this.session?.stop()
    this.session = undefined
    this.pendings.clear()
    this.inFlight.clear()
    this.replyThreading = 'unknown'
    this.probeWaiter = undefined
  }

  /** Start the background probe of this VTA (cutover plan §6.2), unless one is running. */
  private startProbe(serviceId?: string): void {
    if (this.probing) return
    this.probing = this.probe(serviceId).finally(() => {
      this.probing = undefined
    })
  }

  /**
   * One TSP 1.0 probe of the VTA: an `XRFI` invite and `auth/whoami`, sent
   * beside the task queue so no person waits on it. Its answer is matched by
   * thread in `deliver` and taken by nothing else. Answered, the rest of the
   * session speaks TSP 1.0 to the VTA.
   */
  private async probe(serviceId?: string): Promise<TspProbeOutcome | 'skipped'> {
    // Held here, not only on `this`: `deliver` clears `this.probeWaiter` when
    // the answer comes, and the wait must still see that it did.
    let waiter: { ids: Set<string>; answered: boolean; resolve: () => void } | undefined
    return runTspProbe({
      did: this.vtaDid,
      serviceId,
      store: this.probes,
      logger: this.agent.config.logger,
      send: async () => {
        const session = this.session
        const did = this.identity?.did
        const tspIdentity = this.tsp
        if (!session || !did || !tspIdentity || !this.mediator) throw new Error('not connected over TSP')
        const threadId = `urn:uuid:${utils.uuid()}`
        const documentId = `urn:uuid:${utils.uuid()}`
        const document = await signDocumentProof(
          this.agent,
          {
            id: documentId,
            type: VTA_TASK.whoAmI,
            threadId,
            payload: {},
            issuer: did,
            recipient: this.vtaDid,
            issuedAt: new Date().toISOString(),
          },
          did,
          { proofPurpose: purposeForDocumentType(VTA_TASK.whoAmI) }
        )
        const route = [this.mediator.did, did]
        const invite = await tsp.packInviteV1(did, this.vtaDid, tspIdentity.identity, tspIdentity.resolver, { route })
        const ask = await packTrustTaskForPeer(tspIdentity, did, this.vtaDid, document, 'v1')
        waiter = { ids: new Set([threadId, documentId]), answered: false, resolve: () => undefined }
        this.probeWaiter = waiter
        await session.sendTspFrame(invite.bytes)
        await session.sendTspFrame(ask.bytes)
      },
      waitForAnswer: (timeoutMs) =>
        new Promise<boolean>((resolve) => {
          const current = waiter
          if (!current) return resolve(false)
          if (current.answered) return resolve(true)
          const timer = setTimeout(() => {
            if (this.probeWaiter === current) this.probeWaiter = undefined
            resolve(false)
          }, timeoutMs)
          current.resolve = () => {
            clearTimeout(timer)
            resolve(true)
          }
        }),
      peerAnsweredOtherwise: () => this.heardFromAgent,
      onAnswered: () => {
        this.carriageByPeer.set(this.vtaDid, 'tsp')
        // The probe's invite stands for the session's greeting.
        this.greeted = true
      },
    })
  }

  /**
   * Send one Trust Task and wait for the VTA's answer. The document is the
   * DIDComm body; the message type is the framework's binding envelope, which is
   * what the VTA routes on. Serialised: the VTA answers on the same socket and a
   * reply carries no correlation a client can rely on, so one at a time.
   */
  async task<T = unknown>(
    type: string,
    payload: Record<string, unknown>,
    timeoutMs = 30000,
    /** Members beside `payload` on the signed document itself — e.g. `idempotencyKey`. */
    documentExtras: Record<string, unknown> = {},
    /** Called once the task has left the phone — the moment `timeoutMs` starts. */
    onSent?: () => void,
    /**
     * `waitForConsent: false`: a task held for consent is refused at once, as
     * held, instead of waiting for the grant — for a task this phone sends
     * about itself, where the approver a rule names may be this phone, so the
     * wait could never end (approvalRules.ts, PHONE_SENDS).
     */
    sendOptions: { waitForConsent?: boolean } = {}
  ): Promise<T> {
    // A reload would lose all of this (the queue, a step-up, a wait for consent
    // that can last minutes, the re-submits): none of it is stored. So no
    // downloaded update applies until the task ends (utils/otaApply).
    const done = this.enqueue<T>(type, payload, timeoutMs, documentExtras, onSent).catch(async (error: unknown) => {
      const stepUp = this.managerDid ? stepUpRequestOf(error, { vtaDid: this.vtaDid, me: this.managerDid }) : undefined
      if (stepUp)
        return this.answerStepUp<T>(stepUp, error, type, () =>
          this.sendTask<T>(type, payload, timeoutMs, documentExtras)
        )
      // A task the policy holds for consent is refused with
      // `details.reason = "auth:consent_required"` and the signed requests the
      // approvers were sent (policy_gate.rs). The grant that consent produces
      // is single-use and consumed by re-submitting the same payload.
      const pending = consentPendingOf(error)
      const waitMs = this.options.consentWaitMs ?? 180000
      if (!pending || waitMs <= 0 || sendOptions.waitForConsent === false) throw error
      this.options.onConsentPending?.({ taskType: type, payloadDigest: pending.payloadDigest })
      if (pending.omitted) {
        // Those approvers are reached only by the VTA's own push (vti #1680);
        // there is nothing of theirs for this phone to relay.
        this.agent.config.logger.info(
          `${LOG_PREFIX} ${type} is held for consent; ${pending.omitted} signed request(s) did not fit and were omitted`
        )
      }
      // The VTA can push a consent request only to a did:key approver
      // ("did:webvh … not wired yet → relay fallback", step_up.rs); for any
      // other approver it says "the approver learns of this request only if
      // the requester relays it" — and hands us the VTA-signed requests in the
      // refusal for exactly that. A CLI cannot relay; a phone can.
      await this.relayConsentRequests(pending.requests)
      // Then wait for the grant. The granted notice is route-gated the same
      // way, so do not rely on it alone: re-submit periodically on THIS client
      // (its session routes replies to it) — a re-submit while consent is
      // still pending is refused again, and the first one after the approval
      // consumes the grant.
      const deadline = Date.now() + waitMs
      let lastError: unknown = error
      while (Date.now() < deadline) {
        await this.awaitGrant(pending.payloadDigest, Math.min(8000, deadline - Date.now())).catch(() => undefined)
        try {
          return await this.sendTask<T>(type, payload, timeoutMs, documentExtras)
        } catch (retryError) {
          lastError = retryError
          if (!consentPendingOf(retryError)) throw retryError
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError))
    })
    // Registered once `done` exists, so a synchronous throw before it can't leave a
    // blocker that is never released. enqueue only schedules its run, so nothing of
    // the task starts before this line.
    const release = registerOtaApplyBlocker(`vta-task:${type}`)
    return done.finally(release)
  }

  /**
   * One send in the queue, behind whatever is in flight — no step-up or consent handling. Oldest first: a task in the
   * read lane (vtaReadLane.ts) may start beside other lane tasks, up to the lane's size, once this session's agent is
   * known to thread its replies; any other task starts only when nothing is on the wire, and the tasks behind it wait.
   * Once that is known, a heartbeat goes beside the queue (vtaReadLane.ts, besideQueue): at once, and nothing waits
   * for it.
   */
  private enqueue<T>(
    type: string,
    payload: Record<string, unknown>,
    timeoutMs: number,
    documentExtras: Record<string, unknown>,
    onSent?: () => void
  ): Promise<T> {
    const ticket = ++this.tickets
    return new Promise<T>((resolve, reject) => {
      const run = (): Promise<T> =>
        ticket <= this.droppedThrough
          ? Promise.reject(new VtaTaskDropped(type))
          : this.sendTask<T>(type, payload, timeoutMs, documentExtras, onSent)
      // What may start is decided by the running counts in pump(), which a task beside the queue never touches;
      // inFlight, where it does show, only names what a task waits behind (below).
      if (this.goesBeside(type)) {
        void Promise.resolve().then(() => run().then(resolve, reject))
        return
      }
      this.waiting.push({ ticket, type, start: () => run().then(resolve, reject) })
      // One task at a time: one queued behind another says what it waits on, so a
      // queue that stalls shows what it stalled on (two-phone gate trial, 09-29).
      // A heartbeat beside the queue holds nothing: what is named is the other task on the wire, if there is one.
      const onWire = [...this.inFlight.values()]
      const ahead = onWire.find((t) => !besideQueue(t.type)) ?? onWire[0]
      if (ahead && !this.mayStart(type)) {
        this.agent.config.logger.info(
          `${LOG_PREFIX} ${type} waits behind ${ahead.type} (in flight ${Math.round((Date.now() - ahead.since) / 1000)} s, ${ahead.id})`
        )
      }
      // Scheduled, not started: nothing of the task runs before the caller has its promise (task(), the OTA blocker).
      void Promise.resolve().then(() => this.pump())
    })
  }

  private sharesLane(type: string): boolean {
    return this.readLaneSize > 1 && this.replyThreading === 'threaded' && inReadLane(type)
  }

  /** Whether a task of `type` at the head of the queue could start now. */
  private mayStart(type: string): boolean {
    if (this.aloneRunning) return false
    return this.sharesLane(type) ? this.readsRunning < this.readLaneSize : this.readsRunning === 0
  }

  /** Start what may start, oldest first; a task that must wait holds back everything behind it. */
  private pump(): void {
    while (this.waiting.length > 0 && this.mayStart(this.waiting[0].type)) {
      const next = this.waiting.shift() as QueuedTask
      const shared = this.sharesLane(next.type)
      if (shared) this.readsRunning++
      else this.aloneRunning = true
      void next.start().finally(() => {
        if (shared) this.readsRunning--
        else this.aloneRunning = false
        this.pump()
      })
    }
  }

  /**
   * Answer the agent's step-up for a task, then re-submit it once approved.
   * The answer goes on this session, signed by this client's identity — the
   * session the agent elevates. A request this phone cannot answer leaves the
   * refusal as it came.
   */
  private async answerStepUp<T>(
    stepUp: NonNullable<ReturnType<typeof stepUpRequestOf>>,
    refusal: unknown,
    taskType: string,
    resubmit: () => Promise<T>
  ): Promise<T> {
    const ask = this.options.onStepUp
    if (!stepUp.ok || !ask) {
      if (!stepUp.ok) this.agent.config.logger.warn(`${LOG_PREFIX} not answering the agent's step-up: ${stepUp.why}`)
      throw refusal
    }
    const answer = await ask(stepUp.request, { taskType })
    const decision = answer === 'approve' ? 'approved' : 'denied'
    // The version the answer goes in is logged once it is answered ("stepUpResponse:… answered in …").
    this.agent.config.logger.info(
      `${LOG_PREFIX} answering the agent's step-up ${stepUp.request.requestType} (${decision}), in ${approveResponseTypesFor(stepUp.request.requestType).join(' then ')}`
    )
    // 0.6 first, whatever the request's version: from 0d3f268e (#2313) the agent mints approve-request/0.2 yet
    // serves only approve-response/0.6, while v0.60.0 to v0.66.0 serve only 0.1-0.3. The request's own response
    // version is the step-down. The members are the same in every version sent (approveResponsePayload).
    const payload = approveResponsePayload(stepUp.request, decision)
    await this.versions.ask(
      `stepUpResponse:${stepUp.request.responseType}`,
      approveResponseTypesFor(stepUp.request.requestType),
      (type) => this.sendTask(type, payload, 30000)
    )
    if (decision === 'denied') throw new StepUpDeclined()
    return resubmit()
  }

  /** One send and its matched answer — no queue, no consent handling. */
  private async sendTask<T>(
    type: string,
    payload: Record<string, unknown>,
    timeoutMs: number,
    documentExtras: Record<string, unknown> = {},
    onSent?: () => void
  ): Promise<T> {
    {
      const session = this.session
      const did = this.identity?.did
      if (!session || !did) throw new Error(`${LOG_PREFIX} not connected`)

      // A VTA's specifications require a proof on the document — measured as
      // "document refused by its specification's policy reason=ProofRequired"
      // on `auth/whoami/0.1` — where the community's join tasks did not. The
      // manager identity signs (eddsa-jcs-2022, the wallet's existing signer),
      // and it is the same DID the envelope is sealed from, which the VTA
      // checks (VTI-10).
      const threadId = `urn:uuid:${utils.uuid()}`
      const documentId = `urn:uuid:${utils.uuid()}`
      const envelopeId = `urn:uuid:${utils.uuid()}`
      const document = await signDocumentProof(
        this.agent,
        {
          id: documentId,
          type,
          threadId,
          payload,
          issuer: did,
          recipient: this.vtaDid,
          issuedAt: new Date().toISOString(),
          // Covered by the proof like everything else on the document.
          ...documentExtras,
        },
        did,
        { proofPurpose: purposeForDocumentType(type) }
      )
      const sentAt = Date.now()
      const key = typeof documentExtras.idempotencyKey === 'string' ? documentExtras.idempotencyKey : undefined
      const earlier = new Set(key ? (this.attemptsByKey.get(key) ?? []) : [])
      if (key) this.rememberAttempt(key, [envelopeId, documentId, threadId])
      const slot = ++this.nextSlot
      const reply = new Promise<DidCommV2PlaintextMessage>((resolve) => {
        this.pendings.set(slot, {
          resolve,
          sentAt,
          ids: new Set([envelopeId, documentId, threadId, ...earlier]),
          earlier,
        })
        this.inFlight.set(slot, { type, since: sentAt, id: documentId })
      })
      const settle = () => {
        this.pendings.delete(slot)
        this.inFlight.delete(slot)
      }
      let overTsp = false
      // Nothing sent, or a send that failed, leaves no reply waiting.
      try {
        // §4.2 on the VTA leg: read what the VTA advertises and speak TSP when it
        // offers it and this wallet can introduce itself. A VTA built without the
        // `tsp` feature advertises nothing, and this stays on DIDComm.
        const carriage = await chooseCarriage(
          this.agent,
          this.vtaDid,
          Boolean(this.tsp) && tsp.CODEC_FORMS_RELATIONSHIPS,
          {
            decided: this.carriageByPeer,
            freshV1: async (peer) => isFreshV1(await this.peerRevisions.get(peer)),
            onProbeWanted: (_peer, serviceId) => this.startProbe(serviceId),
          }
        )
        overTsp = carriage === 'tsp' && Boolean(this.tsp)
        // The breaker (vta-sdk's D4 breaker, VTI #1978): after two TSP asks in a
        // row went unanswered, nothing more is sent until the window passes; the
        // first ask after it goes as the probe, with a fresh greeting.
        if (overTsp && this.breaker.holding(Date.now())) {
          settle()
          throw new VtaRepliesNotArriving(type, this.breaker.noAnswerInARow)
        }
        if (carriage === 'tsp' && this.tsp) {
          if (!this.greeted) {
            // Our mediator, then us: §5.3.3 ends a hop list at our own VID.
            const route = [this.mediator!.did, did]
            const invite = await tsp.packInviteV1(did, this.vtaDid, this.tsp.identity, this.tsp.resolver, { route })
            await session.sendTspFrame(invite.bytes)
            this.greeted = true
            this.agent.config.logger.info(`${LOG_PREFIX} greeted ${this.vtaDid} with an XRFI invite`)
          }
          // To an upstream service TSP means TSP 1.0 (cutover plan §6.2).
          const packed = await packTrustTaskForPeer(this.tsp, did, this.vtaDid, document, 'v1')
          await session.sendTspFrame(packed.bytes)
          this.agent.config.logger.info(
            `${LOG_PREFIX} asked ${agentNamedFor(type, this.vtaDid)} ${type} over ${packed.revision}`
          )
        } else
          await session.sendTo(this.vtaDid, {
            id: envelopeId,
            typ: 'application/didcomm-plain+json',
            type: TRUST_TASK_V2_ENVELOPE_TYPE,
            from: did,
            to: [this.vtaDid],
            thid: threadId,
            created_time: nowSec(),
            expires_time: nowSec() + 300,
            body: document,
          })
        onSent?.()
      } catch (error) {
        settle()
        throw error
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      let cancel: (() => void) | undefined
      const answer = await Promise.race([
        reply,
        new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), timeoutMs))),
        new Promise<'dropped'>((resolve) => {
          cancel = () => resolve('dropped')
          this.cancelInFlight.add(cancel)
        }),
      ])
      clearTimeout(timer)
      if (cancel) this.cancelInFlight.delete(cancel)
      settle()
      if (answer === 'dropped') throw new VtaTaskDropped(type)
      if (!answer) {
        // A VTA that restarted may have forgotten the relationship, and a
        // peer it does not know drops our frames in silence (§7.2.2): the
        // session stays open, so nothing here would greet it again until the
        // app relaunched (al-phone, 10-05). Greet again on the next ask —
        // upstream's own reset on a reply-timeout (vta-service
        // tsp_transport.rs `reset_relationship`). If the VTA kept the
        // relationship, it takes the repeat invite as a no-op. This ask still
        // fails: resending it could run it twice.
        if (overTsp) {
          this.greeted = false
          const wasOpen = this.breaker.open
          // Asks on the wire together go unanswered together: the first counts, and one sent before it adds nothing
          // (three reads in the lane timing out are one silence, not three).
          const counts = sentAt >= this.lastStrikeAt
          if (counts) this.lastStrikeAt = Date.now()
          const holdMs = counts ? this.breaker.unanswered(this.lastStrikeAt) : undefined
          if (holdMs !== undefined) {
            // A VTA that found this phone not collecting drops its replies and
            // sends no accept for 5 min (VTI #1978): greeting it at every ask
            // only adds sends it ignores. Wait a step out, then probe.
            releaseWarn(
              `${LOG_PREFIX} ${this.breaker.noAnswerInARow} asks in a row got no answer over TSP; replies are not reaching this phone — holding asks to ${this.vtaDid} for ${holdMs / 1000} s`
            )
            if (!wasOpen) this.options.onRepliesStalled?.(true)
          } else
            this.agent.config.logger.info(
              `${LOG_PREFIX} no answer over TSP; greeting ${this.vtaDid} again on the next ask`
            )
        }
        // Cutover plan §6.2, change 2: a TSP 1.0 ask that went unanswered moves
        // the rest of this session to DIDComm and marks the record stale, so
        // the next session decides afresh. A read is asked once more over
        // DIDComm; a write is not, since a repeat could run it twice.
        if (overTsp) {
          this.carriageByPeer.set(this.vtaDid, 'didcomm')
          await this.peerRevisions.markStale(this.vtaDid).catch(() => undefined)
          if (isReadOnlyVtaTask(type)) {
            this.agent.config.logger.info(
              `${LOG_PREFIX} no answer to ${type} over TSP 1.0 in ${Math.round(timeoutMs / 1000)} s — DIDComm for this session; asking again over DIDComm, since it only reads`
            )
            return this.sendTask<T>(type, payload, timeoutMs, documentExtras)
          }
          this.agent.config.logger.info(
            `${LOG_PREFIX} no answer to ${type} over TSP 1.0 — DIDComm for this session; not sent again, since it writes`
          )
        }
        // Said on every carriage, not only TSP, and at Info so a release build
        // keeps it: on iOS this is the only place such a silence is recorded,
        // and an unanswered task that leaves no trace cannot be diagnosed from
        // a tester's report — which is exactly what happened with
        // `vta/pcs/prove` on 2026-10-15.
        this.agent.config.logger.info(
          `${LOG_PREFIX} no answer to ${type} after ${Math.round(timeoutMs / 1000)} s over ${
            overTsp ? 'TSP' : 'DIDComm'
          } — the ask is not resent, since a repeat could run it twice`
        )
        throw new VtaNoAnswer(type, timeoutMs)
      }

      // An auth/ACL refusal never reaches the task handler: the VTA answers
      // with a DIDComm problem-report (`app_err_to_response`, handlers.rs),
      // not a trust-task-error. Treat it as the refusal it is.
      if (answer.type === PROBLEM_REPORT) {
        const p = answer.body as { code?: string; comment?: string } | undefined
        throw new VtiRefusal(p?.code ?? 'problem-report', p?.comment ?? `the VTA refused ${type}`)
      }
      // vta-sdk's client refuses a reply that is unsigned, does not verify, or
      // was signed by a key other than this VTA's (verify_reply). Keyring logs
      // the verdict first, off the answer's path, and refuses nothing yet.
      void checkVtaReply(this.agent, (answer.body ?? {}) as Record<string, unknown>, this.vtaDid).then((verdict) => {
        const logger = this.agent.config?.logger
        if (!logger) return
        if (verdict.kind === 'verified') logger.info(`${LOG_PREFIX} reply verified: ${type}`)
        else if (verdict.kind === 'wrongSigner')
          logger.warn(
            `${LOG_PREFIX} reply signed by ${isHiddenVettingType(type) ? 'another party' : verdict.signer}, not ${agentNamedFor(type, this.vtaDid)}: ${type}`
          )
        else if (verdict.kind === 'unsigned') logger.warn(`${LOG_PREFIX} reply unsigned: ${type}`)
        else if (verdict.kind === 'invalid')
          logger.warn(`${LOG_PREFIX} reply proof does not verify (${verdict.detail}): ${type}`)
      })
      const body = answer.body as { type?: string; payload?: unknown } | undefined
      if (String(body?.type ?? '').startsWith(TASK_ERROR)) {
        const p = body?.payload as { code?: string; message?: string; details?: unknown } | undefined
        throw new VtiRefusal(p?.code ?? 'unknown', p?.message ?? `the VTA refused ${type}`, p?.details)
      }
      return (body?.payload ?? body) as T
    }
  }

  /** Forward the VTA-signed consent requests to the approvers they name, over the same session. */
  private async relayConsentRequests(requests: Record<string, unknown>[]): Promise<void> {
    const session = this.session
    const did = this.identity?.did
    if (!session || !did) return
    for (const request of requests) {
      const recipient = typeof request.recipient === 'string' ? request.recipient : undefined
      if (!recipient) continue
      try {
        await session.sendTo(recipient, {
          id: `urn:uuid:${utils.uuid()}`,
          typ: 'application/didcomm-plain+json',
          type: TRUST_TASK_V2_ENVELOPE_TYPE,
          from: did,
          to: [recipient],
          created_time: nowSec(),
          expires_time: nowSec() + 900,
          body: request,
        })
      } catch (relayError) {
        this.options.onError?.(relayError instanceof Error ? relayError : new Error(String(relayError)))
      }
    }
  }

  private awaitGrant(payloadDigest: string | undefined, waitMs: number): Promise<void> {
    if (!payloadDigest) return new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 5000)))
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.grantWaiters.delete(payloadDigest)
        reject(new Error(`${LOG_PREFIX} no approver consented within ${Math.round(waitMs / 1000)}s`))
      }, waitMs)
      this.grantWaiters.set(payloadDigest, () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  /**
   * An approver's answer to a consent request it was sent — signed by this client's identity.
   *
   * `payloadDigest` is echoed from the request, and the decision schema types
   * it as the framework's `DigestMultibase` (task-consent/decision/0.1
   * payload.schema.json:15-18; framework 0.3: `z`/`u` multibase, at least 16
   * characters). A VTA always sends one — the salted `wire_digest`, a
   * base58btc SHA-256 multihash (vta-policy consent.rs:73-94, :126-131; put in
   * the request at vta-service consent_request.rs:97) — so a value that is not
   * one did not come from a VTA, and nothing is signed over it.
   */
  decideConsent(
    request: Pick<VtaConsentRequest, 'challenge' | 'payloadDigest'>,
    decision: 'approve' | 'deny',
    reason?: string
  ) {
    if (!isDigestMultibase(request.payloadDigest))
      return Promise.reject(
        new Error(`${LOG_PREFIX} the consent request's payloadDigest is not a digestMultibase; not deciding it`)
      )
    const payload = {
      challenge: request.challenge,
      payloadDigest: request.payloadDigest,
      decision,
      ...(reason ? { reason } : {}),
    }
    return this.versions
      .ask('consentDecision', VTA_TASK_VERSIONS.consentDecision, (type) =>
        this.task<{ status?: string }>(type, payload)
      )
      .then(({ answer }) => answer)
  }

  /**
   * `vault/sign-trust-task`: the VTA signs `unsignedEnvelope` as the entry's
   * principal and answers it with a `proof`. `ext` carries the UV approval of
   * a sign-in grant (`org.openvtc.uv-consent`). Not held for consent: a
   * sign-in has 120 s to finish, so a held signature is refused at once.
   */
  async signTrustTask(request: {
    entryId: string
    unsignedEnvelope: Record<string, unknown>
    ext?: Record<string, unknown>
  }): Promise<Record<string, unknown>> {
    const payload = {
      entryId: request.entryId,
      unsignedEnvelope: request.unsignedEnvelope,
      ...(request.ext ? { ext: request.ext } : {}),
    }
    const { answer } = await this.versions.ask('vaultSignTrustTask', VTA_TASK_VERSIONS.vaultSignTrustTask, (type) =>
      this.task<{ signedEnvelope?: Record<string, unknown> }>(type, payload, 30000, {}, undefined, {
        waitForConsent: false,
      })
    )
    if (!answer?.signedEnvelope || typeof answer.signedEnvelope !== 'object') {
      throw new Error(`${LOG_PREFIX} vault/sign-trust-task answered without a signedEnvelope`)
    }
    return answer.signedEnvelope
  }

  /** `vault/list`: the entries' metadata, filtered as the VTA filters (`contextId`, `targetDid`, …). */
  async vaultList(filters: Record<string, unknown> = {}): Promise<VtaVaultEntry[]> {
    const { answer } = await this.versions.ask('vaultList', VTA_TASK_VERSIONS.vaultList, (type) =>
      this.task<{ entries?: VtaVaultEntry[] } | VtaVaultEntry[]>(type, vaultPayloadFor(type, filters))
    )
    return Array.isArray(answer) ? answer : (answer?.entries ?? [])
  }

  /** `vault/upsert`: create (no `id`) or update an entry. A create needs `sealedSecret` (vault.rs:826-870). */
  async vaultUpsert(payload: Record<string, unknown>): Promise<{ entry?: VtaVaultEntry; created?: boolean }> {
    const { answer } = await this.versions.ask('vaultUpsert', VTA_TASK_VERSIONS.vaultUpsert, (type) =>
      this.task<{ entry?: VtaVaultEntry; created?: boolean; wasCreated?: boolean }>(
        type,
        vaultPayloadFor(type, payload)
      )
    )
    // 0.4 spells it `wasCreated`; 0.1 to 0.3 `created`.
    const { wasCreated, ...rest } = answer ?? {}
    return wasCreated === undefined ? rest : { ...rest, created: wasCreated }
  }

  /**
   * Seal a cleartext vault secret to this VTA as a `didcomm-authcrypt` JWE,
   * from the manager identity this session signs in as — the
   * `sealedSecret` `vault/upsert` takes. The VTA unpacks it and refuses it
   * unless the authenticated sender is the caller (vta-service
   * operations/vault/upsert.rs:34-63), so it is packed by the same identity
   * and the same Credo envelope service as every message this client sends
   * (vta-sdk does the same, didcomm_session.rs:557-586). The cleartext never
   * leaves this call except inside the JWE, and is never logged.
   */
  async sealVaultSecret(secret: Record<string, unknown>): Promise<VtaSealedSecret> {
    const identity = this.identity
    if (!identity || !this.session) throw new Error(`${LOG_PREFIX} not connected`)
    const packed = await authcryptTo(this.agent, identity, this.vtaDid, {
      id: `urn:uuid:${utils.uuid()}`,
      typ: 'application/didcomm-plain+json',
      type: VAULT_SECRET_MESSAGE_TYPE,
      from: identity.did,
      to: [this.vtaDid],
      created_time: nowSec(),
      body: secret,
    })
    return { envelope: 'didcomm-authcrypt', jwe: typeof packed === 'string' ? packed : JSON.stringify(packed) }
  }

  /** `timeoutMs` bounds the wait for the VTA's answer, counted from the send (`onSent`). */
  whoAmI(timeoutMs?: number, onSent?: () => void) {
    return this.task<VtaWhoAmI>(VTA_TASK.whoAmI, {}, timeoutMs, {}, onSent)
  }

  /**
   * Move this phone's grant from the key it is signed in with onto a fresh
   * long-lived one, the way `pnm` does after its first connect: the admin
   * granted the temporary key for an hour, and a swap does not carry that
   * expiry over (`operations::acl::swap_acl`). The new key proves it consents
   * with a VP-JWT addressed to this VTA (`vta-sdk` `AclSwapPresentation`); the
   * session then reopens as the new key. Returns the new manager DID.
   *
   * The new key is recorded as pending before the swap is sent. The VTA moves
   * the grant and retires the old key in one request, so if its answer never
   * arrives the phone cannot tell from its side which key the VTA now knows —
   * and throwing the new one away would lock the phone out of its own agent.
   * Any failure is therefore settled by asking the VTA ({@link resolvePendingSwap}):
   * the new key is adopted if the VTA accepts it; otherwise the old one is kept
   * and this throws, as before. `pnm` has no such step: its new key lives only
   * in memory until the swap answers (`vta-sdk` `session.rs`
   * `rotate_key_over_client`).
   */
  async rotateManagerKey(reason = 'keyring: rotate the linking key onto a long-lived one'): Promise<string> {
    const current = this.identity?.did
    if (!this.session?.isOpen || !current) throw new Error(`${LOG_PREFIX} rotate needs an open session`)
    this.mediator ??= await resolveVtaMediator(this.agent, this.vtaDid)
    const next = await createVtiClientDid(this.agent, this.mediator)
    const record: VtiManagerIdentity = {
      ...((await this.store.getManager(this.vtaDid)) ?? { createdAt: new Date().toISOString() }),
      vtaDid: this.vtaDid,
      did: current,
      pendingNext: { did: next, createdAt: new Date().toISOString() },
    }
    await this.store.setManager(record)
    this.agent.config.logger.info(`${LOG_PREFIX} recorded ${next} as the pending successor before the key swap`)
    const issuedAt = nowSec()
    try {
      const linkProof = await signCompactJws(this.agent, next, {
        iss: next,
        aud: this.vtaDid,
        iat: issuedAt,
        exp: issuedAt + 300,
        nonce: utils.uuid(),
        vp: { type: ['VerifiablePresentation', 'AclSwapRequest'], holder: next },
      })
      await this.task(
        VTA_TASK.aclSwapKey,
        { currentSubject: current, newSubject: next, linkProof, reason },
        this.options.swapTimeoutMs ?? 30000
      )
      if (activeSwapTestHook()) {
        throw new Error(`${LOG_PREFIX} the VTA did not answer ${VTA_TASK.aclSwapKey} (answer dropped by the e2e hook)`)
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      if (activeSwapTestHook() === 'drop-and-stop') {
        // As if the app died here: the successor stays pending for the next connect.
        await this.disconnect()
        throw error
      }
      this.agent.config.logger.warn(`${LOG_PREFIX} key swap did not complete (${detail}); asking the VTA`)
      await this.disconnect()
      const live = await this.resolvePendingSwap(record)
      if (live === next) return next
      throw keySwapNotDone(error)
    }
    await this.store.setManager({
      vtaDid: this.vtaDid,
      did: next,
      createdAt: new Date().toISOString(),
      stage: 'permanent',
      // The approval rules still name `current`; moved at the next signed-in session.
      approversFrom: current,
    })
    await this.disconnect()
    try {
      await this.connect()
    } catch (error) {
      // The swap is done and recorded; only signing in as the new key failed.
      throw new SwapDoneSignInFailed(next, error)
    }
    return next
  }

  /**
   * Settle a swap whose outcome the phone did not see, by asking the VTA which
   * key it accepts. Returns the key adopted, with the session open as it.
   *
   * The order follows how the VTA swaps (`operations::acl::swap_acl`): it
   * writes the successor's entry before it deletes the old one, and nothing
   * after the write undoes it. So whether the successor is on the ACL is the
   * one decisive fact — if it is, the swap went through (the old entry is gone,
   * or at worst lingers with its one-hour expiry while the successor's is
   * permanent), and it is adopted; if it is not, the swap never wrote anything
   * and the old key must still be live, which a second `whoami` confirms before
   * the successor is dropped. A key is only ever dropped on the VTA's own word
   * that the other one is live; anything short of that keeps both and throws
   * {@link ManagerKeyUnresolved}.
   */
  async resolvePendingSwap(record?: VtiManagerIdentity): Promise<string> {
    const manager = record ?? (await this.store.getManager(this.vtaDid))
    if (!manager?.pendingNext) {
      if (!manager) throw new Error(`${LOG_PREFIX} no manager identity for ${this.vtaDid}`)
      if (!this.session?.isOpen) await this.openAs(manager.did)
      return manager.did
    }
    const current = manager.did
    const next = manager.pendingNext.did
    const log = this.agent.config.logger

    const asNext = await this.probeAs(next)
    if (asNext.kind === 'live') {
      await this.store.setManager({
        vtaDid: this.vtaDid,
        did: next,
        createdAt: manager.pendingNext.createdAt,
        stage: 'permanent',
        approversFrom: current,
      })
      log.info(`${LOG_PREFIX} the VTA knows the swapped-in key; adopted ${next}`)
      return next
    }
    const asCurrent = await this.probeAs(current)
    if (asCurrent.kind === 'live') {
      if (asNext.kind === 'refused') {
        // The VTA's word on both: the swap never happened.
        const kept: VtiManagerIdentity = { ...manager }
        delete kept.pendingNext
        await this.store.setManager(kept)
        log.info(`${LOG_PREFIX} the key swap did not happen; kept ${current}`)
      } else {
        // The old key works, but whether the successor was also written is
        // unknown — keep it pending, and ask again on the next connect.
        log.warn(`${LOG_PREFIX} kept ${current}; could not ask as ${next} (${asNext.detail})`)
      }
      return current
    }
    await this.disconnect()
    const detail = `as ${next}: ${asNext.kind} (${asNext.detail}); as ${current}: ${asCurrent.kind} (${asCurrent.detail})`
    log.warn(`${LOG_PREFIX} key swap unresolved, both keys kept — ${detail}`)
    throw new ManagerKeyUnresolved(
      this.vtaDid,
      current,
      next,
      asNext.kind === 'refused' && asCurrent.kind === 'refused',
      detail
    )
  }

  /** One `whoami` as `did` on a fresh session: live, refused as not on the ACL, or unknown. */
  private async probeAs(did: string): Promise<Probe> {
    await this.disconnect()
    try {
      await this.openAs(did)
      await this.whoAmI(this.options.probeTimeoutMs ?? 20000)
      return { kind: 'live' }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return refusedAsNotOnAcl(error) ? { kind: 'refused', detail } : { kind: 'unknown', detail }
    }
  }

  /**
   * The agent's access list: `acl/list/0.1` with no filter. The answer is
   * `{entries, truncated, cursor?, redactedFields?}` (vta-sdk
   * acl_management/list.rs:77-93); this VTA returns every entry in one page and
   * says so with `truncated: false` (vta-service operations/acl.rs:1034-1057).
   * Only rows the caller may audit come back. The request's `role` filter is
   * not applied by the trust-task handler (it passes only `scope` and
   * `direction`, trust_tasks/acl.rs:42-48), so callers filter here.
   */
  async listAcl(): Promise<VtaAclEntry[]> {
    const { answer } = await this.versions.ask('aclList', VTA_TASK_VERSIONS.aclList, (uri) =>
      this.task<{ entries?: unknown; truncated?: unknown; nextCursor?: unknown }>(uri, {})
    )
    // 0.1 and 0.2 say a partial page with `truncated`; 0.3 with a `nextCursor`.
    if (answer?.truncated === true || typeof answer?.nextCursor === 'string') {
      this.agent.config.logger.warn(
        `${LOG_PREFIX} ${this.vtaDid} answered a partial access list; showing the first page`
      )
    }
    return parseAclEntries(answer?.entries)
  }

  /**
   * Make `did` a full administrator of this agent: `acl/grant/0.1` with an
   * admin entry that names no scopes (unrestricted) and no expiry (permanent).
   * The payload is `{entry}` (vta-sdk acl_management/create.rs:24-43); the
   * entry refuses unknown members (entry.rs:175-176), so only `subject`,
   * `role` and `label` are sent. Only a super-admin may create an unrestricted
   * admin (vti-common acl/mod.rs:1081-1112), and a subject already on the list
   * is refused as a conflict (vta-service operations/acl.rs:391-395). Answers
   * the entry the VTA now holds.
   *
   * `expiresAt` (RFC 3339, the entry's wire form in both 0.1 and 0.2:
   * acl/_shared acl-entry.schema.json, vta-sdk acl_management/entry.rs) makes
   * the entry lapse then. A caller whose own entry expires may write only an
   * entry that expires no later than its own (VTI-ACL-053, vta-service
   * operations/acl.rs:388-403).
   */
  async grantAdmin(did: string, options: { label?: string; expiresAt?: string } = {}): Promise<VtaAclEntry> {
    const label = options.label?.trim().slice(0, ACL_LABEL_MAX)
    const { uri, answer } = await this.versions.ask('aclGrant', VTA_TASK_VERSIONS.aclGrant, (type) =>
      this.task(type, {
        entry: {
          subject: did,
          role: 'admin',
          ...(label ? { label } : {}),
          ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
          ...(isAcl02(type) ? FULL_ADMIN_AUTHORITY_02 : {}),
        },
      })
    )
    return answeredEntry(uri, answer)
  }

  /**
   * Remove `did` from this agent's access list: `acl/revoke/0.1`, full
   * removal, so no `scopes` (vta-sdk acl_management/delete.rs:23-45; a scoped
   * revoke is refused, operations/acl.rs:1104-1126). The VTA refuses a caller
   * removing itself (operations/acl.rs:792-796). Answers the entry as it stood.
   */
  async revokeSubject(did: string): Promise<VtaAclEntry | undefined> {
    // 0.2 makes the narrowing explicit: `revocation: {kind: "entry"}` is a full
    // removal, and leaving it out is invalid (acl/revoke/0.2
    // payload.invalid-examples.json:3-4). Its answer's `entry` is null for a
    // removal (payload.schema.json:71); 0.1 answered the entry as it stood.
    const { uri, answer } = await this.versions.ask('aclRevoke', VTA_TASK_VERSIONS.aclRevoke, (type) =>
      this.task(type, isAcl02(type) ? { subject: did, revocation: { kind: 'entry' } } : { subject: did })
    )
    if (isAcl02(uri) && (answer as { entry?: unknown } | undefined)?.entry === null) return undefined
    return answeredEntry(uri, answer)
  }

  /**
   * Set the human-readable label of an access-list entry: `acl/update/0.1`
   * with `{subject, label}` (vta-sdk acl_management/update.rs:36-51; omitted
   * members are left unchanged). An admin may relabel any entry it can see,
   * its own included (vta-service operations/acl.rs:517-545).
   */
  async labelAclEntry(did: string, label: string): Promise<VtaAclEntry> {
    const { uri, answer } = await this.versions.ask('aclUpdate', VTA_TASK_VERSIONS.aclUpdate, (type) =>
      this.task(type, { subject: did, label: label.trim().slice(0, ACL_LABEL_MAX) })
    )
    return answeredEntry(uri, answer)
  }

  /**
   * The agent's approval rules: the reserved `approvals` row read with
   * `policy/get/0.1` (vta-sdk protocols/policy_management.rs GetPolicyBody →
   * `{policy}`). An agent with no row yet answers `not_found`
   * (vta-service operations/policy.rs:141), read as no rules at version 0 —
   * the version an upsert expects for a row that does not exist (:203-209).
   */
  async readApprovals(): Promise<ReturnType<typeof modelFromExt>> {
    try {
      const answer = await this.task<{ policy?: { version?: unknown; ext?: unknown } }>(VTA_TASK.policyGet, {
        id: DECLARATIVE_POLICY_ID,
      })
      const version = typeof answer?.policy?.version === 'number' ? answer.policy.version : 0
      return modelFromExt(answer?.policy?.ext, version)
    } catch (error) {
      const details = (error instanceof VtiRefusal ? error.details : undefined) as { reason?: unknown } | undefined
      if (details?.reason === 'not_found') return { ...EMPTY_APPROVALS, unreadable: false }
      throw error
    }
  }

  /**
   * Write the approval rules: `policy/upsert` (0.3, else 0.2) on the reserved row, its
   * Rego generated from the rules exactly as the SDK does — the agent derives
   * it again and refuses a write that differs, and refuses the reserved id
   * without the rules in `ext` (operations/policy.rs:172-197). Validated here
   * first, so a model the agent would refuse is refused in its words before
   * anything is sent. `expectedVersion` is the version read: a row changed
   * since is a `conflict` (:203-209), and nothing is overwritten. Writing is
   * super-admin only (:159). Answers the version now held.
   */
  async writeApprovals(model: Pick<ApprovalsModel, 'rules' | 'sets'>, expectedVersion: number): Promise<number> {
    const rules = model.rules.map(ruleForWire)
    validateApprovals(rules, model.sets)
    const { answer } = await this.versions.ask('policyUpsert', VTA_TASK_VERSIONS.policyUpsert, (type) =>
      this.task<{ policy?: { version?: unknown } }>(type, {
        id: DECLARATIVE_POLICY_ID,
        name: DECLARATIVE_POLICY_NAME,
        module: synthesizeRego(rules),
        priority: DECLARATIVE_POLICY_PRIORITY,
        enabled: true,
        expectedVersion,
        ext: { [EXT_KEY_RULES]: rules, [EXT_KEY_APPROVER_SETS]: model.sets },
      })
    )
    return typeof answer?.policy?.version === 'number' ? answer.policy.version : expectedVersion + 1
  }

  /**
   * After a key swap, move the agent's approval rules from the retired key to
   * this phone's key now ({@link withKeySwapped}), so the phone keeps being
   * asked. Runs on a signed-in session while the identity record still names
   * a retired key (`approversFrom`), and clears it once the rules no longer
   * name that key — or when there is nothing this phone may change: an
   * unreadable row (never written back), or any refusal to write (only a
   * super-admin may, vta-service operations/policy.rs:159, answered as
   * `permissionDenied`). A lost answer or a version clash leaves it for the
   * next session. Answers what happened, for the log.
   */
  async carryApproversAcrossSwap(): Promise<'none' | 'moved' | 'unchanged' | 'notAllowed' | 'unreadable' | 'later'> {
    const record = await this.store.getManager(this.vtaDid)
    const from = record?.approversFrom
    const to = record?.did
    if (!record || !from || !to || from === to) return 'none'
    const done = async () => {
      const latest = await this.store.getManager(this.vtaDid)
      if (latest?.approversFrom === from) {
        const cleared = { ...latest }
        delete cleared.approversFrom
        await this.store.setManager(cleared)
      }
    }
    try {
      const model = await this.readApprovals()
      if (model.unreadable) {
        await done()
        return 'unreadable'
      }
      const next = withKeySwapped(model, from, to)
      if (!next.changed) {
        await done()
        return 'unchanged'
      }
      await this.writeApprovals(next, model.version)
      await done()
      return 'moved'
    } catch (error) {
      // No answer, or the row changed in between: try again at the next session.
      if (!(error instanceof VtiRefusal)) return 'later'
      if ((error.details as { reason?: unknown } | undefined)?.reason === 'conflict') return 'later'
      // Any other answer is the agent's word (permissionDenied for a phone that
      // is not super-admin, helpers.rs; a consent this phone must give itself):
      // asking again each session would only hear it again.
      await done()
      return 'notAllowed'
    }
  }

  /**
   * "Send me a test request": ask the agent to create a context this phone's
   * own rule holds, and do not wait for the grant. Approving a request does not
   * run its task — the requester has to re-submit with the grant
   * (vta-service consent_request.rs:41-42, 207-214) — and this never
   * re-submits, so nothing is created. `held`: the agent asked its approvers,
   * this phone among them. `letThrough`: the agent created it, so it enforces
   * no rules where it is hosted; the context is deleted again, best effort
   * (`cleanedUp` says whether that worked).
   *
   * It goes through `enqueue`, never `task()` or `createContext()`: `task()`
   * waits for the grant and re-submits, and the first re-submit after an
   * approval consumes the grant and runs the task — the test would then create
   * the context it promised not to.
   */
  async sendTestRequest(): Promise<{ kind: 'held' } | { kind: 'letThrough'; cleanedUp: boolean }> {
    const id = `keyring-test-request-${Date.now()}`
    try {
      await this.enqueue(VTA_TASK.contextsCreate, { id, name: 'Keyring test request' }, 30000, {})
    } catch (error) {
      const pending = consentPendingOf(error)
      if (!pending) throw error
      // A did:webvh approver hears of it only if the requester relays it (VtaClient.task).
      await this.relayConsentRequests(pending.requests)
      return { kind: 'held' }
    }
    const cleanedUp = await this.versions
      .ask('contextsDelete', VTA_TASK_VERSIONS.contextsDelete, (type) =>
        this.enqueue(type, { id, force: true }, 30000, {})
      )
      .then(
        () => true,
        () => false
      )
    return { kind: 'letThrough', cleanedUp }
  }

  async listContexts(): Promise<VtaContext[]> {
    const result = await this.task<{ contexts?: VtaContext[] } | VtaContext[]>(VTA_TASK.contextsList, {})
    return Array.isArray(result) ? result : (result.contexts ?? [])
  }

  createContext(id: string, name: string) {
    return this.task<VtaContext>(VTA_TASK.contextsCreate, { id, name })
  }

  /**
   * What to call this agent beside its DID (VTI-Q20): its verified agent name,
   * else the operator's `vta_name` from `config/show/0.1`, else undefined — a
   * caller then shows the host. Never throws: a label is a nicety, and an agent
   * that cannot be asked, or a name that does not check out, is simply no label.
   */
  async agentLabel(
    options: { fetchImpl?: Parameters<typeof verifiedAgentName>[2] } = {}
  ): Promise<AgentLabel | undefined> {
    const [verifiedName, vtaName] = await Promise.all([
      this.agent.dids
        .resolveDidDocument(this.vtaDid)
        .then((doc) => verifiedAgentName(this.vtaDid, doc as AgentNameDocument, options.fetchImpl))
        .catch(() => undefined),
      this.task(VTA_TASK.configShow, { keys: ['vta_name'] })
        .then(vtaNameFrom)
        .catch(() => undefined),
    ])
    return chooseAgentLabel(verifiedName, vtaName)
  }

  /** The DID-hosting servers this VTA is registered with — where a persona can be minted. */
  async listServers(): Promise<{ id: string; did?: string; label?: string }[]> {
    const result = await this.task<{ servers?: { id: string }[] } | { id: string }[]>(VTA_TASK.serversList, {})
    return Array.isArray(result) ? result : (result.servers ?? [])
  }

  async listDids(contextId?: string): Promise<VtaMintedDid[]> {
    const result = await this.task<{ dids?: VtaMintedDid[] } | VtaMintedDid[]>(
      VTA_TASK.didsList,
      contextId ? { contextId } : {}
    )
    return Array.isArray(result) ? result : (result.dids ?? [])
  }

  /**
   * Mint a persona: a `did:webvh` on a DID-hosting server the VTA is registered
   * with, advertising the VTA's mediator so a community can reach it. The keys
   * stay in the VTA; the answer carries their ids.
   */
  mintPersona(options: {
    contextId: string
    serverId?: string
    didUrl?: string
    label?: string
    idempotencyKey?: string
  }) {
    if (!options.serverId && !options.didUrl) {
      throw new Error(`${LOG_PREFIX} mintPersona needs a registered server id or a serverless DID URL`)
    }
    const payload = {
      contextId: options.contextId,
      ...(options.serverId ? { serverId: options.serverId } : {}),
      // Serverless: the VTA mints and serves the log itself at this URL.
      ...(options.didUrl ? { url: options.didUrl } : {}),
      label: options.label,
      addMediatorService: true,
      // DIDComm only. A VTA adds `#tsp` by default when it and its mediator
      // speak TSP (VTI vta-service did_webvh/document.rs:47-67), and a
      // community then pushes to the persona over TSP first. Across two
      // mediators that push never reached the phone (227 gate, VTA Farm),
      // and the community falls back to DIDComm only after an hour. Over
      // DIDComm the same pushes arrive.
      addTspService: false,
      setPrimary: false,
    }
    // A step down happens only on a version refusal, when the VTA minted nothing, so the same key goes with each try.
    return this.versions
      .ask('didsCreate', VTA_TASK_VERSIONS.didsCreate, (type) =>
        this.task<VtaMintedDid>(
          type,
          payload,
          MINT_TIMEOUT_MS,
          // A mint whose answer is lost still succeeds at the VTA; retried with the
          // same key within 24 h the VTA returns that first mint instead of minting
          // an orphan (VTI-Q17, answered by the maintainers 2026-09-23).
          options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}
        )
      )
      .then(({ answer }) => answer)
  }

  /**
   * The agent context new personas are minted in (IN-259): one named for
   * Keyring if the agent has it, else the agent's default context ("vta"),
   * and only then the first it lists. The first was used before, which put a
   * persona beside whatever came first — a tester's was "did-git-sign". The
   * phone does not make a context itself: `vta/contexts/create` is a task the
   * "Ask me before…" screen offers rules on, and the phone never sends one
   * (approvalRules.ts OFFERED_TASKS), so a rule there could only ever hold it.
   */
  private personaContextId(contexts: VtaContext[]): string {
    const has = (id: string) => contexts.some((c) => c.id === id)
    if (has(PERSONA_CONTEXT_ID)) return PERSONA_CONTEXT_ID
    if (has(DEFAULT_CONTEXT_ID)) return DEFAULT_CONTEXT_ID
    return contexts[0]?.id ?? DEFAULT_CONTEXT_ID
  }

  /**
   * The persona for a community, kept in the identity store: reused when the
   * phone already holds one with its key-agreement key borrowed, otherwise
   * minted on the first registered DID-hosting server (or serverlessly at
   * `personaBaseUrl`), its key borrowed, and the whole recorded. Connects if
   * it must; the caller owns disconnecting.
   */
  async ensurePersona(options: { communityDid: string; label?: string; personaBaseUrl?: string }): Promise<VtiPersona> {
    // One persona per community, however many screens ask at once: a second
    // caller waits for the first one's answer instead of minting and recording
    // again (IN-26: several callers each recorded the same persona).
    const inFlightKey = `${this.vtaDid}|${options.communityDid}`
    const running = personasInFlight.get(inFlightKey)
    if (running) return running
    const work = this.ensurePersonaOnce(options).finally(() => {
      if (personasInFlight.get(inFlightKey) === work) personasInFlight.delete(inFlightKey)
    })
    personasInFlight.set(inFlightKey, work)
    return work
  }

  private async ensurePersonaOnce(options: {
    communityDid: string
    label?: string
    personaBaseUrl?: string
  }): Promise<VtiPersona> {
    const existing = await this.store.getPersona(options.communityDid)
    if (existing?.kmsKeyIds?.keyAgreement && existing.kmsKeyIds.signing) {
      await this.holdPersonaKeys(existing)
      return existing
    }

    await this.connect()
    // Only a new persona needs a context: one already recorded stays where it is.
    const contextId = existing ? existing.contextId : this.personaContextId(await this.listContexts())
    const servers = await this.listServers()
    const label = options.label ?? `keyring-${Date.now().toString(36)}`
    // A persona is a did:webvh, and one has to be served from somewhere: a
    // DID-hosting server the VTA is registered with, or — serverlessly — a base
    // URL the VTA itself serves. With neither, the serverless branch below
    // would mint at "/<label>": a DID no one can resolve, which a community
    // then fails to reach with no word of why. Refuse before minting instead,
    // and say what the agent is missing. A store build bakes no base URL, so
    // this is the case for any tester whose agent has no DID host.
    if (!existing && !servers[0] && !options.personaBaseUrl) {
      throw new PersonaHostMissing(this.vtaDid)
    }
    const minted = existing
      ? ({
          did: existing.did,
          contextId: existing.contextId,
          signingKeyId: existing.vtaKeyIds.signing,
          kaKeyId: existing.vtaKeyIds.keyAgreement,
        } as VtaMintedDid)
      : await this.mintOnce(
          options.communityDid,
          servers[0]
            ? { contextId, serverId: servers[0].id, label }
            : { contextId, didUrl: `${options.personaBaseUrl ?? ''}/${label}`, label }
        )
    const borrowed = await this.borrowKey(minted.kaKeyId)
    // The signing key too: a vetting card, an eligibility presentation and a
    // vetting statement are all signed as the persona (D19).
    const signing = await this.borrowKey(minted.signingKeyId)
    const persona: VtiPersona = {
      communityDid: options.communityDid,
      vtaDid: this.vtaDid,
      did: minted.did,
      contextId: minted.contextId ?? contextId,
      vtaKeyIds: { signing: minted.signingKeyId, keyAgreement: minted.kaKeyId },
      kmsKeyIds: { keyAgreement: borrowed.keyId, signing: signing.keyId },
      label,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    }
    await this.store.setPersona(persona)
    await this.store.clearMintKey?.(options.communityDid)
    return persona
  }

  /**
   * One mint per community until a persona is recorded for it: every retry — a
   * tap on Try again, or after a restart — re-sends the first attempt's key AND
   * request. The VTA answers a keyed retry with the first mint only when the
   * payload is the same, and refuses any difference for 24 h ("idempotency key
   * reused for a different request", vta-service trust_tasks/idempotency.rs);
   * up to 224 a retry rebuilt the request with a new label, so one mint that
   * reached the VTA without its persona being recorded blocked that community
   * on the phone for a day.
   *
   * A key saved without its request (before this) cannot be re-sent unchanged.
   * On that refusal the attempt starts over once with a new key: the first
   * mint, if it happened, stays on the VTA unused.
   */
  private async mintOnce(communityDid: string, fresh: VtiMintRequest): Promise<VtaMintedDid> {
    const savedKey = await this.store.getMintKey?.(communityDid)
    const savedRequest = savedKey ? await this.store.getMintRequest?.(communityDid) : undefined
    const request = savedRequest ?? fresh
    const key = savedKey ?? `urn:uuid:${utils.uuid()}`
    await this.store.setMintKey?.(communityDid, key, request)
    try {
      return await this.mintPersona({ ...request, idempotencyKey: key })
    } catch (error) {
      if (
        !/idempotency key reused for a different request/i.test(error instanceof Error ? error.message : String(error))
      )
        throw error
      this.agent.config?.logger?.warn?.(
        `${LOG_PREFIX} the VTA holds a different mint under this community's key; starting the mint over with a new key`
      )
      const again = `urn:uuid:${utils.uuid()}`
      await this.store.setMintKey?.(communityDid, again, fresh)
      return this.mintPersona({ ...fresh, idempotencyKey: again })
    }
  }

  /**
   * Borrow both keys of an identity that holds no copies, and record them on it, as a join records a new
   * persona's. Only the identity's own agent is asked, and nothing is minted: a persona of another agent is left as
   * it is. Answers whether the identity recorded for its community is this one, with copies, afterwards.
   *
   * The in-flight map is per community, not per identity, and shared with `ensurePersona`: a join or another borrow
   * for the same community is waited for, and what it left is read again before anything is borrowed. So a borrow
   * never repeats one that has just finished, and never writes this identity back over one a join recorded
   * meanwhile (both keep one record per agent and community). It cannot wait on itself: `ensurePersonaOnce` hands
   * a persona to `holdPersonaKeys` only when both its copies are recorded, which never comes here.
   */
  private async borrowAdoptedKeys(persona: VtiPersona): Promise<boolean> {
    if (persona.vtaDid !== this.vtaDid || isAgentsOwnPersona(persona)) return false
    const inFlightKey = `${this.vtaDid}|${persona.communityDid}`
    for (;;) {
      const running = personasInFlight.get(inFlightKey)
      if (running) {
        await running.catch(() => undefined)
        continue
      }
      const recorded = await this.store.getPersona(persona.communityDid, this.vtaDid)
      // Something started for this community while the record was read: wait for it, and read again.
      if (personasInFlight.has(inFlightKey)) continue
      if (recorded?.did !== persona.did) return false
      if (recorded.kmsKeyIds?.keyAgreement && recorded.kmsKeyIds.signing) return true
      const work = (async () => {
        await this.connect()
        const keyAgreement = await this.borrowKey(recorded.vtaKeyIds.keyAgreement)
        const signing = await this.borrowKey(recorded.vtaKeyIds.signing)
        const held: VtiPersona = {
          ...recorded,
          kmsKeyIds: { keyAgreement: keyAgreement.keyId, signing: signing.keyId },
        }
        await this.store.setPersona(held)
        return held
      })().finally(() => {
        if (personasInFlight.get(inFlightKey) === work) personasInFlight.delete(inFlightKey)
      })
      personasInFlight.set(inFlightKey, work)
      await work
      return true
    }
  }

  /**
   * Borrow one of the VTA's keys into the wallet's KMS; returns the KMS key id. Never a key of the agent's own DID:
   * an identity's keys only (agentOwnIdentity).
   */
  async borrowKey(
    vtaKeyId: string
  ): Promise<{ keyId: string; curve: 'Ed25519' | 'X25519'; publicKeyMultibase: string }> {
    if (isAgentsOwnDid(didOfKeyId(vtaKeyId), this.vtaDid))
      throw new Error(`${LOG_PREFIX} not borrowed: the key is the agent's own, not an identity's`)
    const exported = await this.task<VtaExportedKey>(VTA_TASK.keysExportSecret, { keyId: vtaKeyId })
    // Held in memory only (#10, plan part C), under an id that is the same every
    // session, so a persona's record keeps naming it across restarts.
    const into = { backend: EPHEMERAL_KMS_BACKEND, keyId: inMemoryKeyId(this.vtaDid, vtaKeyId) }
    return { ...(await importVtaKey(this.agent, exported, into)), publicKeyMultibase: exported.publicKeyMultibase }
  }

  /**
   * Fetch a persona's key copies again when this phone does not hold them —
   * after a restart or a lock the in-memory backend is empty. A persona whose
   * copies are still in the wallet's store (minted before memory-only custody)
   * is left alone. Answers whether anything was fetched.
   *
   * An identity taken on from the agent (Bring back, vtiAdoptIdentities) is recorded with the agent's key ids
   * and no copies at all, so nothing on the phone could sign in as it (vtiAgent: "the persona has no borrowed
   * key-agreement key"): its rooms, its community's messages and its vetting all stopped there. Its copies are
   * borrowed and recorded here, the first time it is asked for.
   */
  async holdPersonaKeys(persona: VtiPersona): Promise<boolean> {
    if (!persona.kmsKeyIds?.keyAgreement || !persona.kmsKeyIds.signing) return this.borrowAdoptedKeys(persona)
    const pairs = [
      [persona.kmsKeyIds?.signing, persona.vtaKeyIds.signing],
      [persona.kmsKeyIds?.keyAgreement, persona.vtaKeyIds.keyAgreement],
    ] as const
    let fetched = false
    for (const [kmsKeyId, vtaKeyId] of pairs) {
      if (!kmsKeyId || !isInMemoryKeyId(kmsKeyId)) continue
      // Asked without fetching: getPublicKey would fetch a missing copy itself
      // (EphemeralKeyManagementService), and this is the fetch.
      const held =
        (await heldInMemory(this.agent, kmsKeyId)) ??
        (await this.agent.kms
          .getPublicKey({ keyId: kmsKeyId, backend: EPHEMERAL_KMS_BACKEND })
          .then(() => true)
          .catch(() => false))
      if (held) continue
      await this.connect()
      await this.borrowKey(vtaKeyId)
      fetched = true
    }
    return fetched
  }

  // ---------------------------------------------------------------------------
  // Hidden vetting (PCS): the applicant's five tasks.
  //
  // The agent holds the per-application PCS key and builds the proof; this
  // client only carries messages (zero-knowledge-plan D4). The other seven
  // `vta/pcs/*` tasks belong to a vetter and are not here.
  // ---------------------------------------------------------------------------

  /**
   * The Trust Task types this agent dispatches, from its own `trust-task-discovery/0.1` answer;
   * undefined when it could not be asked or listed nothing. An empty list is inconclusive, never
   * "serves nothing".
   */
  async supportedTypes(): Promise<string[] | undefined> {
    // `trust-task-discovery/0.1` answers from the dispatch table itself
    // (`vta-service/src/trust_tasks/discovery.rs` passes `dispatched_uris()`)
    // and its handler takes no capability check, so the answer is conclusive
    // both ways and needs no grant.
    try {
      const { answer } = await this.versions.ask('discovery', VTA_TASK_VERSIONS.discovery, (type) =>
        this.task<{ supportedTypes?: unknown }>(
          type,
          // **No patterns**, deliberately: a responder matches a pattern against
          // a task's *slug*, not its Type URI
          // (`vti-common/src/trust_task/discovery.rs` `matches_any` calls
          // `slug_of(uri)` before `match_slug`), so a URI-shaped pattern matches
          // nothing and the answer comes back empty — which would read as "does
          // not serve it" for an agent that does. An empty pattern list means
          // every supported task (`matches_any` returns true when
          // `patterns.is_empty()`), and the filtering happens below where the
          // Type URIs are unambiguous. The spec's own payload note says as much:
          // a discoverer wanting more asks for everything and filters locally.
          {},
          30000,
          {},
          undefined,
          { waitForConsent: false }
        )
      )
      const types = Array.isArray(answer?.supportedTypes) ? answer.supportedTypes : []
      // Entries come as a bare URI or as `{type}` — both forms are legal in
      // one list (spec 0.1 `supportedTypes`).
      const uris = types
        .map((t) =>
          typeof t === 'string' ? t : t && typeof t === 'object' ? (t as { type?: unknown }).type : undefined
        )
        .filter((t): t is string => typeof t === 'string')
      return uris.length > 0 ? uris : undefined
    } catch {
      // An agent that does not serve discovery, or a policy that denies it.
      return undefined
    }
  }

  /**
   * Whether this agent serves `vta/pcs/*` at all — `applications/show` with an
   * id it cannot hold.
   *
   * `notFound` means the family is served, which is the answer we want: the
   * probe asks a question whose "failure" is the success signal.
   * `unsupportedType` means the agent predates vta-service 0.60.
   *
   * Returns `undefined` for "cannot tell", which includes a policy holding the
   * probe for consent or step-up. `waitForConsent: false` keeps that cheap: a
   * held task is refused at once rather than waiting, and the caller must NOT
   * treat the refusal as a verdict — a rule covering reads is not evidence
   * about the agent's version.
   */
  async servesPcs(): Promise<boolean | undefined> {
    // Ask the agent what it serves, rather than inferring it from a refusal.
    // An agent that lists nothing, or cannot be asked, leaves the question to
    // the probe below.
    const uris = await this.supportedTypes()
    if (uris) return uris.some((uri) => uri.startsWith(PCS_FAMILY))

    try {
      await this.task(
        PCS_VTA_TASK.applicationsShow,
        { applicationId: PCS_PROBE_APPLICATION_ID },
        30000,
        {},
        undefined,
        {
          waitForConsent: false,
        }
      )
      // An agent that answered at all serves the family; a hit on this id is
      // not credible, but it would still prove the task is implemented.
      return true
    } catch (error) {
      const code = pcsErrorCode((error as { document?: unknown })?.document ?? error)
      if (code?.endsWith(':notFound') || code === 'notFound') return true
      if (code === PCS_ERROR.unsupportedType || code?.endsWith(':unsupportedType')) return false
      // `permissionDenied` is NOT evidence either way, however tempting it is.
      // At 0.60 it means the capability check inside the handler ran, so the
      // handler exists — but the policy gate runs *before* dispatch on older
      // agents, and with `policy.enforcement` on, a denial for an unknown type
      // is also `permissionDenied`; so is a policy-store read failure, which
      // fails closed with "policy evaluation unavailable"
      // (`vta-service/src/trust_tasks/policy_gate.rs:123-141`, read at
      // vta-service-v0.56.0). A pre-0.60 agent can therefore say
      // `permissionDenied` to a task it does not implement, and reading that as
      // "serves it" would claim hidden vetting is available where it is not.
      return undefined
    }
  }

  /** `vta/pcs/applications/create/0.1`. One per join attempt, before any vetter is asked. */
  async createPcsApplication(payload: ApplicationsCreatePayload): Promise<PcsApplication> {
    const answer = await this.task<{ application?: PcsApplication }>(
      PCS_VTA_TASK.applicationsCreate,
      payload as unknown as Record<string, unknown>
    )
    const application = answer?.application
    if (!application?.applicationId) throw new Error('vta/pcs/applications/create returned no application')
    return application
  }

  /** `vta/pcs/applications/show/0.1`. The agent is the source of truth; this re-reads it. */
  async showPcsApplication(applicationId: string): Promise<PcsApplication | undefined> {
    const answer = await this.task<{ application?: PcsApplication }>(PCS_VTA_TASK.applicationsShow, { applicationId })
    return answer?.application
  }

  /**
   * `vta/pcs/verify-attestation/0.1`. The agent verifies the vetter's
   * attestation and keeps it; nothing is stored on the device, by design.
   */
  async verifyPcsAttestation(payload: VerifyAttestationPayload): Promise<PcsApplication | undefined> {
    const answer = await this.task<{ application?: PcsApplication }>(
      PCS_VTA_TASK.verifyAttestation,
      payload as unknown as Record<string, unknown>
    )
    return answer?.application
  }

  /**
   * `vta/pcs/prove/0.1`. Ninety seconds, not the usual thirty: the agent is
   * building a zero-knowledge proof, and upstream allows that much for it.
   *
   * `prove:noUsableAttestation` is a progress state — too few attestations yet
   * — and reaches the caller as an error to read with `pcsErrorCode`, not as a
   * failure of the call.
   */
  async provePcs(payload: ProvePayload): Promise<Record<string, unknown>> {
    const answer = await this.task<{ hiddenVetting?: Record<string, unknown> }>(
      PCS_VTA_TASK.prove,
      payload as unknown as Record<string, unknown>,
      90000
    )
    const hiddenVetting = answer?.hiddenVetting
    if (!hiddenVetting) throw new Error('vta/pcs/prove returned no hiddenVetting object')
    return hiddenVetting
  }

  /**
   * The vetter's seven, in the order a vetter meets them.
   *
   * Enrolling and drawing are each three steps across two parties — the agent
   * blinds, the community signs, the agent unblinds — because the agent holds
   * the key and the community holds the authority. The phone never sees an
   * unblinded credential.
   */

  /** `vta/pcs/vetter/show/0.1`. A read: labels, token counts, draws in flight. */
  async showPcsVetter(payload: VetterShowPayload): Promise<VetterStanding | undefined> {
    const answer = await this.task<{ vetter?: VetterStanding }>(
      PCS_VETTER_TASK.vetterShow,
      payload as unknown as Record<string, unknown>
    )
    return answer?.vetter
  }

  /**
   * `vta/pcs/root-request/0.1`. The blinded enrolment request, for the phone
   * to carry: the community's `pcs-root` payload, which the agent answers
   * inside a `request` member.
   */
  async pcsRootRequest(payload: RootRequestPayload): Promise<RootRequestWire> {
    const answer = await this.task<{ request?: Partial<RootRequestWire> }>(
      PCS_VETTER_TASK.rootRequest,
      payload as unknown as Record<string, unknown>
    )
    // The answer is `{ request: { label, id, request } }` — the community's
    // payload, nested — not `{ id, request }`. Reading `id` one level up gave
    // `''`, which test-vtc refused against `^z[1-9A-HJ-NP-Za-km-z]+$` in a way
    // that read as an encoding problem rather than a missing field
    // (2026-10-15). Never invent the id: a missing or non-base58 one is an
    // answer we cannot use, so it is said here, before the community sees it.
    const request = answer?.request
    if (!request?.request || !request.label) throw new Error('vta/pcs/root-request returned no request')
    const id = typeof request.id === 'string' ? request.id : ''
    if (!MULTIBASE_BASE58.test(id)) {
      throw Object.assign(
        new Error(`vta/pcs/root-request returned no usable identifier (${id === '' ? 'absent' : 'not base58btc'})`),
        { code: 'vta/pcs/root-request:noIdentifier' }
      )
    }
    return request as RootRequestWire
  }

  /** `vta/pcs/root-accept/0.1`. The community's answer, for the agent to unblind and keep. */
  async pcsRootAccept(payload: RootAcceptPayload): Promise<void> {
    await this.task(PCS_VETTER_TASK.rootAccept, payload as unknown as Record<string, unknown>)
  }

  /**
   * `vta/pcs/tokens/request/0.1`. One blinded request per token of this tick's
   * drip: the community's `pcs-tokens` payload, inside a `request` member.
   */
  async pcsTokensRequest(payload: TokensRequestPayload): Promise<TokenDrawWire> {
    const answer = await this.task<{ request?: Partial<TokenDrawWire> }>(
      PCS_VETTER_TASK.tokensRequest,
      payload as unknown as Record<string, unknown>
    )
    const request = answer?.request
    if (!Array.isArray(request?.requests) || !request.label || typeof request.tick !== 'number')
      throw new Error('vta/pcs/tokens/request returned no requests')
    return request as TokenDrawWire
  }

  /** `vta/pcs/tokens/accept/0.1`. The drawn tokens, for the agent to unblind and keep. */
  async pcsTokensAccept(payload: TokensAcceptPayload): Promise<void> {
    await this.task(PCS_VETTER_TASK.tokensAccept, payload as unknown as Record<string, unknown>)
  }

  /** `vta/pcs/tokens/abandon/0.1`. Give up a draw, so the next is not refused as already in flight. */
  async pcsTokensAbandon(payload: TokensAbandonPayload): Promise<void> {
    await this.task(PCS_VETTER_TASK.tokensAbandon, payload as unknown as Record<string, unknown>)
  }

  /**
   * `vta/pcs/attest/0.1`. The agent spends one token and builds the
   * attestation, which names no vetter — the point of the construction.
   * Ninety seconds, as `prove` has: it is the same arithmetic.
   */
  async pcsAttest(payload: AttestPayload): Promise<Record<string, unknown>> {
    const answer = await this.task<{ attestation?: Record<string, unknown> }>(
      PCS_VETTER_TASK.attest,
      payload as unknown as Record<string, unknown>,
      90000
    )
    if (!answer?.attestation) throw new Error('vta/pcs/attest returned no attestation')
    return answer.attestation
  }

  /**
   * `vta/pcs/applications/delete/0.1`, once the join is decided either way.
   * Removes the application's key path and its attestations from the agent.
   */
  async deletePcsApplication(applicationId: string): Promise<void> {
    await this.task(PCS_VTA_TASK.applicationsDelete, { applicationId })
  }
}
