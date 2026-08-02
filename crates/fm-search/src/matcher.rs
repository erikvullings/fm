//! Filename matching: plain substring and a small hand-rolled glob (spec §24).
//!
//! Only filename matching ships in this task; size/date/type filters and
//! content search are designed for but explicitly deferred (spec §24).

/// How a query string is matched against an entry's display name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MatchMode {
    /// Case-insensitive substring containment.
    Substring,
    /// Case-insensitive glob with `*` (any run of characters) and `?` (any
    /// single character) wildcards.
    Glob,
}

/// Chooses [`MatchMode::Glob`] when `query` contains a wildcard character,
/// otherwise [`MatchMode::Substring`].
#[must_use]
pub fn detect_match_mode(query: &str) -> MatchMode {
    if query.contains('*') || query.contains('?') {
        MatchMode::Glob
    } else {
        MatchMode::Substring
    }
}

/// Reports whether `name` matches `query` under `mode`.
///
/// Comparisons use [`str::to_lowercase`], which is Unicode-aware (not an
/// ASCII-only lowercasing), so non-ASCII queries and filenames compare
/// correctly.
#[must_use]
pub fn matches_name(name: &str, query: &str, mode: MatchMode) -> bool {
    let name = name.to_lowercase();
    let query = query.to_lowercase();
    match mode {
        MatchMode::Substring => name.contains(&query),
        MatchMode::Glob => glob_match(&name, &query),
    }
}

/// Classic iterative wildcard matcher supporting `*` and `?`.
///
/// Operates on `char`s rather than bytes so multi-byte UTF-8 sequences are
/// never split mid-character.
fn glob_match(name: &str, pattern: &str) -> bool {
    let name: Vec<char> = name.chars().collect();
    let pattern: Vec<char> = pattern.chars().collect();
    let (mut n, mut p) = (0usize, 0usize);
    let mut star: Option<usize> = None;
    let mut match_from = 0usize;

    while n < name.len() {
        if p < pattern.len() && (pattern[p] == '?' || pattern[p] == name[n]) {
            n += 1;
            p += 1;
        } else if p < pattern.len() && pattern[p] == '*' {
            star = Some(p);
            match_from = n;
            p += 1;
        } else if let Some(star_index) = star {
            p = star_index + 1;
            match_from += 1;
            n = match_from;
        } else {
            return false;
        }
    }
    while p < pattern.len() && pattern[p] == '*' {
        p += 1;
    }
    p == pattern.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_glob_mode_only_when_a_wildcard_is_present() {
        assert_eq!(detect_match_mode("report"), MatchMode::Substring);
        assert_eq!(detect_match_mode("report*"), MatchMode::Glob);
        assert_eq!(detect_match_mode("rep?rt"), MatchMode::Glob);
    }

    #[test]
    fn substring_matching_is_case_insensitive() {
        assert!(matches_name("Report.PDF", "report", MatchMode::Substring));
        assert!(!matches_name("Report.PDF", "invoice", MatchMode::Substring));
    }

    #[test]
    fn glob_matching_supports_star_and_question_mark() {
        assert!(matches_name(
            "report-2026.pdf",
            "report-*.pdf",
            MatchMode::Glob
        ));
        assert!(matches_name(
            "report-2026.pdf",
            "report-????.pdf",
            MatchMode::Glob
        ));
        assert!(!matches_name(
            "report-2026.pdf",
            "report-???.pdf",
            MatchMode::Glob
        ));
        assert!(matches_name("anything.txt", "*", MatchMode::Glob));
        assert!(!matches_name("report.pdf", "invoice*", MatchMode::Glob));
    }

    #[test]
    fn matching_is_unicode_aware_not_ascii_only() {
        assert!(matches_name("Café.txt", "café", MatchMode::Substring));
        assert!(matches_name(
            "日本語ファイル.txt",
            "日本語",
            MatchMode::Substring
        ));
        assert!(matches_name("🎉party.txt", "🎉*", MatchMode::Glob));
    }
}
