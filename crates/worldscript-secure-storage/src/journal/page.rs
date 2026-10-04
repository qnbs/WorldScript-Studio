use crate::identity::RecordIdentity;
use crate::record::{open_record, seal_record};
use crate::record_class::RecordClass;
use crate::seal::{Key, RecordMeta};

use super::inventory::JournalInventoryEntry;
use super::wire::{check_counter, migration_page_index, refuse_duplicate_entries, Reader};
use super::{
    JournalError, JOURNAL_PAGE_FORMAT_VERSION, JOURNAL_PAGE_RECORD_SCHEMA, MAX_JOURNAL_PAGE_BYTES,
    MAX_JOURNAL_PAGE_DESCRIPTORS,
};

/// One authenticated journal page body (§10.1.1).
#[derive(Clone, PartialEq, Eq)]
pub struct JournalPage {
    pub page_index: u32,
    pub page_generation: u64,
    entries: Vec<JournalInventoryEntry>,
}

impl JournalPage {
    pub fn new(
        page_index: u32,
        page_generation: u64,
        entries: Vec<JournalInventoryEntry>,
    ) -> Result<Self, JournalError> {
        if entries.len() > MAX_JOURNAL_PAGE_DESCRIPTORS {
            return Err(JournalError::InvalidDescriptorCount);
        }
        let mut entries = entries;
        entries.sort_by(|a, b| a.sort_key().cmp(&b.sort_key()));
        refuse_duplicate_entries(&entries)?;
        let page = JournalPage {
            page_index,
            page_generation,
            entries,
        };
        page.validate()?;
        Ok(page)
    }

    pub fn page_index(&self) -> u32 {
        self.page_index
    }

    pub fn page_generation(&self) -> u64 {
        self.page_generation
    }

    pub fn entries(&self) -> &[JournalInventoryEntry] {
        &self.entries
    }

    pub fn encode(&self) -> Result<Vec<u8>, JournalError> {
        self.validate()?;
        let mut out = Vec::with_capacity(16 + self.entries.len() * 256);
        out.extend_from_slice(&JOURNAL_PAGE_FORMAT_VERSION.to_be_bytes());
        out.extend_from_slice(&self.page_index.to_be_bytes());
        out.extend_from_slice(&self.page_generation.to_be_bytes());
        out.extend_from_slice(&(self.entries.len() as u32).to_be_bytes());
        for entry in &self.entries {
            entry.encode_into(&mut out)?;
        }
        if out.len() > MAX_JOURNAL_PAGE_BYTES {
            return Err(JournalError::TooLarge);
        }
        Ok(out)
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, JournalError> {
        if bytes.len() > MAX_JOURNAL_PAGE_BYTES {
            return Err(JournalError::TooLarge);
        }
        let mut reader = Reader(bytes);
        let format = reader.u32()?;
        if format != JOURNAL_PAGE_FORMAT_VERSION {
            return Err(JournalError::UnsupportedFormat(format));
        }
        let page_index = reader.u32()?;
        let page_generation = reader.u64()?;
        let count = reader.u32()? as usize;
        if count > MAX_JOURNAL_PAGE_DESCRIPTORS {
            return Err(JournalError::InvalidDescriptorCount);
        }
        let mut entries = Vec::with_capacity(count);
        for _ in 0..count {
            entries.push(reader.inventory_entry()?);
        }
        if !reader.0.is_empty() {
            return Err(JournalError::Corrupt("trailing bytes after journal page"));
        }
        let page = JournalPage {
            page_index,
            page_generation,
            entries,
        };
        page.validate()?;
        let reencoded = page.encode()?;
        if reencoded != bytes {
            return Err(JournalError::Corrupt("journal page is not canonical"));
        }
        Ok(page)
    }

    pub fn seal(
        &self,
        key: &Key,
        record: &RecordIdentity,
        meta: RecordMeta,
    ) -> Result<Vec<u8>, JournalError> {
        if meta.record_generation != self.page_generation {
            return Err(JournalError::GenerationMismatch);
        }
        if meta.record_schema != JOURNAL_PAGE_RECORD_SCHEMA {
            return Err(JournalError::UnsupportedFormat(meta.record_schema));
        }
        if record.class() != RecordClass::MigrationPage {
            return Err(JournalError::WrongPageIndex);
        }
        let page_index = migration_page_index(record)?;
        if page_index != self.page_index {
            return Err(JournalError::WrongPageIndex);
        }
        let payload = self.encode()?;
        seal_record(key, record, meta, &payload).map_err(JournalError::Seal)
    }

    pub fn open(
        key: &Key,
        record: &RecordIdentity,
        page_generation: u64,
        envelope: &[u8],
    ) -> Result<Self, JournalError> {
        if record.class() != RecordClass::MigrationPage {
            return Err(JournalError::WrongPageIndex);
        }
        let opened = open_record(key, record, envelope).map_err(JournalError::Open)?;
        if opened.header.record_generation != page_generation {
            return Err(JournalError::GenerationMismatch);
        }
        if opened.header.record_schema != JOURNAL_PAGE_RECORD_SCHEMA {
            return Err(JournalError::UnsupportedFormat(opened.header.record_schema));
        }
        let page = JournalPage::decode(&opened.payload)?;
        if page.page_generation != page_generation {
            return Err(JournalError::GenerationMismatch);
        }
        if migration_page_index(record)? != page.page_index {
            return Err(JournalError::WrongPageIndex);
        }
        Ok(page)
    }

    fn validate(&self) -> Result<(), JournalError> {
        check_counter(self.page_generation)?;
        refuse_duplicate_entries(&self.entries)?;
        let ascending = self
            .entries
            .windows(2)
            .all(|pair| pair[0].sort_key() < pair[1].sort_key());
        if !ascending {
            return Err(JournalError::NotStrictlyAscending);
        }
        self.entries.iter().try_for_each(|entry| entry.validate())?;
        Ok(())
    }
}
