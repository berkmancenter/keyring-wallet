//! card-verify-v047 — upstream judges what Keyring writes in DTG Credentials v1.
//!
//! The VTI SDK at the 0.47 pin (vta-sdk 0.58; dtg-credentials 0.12.0) runs the
//! checks an openvtc applicant on 0.47 runs on a vetting statement:
//! `verify_statement` (strict DTG parse: the v1 context in order, one concrete
//! subtype, issuerScope; the vetted/1 predicate and its strict object.value;
//! one assertionMethod proof by the issuer), then `check_against_card` (the
//! statement is about this Vetting Card) and `check_against_session` (its
//! taskContext and taskDigestMultibase bind the session document).
//!
//! card-verify-v047 <card.json> <expect.json>
//!   vta-sdk verify_card on a Keyring Vetting Card (expect.json as card-verify's).
//! card-verify-v047 verify-statement <statement.json> <card.json> <session.json> <expect.json>
//!   the card as above, then the three statement checks.
//!
//! Exit 0 and one OK line when upstream accepts; non-zero and REFUSED with
//! upstream's own error otherwise. The main-pin checker is ../card-verify.

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
        .map_err(|e| format!("REFUSED (card): {e} — {e:?}"))
}

async fn verify_card_only(card_path: &str, expect_path: &str) -> Result<String, String> {
    let verified = verified_card(&read(card_path)?, &read(expect_path)?).await?;
    Ok(format!("OK: card accepted by vta-sdk 0.58 verify_card (digest {})", verified.digest_multibase()))
}

async fn verify_statement_v1(
    statement_path: &str,
    card_path: &str,
    session_path: &str,
    expect_path: &str,
) -> Result<String, String> {
    let statement = read(statement_path)?;
    let session = read(session_path)?;
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
        .map_err(|e| format!("REFUSED (verify_statement): {e} — {e:?}"))?;
    verified
        .check_against_card(&card)
        .map_err(|e| format!("REFUSED (check_against_card): {e} — {e:?}"))?;
    verified
        .check_against_session(&session)
        .map_err(|e| format!("REFUSED (check_against_session): {e} — {e:?}"))?;
    Ok(format!(
        "OK: vetted/1 statement accepted by vta-sdk 0.58 verify_statement + check_against_card + check_against_session (card digest {})",
        card.digest_multibase()
    ))
}

#[tokio::main]
async fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let argv: Vec<&str> = args.iter().map(String::as_str).collect();
    let result = match &argv[1..] {
        ["verify-statement", statement, card, session, expect] => {
            verify_statement_v1(statement, card, session, expect).await
        }
        [card, expect] => verify_card_only(card, expect).await,
        _ => {
            eprintln!(
                "usage: card-verify-v047 <card.json> <expect.json>\n       card-verify-v047 verify-statement <statement.json> <card.json> <session.json> <expect.json>"
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
