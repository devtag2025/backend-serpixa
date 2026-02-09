# DataForSEO instant_pages – test payload and request

## Endpoint

- **URL:** `POST https://api.dataforseo.com/v3/on_page/instant_pages`  
  (Sandbox: `POST https://sandbox.dataforseo.com/v3/on_page/instant_pages`)
- **Auth:** HTTP Basic (your DataForSEO login = email, password = API password)
- **Body:** JSON array of task objects (max 20 tasks per request, max 5 same domain)

---

## Minimal payload (same as Serpixa)

```json
[
  {
    "url": "https://www.glowmarkagency.be/quest-ce-que-le-netlinking/",
    "enable_javascript": true,
    "enable_browser_rendering": true
  }
]
```

- **`url`** (required): absolute URL of the page to audit.
- **`enable_javascript`**: load scripts (needed for many modern pages).
- **`enable_browser_rendering`**: full browser emulation (styles, images, etc.).

---

## Extended payload (with locale)

```json
[
  {
    "url": "https://www.glowmarkagency.be/quest-ce-que-le-netlinking/",
    "enable_javascript": true,
    "enable_browser_rendering": true,
    "browser_preset": "desktop",
    "accept_language": "fr-BE,fr;q=0.9,en;q=0.8"
  }
]
```

- **`browser_preset`**: `"desktop"` | `"mobile"` | `"tablet"`.
- **`accept_language`**: language header (helps with localized content).

---

## cURL examples

Replace `YOUR_LOGIN` (your DataForSEO email) and `YOUR_API_PASSWORD`.

**Production:**

```bash
curl -X POST "https://api.dataforseo.com/v3/on_page/instant_pages" \
  -u "YOUR_LOGIN:YOUR_API_PASSWORD" \
  -H "Content-Type: application/json" \
  -d @docs/instant_pages_test_payload.json
```

**Sandbox:**

```bash
curl -X POST "https://sandbox.dataforseo.com/v3/on_page/instant_pages" \
  -u "YOUR_LOGIN:YOUR_API_PASSWORD" \
  -H "Content-Type: application/json" \
  -d @docs/instant_pages_test_payload.json
```

**Inline JSON (change URL if needed):**

```bash
curl -X POST "https://api.dataforseo.com/v3/on_page/instant_pages" \
  -u "YOUR_LOGIN:YOUR_API_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '[{"url":"https://www.glowmarkagency.be/quest-ce-que-le-netlinking/","enable_javascript":true,"enable_browser_rendering":true}]'
```

---

## Where keyword count comes from in the response

After a successful call, inspect:

- **`tasks[0].result[0].items[0].meta.content.plain_text_content`** – main extracted text (we count the keyword in this + headings).
- **`tasks[0].result[0].items[0].meta.content.plain_text_word_count`** – word count from the API.
- **`tasks[0].result[0].items[0].meta.htags`** – `h1`, `h2`, `h3` arrays we prepend to the text before counting.

Search for `"netlinking"` in `plain_text_content` to see how many times it appears in the content DataForSEO returns (this is what we use for the “9 occurrences” style result).
