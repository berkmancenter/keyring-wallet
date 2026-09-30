//! Register the push gateway's account on its bundled mediator.
//!
//! The mediator runs closed (`mediator_acl_mode = "explicit_allow"`): only a
//! DID with an account may log in, and only an admin may create one. This logs
//! in as the mediator's admin (the profile `mediator-setup` wrote as
//! `admin-monitor.json`) and sends upstream's `messaging/account/add` Trust
//! Task for the gateway's DID, with the rights the gateway needs:
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
//! ```sh
//! mediator-account --profile /run/secrets/mediator/admin-monitor.json --add <gateway DID>
//! ```

use std::sync::Arc;

use affinidi_messaging_sdk::{ATM, config::ATMConfig, profiles::ATMProfile};
use affinidi_secrets_resolver::SecretsResolver;
use affinidi_tdk_common::{TDKSharedState, config::TDKConfig, profiles::TDKProfile};
use trust_tasks_rs::specs::messaging::account;

const USAGE: &str = "usage: mediator-account --profile <admin profile JSON> --add <gateway DID>";

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
    if let Err(e) = run().await {
        eprintln!("mediator-account: {e}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), String> {
    let mut profile_path = None;
    let mut gateway_did = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--profile" => profile_path = args.next(),
            "--add" => gateway_did = args.next(),
            _ => return Err(USAGE.into()),
        }
    }
    let (Some(profile_path), Some(gateway_did)) = (profile_path, gateway_did) else {
        return Err(USAGE.into());
    };
    if !gateway_did.starts_with("did:") {
        return Err(format!("{gateway_did:?} is not a DID"));
    }

    let bytes =
        std::fs::read(&profile_path).map_err(|e| format!("read {profile_path}: {e}"))?;
    let mut admin: TDKProfile = serde_json::from_slice(&bytes)
        .map_err(|e| format!("{profile_path} is not a TDK profile: {e}"))?;
    let secrets = admin.take_secrets();
    if secrets.is_empty() {
        return Err(format!("{profile_path} carries no secrets"));
    }
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
    atm.get_tdk().secrets_resolver().insert_vec(&secrets).await;

    let profile = ATMProfile::new(
        &atm,
        Some(admin.alias.clone()),
        admin.did.clone(),
        Some(mediator_did.clone()),
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
    let hash = sha256::digest(gateway_did.as_str());
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
