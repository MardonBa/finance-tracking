use std::path::PathBuf;

/// Keys copied from the repo-root `.env` (gitignored) into compile-time env
/// vars, read in `oauth.rs` with `option_env!`. An already-set environment
/// variable wins over the file. Values are never printed.
const BUILD_TIME_KEYS: [&str; 2] = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];

fn main() {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let dotenv = manifest.join("../../../.env");
    println!("cargo:rerun-if-changed={}", dotenv.display());
    let file = std::fs::read_to_string(&dotenv).unwrap_or_default();
    for key in BUILD_TIME_KEYS {
        println!("cargo:rerun-if-env-changed={key}");
        let value = std::env::var(key).ok().filter(|v| !v.is_empty()).or_else(|| {
            file.lines().find_map(|line| {
                let (k, v) = line.split_once('=')?;
                (k.trim() == key).then(|| v.trim().trim_matches('"').trim_matches('\'').to_string())
            })
        });
        if let Some(v) = value.filter(|v| !v.is_empty()) {
            println!("cargo:rustc-env={key}={v}");
        }
    }
    // generate_context! bakes the icons in (dev sets the Dock icon from
    // icon.icns) but doesn't tell Cargo, so a new icon wouldn't rebuild.
    println!("cargo:rerun-if-changed={}", manifest.join("icons").display());
    tauri_build::build()
}
