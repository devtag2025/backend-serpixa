# SEO Audit: Keyword count – where it comes from and how to verify

## Where the recommendation gets the count

The **keyword occurrence count** in the SEO audit (and in the “keyword density” recommendation) is **not** taken from the full page you see in the browser. It is computed from:

1. **DataForSEO On-Page API** (`/v3/on_page/instant_pages`)
   - The API returns extracted page content in `items[0].meta.content.plain_text_content` (and optionally in `items[0].content.plain_text_content`).
2. **What we use**
   - We build one string = **headings (H1, H2, H3)** + **body** from that API response.
   - We **normalize** that string (lowercase, remove accents, collapse spaces).
   - We count **keyword matches** with a case-insensitive regex on this normalized string.
   - **Word count** used for density is the number of words in this **same** normalized string (so “occurrences in N words” always refers to the exact text we analyzed).

So the count can be **lower** than a manual count on the full page because:

- DataForSEO may return only **main content** (e.g. article body), and can exclude or truncate navigation, footer, sidebar, repeated blocks, etc.
- So if you count 32 occurrences of “Netlinking” on the full page (including menu/footer), but the API only gives us the main text where the word appears 9 times, the audit will show **9 occurrences**.

## How to verify and test

### 1. Use the verification object in the API response

Each SEO audit’s **keyword analysis** includes a `keywordVerification` object so you can see exactly what was used for the recommendation:

- **`source`** – Short description: “DataForSEO plain_text_content + headings (main extracted content; may exclude nav/footer)”.
- **`analyzedTextLength`** – Character length of the normalized text we analyzed.
- **`analyzedWordCount`** – Word count we computed from that text (used for density).
- **`wordCountFromApi`** – Word count from DataForSEO (for comparison).
- **`wordCountUsed`** – The word count actually used for density (same as `analyzedWordCount` when we have text).
- **`keywordOccurrences`** – The keyword count that drives the recommendation.

**Where to see it**

- When you **run an audit**, the response includes `audit.keywordAnalysis.keywordVerification`.
- When you **get an audit by ID** (e.g. `GET /api/seo-audit/:id`), the same `keywordAnalysis.keywordVerification` is returned.

So you can verify: “The recommendation says X occurrences in Y words” by checking that `keywordVerification.keywordOccurrences === X` and `keywordVerification.wordCountUsed === Y`.

### 2. Optional debug logging

To trace the count in server logs, you can enable debug in `dataforseo.service.js` (e.g. log when `process.env.DEBUG_SEO_KEYWORD === '1'`):

- Log `analyzedWordCount`, `keywordOccurrences`, and optionally a short snippet of the analyzed text (e.g. first 200 chars) so you can confirm which content was used.

### 3. Manual testing against the same URL

- Run an audit for the URL and keyword (e.g. “Netlinking”).
- In the response, read `keywordAnalysis.keywordVerification`.
- Compare:
  - **Your manual count** on the **full page** (e.g. 32) can be higher because it includes header/nav/footer/sidebar.
  - **Our count** (`keywordOccurrences`, e.g. 9) is only in the text DataForSEO returned (often main content only).

So a difference like “32 on the page vs 9 in the audit” is expected when the API’s extracted content is a subset of the full page.

## Summary

| What you see | Meaning |
|--------------|--------|
| Recommendation: “9 occurrences in 4409 words” | We found 9 keyword matches in the **extracted** text; that text had 4409 words (or we use API word count if our analyzed text was empty). |
| You count 32 on the full page | Your count includes **all** visible areas (nav, footer, sidebar, etc.). DataForSEO often only returns main content, so our count is lower. |
| `keywordVerification` in the API | Use it to confirm the exact `keywordOccurrences` and `wordCountUsed` that produced the recommendation. |

No code change is required to “fix” the 9 vs 32 difference if the 32 includes content outside what the API returns; the verification object is there to make the source of the count transparent and testable.
