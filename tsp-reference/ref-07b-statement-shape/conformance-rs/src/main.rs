//! Feed Keyring's real VWC artifacts to the DTG reference implementation
//! (`dtg-credentials`, Glenn Gore / OpenVTC) and report what it makes of them.
//!
//! Cross-implementation conformance: Keyring hand-rolls its DTG credential
//! shapes on top of credo-ts; the Rust crate is the catalogue the VTC mints
//! from. If the two disagree about a wire shape, one of them is wrong, and it
//! is worth knowing which before arguing about a new credential type.

use dtg_credentials::DTGCredential;
use std::env;
use std::fs;

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    println!("harness: dtg-credentials 0.7 (see Cargo.lock)");
    for path in args {
        let label = path.rsplit('/').next().unwrap_or(&path).to_string();
        let raw = match fs::read_to_string(&path) {
            Ok(r) => r,
            Err(e) => {
                println!("{label}\tREAD-ERROR\t{e}");
                continue;
            }
        };
        let value: serde_json::Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(e) => {
                println!("{label}\tJSON-ERROR\t{e}");
                continue;
            }
        };
        // Fixture files wrap the credential; unwrap if wrapped.
        let cred = value.get("credential").cloned().unwrap_or(value);
        match serde_json::from_value::<DTGCredential>(cred) {
            Ok(c) => println!("{label}\tACCEPTED\ttype={:?}", c.type_()),
            Err(e) => println!("{label}\tREJECTED\t{e}"),
        }
    }
}
