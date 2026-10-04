use sha2::{Digest, Sha256};

use crate::marker::content_digest;

use super::inventory::{hash_inventory_entry, JournalInventoryEntry, OwnedInventorySortKey};
use super::manifest::JournalPageRef;
use super::page::JournalPage;
use super::wire::{check_counter, entry_count, refuse_duplicate_pages, validate_inventory_version};
use super::{
    JournalError, INVENTORY_DOMAIN, JOURNAL_PAGE_SET_DOMAIN, MAX_JOURNAL_INVENTORY_ENTRIES,
};

/// `journal_page_set_digest` (§10.1.1).
pub fn journal_page_set_digest(pages: &[JournalPageRef]) -> Result<[u8; 32], JournalError> {
    let mut sorted = pages.to_vec();
    sorted.sort_by_key(|page| page.page_index);
    refuse_duplicate_pages(&sorted)?;
    let mut hasher = Sha256::new().chain_update(JOURNAL_PAGE_SET_DOMAIN);
    hasher.update(entry_count(sorted.len())?);
    for page in sorted {
        hasher.update(page.page_index.to_be_bytes());
        check_counter(page.page_generation)?;
        hasher.update(page.page_generation.to_be_bytes());
        hasher.update(page.page_entry_count.to_be_bytes());
        hasher.update(page.page_content_digest);
    }
    Ok(hasher.finalize().into())
}

/// §10.2 bootstrap: `page_count = 0` page-set digest.
pub fn empty_journal_page_set_digest() -> [u8; 32] {
    Sha256::new()
        .chain_update(JOURNAL_PAGE_SET_DOMAIN)
        .chain_update(0u32.to_be_bytes())
        .finalize()
        .into()
}

/// `inventory_digest` (§5.4) over the supplied entries.
pub fn inventory_digest(
    inventory_version: u32,
    entries: &[JournalInventoryEntry],
) -> Result<[u8; 32], JournalError> {
    if entries.len() as u32 > MAX_JOURNAL_INVENTORY_ENTRIES {
        return Err(JournalError::TooManyEntries);
    }
    let mut sorted: Vec<&JournalInventoryEntry> = entries.iter().collect();
    sorted.sort_by(|a, b| a.sort_key().cmp(&b.sort_key()));
    sorted.windows(2).try_for_each(|pair| {
        if pair[0].sort_key() == pair[1].sort_key() {
            Err(JournalError::DuplicateEntry)
        } else {
            Ok(())
        }
    })?;
    let mut hasher = Sha256::new().chain_update(INVENTORY_DOMAIN);
    hasher.update(inventory_version.to_be_bytes());
    hasher.update(entry_count(sorted.len())?);
    for entry in sorted {
        entry.validate()?;
        hash_inventory_entry(&mut hasher, entry)?;
    }
    Ok(hasher.finalize().into())
}

pub fn empty_inventory_digest(inventory_version: u32) -> [u8; 32] {
    Sha256::new()
        .chain_update(INVENTORY_DOMAIN)
        .chain_update(inventory_version.to_be_bytes())
        .chain_update(0u32.to_be_bytes())
        .finalize()
        .into()
}

/// Incrementally verifies a paged inventory against `inventory_digest` without retaining all entries.
pub struct InventoryDigestVerifier {
    expected_entry_count: u32,
    seen_entry_count: u32,
    previous_key: Option<OwnedInventorySortKey>,
    hasher: Sha256,
}

impl InventoryDigestVerifier {
    pub fn new(inventory_version: u32, expected_entry_count: u32) -> Result<Self, JournalError> {
        validate_inventory_version(inventory_version)?;
        if expected_entry_count > MAX_JOURNAL_INVENTORY_ENTRIES {
            return Err(JournalError::TooManyEntries);
        }
        let mut hasher = Sha256::new().chain_update(INVENTORY_DOMAIN);
        hasher.update(inventory_version.to_be_bytes());
        hasher.update(expected_entry_count.to_be_bytes());
        Ok(Self {
            expected_entry_count,
            seen_entry_count: 0,
            previous_key: None,
            hasher,
        })
    }

    pub fn absorb_page(&mut self, page: &JournalPage) -> Result<(), JournalError> {
        check_counter(page.page_generation)?;
        let mut previous_in_page: Option<OwnedInventorySortKey> = None;
        for entry in page.entries() {
            entry.validate()?;
            let key = entry.sort_key().owned();
            if let Some(prev) = &previous_in_page {
                if key <= *prev {
                    return Err(JournalError::NotStrictlyAscending);
                }
            }
            if let Some(prev) = &self.previous_key {
                if key <= *prev {
                    return Err(JournalError::NotStrictlyAscending);
                }
            }
            hash_inventory_entry(&mut self.hasher, entry)?;
            previous_in_page = Some(key.clone());
            self.previous_key = Some(key);
            self.seen_entry_count += 1;
            if self.seen_entry_count > self.expected_entry_count {
                return Err(JournalError::TooManyEntries);
            }
        }
        Ok(())
    }

    pub fn finish(self, expected_digest: [u8; 32]) -> Result<(), JournalError> {
        if self.seen_entry_count != self.expected_entry_count {
            return Err(JournalError::EntryCountMismatch);
        }
        let digest: [u8; 32] = self.hasher.finalize().into();
        if digest != expected_digest {
            return Err(JournalError::InconsistentInventory);
        }
        Ok(())
    }
}

/// Builds the page-set row for a sealed page.
pub fn page_ref_for(page: &JournalPage, envelope: &[u8]) -> Result<JournalPageRef, JournalError> {
    Ok(JournalPageRef {
        page_index: page.page_index,
        page_generation: page.page_generation,
        page_entry_count: page.entries().len() as u32,
        page_content_digest: content_digest(envelope),
    })
}
