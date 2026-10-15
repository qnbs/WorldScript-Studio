//! The buffer `GetFileInformationByHandleEx(FileIdBothDirectoryInfo)` fills: a chain of variable-length
//! `FILE_ID_BOTH_DIR_INFO` records. It is parsed from bytes with checked indexing only, and compiled on
//! Windows, where the listing uses it, and in tests, so that the parser is exercised on every host.

/// Where the fields this parser reads sit in a `FILE_ID_BOTH_DIR_INFO` (a Windows test pins them to the
/// structure of `windows-sys`).
pub(super) const NEXT_ENTRY_AT: usize = 0;
pub(super) const FILE_NAME_LENGTH_AT: usize = 60;
pub(super) const FILE_NAME_AT: usize = 104;

/// The buffer is not a well-formed chain of records.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct Malformed;

/// The names, as UTF-16 units, of the records in `buffer`, without `.` and `..`.
pub(super) fn names(buffer: &[u8]) -> Result<Vec<Vec<u16>>, Malformed> {
    let mut found = Vec::new();
    let mut record = 0usize;
    loop {
        let (next, name) = record_at(buffer, record)?;
        if !is_dot_entry(&name) {
            found.push(name);
        }
        if next == 0 {
            return Ok(found);
        }
        record = record.checked_add(next).ok_or(Malformed)?;
    }
}

fn record_at(buffer: &[u8], record: usize) -> Result<(usize, Vec<u16>), Malformed> {
    let next = word_at(buffer, record, NEXT_ENTRY_AT)?;
    let length = word_at(buffer, record, FILE_NAME_LENGTH_AT)?;
    let start = record.checked_add(FILE_NAME_AT).ok_or(Malformed)?;
    let end = start.checked_add(length).ok_or(Malformed)?;
    let bytes = buffer.get(start..end).ok_or(Malformed)?;
    if bytes.len() % 2 != 0 {
        return Err(Malformed);
    }
    let units = bytes
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect();
    Ok((next, units))
}

fn word_at(buffer: &[u8], record: usize, field: usize) -> Result<usize, Malformed> {
    let start = record.checked_add(field).ok_or(Malformed)?;
    let end = start.checked_add(4).ok_or(Malformed)?;
    let bytes = buffer.get(start..end).ok_or(Malformed)?;
    Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize)
}

fn is_dot_entry(name: &[u16]) -> bool {
    let dot = u16::from(b'.');
    name == [dot] || name == [dot, dot]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A record for `name` whose next record is `next` bytes on (0 for the last).
    fn record(name: &str, next: u32) -> Vec<u8> {
        let units: Vec<u16> = name.encode_utf16().collect();
        let mut bytes = vec![0u8; FILE_NAME_AT];
        bytes[NEXT_ENTRY_AT..NEXT_ENTRY_AT + 4].copy_from_slice(&next.to_le_bytes());
        let length = u32::try_from(units.len() * 2).unwrap();
        bytes[FILE_NAME_LENGTH_AT..FILE_NAME_LENGTH_AT + 4].copy_from_slice(&length.to_le_bytes());
        for unit in units {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        bytes
    }

    /// The records chained the way the system writes them, each padded to 8 bytes.
    fn chain(names: &[&str]) -> Vec<u8> {
        let mut buffer = Vec::new();
        for (index, name) in names.iter().enumerate() {
            let mut bytes = record(name, 0);
            bytes.resize(bytes.len().div_ceil(8) * 8, 0);
            if index + 1 < names.len() {
                let next = u32::try_from(bytes.len()).unwrap();
                bytes[NEXT_ENTRY_AT..NEXT_ENTRY_AT + 4].copy_from_slice(&next.to_le_bytes());
            }
            buffer.extend_from_slice(&bytes);
        }
        buffer
    }

    fn text(found: Result<Vec<Vec<u16>>, Malformed>) -> Result<Vec<String>, Malformed> {
        found.map(|names| {
            names
                .iter()
                .map(|name| String::from_utf16_lossy(name))
                .collect()
        })
    }

    #[test]
    fn a_chain_yields_its_names_without_the_dot_entries() {
        let buffer = chain(&[".", "..", "a", "page-000001.bin", "ü"]);
        assert_eq!(
            text(names(&buffer)),
            Ok(vec![
                "a".to_owned(),
                "page-000001.bin".to_owned(),
                "ü".to_owned()
            ])
        );
    }

    #[test]
    fn a_name_with_an_unpaired_surrogate_is_kept_as_its_units() {
        let mut buffer = record("a", 0);
        buffer.truncate(FILE_NAME_AT);
        buffer[FILE_NAME_LENGTH_AT..FILE_NAME_LENGTH_AT + 4].copy_from_slice(&4u32.to_le_bytes());
        for unit in [0x61u16, 0xD800] {
            buffer.extend_from_slice(&unit.to_le_bytes());
        }
        assert_eq!(names(&buffer), Ok(vec![vec![0x61, 0xD800]]));
    }

    #[test]
    fn a_malformed_buffer_is_refused_and_never_read_past_its_end() {
        let good = chain(&["a", "b"]);
        let mut odd_length = record("a", 0);
        odd_length[FILE_NAME_LENGTH_AT..FILE_NAME_LENGTH_AT + 4]
            .copy_from_slice(&3u32.to_le_bytes());
        odd_length.extend_from_slice(&[b'a', 0, b'b']);
        let mut name_past_end = record("abc", 0);
        name_past_end.truncate(FILE_NAME_AT + 2);
        let mut next_past_end = record("a", 0);
        next_past_end[NEXT_ENTRY_AT..NEXT_ENTRY_AT + 4].copy_from_slice(&u32::MAX.to_le_bytes());
        let mut name_length_huge = record("a", 0);
        name_length_huge[FILE_NAME_LENGTH_AT..FILE_NAME_LENGTH_AT + 4]
            .copy_from_slice(&u32::MAX.to_le_bytes());
        let cases: [&[u8]; 6] = [
            &[],
            &good[..FILE_NAME_LENGTH_AT],
            &odd_length,
            &name_past_end,
            &next_past_end,
            &name_length_huge,
        ];
        let refused = cases.map(|case| names(case).is_err());
        assert_eq!(refused, [true; 6]);
    }
}
