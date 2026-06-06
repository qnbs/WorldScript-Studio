# i18n Glossary — StoryCraft Studio

> **Binding reference.** Every translation in `locales/{lang}/` MUST use these canonical terms for the StoryCraft domain vocabulary, so the UI reads consistently.

## Conventions

- **Keep as-is (do not translate):** product/brand and technical tokens — `StoryCraft Studio`, `Gemini`, `OpenAI`, `Ollama`, `WebLLM`, `API`, `URL`, `PDF`, `DOCX`, `EPUB`, `RTF`, `HTML`, `JSON`, `CSV`, `TXT`, `ZIP`, `MD`, `AES-256`, `PWA`, `Tauri`, `GitHub`, `LoRA`, `RAG`, version strings (`v1.2`), and keyboard combos (`Ctrl+S`). These match `SKIP_PATTERNS` in `scripts/check-i18n-keys.mjs`.
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

## Scope Note

`help.json` (long-form help-article prose) is intentionally left as **English fallback** for Beta languages. Only the 18 UI-chrome modules are translated. See `AUDIT.md` C-6.
