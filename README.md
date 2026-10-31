# CUSTOM FIT PRIME — Burgundy Lookbook Review

This is a review-only version. It has not been pushed to GitHub or deployed to Vercel.

## What's changed
- Removed the announcement strip, navigation header, large text hero and intro block from the Lookbook page.
- Moved the supplied brand-ad video to the very top of the page, full-width, with a poster image, controls and a separate sound-enable button.
- Changed the page background to deep burgundy with antique-gold accents and ivory typography.
- Divided the 22 unique uploaded blouse boards into four editorial chapters: Classic Necklines (10), Contemporary Silhouettes (5), Statement Sleeves (2), and Embellished & Heritage (5).
- Kept the original full design boards, including front, back, neckline, sleeve and detail panels.
- Retained search, category filters, design-detail view, save-to-lookbook, saved looks and enquiry brief controls.
- Kept a simple Home link in the footer instead of a top navigation bar.

## Open on Windows
1. Extract the complete ZIP into a normal folder.
2. Keep `index.html`, `lookbook.html`, `assets/` and the BAT files together at the same level.
3. Double-click `OPEN_LOOKBOOK_PREVIEW.bat`.
4. The new Lookbook opens with the ad at the top. Use the built-in video volume control or the Enable sound button.

## Video note
The supplied advertisement draft is 13.354 seconds. It is embedded at the top as provided; this review package does not claim that it has already been corrected to 15 seconds.

## Image note
The gallery includes the first 22 unique user-supplied blouse boards. New uploads can be added to the existing chapters or assigned to new chapters after review.

## Deploy structure after approval
```text
index.html
lookbook.html
assets/
  custom-fit-prime-logo.png
  hero-emerald.webp
  custom-fit-prime-ad-draft.mp4
  lookbook/
    blouse-look-01.webp
    ...
    blouse-look-22.webp
```

For Vercel static hosting use Framework Preset `Other`, Root Directory `./`, no build command, and Output Directory `.`.
