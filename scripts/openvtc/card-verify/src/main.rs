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
use vta_sdk::vetting::ticket_uri;

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

#[tokio::main]
async fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let argv: Vec<&str> = args.iter().map(String::as_str).collect();
    let result = match &argv[1..] {
        ["digest", value] => digest(value),
        ["vectors", card] => vectors(card),
        ["sign-fixtures"] => sign_fixtures().await,
        ["verify-statement", statement, card, expect] => verify_statement_against(statement, card, expect).await,
        [card, expect] => run(card, expect).await,
        _ => {
            eprintln!(
                "usage: card-verify <card.json> <expect.json>\n       card-verify digest <value.json>\n       card-verify vectors <card.json>\n       card-verify sign-fixtures\n       card-verify verify-statement <statement.json> <card.json> <expect.json>"
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
