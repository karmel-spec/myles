# The Birth of Myles

A keepsake book for Abby: the birth story of Myles Bryant White (October 10,
2026) in two voices, the minute-by-minute timeline his grandma kept and
Abby's own journal of the three days, set into the timeline at the moments it
describes, with the professional photographs from the birth day. One page that
works as a phone app and prints as a photo book.

- **Read** — the story on a phone, chapter by chapter. Each chapter opens on
  its hero photo; journal passages sit between the timeline moments.
- **Book** — the same story laid out magazine-style as book pages, with
  Print / Save as PDF at Blurb 8×10 layflat size (with bleed) or Letter.
- **Add to it** — with the family passphrase: edit any moment or journal
  passage, add moments, passages and chapters, birth facts, a cover photo,
  and photos placed by the time they were taken (pick files, or paste a
  Google Photos album link; shots already in the book are flagged).
  **Review photos** shows every photo on one screen for culling.

Everything the family adds is stored in this site's own Netlify Blob store.
No database, no other accounts.

## Put it online (one time, about five minutes)

1. Push this repository to GitHub.
2. In Netlify: **Add new site → Import an existing project → GitHub →** pick
   this repository. Leave the build settings as they are (they come from
   `netlify.toml`) and click **Deploy**.
3. Under **Site configuration → Site details → Change site name**, pick the
   address you want, for example `myles-birth-story.netlify.app`.
4. Open the site. The first visitor is asked to choose the family passphrase;
   after that everyone with the passphrase can add to the book.

Optional: set a `BABYBOOK_PIN` environment variable instead, and the site
uses that as the passphrase.

## Printing

Open **Book**, pick the page size, click **Print / Save as PDF**, and in the
dialog choose Save as PDF, no margins, background graphics on. Upload the
PDF to Blurb (Standard Portrait 8×10, Layflat, ImageWrap) through its PDF to
Book tool; the cover is built in Blurb's own cover editor.

## Files

- `site/index.html`, `site/book.css`, `site/app.js` — the page
- `site/story.js` — the birth story as shipped: timeline, journal, chapter
  heroes and which shipped photo goes with which moment (edits made in the
  app win over it)
- `site/photos/` — the professional birth-day photographs, 2400 px, metadata stripped
- `netlify/functions/babybook.mjs` — `/api/babybook`, the only backend
- `netlify/functions/photo.mjs` — serves `/photo/<name>` from the Blob store
