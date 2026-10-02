//! Open a `push-gateway` provision bundle into the identity file
//! vti-push-gateway reads (`GATEWAY_IDENTITY_FILE`).
//!
//! `pnm bootstrap open` does not do this. For a `TemplateBootstrap` payload it
//! prints a summary and writes nothing, and it deletes the single-use seed
//! first (VTI `pnm-cli/src/bootstrap.rs` `run_open` →
//! `vta-cli-common/src/sealed_consumer.rs` `consume_secret`). Running it on a
//! gateway bundle destroys the gateway's keys. VTI leaves the install step to
//! each integration (`docs/02-vta/provision-integration.md`, "Phase 3"), and the
//! gateway has none, so this tool is that step.
//!
//! It never deletes or modifies the seed or the bundle, and never prints a
//! private key.
//!
//! ```sh
//! gateway-identity --bundle bundle.armor --seed <bundle_id>.key \
//!   --digest <sha256 from the provisioner> --mediator <mediator DID> \
//!   --out secrets/gateway-identity.json
//! ```

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;

use serde_json::json;
use vta_sdk::sealed_transfer::{armor, ed25519_seed_to_x25519_secret, open_bundle, SealedPayloadV1};

struct Args {
    bundle: PathBuf,
    seed: PathBuf,
    digest: String,
    mediator: String,
    out: PathBuf,
}

fn parse_args() -> Result<Args, String> {
    let usage = "usage: gateway-identity --bundle <file> --seed <file> --digest <hex> \
                 --mediator <did> --out <file>";
    let mut it = std::env::args().skip(1);
    let (mut bundle, mut seed, mut digest, mut mediator, mut out) = (None, None, None, None, None);
    while let Some(flag) = it.next() {
        let value = it.next().ok_or_else(|| format!("{flag} needs a value\n{usage}"))?;
        match flag.as_str() {
            "--bundle" => bundle = Some(PathBuf::from(value)),
            "--seed" => seed = Some(PathBuf::from(value)),
            "--digest" => digest = Some(value),
            "--mediator" => mediator = Some(value),
            "--out" => out = Some(PathBuf::from(value)),
            _ => return Err(format!("unknown flag {flag}\n{usage}")),
        }
    }
    let missing = |name: &str| format!("missing {name}\n{usage}");
    Ok(Args {
        bundle: bundle.ok_or_else(|| missing("--bundle"))?,
        seed: seed.ok_or_else(|| missing("--seed"))?,
        digest: digest.ok_or_else(|| missing("--digest"))?,
        mediator: mediator.ok_or_else(|| missing("--mediator"))?,
        out: out.ok_or_else(|| missing("--out"))?,
    })
}

/// (did, signing key id, signing private key, key-agreement key id, ka private key)
type Material = (String, String, String, String, String);

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = parse_args()?;
    if !args.mediator.starts_with("did:") {
        return Err("--mediator must be the mediator's DID".into());
    }
    if args.out.exists() {
        return Err(format!("{} exists; refusing to overwrite", args.out.display()).into());
    }

    let armored = fs::read_to_string(&args.bundle)?;
    let bundles = armor::decode(&armored)?;
    if bundles.len() != 1 {
        return Err(format!("expected one bundle, found {}", bundles.len()).into());
    }
    let seed_bytes = fs::read(&args.seed)?;
    let seed: [u8; 32] = seed_bytes
        .as_slice()
        .try_into()
        .map_err(|_| format!("seed must be 32 bytes, found {}", seed_bytes.len()))?;
    let x_secret = ed25519_seed_to_x25519_secret(&seed);
    // The digest is required: it is the out-of-band trust anchor.
    let opened = open_bundle(&x_secret, &bundles[0], Some(&args.digest))?;

    let (template, materials): (String, Vec<Material>) = match opened.payload {
        SealedPayloadV1::TemplateBootstrap(p) => (
            p.config.template_name.clone(),
            p.secrets
                .into_values()
                .map(|m| {
                    (
                        m.did,
                        m.signing_key.key_id,
                        m.signing_key.private_key_multibase,
                        m.ka_key.key_id,
                        m.ka_key.private_key_multibase,
                    )
                })
                .collect(),
        ),
        SealedPayloadV1::TemplateBootstrapV2(p) => {
            // The identity file holds one signing key. A DID document that
            // publishes extra signing keys would advertise keys the gateway
            // cannot sign with (the mediator's setup tool projects them for the
            // same reason: affinidi-tdk-rs mediator-setup/src/main.rs,
            // build_did_secrets_bundle), so refuse rather than drop them.
            if p.secrets.values().any(|m| !m.additional_signing_keys.is_empty()) {
                return Err("bundle carries additional signing keys; the gateway's \
                            identity file cannot hold them"
                    .into());
            }
            (
            p.config.template_name.clone(),
            p.secrets
                .into_values()
                .map(|m| {
                    (
                        m.did,
                        m.signing_key.key_id,
                        m.signing_key.private_key_multibase,
                        m.ka_key.key_id,
                        m.ka_key.private_key_multibase,
                    )
                })
                .collect(),
            )
        }
        _ => return Err("not a TemplateBootstrap bundle".into()),
    };
    if template != "push-gateway" {
        return Err(format!("bundle is for template '{template}', not push-gateway").into());
    }
    let [(did, sig_id, sig_priv, ka_id, ka_priv)]: [Material; 1] = materials
        .try_into()
        .map_err(|v: Vec<Material>| format!("expected secrets for one DID, found {}", v.len()))?;
    for (id, what) in [(&sig_id, "signing"), (&ka_id, "key-agreement")] {
        if !id.starts_with(&format!("{did}#")) {
            return Err(format!("{what} key id {id} is not a fragment of {did}").into());
        }
    }

    let identity = json!({
        "did": did,
        "signing": { "id": sig_id, "privateKeyMultibase": sig_priv },
        "keyAgreement": { "id": ka_id, "privateKeyMultibase": ka_priv },
        "mediator": args.mediator,
    });
    let mut f = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&args.out)?;
    f.write_all(serde_json::to_string_pretty(&identity)?.as_bytes())?;
    f.write_all(b"\n")?;

    println!("wrote {} (0600)", args.out.display());
    println!("  did:          {did}");
    println!("  signing:      {sig_id}");
    println!("  keyAgreement: {ka_id}");
    println!("  mediator:     {}", args.mediator);
    println!("The seed and the bundle were not modified.");
    Ok(())
}
