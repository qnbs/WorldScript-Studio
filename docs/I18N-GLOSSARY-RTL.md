# i18n Glossary — Arabic (ar) & Hebrew (he) RTL Beta

> **Binding reference.** Every ar/he translation in `locales/ar/` and `locales/he/` MUST use
> these canonical terms for the WorldScript domain vocabulary, so the UI reads consistently.
> Status: **Beta** — sensible, consistent, non-native-reviewed. Native review = community follow-up
> (TODO.md C-6). When in doubt, prefer a clear common-usage word over a rare literary one.

## Conventions

- **Keep as-is (do not translate):** product/brand and technical tokens — `WorldScript Studio`,
  `Gemini`, `OpenAI`, `Ollama`, `WebLLM`, `API`, `URL`, `PDF`, `DOCX`, `EPUB`, `RTF`, `HTML`,
  `JSON`, `CSV`, `TXT`, `ZIP`, `MD`, `AES-256`, `PWA`, `Tauri`, `GitHub`, `LoRA`, `RAG`,
  version strings (`v1.2`), and keyboard combos (`Ctrl+S`). These match `SKIP_PATTERNS` in
  `scripts/check-i18n-keys.mjs`.
- **Preserve placeholders exactly:** `{{count}}`, `{{title}}`, `{{name}}` — never translate or
  reorder the inner token; surrounding words may be reordered for grammar.
- **Numerals:** use Western Arabic digits (0-9) — the app's data layer is locale-agnostic.
- **Tone:** concise, neutral, modern software register (not classical/literary).

## Core domain terms

| English (Co-Pilot term) | Arabic (ar) | Hebrew (he) | Notes |
|---|---|---|---|
| Manuscript | المخطوطة | כתב היד | the full book text |
| Outline | المخطط | מתווה | structural outline |
| Section / Scene | المشهد | סצנה | a scene unit |
| Template | القالب | תבנית | |
| Snapshot (auto-save) | لقطة | תצלום מצב | automatic save point |
| Scene Revision (user-saved) | مراجعة المشهد | גרסת סצנה | explicit user-saved revision |
| Writing Session | جلسة الكتابة | מפגש כתיבה | |
| Plot Board | لوحة الحبكة | לוח עלילה | |
| Connection (plot edge) | الصلة | קשר | edge between scenes |
| Subplot | حبكة فرعية | עלילת משנה | |
| Tension Curve | منحنى التوتر | עקומת מתח | |
| Character | الشخصية | דמות | |
| Character Arc | مسار الشخصية | קשת הדמות | character development arc |
| Character Graph | مخطط الشخصيات | גרף דמויות | relationship graph |
| World-Building | بناء العالم | בניית עולם | |
| World | العالم | עולם | |
| Story Object | عنصر القصة | אובייקט סיפור | |
| Mind Map | الخريطة الذهنية | מפת חשיבה | |
| Co-Pilot (the AI) | المساعد الذكي | עוזר ה‑AI | AI is always "Co-Pilot"; keep friendly assistant tone |
| Dashboard | لوحة التحكم | לוח בקרה | |
| Settings | الإعدادات | הגדרות | |
| Export | تصدير | ייצוא | |
| Outline Generator | مُولِّد المخطط | מחולל המתווה | |
| Consistency Checker | مدقق الاتساق | בודק עקביות | |
| AI Critic | الناقد الذكي | מבקר ה‑AI | |
| Fine-Tuning (LoRA) | الضبط الدقيق | כוונון עדין | LoRA stays as "LoRA" |

## Common UI verbs / chrome

| English | Arabic (ar) | Hebrew (he) |
|---|---|---|
| Save | حفظ | שמירה |
| Cancel | إلغاء | ביטול |
| Delete | حذف | מחיקה |
| Edit | تعديل | עריכה |
| Add | إضافة | הוספה |
| Create | إنشاء | יצירה |
| Close | إغلاق | סגירה |
| Search | بحث | חיפוש |
| Next | التالي | הבא |
| Back / Previous | السابق | הקודם |
| Continue | متابعة | המשך |
| Loading… | جارٍ التحميل… | טוען… |
| Settings | الإعدادات | הגדרות |
| Help | المساعدة | עזרה |
| Generate | توليد | יצירה |
| Regenerate | إعادة التوليد | יצירה מחדש |
| Beta | تجريبي (Beta) | בטא (Beta) |

## Scope note

`help.json` (long-form help-article prose) is intentionally left as **English fallback** for this
Beta. Only the 18 UI-chrome modules are translated. See plan + `AUDIT.md` C-6.
