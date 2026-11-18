use reqwest::header::{ACCEPT, CACHE_CONTROL, USER_AGENT};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchedCalendarFeed {
    pub original_url: String,
    pub normalized_url: String,
    pub provider: String,
    pub calendar_name: String,
    pub ics_text: String,
}

/// Normalizes a calendar feed URL:
/// - Automatically converts Apple iCloud's `webcal://` (and `webcals://`) scheme to `https://`
/// - Validates that the resulting URL starts with `https://` or `http://`
pub fn normalize_calendar_url(raw_url: &str) -> Result<String, String> {
    let trimmed = raw_url.trim();
    if trimmed.is_empty() {
        return Err("Calendar URL is empty.".to_string());
    }

    let lower = trimmed.to_ascii_lowercase();
    let normalized = if lower.starts_with("webcal://") {
        format!("https://{}", &trimmed["webcal://".len()..])
    } else if lower.starts_with("webcals://") {
        format!("https://{}", &trimmed["webcals://".len()..])
    } else if lower.starts_with("http://") || lower.starts_with("https://") {
        trimmed.to_string()
    } else {
        return Err("Invalid URL scheme. Must start with https://, http://, or webcal://".to_string());
    };

    // Ensure there is a host after the scheme
    let without_scheme = normalized
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or("");
    if without_scheme.is_empty() || without_scheme.starts_with('/') {
        return Err("Invalid calendar URL: missing hostname.".to_string());
    }

    Ok(normalized)
}

/// Automatically detects the calendar provider from the URL.
pub fn detect_calendar_provider(raw_url: &str) -> String {
    let lower = raw_url.trim().to_ascii_lowercase();
    if lower.contains("icloud.com")
        || lower.contains("apple.com")
        || lower.starts_with("webcal://")
        || lower.starts_with("webcals://")
    {
        "Apple iCloud".to_string()
    } else if lower.contains("google.com") || lower.contains("googleusercontent.com") {
        "Google Calendar".to_string()
    } else if lower.contains("outlook.live.com")
        || lower.contains("outlook.office365.com")
        || lower.contains("office.com")
        || lower.contains("microsoft.com")
    {
        "Outlook".to_string()
    } else {
        "iCal (.ics)".to_string()
    }
}

/// Extracts `X-WR-CALNAME` from the raw `.ics` header if available.
fn extract_calendar_name(ics_text: &str, fallback_provider: &str) -> String {
    for line in ics_text.lines().take(80) {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("X-WR-CALNAME:") {
            let name = rest.trim();
            if !name.is_empty() {
                return name.to_string();
            }
        }
    }
    fallback_provider.to_string()
}

/// Tauri command: Normalizes `webcal://` to `https://` and fetches the `.ics` feed using `reqwest`.
#[tauri::command]
pub async fn fetch_calendar_ics_feed(raw_url: String) -> Result<FetchedCalendarFeed, String> {
    let provider = detect_calendar_provider(&raw_url);
    let normalized_url = normalize_calendar_url(&raw_url)?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let response = client
        .get(&normalized_url)
        .header(USER_AGENT, "Local-Planner-Desktop/1.0")
        .header(ACCEPT, "text/calendar, text/plain, */*")
        .header(CACHE_CONTROL, "no-cache")
        .send()
        .await
        .map_err(|e| format!("Fetch Error: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "Fetch Error (HTTP {} {})",
            status.as_u16(),
            status.canonical_reason().unwrap_or("Error")
        ));
    }

    let ics_text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))?;

    if !ics_text.contains("BEGIN:VCALENDAR") {
        return Err("Invalid .ics content (missing BEGIN:VCALENDAR)".to_string());
    }

    let calendar_name = extract_calendar_name(&ics_text, &provider);

    Ok(FetchedCalendarFeed {
        original_url: raw_url.trim().to_string(),
        normalized_url,
        provider,
        calendar_name,
        ics_text,
    })
}
