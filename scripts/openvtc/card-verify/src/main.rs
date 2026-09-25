//! `card-verify <card.json> <expect.json>` — run the VTI SDK's `verify_card`, the
//! check an openvtc vetter runs, on a Vetting Card Keyring produced.
//!
//! `expect.json` is what the vetter knows from its own session:
//! `{ "audience", "publisher", "community", "challenge", "domain",
//!    "requiredClaims": [..], "now"?: RFC 3339 }`.
//! `now` defaults to one second after the card's `issuedAt`, so a card captured
//! earlier is judged inside its own window. A `did:key` publisher is verified
//! offline; any other DID is resolved over the network (public hosts only, as
//! the SDK's default policy).
//!
//! Exit 0 and one `OK` line on success; exit 1 and the SDK's reason otherwise.
//!
//! Two more modes, for the conformance vectors (each runs upstream's own
//! function, at the pin, on a value Keyring produced or will be checked against):
//!
//! - `card-verify digest <value.json>` prints DTG Credentials' `digestMultibase`
//!   of the value: JCS without the top-level `proof`, sha-256 multihash,
//!   base58btc (`dtg_credentials::digest_multibase_json`, the function vta-sdk's
//!   `vetting::digest` calls for a card or a statement).
//! - `card-verify vectors <card.json>` prints golden vectors as JSON: for fixed
//!   inputs (and the given card), what upstream computes for the identity
//!   commitment (`vetting::card::identity_commitment`), the card digest
//!   (`dtg_credentials::digest_multibase_json`), the match code
//!   (`vetting::match_code::vetting_match_code`) and the ticket URI
//!   (`vetting::ticket_uri::decode`, then `encode`). Keyring's tests check its
//!   own functions against that file.
//! - `card-verify sign-fixtures` prints a card and a statement SIGNED BY
//!   UPSTREAM CODE (vta-sdk `vetting::card::sign_card` and
//!   `vetting::statement::sign_statement`) with fixed-seed did:key keys, and the
//!   card's digest from `verify_card`. Keyring's tests verify these proofs and
//!   accept this statement with its own code.
//! - `card-verify verify-task <task.json> <expected-signer-did> [<expected-type>]`
//!   runs vta-sdk's `trust_task_proof::verify_trust_task_proof_with` on a Trust
//!   Task document Keyring signed, which is what a VTA or a VTC runs on each
//!   task it receives; requires the proven signer to be the expected one and
//!   the document's `issuer`, and the `type` to be the expected one; then checks
//!   the payload against trust-tasks-rs's typed spec for that type (policy,
//!   published schema, typed parse). See `check_task`.
//! - `card-verify verify-tasks <tasks.json> <dir>` runs `verify-task` on every
//!   `{ file, type, signer }` entry of a conformance run's list.
//! - `card-verify verify-statement <statement.json> <card.json> <expect.json>`
//!   verifies the card as above, then runs vta-sdk's `verify_statement` and
//!   `check_against_card` on the statement: what an openvtc applicant runs on a
//!   statement it receives (openvtc-core `vetting/applicant.rs` `on_statement`).
//!   `expect.json` may add `"statementNow"` (RFC 3339); it defaults to one
//!   second after the statement's `validFrom`.

use std::process::ExitCode;

use affinidi_did_resolver_cache_sdk::DIDCacheClient;
use affinidi_did_resolver_cache_sdk::config::DIDCacheConfigBuilder;
use affinidi_did_resolver_cache_sdk::network_resolvers::HostPolicy;
use chrono::{DateTime, Duration, Utc};
use serde_json::Value;
use vta_sdk::trust_task_proof::TrustTaskVmResolver;
use vta_sdk::vetting::card::{CardExpectations, VerifiedVettingCard, verify_card};
use serde_json::json;
use vta_sdk::protocols::vetting::session::v0_1::VettingCardClaim;
use affinidi_secrets_resolver::secrets::Secret;
use vta_sdk::protocols::vetting::IdentityVettingEndorsement;
use vta_sdk::vetting::card::{CardDraft, identity_commitment, sign_card};
use vta_sdk::vetting::statement::{StatementDraft, sign_statement};
use vta_sdk::vetting::match_code::vetting_match_code;
use vta_sdk::vetting::statement::verify_statement;
use vta_sdk::trust_task_proof::verify_trust_task_proof_with;
use vta_sdk::vetting::ticket_uri;
use vta_sdk::vetting::eligibility::{EligibilityExpectations, build_eligibility_vp, verify_eligibility_vp};
use affinidi_data_integrity::{DataIntegrityProof, SignOptions, crypto_suites::CryptoSuite};

fn read(path: &str) -> Result<Value, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("{path}: {e}"))
}

fn field<'a>(v: &'a Value, name: &str) -> Result<&'a str, String> {
    v.get(name).and_then(Value::as_str).ok_or_else(|| format!("expect.json: missing \"{name}\""))
}

async fn resolver_for(did: &str) -> Result<TrustTaskVmResolver, String> {
    if did.starts_with("did:key:") {
        return Ok(TrustTaskVmResolver::did_key_only());
    }
    let config = DIDCacheConfigBuilder::default().with_host_policy(HostPolicy::PublicOnly).build();
    let client = DIDCacheClient::new(config).await.map_err(|e| format!("resolver: {e}"))?;
    Ok(TrustTaskVmResolver::new(client))
}

async fn verified_card(card: &Value, expect: &Value) -> Result<VerifiedVettingCard, String> {
    let required: Vec<String> = expect
        .get("requiredClaims")
        .and_then(Value::as_array)
        .ok_or("expect.json: missing \"requiredClaims\"")?
        .iter()
        .filter_map(|c| c.as_str().map(str::to_string))
        .collect();
    let now: DateTime<Utc> = match expect.get("now").and_then(Value::as_str) {
        Some(t) => t.parse().map_err(|e| format!("expect.json now: {e}"))?,
        None => {
            let issued = card.get("issuedAt").and_then(Value::as_str).ok_or("card: missing issuedAt")?;
            issued.parse::<DateTime<Utc>>().map_err(|e| format!("card issuedAt: {e}"))? + Duration::seconds(1)
        }
    };
    let publisher = field(expect, "publisher")?;
    let resolver = resolver_for(publisher).await?;
    let expectations = CardExpectations {
        audience: field(expect, "audience")?,
        publisher,
        community: field(expect, "community")?,
        challenge: field(expect, "challenge")?,
        domain: field(expect, "domain")?,
        required_claims: &required,
        now,
    };
    verify_card(card, &expectations, &resolver)
        .await
        .map_err(|e| format!("REFUSED: {e} — {e:?}"))
}

async fn run(card_path: &str, expect_path: &str) -> Result<String, String> {
    let verified = verified_card(&read(card_path)?, &read(expect_path)?).await?;
    Ok(format!("OK: card accepted by vta-sdk verify_card (digest {})", verified.digest_multibase()))
}

fn vectors(card_path: &str) -> Result<String, String> {
    let card = read(card_path)?;
    let claims = |v: Value| -> Result<Vec<VettingCardClaim>, String> {
        serde_json::from_value(v).map_err(|e| format!("claims: {e}"))
    };
    let mut commitments = Vec::new();
    let cases = [
        (
            card.get("commitmentSalt").cloned().unwrap_or_default(),
            card.get("claims").cloned().unwrap_or_default(),
            json!(["name.legal"]),
        ),
        (
            json!("salt-1"),
            json!([{ "type": "name.legal", "value": "Ada Lovelace", "provenance": "selfAsserted" }]),
            json!(["name.legal"]),
        ),
        (
            json!("salt-1"),
            json!([
                { "type": "name.legal", "value": "Ada Lovelace", "provenance": "selfAsserted" },
                { "type": "name.legal", "value": "Someone Else", "provenance": "selfAsserted" }
            ]),
            json!(["name.legal"]),
        ),
    ];
    for (salt, claim_list, required) in cases {
        let salt_str = salt.as_str().ok_or("salt is not a string")?.to_string();
        let required_list: Vec<String> = serde_json::from_value(required.clone()).map_err(|e| e.to_string())?;
        let expected = identity_commitment(&salt_str, &claims(claim_list.clone())?, &required_list)
            .map_err(|e| format!("identity_commitment: {e}"))?;
        commitments.push(json!({ "salt": salt_str, "claims": claim_list, "requiredClaims": required, "expected": expected }));
    }
    let match_codes: Vec<Value> = [
        "urn:uuid:5b0e1c2a-7d4f-4a51-9c6e-2f1b8d3a9e70",
        "urn:uuid:a",
        "urn:uuid:session-conformance",
    ]
    .iter()
    .map(|id| json!({ "sessionDocumentId": id, "expected": vetting_match_code(id) }))
    .collect();
    let mut tickets = Vec::new();
    for uri in [
        "vetting-ticket:?v=1&community=did%3Awebvh%3AQmCommunity%3Adids.example%3Acommunity&vetter=did%3Awebvh%3AQmVetter%3Adids.example%3Avetter&ticket=tkt-0001&secret=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
        "vetting-ticket:?v=1&community=did%3Awebvh%3AQmCommunity%3Adids.example%3Acommunity&vetter=did%3Akey%3Az6MkVetter&code=K7QF-2M9X",
    ] {
        let decoded = ticket_uri::decode(uri).map_err(|e| format!("ticket decode {uri}: {e}"))?;
        let encoded = ticket_uri::encode(&decoded).map_err(|e| format!("ticket encode: {e}"))?;
        let presentation = serde_json::to_value(&decoded.presentation).map_err(|e| e.to_string())?;
        tickets.push(json!({
            "uri": uri,
            "decoded": { "community": decoded.community, "vetter": decoded.vetter, "presentation": presentation },
            "reencoded": encoded
        }));
    }
    let doc = json!({
        "note": "Golden vectors computed by upstream code (wallet scripts/openvtc/card-verify vectors). Keyring's tests check its own functions against these; never regenerate them with Keyring's code.",
        "sources": {
            "identityCommitment": "vta-sdk vetting/card.rs identity_commitment",
            "cardDigest": "dtg-credentials digest_multibase_json (lib.rs:534), via vta-sdk vetting/mod.rs digest",
            "matchCode": "vta-sdk vetting/match_code.rs vetting_match_code",
            "ticketUri": "vta-sdk vetting/ticket_uri.rs decode, encode"
        },
        "identityCommitment": commitments,
        "cardDigest": { "card": card.clone(), "expected": dtg_credentials::digest_multibase_json(&card).map_err(|e| e.to_string())? },
        "matchCode": match_codes,
        "ticketUri": tickets
    });
    serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())
}

/// A did:key Ed25519 secret from a fixed seed, `id` = `<did>#<multibase>`, as
/// vta-sdk's own test support makes one (vetting/mod.rs test_support::secret).
fn seeded(seed_byte: u8) -> Result<(Secret, String), String> {
    let mut secret = Secret::generate_ed25519(None, Some(&[seed_byte; 32]));
    let public = secret.get_public_keymultibase().map_err(|e| e.to_string())?;
    secret.id = format!("did:key:{public}#{public}");
    Ok((secret, format!("did:key:{public}")))
}

async fn sign_fixtures() -> Result<String, String> {
    let (applicant, applicant_did) = seeded(1)?;
    let (vetter, vetter_did) = seeded(2)?;
    let community = "did:webvh:QmCommunity:dids.example:community".to_string();
    let session_id = "urn:uuid:7c9d0e1f-2a3b-4c5d-8e6f-7a8b9c0d1e2f".to_string();
    let challenge = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8".to_string();
    let issued_at: DateTime<Utc> = "2026-09-25T00:00:00Z".parse().map_err(|e| format!("{e}"))?;
    let claims: Vec<VettingCardClaim> = serde_json::from_value(json!([
        { "type": "name.legal", "value": "Ada Lovelace", "provenance": "selfAsserted" }
    ]))
    .map_err(|e| format!("claims: {e}"))?;
    let card = sign_card(
        CardDraft {
            id: "urn:uuid:3f1e8a2c-6b4d-4e5f-9a1b-2c3d4e5f6a7b".into(),
            publisher: applicant_did.clone(),
            audience: vetter_did.clone(),
            community: community.clone(),
            challenge: challenge.clone(),
            domain: community.clone(),
            issued_at,
            validity: Duration::minutes(10),
            claims,
            identity_types: vec!["name.legal".into()],
            salt: "c2FsdC11cHN0cmVhbS1maXh0dXJlLTMyLWJ5dGVzLS0".into(),
        },
        &applicant,
    )
    .await
    .map_err(|e| format!("sign_card: {e}"))?;
    let expect = json!({
        "audience": vetter_did, "publisher": applicant_did, "community": community,
        "challenge": challenge, "domain": community, "requiredClaims": ["name.legal"],
        "now": "2026-09-25T00:00:01Z"
    });
    let verified = verified_card(&card, &expect).await?;
    let endorsement: IdentityVettingEndorsement = serde_json::from_value(json!({
        "type": vta_sdk::protocols::vetting::IDENTITY_VETTING_ENDORSEMENT_TYPE,
        "community": community,
        "method": "inPerson",
        "documentClasses": ["passport"],
        "claimsVerified": ["name.legal"],
        "livenessConfirmed": true,
        "identityCommitment": card.get("identityCommitment").cloned().unwrap_or_default(),
        "cardDigestMultibase": verified.digest_multibase(),
        "declaredRelationship": "none"
    }))
    .map_err(|e| format!("endorsement: {e}"))?;
    let statement = sign_statement(
        StatementDraft {
            id: "urn:uuid:5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d".into(),
            issuer: vetter_did.clone(),
            subject: applicant_did.clone(),
            endorsement,
            valid_from: issued_at + Duration::minutes(1),
            valid_until: issued_at + Duration::days(120),
            task_context: session_id.clone(),
        },
        &vetter,
    )
    .await
    .map_err(|e| format!("sign_statement: {e}"))?;
    let doc = json!({
        "note": "Signed by upstream code (wallet scripts/openvtc/card-verify sign-fixtures: vta-sdk sign_card, sign_statement). Never re-sign with Keyring's code.",
        "applicantDid": applicant_did,
        "vetterDid": vetter_did,
        "community": community,
        "session": { "documentId": session_id, "challenge": challenge, "domain": community, "requiredClaims": ["name.legal"] },
        "card": card,
        "cardDigest": verified.digest_multibase(),
        "statement": statement
    });
    serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())
}

/// What a Trust Task check concluded about a document it did not refuse.
enum TaskVerdict {
    /// Proof, issuer, type and payload all checked.
    Ok(String),
    /// Proof, issuer and type checked; upstream publishes no typed payload for
    /// this type, so the payload was not.
    PayloadUnchecked(String),
}

/// The payload checks for one typed spec `P`, in the order vtc-service's
/// spine runs them: the specification's own consumer policy
/// (`schema_index::spec_policy_for(..).enforce`, vtc-service
/// `trust_tasks/mod.rs:302`), then the published JSON Schema the codegen
/// inlined (`validate::ValidatedPayload::validate_value`), then serde into the
/// typed payload — the parse openvtc's `vetting/wire.rs:204` `open::<P>` runs.
fn check_typed<P: trust_tasks_rs::Payload>(doc: &trust_tasks_rs::TrustTask<Value>) -> Result<String, String> {
    use trust_tasks_rs::validate::ValidatedPayload;
    trust_tasks_rs::SpecPolicy::of::<P>()
        .enforce(doc)
        .map_err(|r| format!("REFUSED: the specification's policy refuses it: {r}"))?;
    P::validate_value(&doc.payload)
        .map_err(|e| format!("REFUSED: payload fails the published schema of {}: {}", P::TYPE_URI, e.messages().join("; ")))?;
    serde_json::from_value::<P>(doc.payload.clone())
        .map_err(|e| format!("REFUSED: payload does not parse as {}: {e}", std::any::type_name::<P>()))?;
    Ok(format!("payload: schema + {}", std::any::type_name::<P>().trim_start_matches("trust_tasks_rs::specs::")))
}

/// Type URI -> the trust-tasks-rs 0.22.3 typed payload for it: `Payload` for a
/// request, the spec's `Response` for `#response`. `None` when upstream has no
/// typed payload for the URI.
fn typed_payload_check(type_uri: &str, doc: &trust_tasks_rs::TrustTask<Value>) -> Option<Result<String, String>> {
    use trust_tasks_rs::specs::*;
    macro_rules! typed {
        ($($uri:literal => $ty:ty),* $(,)?) => {
            match type_uri {
                $($uri => Some(check_typed::<$ty>(doc)),)*
                // The framework error: hand-modelled in the crate (no schema),
                // for the version upstream emits.
                "https://trusttasks.org/spec/trust-task-error/0.5" => Some(
                    serde_json::from_value::<trust_tasks_rs::ErrorPayload>(doc.payload.clone())
                        .map(|_| "payload: trust_tasks_rs::ErrorPayload (0.5, no schema upstream)".to_string())
                        .map_err(|e| format!("REFUSED: payload does not parse as trust_tasks_rs::ErrorPayload: {e}")),
                ),
                _ => None,
            }
        };
    }
    typed! {
        "https://trusttasks.org/spec/vetting/request/0.1" => vetting::request::v0_1::Payload,
        "https://trusttasks.org/spec/vetting/request/0.1#response" => vetting::request::v0_1::Response,
        "https://trusttasks.org/spec/vetting/session/0.1" => vetting::session::v0_1::Payload,
        "https://trusttasks.org/spec/vetting/session/0.1#response" => vetting::session::v0_1::Response,
        "https://trusttasks.org/spec/vetting/decline/0.1" => vetting::decline::v0_1::Payload,
        "https://trusttasks.org/spec/credential-exchange/issue/0.1" => credential_exchange::issue::v0_1::Payload,
        "https://trusttasks.org/spec/vtc/join-requests/submit/0.2" => vtc::join_requests::submit::v0_2::Payload,
        "https://trusttasks.org/spec/vtc/join-requests/supplement/0.1" => vtc::join_requests::supplement::v0_1::Payload,
        "https://trusttasks.org/spec/vtc/join-requests/status/0.1" => vtc::join_requests::status::v0_1::Payload,
        "https://trusttasks.org/spec/vtc/join-requests/withdraw/0.1" => vtc::join_requests::withdraw::v0_1::Payload,
        "https://trusttasks.org/spec/vtc/members/self-remove/0.1" => vtc::members::self_remove::v0_1::Payload,
        "https://trusttasks.org/spec/auth/whoami/0.1" => auth::whoami::v0_1::Payload,
        "https://trusttasks.org/spec/config/show/0.1" => config::show::v0_1::Payload,
        "https://trusttasks.org/spec/vta/contexts/list/1.0" => vta::contexts::list::v1_0::Payload,
        "https://trusttasks.org/spec/vta/contexts/create/1.0" => vta::contexts::create::v1_0::Payload,
        "https://trusttasks.org/spec/vta/webvh/servers/list/1.0" => vta::webvh::servers::list::v1_0::Payload,
        "https://trusttasks.org/spec/vta/webvh/dids/list/1.0" => vta::webvh::dids::list::v1_0::Payload,
        "https://trusttasks.org/spec/vta/webvh/dids/create/1.0" => vta::webvh::dids::create::v1_0::Payload,
        "https://trusttasks.org/spec/keys/export-secret/0.1" => keys::export_secret::v0_1::Payload,
        "https://trusttasks.org/spec/task-consent/decision/0.1" => task_consent::decision::v0_1::Payload,
        "https://trusttasks.org/spec/acl/swap-key/0.1" => acl::swap_key::v0_1::Payload,
    }
}

/// The checks a VTA or a VTC runs on a Trust Task it receives, on a document
/// Keyring signed: the proof (vta-sdk `verify_trust_task_proof_with`), the
/// proven signer is the expected one AND the document's own `issuer` (SPEC
/// §4.7, as vtc-service `trust_tasks/mod.rs:326-349` refuses a proof by a DID
/// other than the issuer), the `type` when one is expected, then the payload
/// against its typed spec (`typed_payload_check`). A type upstream knows only
/// by schema is checked against the schema alone.
async fn check_task(doc_value: Value, expected_signer: &str, expected_type: Option<&str>) -> Result<TaskVerdict, String> {
    let doc: trust_tasks_rs::TrustTask<Value> =
        serde_json::from_value(doc_value).map_err(|e| format!("REFUSED: not a Trust Task document: {e}"))?;
    let resolver = resolver_for(expected_signer).await?;
    let signer = verify_trust_task_proof_with(&doc, &resolver)
        .await
        .map_err(|e| format!("REFUSED: {e} — {e:?}"))?;
    if signer != expected_signer {
        return Err(format!("REFUSED: the proof is by {signer}, not {expected_signer}"));
    }
    if doc.issuer.as_deref() != Some(signer.as_str()) {
        return Err(format!(
            "REFUSED: the proof is by {signer} but the document's issuer is {} (SPEC §4.7)",
            doc.issuer.as_deref().unwrap_or("absent")
        ));
    }
    let type_uri = doc.type_uri.to_string();
    if let Some(expected) = expected_type
        && type_uri != expected
    {
        return Err(format!("REFUSED: the document's type is {type_uri}, not {expected}"));
    }
    let head = format!("proof by {signer} = issuer");
    match typed_payload_check(&type_uri, &doc) {
        Some(Ok(payload)) => Ok(TaskVerdict::Ok(format!("{head}; {payload}"))),
        Some(Err(e)) => Err(e),
        None => match trust_tasks_rs::schema_index::schema_for(&type_uri) {
            Some(schema) => {
                trust_tasks_rs::validate::against_schema(schema, &doc.payload)
                    .map_err(|e| format!("REFUSED: payload fails the published schema of {type_uri}: {}", e.messages().join("; ")))?;
                Ok(TaskVerdict::Ok(format!("{head}; payload: published schema (no typed mapping in card-verify)")))
            }
            None => Ok(TaskVerdict::PayloadUnchecked(format!("{head}; payload: no typed schema upstream"))),
        },
    }
}

async fn verify_task(task_path: &str, expected_signer: &str, expected_type: Option<&str>) -> Result<String, String> {
    match check_task(read(task_path)?, expected_signer, expected_type).await? {
        TaskVerdict::Ok(detail) => Ok(format!("OK: {detail}")),
        TaskVerdict::PayloadUnchecked(detail) => Ok(format!("OK (payload unchecked): {detail}")),
    }
}

/// Every document a conformance run wrote: `tasks.json` is
/// `[{ file, type, signer, .. }]`, `file` relative to `dir`. One line per
/// document, a summary, and an error when any is refused or the list is empty.
async fn verify_tasks(list_path: &str, dir: &str) -> Result<String, String> {
    let list = read(list_path)?;
    let entries = list.as_array().ok_or(format!("{list_path}: not a JSON array"))?;
    if entries.is_empty() {
        return Err(format!("{list_path}: no documents listed"));
    }
    let (mut ok, mut unchecked, mut refused) = (0, 0, 0);
    for entry in entries {
        let get = |k: &str| entry.get(k).and_then(Value::as_str);
        let file = get("file").unwrap_or("<no file>");
        let outcome = match (get("file"), get("signer"), get("type")) {
            (Some(file), Some(signer), Some(type_uri)) => {
                let path = std::path::Path::new(dir).join(file);
                match read(&path.to_string_lossy()) {
                    Ok(doc) => check_task(doc, signer, Some(type_uri)).await,
                    Err(e) => Err(format!("REFUSED: {e}")),
                }
            }
            _ => Err("REFUSED: the list entry lacks file, signer or type".to_string()),
        };
        match outcome {
            Ok(TaskVerdict::Ok(detail)) => {
                ok += 1;
                println!("OK                 {file}: {detail}");
            }
            Ok(TaskVerdict::PayloadUnchecked(detail)) => {
                unchecked += 1;
                println!("PAYLOAD-UNCHECKED  {file}: {detail}");
            }
            Err(reason) => {
                refused += 1;
                println!("REFUSED            {file}: {}", reason.trim_start_matches("REFUSED: "));
            }
        }
    }
    let summary = format!(
        "{} documents: {ok} OK, {unchecked} payload-unchecked, {refused} REFUSED",
        entries.len()
    );
    if refused > 0 { Err(summary) } else { Ok(summary) }
}

fn digest(value_path: &str) -> Result<String, String> {
    dtg_credentials::digest_multibase_json(&read(value_path)?).map_err(|e| format!("digest: {e}"))
}

async fn verify_statement_against(statement_path: &str, card_path: &str, expect_path: &str) -> Result<String, String> {
    let statement = read(statement_path)?;
    let expect = read(expect_path)?;
    let card = verified_card(&read(card_path)?, &expect).await?;
    let now: DateTime<Utc> = match expect.get("statementNow").and_then(Value::as_str) {
        Some(t) => t.parse().map_err(|e| format!("expect.json statementNow: {e}"))?,
        None => {
            let from = statement.get("validFrom").and_then(Value::as_str).ok_or("statement: missing validFrom")?;
            from.parse::<DateTime<Utc>>().map_err(|e| format!("statement validFrom: {e}"))? + Duration::seconds(1)
        }
    };
    let issuer = match statement.get("issuer") {
        Some(Value::String(s)) => s.clone(),
        Some(v) => v.get("id").and_then(Value::as_str).unwrap_or_default().to_string(),
        None => return Err("statement: missing issuer".into()),
    };
    let resolver = resolver_for(&issuer).await?;
    let verified = verify_statement(&statement, now, &resolver)
        .await
        .map_err(|e| format!("REFUSED: {e} — {e:?}"))?;
    verified.check_against_card(&card).map_err(|e| format!("REFUSED: {e} — {e:?}"))?;
    Ok(format!(
        "OK: statement accepted by vta-sdk verify_statement + check_against_card (card digest {})",
        card.digest_multibase()
    ))
}

/// A resolver for every DID a check touches: did:key alone resolves offline,
/// anything else needs the network.
async fn resolver_for_all(dids: &[&str]) -> Result<TrustTaskVmResolver, String> {
    match dids.iter().find(|d| !d.starts_with("did:key:")) {
        Some(d) => resolver_for(d).await,
        None => Ok(TrustTaskVmResolver::did_key_only()),
    }
}

/// vta-sdk's `verify_eligibility_vp` on a vetter's eligibility presentation:
/// `expect.json` carries `eligibility: { vetter, community, role, challenge,
/// domain, now? }` — challenge is the id of the vetting/request document the
/// presentation answers, domain that request's joinDid.
async fn verify_eligibility(vp_path: &str, expect_path: &str) -> Result<String, String> {
    let vp = read(vp_path)?;
    let expect = read(expect_path)?;
    let e = expect.get("eligibility").ok_or("expect.json: missing \"eligibility\"")?;
    let now: DateTime<Utc> = match e.get("now").and_then(Value::as_str) {
        Some(t) => t.parse().map_err(|err| format!("eligibility.now: {err}"))?,
        None => Utc::now(),
    };
    let vetter = field(e, "vetter")?;
    let community = field(e, "community")?;
    let resolver = resolver_for_all(&[vetter, community]).await?;
    let expectations = EligibilityExpectations {
        vetter,
        community,
        role: field(e, "role")?,
        challenge: field(e, "challenge")?,
        domain: field(e, "domain")?,
        now,
    };
    let verified = verify_eligibility_vp(&vp, &expectations, &resolver)
        .await
        .map_err(|err| format!("REFUSED: {err} — {err:?}"))?;
    Ok(format!(
        "OK: eligibility presentation accepted by vta-sdk verify_eligibility_vp (role credential {})",
        verified.credential_id().unwrap_or("without an id")
    ))
}

/// An eligibility presentation signed by upstream code, for Keyring's checker
/// to accept: a did:key community signs a CommunityRole grant for a did:key
/// vetter (assertionMethod), and the vetter presents it with
/// build_eligibility_vp (authentication) bound to a request id and joinDid.
async fn sign_eligibility() -> Result<String, String> {
    let (vetter, vetter_did) = seeded(2)?;
    let (community_key, community_did) = seeded(3)?;
    let (_, applicant_did) = seeded(1)?;
    let request_id = "urn:uuid:6f1c2b0a-3d4e-4f5a-8b6c-7d8e9f0a1b01";
    let mut grant = json!({
        "@context": ["https://www.w3.org/ns/credentials/v2", "https://firstperson.network/credentials/dtg/v1"],
        "id": "urn:uuid:0e9d8c7b-6a5f-4e3d-9c2b-1a0f9e8d7c6b",
        "type": ["VerifiableCredential", "EndorsementCredential"],
        "issuer": community_did,
        "validFrom": "2026-09-01T00:00:00Z",
        "validUntil": "2027-03-01T00:00:00Z",
        "credentialSubject": {
            "id": vetter_did,
            "endorsement": {
                "type": vta_sdk::protocols::vetting::COMMUNITY_ROLE_ENDORSEMENT_TYPE,
                "communityDid": community_did,
                "role": "vetter"
            }
        }
    });
    let proof = DataIntegrityProof::sign(
        &grant,
        &community_key,
        SignOptions::new()
            .with_proof_purpose("assertionMethod")
            .with_cryptosuite(CryptoSuite::EddsaJcs2022),
    )
    .await
    .map_err(|e| format!("sign grant: {e}"))?;
    grant["proof"] = serde_json::to_value(proof).map_err(|e| e.to_string())?;
    let vp = build_eligibility_vp(&vetter, vec![grant], request_id, &applicant_did)
        .await
        .map_err(|e| format!("build_eligibility_vp: {e}"))?;
    let expect = json!({
        "vetter": vetter_did, "community": community_did, "role": "vetter",
        "challenge": request_id, "domain": applicant_did, "now": "2026-09-25T00:00:00Z"
    });
    // Upstream accepts its own: a fixture that fails here is not a fixture.
    let resolver = TrustTaskVmResolver::did_key_only();
    verify_eligibility_vp(
        &vp,
        &EligibilityExpectations {
            vetter: &vetter_did,
            community: &community_did,
            role: "vetter",
            challenge: request_id,
            domain: &applicant_did,
            now: "2026-09-25T00:00:00Z".parse().map_err(|e| format!("{e}"))?,
        },
        &resolver,
    )
    .await
    .map_err(|e| format!("upstream refused its own fixture: {e}"))?;
    let doc = json!({
        "note": "Signed by upstream code (wallet scripts/openvtc/card-verify sign-eligibility: vta-sdk build_eligibility_vp; the grant signed eddsa-jcs-2022 for assertionMethod). Never re-sign with Keyring's code.",
        "eligibility": expect,
        "vp": vp
    });
    serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())
}

#[tokio::main]
async fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let argv: Vec<&str> = args.iter().map(String::as_str).collect();
    let result = match &argv[1..] {
        ["digest", value] => digest(value),
        ["vectors", card] => vectors(card),
        ["sign-fixtures"] => sign_fixtures().await,
        ["verify-task", task, signer] => verify_task(task, signer, None).await,
        ["verify-task", task, signer, type_uri] => verify_task(task, signer, Some(type_uri)).await,
        ["verify-tasks", list, dir] => verify_tasks(list, dir).await,
        ["verify-statement", statement, card, expect] => verify_statement_against(statement, card, expect).await,
        ["verify-eligibility", vp, expect] => verify_eligibility(vp, expect).await,
        ["sign-eligibility"] => sign_eligibility().await,
        [card, expect] => run(card, expect).await,
        _ => {
            eprintln!(
                "usage: card-verify <card.json> <expect.json>\n       card-verify digest <value.json>\n       card-verify vectors <card.json>\n       card-verify sign-fixtures\n       card-verify verify-task <task.json> <expected-signer-did> [<expected-type>]\n       card-verify verify-tasks <tasks.json> <dir>\n       card-verify verify-statement <statement.json> <card.json> <expect.json>\n       card-verify verify-eligibility <vp.json> <expect.json>\n       card-verify sign-eligibility"
            );
            return ExitCode::from(2);
        }
    };
    match result {
        Ok(line) => {
            println!("{line}");
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}
