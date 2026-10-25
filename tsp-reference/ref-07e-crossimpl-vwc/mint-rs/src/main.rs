//! ref-07e mint-rs — drive the DTG reference implementation (`dtg-credentials`)
//! from the command line so a JavaScript rung can talk to it.
//!
//! Four subcommands, each one line of output or one file:
//!
//!   mint <out.json>                 mint + sign a VWC with the crate's own
//!                                   constructor and signer (eddsa-jcs-2022)
//!   verify <cred.json> <pubkey-mb>  verify a credential we signed in JS
//!   digest <cred.json>              the crate's digestMultibase of a credential
//!   verify-digest <vwc> <referenced> the crate's own digest comparison
//!
//! Nothing here reimplements anything: every operation is a call into the
//! published crate.

use affinidi_tdk::dids::{DID, KeyType};
use anyhow::{Result, anyhow};
use chrono::{Duration, Utc};
use dtg_credentials::{DTGCredential, WitnessContext};
use std::{env, fs};

/// Ed25519 public key bytes out of a `did:key` identifier.
fn pubkey_from_did_key(did: &str) -> Result<Vec<u8>> {
    let mb = did
        .strip_prefix("did:key:")
        .ok_or_else(|| anyhow!("not a did:key: {did}"))?
        .split('#')
        .next()
        .unwrap();
    let (_base, bytes) = multibase::decode(mb)?;
    // multicodec ed25519-pub = 0xed 0x01, then 32 key bytes
    if bytes.len() < 2 || bytes[0] != 0xed {
        return Err(anyhow!("not an ed25519-pub multicodec"));
    }
    Ok(bytes[2..].to_vec())
}

fn load(path: &str) -> Result<DTGCredential> {
    let raw = fs::read_to_string(path)?;
    let v: serde_json::Value = serde_json::from_str(&raw)?;
    let inner = v.get("credential").cloned().unwrap_or(v);
    Ok(serde_json::from_value(inner)?)
}

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = env::args().skip(1).collect();
    let cmd = args.first().map(String::as_str).unwrap_or("");

    match cmd {
        "mint" => {
            let out = args.get(1).ok_or_else(|| anyhow!("mint needs an out path"))?;

            // An ephemeral issuer. The public key travels inside the did:key,
            // so the JS side needs nothing else to verify.
            let (issuer_did, issuer_secret) = DID::generate_did_key(KeyType::Ed25519)?;

            let now = Utc::now();
            let mut vwc = DTGCredential::new_vwc(
                issuer_did.clone(),
                "did:example:observed-party".to_string(),
                now,
                Some(now + Duration::days(7)),
                "urn:uuid:5e5510f0-0000-4000-8000-000000000001".to_string(),
                Some("zQmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n".to_string()),
                // The same three members Keyring's witness-server already emits.
                Some(WitnessContext {
                    event: Some("ref-07e cross-implementation".to_string()),
                    session_id: Some("urn:uuid:5e5510f0-0000-4000-8000-000000000001".to_string()),
                    method: Some("session-based-challenge".to_string()),
                }),
            );
            vwc.sign(&issuer_secret, Some(now)).await?;

            let doc = serde_json::json!({
                "_provenance": "Minted and signed by dtg-credentials 0.7.0 via DTGCredential::new_vwc + .sign() — the reference implementation's own wire shape, not Keyring's.",
                "issuerDid": issuer_did,
                "publicKeyBytesHex": hex(&pubkey_from_did_key(&issuer_did)?),
                "credential": serde_json::to_value(&vwc)?,
            });
            fs::write(out, serde_json::to_string_pretty(&doc)? + "\n")?;
            println!("MINTED\t{out}\t{issuer_did}");
        }
        "verify" => {
            let path = args.get(1).ok_or_else(|| anyhow!("verify needs a path"))?;
            let did = args.get(2).ok_or_else(|| anyhow!("verify needs the issuer did:key"))?;
            let cred = load(path)?;
            let pk = pubkey_from_did_key(did)?;
            match cred.verify_proof_with_public_key(&pk) {
                Ok(()) => println!("VERIFIED\t{path}"),
                Err(e) => println!("NOT-VERIFIED\t{path}\t{e}"),
            }
        }
        "digest-json" => {
            // digest_multibase_json works on any JSON document, so it can digest a
            // credential the catalogue cannot parse — e.g. one signed with
            // Ed25519Signature2018, which every captured Keyring VRC is.
            let path = args.get(1).ok_or_else(|| anyhow!("digest-json needs a path"))?;
            let raw = fs::read_to_string(path)?;
            let v: serde_json::Value = serde_json::from_str(&raw)?;
            let inner = v.get("credential").cloned().unwrap_or(v);
            match dtg_credentials::digest_multibase_json(&inner) {
                Ok(d) => println!("DIGEST\t{path}\t{d}"),
                Err(e) => println!("DIGEST-ERROR\t{path}\t{e}"),
            }
        }
        "digest" => {
            let path = args.get(1).ok_or_else(|| anyhow!("digest needs a path"))?;
            let cred = load(path)?;
            match cred.digest_multibase() {
                Ok(d) => println!("DIGEST\t{path}\t{d}"),
                Err(e) => println!("DIGEST-ERROR\t{path}\t{e}"),
            }
        }
        "verify-digest" => {
            let vwc = load(args.get(1).ok_or_else(|| anyhow!("need vwc path"))?)?;
            let referenced = load(args.get(2).ok_or_else(|| anyhow!("need referenced path"))?)?;
            match vwc.verify_digest(&referenced) {
                Ok(true) => println!("DIGEST-MATCH"),
                Ok(false) => println!("DIGEST-MISMATCH"),
                Err(e) => println!("DIGEST-ERROR\t{e}"),
            }
        }
        other => return Err(anyhow!("unknown subcommand: {other:?}")),
    }
    Ok(())
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}
