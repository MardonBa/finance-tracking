//! Google sign-in for a desktop app (§3 step 1): system browser + PKCE +
//! loopback redirect on 127.0.0.1 with a random port. The code is exchanged at
//! Google's token endpoint for an ID token, which is then posted to the
//! backend's `POST /auth/google` for an app credential.
//!
//! GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are baked in at build time from the
//! gitignored root `.env` (see build.rs). For Google "Desktop app" clients the
//! secret is not confidential (Google's docs say so), PKCE protects the code.
//! TODO(revisit): the secret is compiled into the binary; fine for a Desktop
//! client, but drop it if the OAuth client type ever changes.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};

use reqwest::Url;
use serde::Deserialize;

use crate::pkce;

pub const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
pub const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
/// How long we wait for the browser to come back before giving up.
/// TODO(revisit): 5 minutes is a guess.
pub const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(5 * 60);

pub fn client_id() -> Option<&'static str> {
    option_env!("GOOGLE_CLIENT_ID").filter(|s| !s.is_empty())
}

fn client_secret() -> Option<&'static str> {
    option_env!("GOOGLE_CLIENT_SECRET").filter(|s| !s.is_empty())
}

/// The authorization URL the system browser opens.
pub fn authorization_url(client_id: &str, redirect_uri: &str, challenge: &str, state: &str) -> Url {
    Url::parse_with_params(
        AUTH_ENDPOINT,
        &[
            ("client_id", client_id),
            ("redirect_uri", redirect_uri),
            ("response_type", "code"),
            ("scope", "openid email"),
            ("code_challenge", challenge),
            ("code_challenge_method", "S256"),
            ("state", state),
            ("prompt", "select_account"),
        ],
    )
    .expect("static auth endpoint parses")
}

#[derive(Debug, PartialEq, Eq)]
pub enum Callback {
    Code(String),
    /// The user cancelled or Google returned an error (e.g. access_denied).
    Denied(String),
    /// Some other request to the loopback port (favicon, a stray probe).
    Ignore,
}

/// Parses the first line of the browser's request to the loopback server
/// (`GET /callback?code=…&state=… HTTP/1.1`). Rejects a mismatched `state`.
pub fn parse_callback(request_line: &str, expected_state: &str) -> Result<Callback, String> {
    let mut parts = request_line.split_whitespace();
    let (Some("GET"), Some(target)) = (parts.next(), parts.next()) else {
        return Ok(Callback::Ignore);
    };
    let url = Url::parse(&format!("http://127.0.0.1{target}")).map_err(|e| e.to_string())?;
    if url.path() != "/callback" {
        return Ok(Callback::Ignore);
    }
    let get = |name: &str| url.query_pairs().find(|(k, _)| k == name).map(|(_, v)| v.into_owned());
    if get("state").as_deref() != Some(expected_state) {
        return Err("Sign-in response did not match this request (state mismatch).".into());
    }
    if let Some(err) = get("error") {
        return Ok(Callback::Denied(err));
    }
    match get("code") {
        Some(code) if !code.is_empty() => Ok(Callback::Code(code)),
        _ => Err("Sign-in response had no authorization code.".into()),
    }
}

const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Finance Tracker</title>\
<body style=\"font-family:-apple-system,sans-serif;background:#f4ecd8;color:#14233f;display:grid;place-items:center;height:90vh\">\
<p>Signed in. You can close this tab and return to Finance Tracker.</p></body>";

fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.flush();
}

/// Waits on `listener` for the browser's redirect and returns the code.
fn wait_for_code(listener: &TcpListener, state: &str) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + SIGN_IN_TIMEOUT;
    loop {
        if Instant::now() > deadline {
            return Err("Sign-in timed out. Try again.".into());
        }
        let mut stream = match listener.accept() {
            Ok((s, _)) => s,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }
            Err(e) => return Err(e.to_string()),
        };
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        let mut line = String::new();
        if BufReader::new(&stream).read_line(&mut line).is_err() {
            continue;
        }
        match parse_callback(&line, state) {
            Ok(Callback::Ignore) => respond(&mut stream, "404 Not Found", ""),
            Ok(Callback::Code(code)) => {
                respond(&mut stream, "200 OK", DONE_PAGE);
                return Ok(code);
            }
            Ok(Callback::Denied(reason)) => {
                respond(&mut stream, "200 OK", "Sign-in was cancelled. You can close this tab.");
                return Err(format!("Google sign-in was cancelled ({reason})."));
            }
            Err(e) => {
                respond(&mut stream, "400 Bad Request", "Sign-in failed. You can close this tab.");
                return Err(e);
            }
        }
    }
}

#[derive(Deserialize)]
struct TokenResponse {
    id_token: Option<String>,
}

/// Response of the backend's `POST /auth/google`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppCredential {
    pub token: String,
}

/// The whole browser round trip. `open` launches the system browser.
/// Returns the app credential from the backend; the caller stores it.
pub async fn sign_in(api_url: &str, open: impl FnOnce(&str) -> Result<(), String>) -> Result<AppCredential, String> {
    let api = Url::parse(api_url).map_err(|_| "Invalid API URL.".to_string())?;
    if !matches!(api.scheme(), "http" | "https") {
        return Err("Invalid API URL.".into());
    }
    let client_id = client_id().ok_or("GOOGLE_CLIENT_ID was not set when this app was built (root .env).")?;
    let pkce = pkce::generate();
    let state = pkce::random_token(16);

    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");
    open(authorization_url(client_id, &redirect_uri, &pkce.challenge, &state).as_str())?;

    let state_for_thread = state.clone();
    let code = tauri::async_runtime::spawn_blocking(move || wait_for_code(&listener, &state_for_thread))
        .await
        .map_err(|e| e.to_string())??;

    let http = reqwest::Client::new();
    let mut form = vec![
        ("client_id", client_id),
        ("code", code.as_str()),
        ("code_verifier", pkce.verifier.as_str()),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect_uri.as_str()),
    ];
    if let Some(secret) = client_secret() {
        form.push(("client_secret", secret));
    }
    let token_res = http.post(TOKEN_ENDPOINT).form(&form).send().await.map_err(|e| e.to_string())?;
    if !token_res.status().is_success() {
        return Err(format!("Google rejected the sign-in ({}).", token_res.status()));
    }
    let id_token = token_res
        .json::<TokenResponse>()
        .await
        .map_err(|e| e.to_string())?
        .id_token
        .ok_or("Google returned no ID token.")?;

    let res = http
        .post(api.join("auth/google").map_err(|e| e.to_string())?)
        .json(&serde_json::json!({ "idToken": id_token, "label": "desktop" }))
        .send()
        .await
        .map_err(|e| format!("Could not reach the backend: {e}"))?;
    match res.status().as_u16() {
        200 => res.json::<AppCredential>().await.map_err(|e| e.to_string()),
        403 => Err("This Google account isn't allowed to use this app.".into()),
        401 => Err("Google sign-in expired before it reached the backend. Try again.".into()),
        s => Err(format!("The backend refused sign-in ({s}).")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authorization_url_carries_pkce_and_loopback_redirect() {
        let url = authorization_url("cid.apps.googleusercontent.com", "http://127.0.0.1:5555/callback", "CHAL", "STATE");
        let q: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(url.host_str(), Some("accounts.google.com"));
        assert_eq!(q["code_challenge"], "CHAL");
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["redirect_uri"], "http://127.0.0.1:5555/callback");
        assert_eq!(q["response_type"], "code");
        assert_eq!(q["state"], "STATE");
        assert!(q["scope"].contains("openid"));
        assert!(!q.contains_key("client_secret"));
    }

    #[test]
    fn parses_code_and_checks_state() {
        assert_eq!(
            parse_callback("GET /callback?state=abc&code=4%2F0xyz HTTP/1.1\r\n", "abc"),
            Ok(Callback::Code("4/0xyz".into()))
        );
        assert!(parse_callback("GET /callback?state=evil&code=x HTTP/1.1", "abc").is_err());
        assert!(parse_callback("GET /callback?code=x HTTP/1.1", "abc").is_err());
    }

    #[test]
    fn reports_denied_and_ignores_strays() {
        assert_eq!(
            parse_callback("GET /callback?state=abc&error=access_denied HTTP/1.1", "abc"),
            Ok(Callback::Denied("access_denied".into()))
        );
        assert_eq!(parse_callback("GET /favicon.ico HTTP/1.1", "abc"), Ok(Callback::Ignore));
        assert_eq!(parse_callback("POST /callback HTTP/1.1", "abc"), Ok(Callback::Ignore));
        assert_eq!(parse_callback("", "abc"), Ok(Callback::Ignore));
    }

    #[test]
    fn missing_code_is_an_error() {
        assert!(parse_callback("GET /callback?state=abc HTTP/1.1", "abc").is_err());
    }
}
