//! PKCE (RFC 7636) and OAuth `state` generation. Pure apart from the random
//! bytes, which come from the OS RNG.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone)]
pub struct Pkce {
    /// Sent only to the token endpoint, never to the browser.
    pub verifier: String,
    /// S256 challenge sent in the authorization URL.
    pub challenge: String,
}

/// base64url (no padding) of `n` random bytes.
pub fn random_token(n: usize) -> String {
    let mut bytes = vec![0u8; n];
    getrandom::fill(&mut bytes).expect("OS random number generator failed");
    URL_SAFE_NO_PAD.encode(bytes)
}

/// S256 code challenge for a verifier: base64url(sha256(verifier)).
pub fn challenge_for(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// A fresh verifier (32 random bytes -> 43 chars, within RFC 7636's 43..=128)
/// and its S256 challenge.
pub fn generate() -> Pkce {
    let verifier = random_token(32);
    let challenge = challenge_for(&verifier);
    Pkce { verifier, challenge }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_rfc7636_appendix_b_vector() {
        assert_eq!(
            challenge_for("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn verifier_uses_only_unreserved_chars_and_valid_length() {
        for _ in 0..50 {
            let p = generate();
            assert!((43..=128).contains(&p.verifier.len()), "len {}", p.verifier.len());
            assert!(p.verifier.chars().all(|c| c.is_ascii_alphanumeric() || "-._~".contains(c)));
            assert_eq!(p.challenge, challenge_for(&p.verifier));
            assert_eq!(p.challenge.len(), 43);
        }
    }

    #[test]
    fn verifiers_are_unique() {
        let a = generate();
        let b = generate();
        assert_ne!(a.verifier, b.verifier);
        assert_ne!(random_token(16), random_token(16));
    }
}
