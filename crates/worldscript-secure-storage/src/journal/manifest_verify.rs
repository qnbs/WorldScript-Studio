use super::digest::{inventory_digest, journal_page_set_digest, InventoryDigestVerifier};
use super::inventory::JournalInventoryEntry;
use super::manifest::{JournalManifest, JournalPageRef};
use super::page::JournalPage;
use super::{JournalError, MAX_JOURNAL_INVENTORY_ENTRIES, MAX_JOURNAL_PAGE_DESCRIPTORS};

impl JournalManifest {
    /// Refuses a manifest whose page-set digest does not match the supplied page refs.
    pub fn verify_page_set(&self, pages: &[JournalPageRef]) -> Result<(), JournalError> {
        if pages.len() as u32 != self.page_count {
            return Err(JournalError::PageSetMismatch);
        }
        let entry_total = sum_page_entry_counts(pages)?;
        if entry_total != self.entry_count as u64 {
            return Err(JournalError::EntryCountMismatch);
        }
        let digest = journal_page_set_digest(pages)?;
        if digest != self.journal_page_set_digest {
            return Err(JournalError::PageSetMismatch);
        }
        Ok(())
    }

    /// Refuses when manifest counters or `inventory_digest` disagree with supplied entries.
    pub fn verify_inventory(&self, entries: &[JournalInventoryEntry]) -> Result<(), JournalError> {
        if entries.len() as u32 != self.entry_count {
            return Err(JournalError::EntryCountMismatch);
        }
        let digest = inventory_digest(self.inventory_version, entries)?;
        if digest != self.inventory_digest {
            return Err(JournalError::InconsistentInventory);
        }
        Ok(())
    }

    /// Verifies a paged inventory against this manifest without loading every entry at once.
    pub fn verify_inventory_pages(&self, pages: &[JournalPage]) -> Result<(), JournalError> {
        if pages.len() as u32 != self.page_count {
            return Err(JournalError::PageSetMismatch);
        }
        let mut sorted_pages: Vec<&JournalPage> = pages.iter().collect();
        sorted_pages.sort_by_key(|page| page.page_index());
        super::wire::refuse_duplicate_adjacent(&sorted_pages, |left, right| {
            left.page_index() == right.page_index()
        })?;
        let mut verifier = InventoryDigestVerifier::new(self.inventory_version, self.entry_count)?;
        for page in sorted_pages {
            verifier.absorb_page(page)?;
        }
        verifier.finish(self.inventory_digest)
    }
}

fn sum_page_entry_counts(pages: &[JournalPageRef]) -> Result<u64, JournalError> {
    let mut entry_total = 0u64;
    for page in pages {
        if page.page_entry_count > MAX_JOURNAL_PAGE_DESCRIPTORS as u32 {
            return Err(JournalError::InvalidDescriptorCount);
        }
        entry_total = entry_total
            .checked_add(page.page_entry_count as u64)
            .ok_or(JournalError::TooManyEntries)?;
        if entry_total > MAX_JOURNAL_INVENTORY_ENTRIES as u64 {
            return Err(JournalError::TooManyEntries);
        }
    }
    Ok(entry_total)
}
