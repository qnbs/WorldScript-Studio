# i18n Glossary — WorldScript Studio

> **Binding reference.** Every translation in `locales/{lang}/` MUST use these canonical terms for the WorldScript domain vocabulary, so the UI reads consistently.

## Conventions

- **Keep as-is (do not translate):** product/brand and technical tokens — `WorldScript Studio`, `Gemini`, `OpenAI`, `Ollama`, `WebLLM`, `API`, `URL`, `PDF`, `DOCX`, `EPUB`, `RTF`, `HTML`, `JSON`, `CSV`, `TXT`, `ZIP`, `MD`, `AES-256`, `PWA`, `Tauri`, `GitHub`, `LoRA`, `RAG`, version strings (`v1.2`), and keyboard combos (`Ctrl+S`). These match `SKIP_PATTERNS` in `scripts/check-i18n-keys.mjs`.
- **Preserve placeholders exactly:** `{{count}}`, `{{title}}`, `{{name}}` — never translate or reorder the inner token; surrounding words may be reordered for grammar.
- **Numerals:** use Western Arabic digits (0-9) — the app's data layer is locale-agnostic.
- **Tone:** concise, neutral, modern software register (not classical/literary).

## Core Domain Terms

| English | German | French | Spanish | Italian | Arabic | Hebrew | Japanese | Chinese | Portuguese | Greek |
|---------|--------|--------|---------|---------|--------|--------|----------|---------|------------|-------|
| Manuscript | Manuskript | Manuscrit | Manuscrito | Manoscritto | المخطوطة | כתב היד | マニュスクリプト | 手稿 | Manuscrito | Χειρόγραφο |
| Outline | Kontur | Contour | Esquema | Outline | المخطط | מתווה | アウトライン | 大纲 | Esboço | Επισήμανση |
| Section / Scene | Szene | Scène | Escena | Scena | المشهد | סצנה | シーン | 场景 | Cena | Σκηνή |
| Template | Vorlage | Modèle | Plantilla | Template | القالب | תבנית | テンプレート | 模板 | Modelo | Πρότυπο |
| Snapshot | Schnappschuss | Instantané | Instantánea | Istanza | لقطة | תצלום מצב | スナップショット | 快照 | Snapshot | Στιγμιότυπο |
| Writing Session | Schreibsession | Session d'écriture | Sesión de escritura | Sessione di scrittura | جلسة الكتابة | מפגש כתיבה | 書き込みセッション | 写作会话 | Sessão de escrita | Συνεδρία έκθεσης |
| Plot Board | Plot-Board | Tableau d'intrigue | Tablero de trama | Scheda trama | لوحة الحبكة | לוח עלילה | プロットボード | 情节板 | Quadro de trama | Πινακίδα πλοκής |
| Character | Charakter | Personnage | Personaje | Personaggio | الشخصية | דמות | キャラクター | 角色 | Personagem | Χαρακτήρας |
| World | Welt | Monde | Mundo | Mondo | العالم | עולם | ワールド | 世界 | Mundo | Κόσμος |
| Co-Pilot (AI) | Co-Pilot | Co-Pilot | Co-Pilot | Co-Pilot | المساعد الذكي | עוזר ה‑AI | コパイロット | 副驾驶 | Co-Pilot | Συν-Συντάκτης |
| Dashboard | Dashboard | Tableau de bord | Panel | Cruscotto | لوحة التحكم | לוח בקרה | ダッシュボード | 仪表板 | Painel | Πίνακας ελέγχου |
| Settings | Einstellungen | Paramètres | Configuración | Impostazioni | الإعدادات | הגדרות | 設定 | 设置 | Configurações | Ρυθμίσεις |
| Export | Export | Exporter | Exportar | Esporta | تصدير | ייצוא | エクスポート | 导出 | Exportar | Εξαγωγή |

## Common UI Verbs

| English | German | French | Spanish | Italian | Arabic | Hebrew | Japanese | Chinese | Portuguese | Greek |
|---------|--------|--------|---------|---------|--------|--------|----------|---------|------------|-------|
| Save | Speichern | Enregistrer | Guardar | Salva | حفظ | שמירה | 保存 | 保存 | Salvar | Αποθήκευση |
| Cancel | Abbrechen | Annuler | Cancelar | Annulla | إلغاء | ביטול | キャンセル | 取消 | Cancelar | Ακύρωση |
| Delete | Löschen | Supprimer | Eliminar | Elimina | حذف | מחיקה | 削除 | 删除 | Excluir | Διαγραφή |
| Edit | Bearbeiten | Modifier | Editar | Modifica | تعديل | עריכה | 編集 | 编辑 | Editar | Επεξεργασία |
| Add | Hinzufügen | Ajouter | Añadir | Aggiungi | إضافة | הוספה | 追加 | 添加 | Adicionar | Προσθήκη |
| Create | Erstellen | Créer | Crear | Crea | إنشاء | יצירה | 作成 | 创建 | Criar | Δημιουργία |
| Close | Schließen | Fermer | Cerrar | Chiudi | إغلاق | סגירה | 閉じる | 关闭 | Fechar | Κλείσιμο |
| Search | Suchen | Rechercher | Buscar | Cerca | بحث | חיפוש | 検索 | 搜索 | Pesquisar | Αναζήτηση |

## Phase 3 Beta Languages

**Status:** Beta — sensible, consistent, non-native-reviewed. Native review = community follow-up.

### Japanese (ja)
- Uses modern, polite software language register
- No grammatical plural forms (all counts return `other`)
- Kanji/Hiragana/Katakana supported via Noto Sans Japanese

### Chinese Simplified (zh)
- Uses Simplified Chinese characters
- No grammatical plural forms
- Numbers formatted with Western Arabic digits

### Portuguese (pt-BR)
- Brazilian Portuguese variant
- Uses "você" (informal) for AI interactions
- Follows Portuguese CLDR plural rules

### Greek (el)
- Modern monotonic Greek (not polytonic)
- Uses "εσείς" form for polite address
- Follows Greek CLDR plural rules

## Phase X Beta Languages (fi, sv, hu, is, eu, fa)

**Status:** Beta. Priority chrome (`portal`, `sidebar`, `dashboard`, top `common.*`) hand-translated;
all remaining modules machine-translated (glossary-anchored, placeholder-masked) to ~96-100 % coverage,
human native review pending. Canonical terms live lang-first in `locales/translation-glossary.json`.
See [`LANGUAGE-EXPANSION-2026.md`](LANGUAGE-EXPANSION-2026.md).

| English | Finnish (fi) | Swedish (sv) | Hungarian (hu) | Icelandic (is) | Basque (eu) | Persian (fa) |
|---------|-------------|--------------|----------------|----------------|-------------|--------------|
| Manuscript | Käsikirjoitus | Manuskript | Kézirat | Handrit | Eskuizkribu | دست‌نوشته |
| Plot Board | Juonitaulu | Plot Board | Cselekménytábla | Söguborð | Argumentu-taula | تخته‌داستان |
| Character | Hahmo | Karaktär | Karakter | Persóna | Pertsonaia | شخصیت |
| World | Maailma | Värld | Világ | Heimur | Mundua | جهان |
| Dashboard | Kojelauta | Översikt | Irányítópult | Mælaborð | Aginte-panela | داشبورد |
| Settings | Asetukset | Inställningar | Beállítások | Stillingar | Ezarpenak | تنظیمات |
| Export | Vie | Exportera | Exportálás | Flytja út | Esportatu | خروجی |

### Morphology & UI-length notes
- **fi (Finnish):** agglutinative; long single-word compounds (*Johdonmukaisuustarkistus*). Watch
  sidebar/dashboard overflow. one/other plurals via `Intl.PluralRules`.
- **hu (Hungarian):** agglutinative; ordinal chapters use a trailing dot (*1. fejezet*). Long
  compounds (*Konzisztencia-ellenőrző*). one/other plurals.
- **is (Icelandic):** four cases; long compounds (*Samkvæmnisprófun*). Ordinals as *1. kafli*.
  one/other plurals (note 21, 31… are "one" — never hardcode).
- **eu (Basque):** non-Indo-European; prefer short, clear forms. Ordinals *1. kapitulua*.
- **fa (Persian):** **RTL**, Arabic script with Persian letters (پ چ ژ گ ک ی). Numerals may render
  as Eastern Arabic (۱۲۳) in prose; keep `{{count}}` etc. unchanged. Literary register for narrative
  demo strings, neutral register for chrome. one/other plurals.

### Flags
Basque has **no** Unicode flag emoji (the ikurriña is not encoded); `LanguageSelector` uses 🌐.
Persian uses 🇮🇷.

## Glossary expansion (v2.0)

`locales/translation-glossary.json` (lang-first, `_meta.version: "2.0"`) is the machine-readable
source of truth and now carries **~44 anchor terms per Beta language** (the original UI/creative set
plus product-distinctive terms: `Co-Pilot`, `ProForge`, `Chapter`, `Theme`, `Subplot`, `Timeline`,
`Snapshot`, `Synopsis`, `Mind Map`, `Word Count`, `Continue Writing`, `Improve Writing`,
`Consistency Checker`, `Plot Hole`, `Revision`). These anchor the bulk translator
(`scripts/bulk-translate-locales.mjs`) for cross-module consistency. The glossary is **sparse-tolerant**
— a term absent for a given language simply falls through to machine translation. To propose terms,
follow [`TRANSLATION-GUIDE.md`](TRANSLATION-GUIDE.md) §4 (prefer distinctive Title-Case strings).

## Scope Note

For Beta locales, UI-chrome modules are hand-translated and the deeper modules are completed by the
glossary-anchored, placeholder-safe **bulk translator** (machine translation, Beta quality) pending
human native review. `help.json` (long-form help-article prose) may remain English fallback longest.
See `AUDIT.md` C-6, [`LANGUAGE-EXPANSION-2026.md`](LANGUAGE-EXPANSION-2026.md) and the review checklist
in [`TRANSLATION-GUIDE.md`](TRANSLATION-GUIDE.md) §6.
