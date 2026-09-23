# RootsTalk PWA Kannada i18n Audit

## How to Use This Report

This audit identifies untranslated English strings, missing Kannada key paths, and contaminated translations in the RootsTalk PWA. The fallback chain is `kn.json → en.json`, meaning any key missing from `kn.json` renders in English at runtime. Priority: **Section 1 (hardcoded strings)** blocks UI entirely and must be wrapped with `t()`. Then tackle **Section 2 (missing keys)** by translating them in `kn.json`. **Section 3** is validation-only — no Devanagari contamination was found.

**Coaching Sandbox (app/become-dealer/, app/become-facilitator/)**: Highest risk area — all text on these pages is hardcoded or uses props; no i18n integration visible. These should be addressed first, along with the order/UPI payment flow in `app/crop-detail/[subscriptionId]/orders/page.tsx`.

---

## Section 1 — Hardcoded English Strings in JSX (Highest Priority)

Total findings: **17 hardcoded strings** across 4 files that bypass i18n entirely.

### app/become-dealer/page.tsx
- **Line 54, 99** — `title="Become a Dealer"` (PWAHeader title attribute; check if PWAHeader title prop accepts `t()`)
- **Line 59** — `>You're already a Facilitator<` (h2 heading)
- **Line 68** — `>Coming soon:</strong> a way to voluntarily end your Facilitator role (once all your pending tasks are clear), after which you'll be able to register as a Dealer.` (alert box)
- **Line 73** — `>Back to Farmer Home<` (button text)
- **Line 108** — `>Become a Dealer<` (h2 heading)
- **Line 110** — `>As a dealer, you receive purchase orders from farmers and supply recommended agricultural inputs.` (body copy)
- **Line 114** — `>What dealers can do<` (section header)
- **Line 116–120** — Array of hardcoded strings: `'Receive and process farmer orders'`, `'Select brands and enter volumes'`, `'Share packing lists with farmers'`, `'Manage subscription payment requests'`, `'Become a Promoter and assign advisories'` (feature list items)
- **Line 135** — `>After you register<` (subheading)
- **Line 137–139** — `>You'll set up your shop details (location, licences, what you sell). To start receiving orders, a company will need to recognise you on their Field Manager page using your registered phone number…` (explanatory text)

### app/become-facilitator/page.tsx
- **Line 50, 93** — `title="Become a Facilitator"` (PWAHeader title)
- **Line 55** — `>You're already a Dealer<` (h2 heading)
- **Line 60–61** — `>A single user cannot be both a Dealer and a Facilitator on RootsTalk. They sit on opposite ends of the order-routing chain — a Facilitator routes farmer orders to Dealers, so the same person can't be on both sides.` (body copy)
- **Line 64–65** — `>You're free to combine any other role (Farmer + Dealer + Pundit, or Farmer + Facilitator + Pundit, etc.) — just not Dealer and Facilitator together.` (body copy)
- **Line 64** — `>Coming soon:</strong> a way to voluntarily end your Dealer role (once all your pending tasks are clear), after which you'll be able to register as a Facilitator.` (alert box)
- **Line 69** — `>Back to Farmer Home<` (button text)
- **Line 102** — `>Become a Facilitator<` (h2 heading)
- **Line 109–110** — `>As a facilitator, you help farmers by routing their orders to dealers, and connect them with expert advice. You don't handle inventory or payment — your role is purely advisory and logistical.` (body copy)
- **Line 114** — `>What facilitators can do<` (section header)
- **Line 116–120** — Array of hardcoded strings (similar feature list)
- **Line 128** — `>After you register<` (subheading)

### app/crop/[referenceNumber]/page.tsx
- **Line 57** — `>Record not found<` (h1 heading)
- **Line 58** — `>This crop record could not be found. Please check the reference number.` (error message)

### app/crop-detail/[subscriptionId]/orders/page.tsx
- **Line 1738, 1758** — `>Pay via UPI<` (section heading and tab label)
- **Line 1786** — `{copied ? '✓ Copied' : 'Copy UPI ID'}` (button text with ternary hardcoded English)
- **Line 1805** — `>1. Tap <strong>Copy UPI ID</strong>.` (instruction text)
- **Line 1808** — `>4. Come back here and tap <strong>I've paid</strong>.` (instruction text)
- **Line 1824** — `{marking ? '…' : "I've paid"}` (button text with ternary hardcoded English)
- **Line 1807** — `>2. Open your UPI app (Google Pay, PhonePe, etc.).` (instruction)
- **Line 1810** — `>3. Paste and send.` (instruction)

### app/dealer/orders/[orderId]/page.tsx
- **Line 1481** — `>✓ Marked for Final Confirm<` (status badge)
- **Line 1491** — `>✗ Marked to Cancel<` (status badge)

### app/dealer/orders/page.tsx
- **Line 1469** — `>Final Confirmation:</strong> the packing list is populated after this.` (info box)
- **Line 1508** — (duplicate)
- **Line 1804** — `>Final Confirmation:</strong> the packing list is populated after this.` (info box)
- **Line 1813** — (duplicate)

---

## Section 2 — Keys Present in en.json but Missing in kn.json

**Summary:** 2,774 keys in `en.json` vs 2,747 keys in `kn.json` = **27 missing translations**. (Also included 4 keys with empty string values as "missing".)

```
- crop.authors.andOthers
- crop.authors.label
- dealer.onboardedCompanies.stepDownPending
- dealer.orders.pill.confirm
- dealer.postponed.confirmNa.bodyPrefix
- dealer.profile.gpsCard.autoSaved
- dealer.promoterAssign.done.bodyPrefix
- facilitator.onboardedCompanies.stepDownPending
- facilitator.payments.loadingSkeleton
- facilitator.profile.stepDownPending
- header.sharePwaQr
- orders.common.map.directionsBtn
- orders.common.map.hideBtn
- orders.common.map.locationCurrent
- orders.common.map.locationDenied
- orders.common.map.locationProfile
- orders.common.map.locationRequesting
- orders.common.map.locationSourceLabel
- orders.common.map.showBtn
- orders.review.confirmDelete.bodyPrefix
- orders.common.trainingDealerBadge
- publicVerify.cultivationPractice
- shareQr.copiedToast
- shareQr.pageTitle
- shareQr.saveBtn
- shareQr.savedToast
- shareQr.scanHint
- shareQr.shareBtn
- shareQr.shareTagline
- shareQr.shareUnavailable
- shareQr.urlLine
```

### Notes on Missing Keys
- **`shareQr.*` (9 keys)**: Entire feature area (`/share-qr`) may have been added recently; all strings are in English in the UI fallback.
- **`orders.common.map.*` (8 keys)**: Location/map picker widget is untranslated.
- **`dealer.profile.gpsCard.autoSaved`, `dealer.promoterAssign.done.bodyPrefix`, `facilitator.payments.loadingSkeleton`**: These are recent additions (July-August 2026) and likely not yet translated.

---

## Section 3 — Devanagari (Hindi) Contamination in kn.json

**Status: PASS** — No Devanagari characters (U+0900–U+097F) found in any value in `kn.json`. All strings are valid Kannada or English.

---

## Recommended Fix Order

1. **Quick wins (all in Section 2)**
   - Add the 27 missing key translations to `kn.json`.
   - Prioritize: `shareQr.*` (9 keys) and `orders.common.map.*` (8 keys).

2. **High-impact hardcoded strings (Section 1)**
   - Refactor `app/become-dealer/page.tsx` and `app/become-facilitator/page.tsx` to use `t()` for all UI copy.
   - Refactor the UPI payment flow in `app/crop-detail/[subscriptionId]/orders/page.tsx` (lines 1738–1824).
   - Refactor error page in `app/crop/[referenceNumber]/page.tsx`.

3. **Verify PWAHeader**
   - Check if `PWAHeader` component (used in become-dealer/facilitator pages) accepts a translatable `title` prop, or if titles are hardcoded internally.

---

## Files Scanned
- **app/**: 75 `.tsx` files
- **components/**: 17 `.tsx` files
- **messages/**: `en.json`, `kn.json`, + 11 other locale files

