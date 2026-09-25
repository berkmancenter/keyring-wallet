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
use vta_sdk::vetting::statement::verify_statement;

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
        ["verify-statement", statement, card, expect] => verify_statement_against(statement, card, expect).await,
        [card, expect] => run(card, expect).await,
        _ => {
            eprintln!(
                "usage: card-verify <card.json> <expect.json>\n       card-verify digest <value.json>\n       card-verify verify-statement <statement.json> <card.json> <expect.json>"
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
