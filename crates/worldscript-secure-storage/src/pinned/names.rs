//! Windows file names that the Win32 path layer does not take literally. Compiled on Windows, where
//! [`PinnedDir`](super::PinnedDir) uses it, and in tests, so that the rules are also exercised on the
//! other platforms.

/// Whether Win32 takes `text` as exactly the entry it spells: no stream (`:`), wildcard, control
/// character or separator, no trailing dot or space that the path layer strips, and no device name.
pub(super) fn is_plain_windows_name(text: &str) -> bool {
    let forbidden = |c: char| c.is_control() || "<>:\"/\\|?*".contains(c);
    !text.is_empty()
        && !text.chars().any(forbidden)
        && !text.ends_with(['.', ' '])
        && !is_device_name(text)
}

/// Names that mean a device in every directory and with any extension: the console and printer names,
/// and the serial and parallel ports `COM1`..`COM9` and `LPT1`..`LPT9`, also written with the
/// superscript digits `¹`, `²` and `³`.
fn is_device_name(text: &str) -> bool {
    let stem = text.split('.').next().unwrap_or(text).trim_end_matches(' ');
    let upper = stem.to_ascii_uppercase();
    if matches!(
        upper.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) {
        return true;
    }
    ["COM", "LPT"]
        .iter()
        .any(|port| upper.strip_prefix(port).is_some_and(is_port_number))
}

fn is_port_number(rest: &str) -> bool {
    let mut digits = rest.chars();
    matches!(
        (digits.next(), digits.next()),
        (Some('1'..='9' | '¹' | '²' | '³'), None)
    )
}

#[cfg(test)]
mod tests {
    use super::is_plain_windows_name;

    #[test]
    fn ordinary_names_are_plain_and_every_reinterpreted_name_is_not() {
        let plain = [
            "a",
            "page-000001.bin",
            "pending-7",
            "COM0",
            "COM10",
            "LPT",
            "console",
        ];
        let reinterpreted = [
            "",
            "a:stream",
            "con",
            "CON",
            "NUL.txt",
            "Com1",
            "lpt9",
            "COM¹",
            "LPT²",
            "com³.log",
            "CONIN$",
            "conout$.x",
            "AUX ",
            "a.",
            "a ",
            "a*",
            "a?",
            "a<b",
            "a|b",
            "a\"b",
            "a\\b",
            "a\u{0}b",
        ];
        assert_eq!(
            (
                plain.map(is_plain_windows_name),
                reinterpreted.map(is_plain_windows_name)
            ),
            ([true; 7], [false; 22])
        );
    }
}
