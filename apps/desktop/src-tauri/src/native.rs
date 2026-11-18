//! macOS-only native pieces: Touch ID (LocalAuthentication) and the Keychain.
//! Other platforms get stubs that fail, so the crate still type-checks there.

// TODO(revisit): the Keychain item has no user-presence access control
// (kSecAccessControlUserPresence needs the data-protection keychain, i.e. a
// signed app with a keychain-access-groups entitlement). Reads are gated in
// Rust instead: `get_credential` refuses unless Touch ID unlocked the session.

/// Keychain service/account names for the app credential.
pub const KEYCHAIN_SERVICE: &str = "com.personal.financetracker.app-credential";
pub const KEYCHAIN_ACCOUNT: &str = "backend";

#[cfg(target_os = "macos")]
mod mac {
    use std::sync::mpsc;

    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSError, NSString};
    use objc2_local_authentication::{LAContext, LAPolicy};
    use security_framework::item::{ItemClass, ItemSearchOptions};
    use security_framework::passwords;

    use super::{KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE};

    const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

    /// Touch ID with the macOS password as fallback (deviceOwnerAuthentication).
    /// Blocks until the user answers; call from a blocking thread.
    pub fn authenticate(reason: &str) -> Result<(), String> {
        let (tx, rx) = mpsc::channel::<Result<(), String>>();
        // SAFETY: LAContext is used from this thread only; the reply block is
        // called once by LocalAuthentication on its own queue.
        unsafe {
            let ctx = LAContext::new();
            let policy = LAPolicy::DeviceOwnerAuthentication;
            if let Err(err) = ctx.canEvaluatePolicy_error(policy) {
                return Err(format!("Touch ID / password isn't available: {}", err.localizedDescription()));
            }
            let block = RcBlock::new(move |success: Bool, error: *mut NSError| {
                let result = if success.as_bool() {
                    Ok(())
                } else if let Some(err) = error.as_ref() {
                    Err(err.localizedDescription().to_string())
                } else {
                    Err("Authentication failed.".to_string())
                };
                let _ = tx.send(result);
            });
            ctx.evaluatePolicy_localizedReason_reply(policy, &NSString::from_str(reason), &block);
            rx.recv().unwrap_or_else(|_| Err("Authentication was interrupted.".into()))
        }
    }

    pub fn has_credential() -> bool {
        ItemSearchOptions::new()
            .class(ItemClass::generic_password())
            .service(KEYCHAIN_SERVICE)
            .account(KEYCHAIN_ACCOUNT)
            .load_attributes(true)
            .search()
            .map(|r| !r.is_empty())
            .unwrap_or(false)
    }

    pub fn read_credential() -> Result<Option<String>, String> {
        match passwords::get_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) {
            Ok(bytes) => String::from_utf8(bytes).map(Some).map_err(|_| "Stored credential is corrupt.".into()),
            Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn write_credential(token: &str) -> Result<(), String> {
        passwords::set_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, token.as_bytes()).map_err(|e| e.to_string())
    }

    pub fn delete_credential() -> Result<(), String> {
        match passwords::delete_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(target_os = "macos")]
pub use mac::*;

#[cfg(not(target_os = "macos"))]
mod other {
    const UNSUPPORTED: &str = "Only macOS is supported.";
    pub fn authenticate(_reason: &str) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }
    pub fn has_credential() -> bool {
        false
    }
    pub fn read_credential() -> Result<Option<String>, String> {
        Err(UNSUPPORTED.into())
    }
    pub fn write_credential(_token: &str) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }
    pub fn delete_credential() -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }
}

#[cfg(not(target_os = "macos"))]
pub use other::*;
