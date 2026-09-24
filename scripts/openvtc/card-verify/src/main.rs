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

use std::process::ExitCode;

use affinidi_did_resolver_cache_sdk::DIDCacheClient;
use affinidi_did_resolver_cache_sdk::config::DIDCacheConfigBuilder;
use affinidi_did_resolver_cache_sdk::network_resolvers::HostPolicy;
use chrono::{DateTime, Duration, Utc};
use serde_json::Value;
use vta_sdk::trust_task_proof::TrustTaskVmResolver;
use vta_sdk::vetting::card::{CardExpectations, verify_card};

fn read(path: &str) -> Result<Value, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("{path}: {e}"))
}

fn field<'a>(v: &'a Value, name: &str) -> Result<&'a str, String> {
    v.get(name).and_then(Value::as_str).ok_or_else(|| format!("expect.json: missing \"{name}\""))
}

async fn run(card_path: &str, expect_path: &str) -> Result<String, String> {
    let card = read(card_path)?;
    let expect = read(expect_path)?;
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
    let publisher = field(&expect, "publisher")?;
    let resolver = if publisher.starts_with("did:key:") {
        TrustTaskVmResolver::did_key_only()
    } else {
        let config = DIDCacheConfigBuilder::default().with_host_policy(HostPolicy::PublicOnly).build();
        let client = DIDCacheClient::new(config).await.map_err(|e| format!("resolver: {e}"))?;
        TrustTaskVmResolver::new(client)
    };
    let expectations = CardExpectations {
        audience: field(&expect, "audience")?,
        publisher,
        community: field(&expect, "community")?,
        challenge: field(&expect, "challenge")?,
        domain: field(&expect, "domain")?,
        required_claims: &required,
        now,
    };
    let verified = verify_card(&card, &expectations, &resolver)
        .await
        .map_err(|e| format!("REFUSED: {e} — {e:?}"))?;
    Ok(format!("OK: card accepted by vta-sdk verify_card (digest {})", verified.digest_multibase()))
}

#[tokio::main]
async fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        eprintln!("usage: card-verify <card.json> <expect.json>");
        return ExitCode::from(2);
    }
    match run(&args[1], &args[2]).await {
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
