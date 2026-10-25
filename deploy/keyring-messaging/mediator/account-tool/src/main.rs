//! Register the push gateway's account on its bundled mediator, and check that
//! the mediator is not an open relay.
//!
//! The mediator runs closed (`mediator_acl_mode = "explicit_allow"`): only a
//! DID with an account may log in, and only an admin may create one.
//!
//! `--add <gateway DID>` logs in as the mediator's admin (the profile
//! `mediator-setup` wrote as `admin-monitor.json`) and sends upstream's
//! `messaging/account/add` Trust Task for the gateway's DID, with the rights
//! the gateway needs:
//!
//! - an inbox (`local`), and `receiveMessages`: agents' wake-ups are delivered
//!   to it;
//! - `sendMessages` and `sendForwarded`: its replies are relayed back to the
//!   agents' mediators;
//! - `receiveForwarded`, for the double-forward shape;
//! - an open access list (`explicitDeny`, empty): any agent may deliver to it.
//!   The gateway authorises every document by its own proof.
//!
//! If the account already exists, its rights are set to the same values with
//! `messaging/account/update`, so running this twice is harmless.
//!
//! `--check-relay <third-party DID> --inbound <URL>` needs no login. It makes a
//! throwaway `did:key`, wraps a dummy message in a forward addressed to the
//! mediator with the third party as the next hop, authcrypts it from the
//! throwaway DID, and posts it to the mediator's `/inbound` with no token, as a
//! stranger would. It passes (exit 0) only if the mediator refuses it; exit 2
//! means the mediator relayed a stranger's forward, an open relay.
//!
//! ```sh
//! mediator-account --profile /run/secrets/mediator/admin-monitor.json --add <gateway DID>
//! mediator-account --profile /run/secrets/mediator/admin-monitor.json \
//!   --check-relay <any DID not on this mediator> --inbound https://<mediator host>/mediator/v1/inbound
//! ```
//!
//! About the admin profile: `mediator-setup` writes the admin's Ed25519 key
//! only, but logging in authcrypts from the admin's `did:key`, which needs the
//! X25519 key-agreement key that `did:key` derives from it. This tool derives
//! it (Ed25519 → X25519, the same conversion `did:key` uses) when the profile
//! lacks one.

use std::sync::Arc;

use affinidi_messaging_sdk::{ATM, config::ATMConfig, profiles::ATMProfile};
use affinidi_secrets_resolver::SecretsResolver;
use affinidi_secrets_resolver::secrets::{KeyType, Secret};
use affinidi_tdk::dids::{DID, KeyType as DidKeyType};
use affinidi_tdk_common::{TDKSharedState, config::TDKConfig, profiles::TDKProfile};
use trust_tasks_rs::specs::messaging::account;

const USAGE: &str = "usage: mediator-account --profile <admin profile JSON> \
    (--add <gateway DID> | --check-relay <third-party DID> --inbound <mediator /inbound URL>)";

/// The gateway's rights, in the wire form both `account/add` and
/// `account/update` take.
const GATEWAY_ACL: &str = r#"{
  "local": true,
  "sendMessages": true,
  "receiveMessages": true,
  "sendForwarded": true,
  "receiveForwarded": true,
  "accessListMode": "explicitDeny"
}"#;

#[tokio::main]
async fn main() {
    match run().await {
        Ok(code) => std::process::exit(code),
        Err(e) => {
            eprintln!("mediator-account: {e}");
            std::process::exit(1);
        }
    }
}

async fn run() -> Result<i32, String> {
    let mut profile_path = None;
    let mut gateway_did = None;
    let mut third_party = None;
    let mut inbound = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--profile" => profile_path = args.next(),
            "--add" => gateway_did = args.next(),
            "--check-relay" => third_party = args.next(),
            "--inbound" => inbound = args.next(),
            _ => return Err(USAGE.into()),
        }
    }
    let Some(profile_path) = profile_path else {
        return Err(USAGE.into());
    };

    let bytes =
        std::fs::read(&profile_path).map_err(|e| format!("read {profile_path}: {e}"))?;
    let mut admin: TDKProfile = serde_json::from_slice(&bytes)
        .map_err(|e| format!("{profile_path} is not a TDK profile: {e}"))?;
    let mediator_did = admin
        .mediator
        .clone()
        .ok_or_else(|| format!("{profile_path} names no mediator"))?;

    let config = TDKConfig::headless().map_err(|e| e.to_string())?;
    let tdk = TDKSharedState::new(config).await.map_err(|e| e.to_string())?;
    let atm_config = ATMConfig::builder().build().map_err(|e| e.to_string())?;
    let atm = ATM::new(atm_config, Arc::new(tdk))
        .await
        .map_err(|e| e.to_string())?;

    match (gateway_did, third_party, inbound) {
        (Some(gateway_did), None, None) => {
            let taken = admin.take_secrets();
            let secrets = with_key_agreement(&admin.did, taken)?;
            if secrets.is_empty() {
                return Err(format!("{profile_path} carries no secrets"));
            }
            atm.get_tdk().secrets_resolver().insert_vec(&secrets).await;
            add_gateway(&atm, &admin, &mediator_did, &gateway_did).await?;
            Ok(0)
        }
        (None, Some(third_party), Some(inbound)) => {
            check_relay(&atm, &mediator_did, &third_party, &inbound).await
        }
        _ => Err(USAGE.into()),
    }
}

/// A `did:key`'s secrets as a login needs them: the Ed25519 key, plus the
/// X25519 key-agreement key `did:key` derives from it, under the id the DID
/// document gives it (`did:key:z6Mk…#z6LS…`). Other DIDs are returned as they
/// are.
fn with_key_agreement(did: &str, mut secrets: Vec<Secret>) -> Result<Vec<Secret>, String> {
    if !did.starts_with("did:key:")
        || secrets.iter().any(|s| s.get_key_type() == KeyType::X25519)
    {
        return Ok(secrets);
    }
    let mut derived = Vec::new();
    for s in secrets.iter().filter(|s| s.get_key_type() == KeyType::Ed25519) {
        let mut x = s.to_x25519().map_err(|e| e.to_string())?;
        let fragment = x.get_public_keymultibase().map_err(|e| e.to_string())?;
        x.id = format!("{did}#{fragment}");
        derived.push(x);
    }
    secrets.extend(derived);
    Ok(secrets)
}

async fn add_gateway(
    atm: &ATM,
    admin: &TDKProfile,
    mediator_did: &str,
    gateway_did: &str,
) -> Result<(), String> {
    if !gateway_did.starts_with("did:") {
        return Err(format!("{gateway_did:?} is not a DID"));
    }
    let profile = ATMProfile::new(
        atm,
        Some(admin.alias.clone()),
        admin.did.clone(),
        Some(mediator_did.to_string()),
    )
    .await
    .map_err(|e| e.to_string())?;
    profile
        .dids()
        .map_err(|_| format!("could not reach mediator {mediator_did} as the admin"))?;
    let profile = atm
        .profile_add(&profile, true)
        .await
        .map_err(|e| format!("log in to {mediator_did} as the admin: {e}"))?;

    // Accounts are keyed by the SHA-256 of the DID.
    let hash = sha256::digest(gateway_did);
    let add_acl: account::add::v0_1::MediatorAcl =
        serde_json::from_str(GATEWAY_ACL).map_err(|e| e.to_string())?;
    let result = match atm
        .trust_tasks()
        .account_add(
            &profile,
            hash.clone(),
            account::add::v0_1::AccountType::Standard,
            Some(add_acl),
        )
        .await
    {
        Ok(account) => serde_json::to_value(&account).map_err(|e| e.to_string())?,
        Err(add_error) => {
            let update_acl: account::update::v0_1::MediatorAcl =
                serde_json::from_str(GATEWAY_ACL).map_err(|e| e.to_string())?;
            let account = atm
                .trust_tasks()
                .account_update(&profile, Some(hash.clone()), None, Some(update_acl), None)
                .await
                .map_err(|e| format!("account add failed ({add_error}), and update failed ({e})"))?;
            serde_json::to_value(&account).map_err(|e| e.to_string())?
        }
    };

    println!("gateway account registered on {mediator_did}");
    println!("  did:  {gateway_did}");
    println!("  hash: {hash}");
    println!(
        "{}",
        serde_json::to_string_pretty(&result).map_err(|e| e.to_string())?
    );
    Ok(())
}

/// Post a stranger's authcrypted forward, naming `third_party` as the next hop,
/// to the mediator's `/inbound` with no token. 0 = refused (good), 2 = relayed.
async fn check_relay(
    atm: &ATM,
    mediator_did: &str,
    third_party: &str,
    inbound: &str,
) -> Result<i32, String> {
    let (stranger, ed) =
        DID::generate_did_key(DidKeyType::Ed25519).map_err(|e| e.to_string())?;
    let secrets = with_key_agreement(&stranger, vec![ed])?;
    atm.get_tdk().secrets_resolver().insert_vec(&secrets).await;
    let profile = ATMProfile::new(
        atm,
        Some("relay-check".into()),
        stranger.clone(),
        Some(mediator_did.to_string()),
    )
    .await
    .map_err(|e| e.to_string())?;
    let profile = Arc::new(profile);

    let (_, packed) = atm
        .routing()
        .forward_message(
            &profile,
            false,
            r#"{"relay-check":"this should never be delivered"}"#,
            mediator_did,
            third_party,
            None,
            None,
        )
        .await
        .map_err(|e| format!("pack the forward: {e}"))?;

    let response = reqwest::Client::new()
        .post(inbound)
        .header("content-type", "application/didcomm-encrypted+json")
        .body(packed)
        .send()
        .await
        .map_err(|e| format!("post to {inbound}: {e}"))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let excerpt: String = body.chars().take(400).collect();

    println!("relay check: a stranger's forward to {third_party} via {mediator_did}");
    println!("  stranger: {stranger}");
    println!("  HTTP {status}: {excerpt}");
    if status.is_success() {
        println!("FAIL: the mediator accepted it. It relays for strangers (an open relay).");
        Ok(2)
    } else {
        println!("PASS: the mediator refused it.");
        Ok(0)
    }
}
