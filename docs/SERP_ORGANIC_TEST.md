# DataForSEO SERP (Google Organic) – test payload and request

## Endpoint

- **URL:** `POST https://api.dataforseo.com/v3/serp/google/organic/live/regular`  
  (Sandbox: `POST https://sandbox.dataforseo.com/v3/serp/google/organic/live/regular`)
- **Auth:** HTTP Basic (your DataForSEO login = email, password = API password)
- **Body:** JSON array of task objects (same structure Serpixa uses for competitor/SERP data)

---

## Payload (same as Serpixa)

**File:** `docs/serp_organic_test_payload.json`

```json
[
  {
    "keyword": "Netlinking",
    "location_name": "Belgium",
    "language_name": "French",
    "device": "desktop",
    "depth": 100
  }
]
```

- **`keyword`** (required): search term (e.g. "Netlinking").
- **`location_name`**: geo for results (e.g. "Belgium", "United States", "France").
- **`language_name`**: language (e.g. "French", "English").
- **`device`**: `"desktop"` | `"mobile"` | `"tablet"`.
- **`depth`**: number of SERP results to return (e.g. 100; we use top 10 for competitors).

---

## Other payload examples

**US English:**
```json
[
  {
    "keyword": "SEO backlinks",
    "location_name": "United States",
    "language_name": "English",
    "device": "desktop",
    "depth": 100
  }
]
```

**France French:**
```json
[
  {
    "keyword": "Netlinking",
    "location_name": "France",
    "language_name": "French",
    "device": "desktop",
    "depth": 100
  }
]
```

---

## cURL examples

Replace `YOUR_LOGIN` (your DataForSEO email) and `YOUR_API_PASSWORD`.

**Production:**
```bash
curl -X POST "https://api.dataforseo.com/v3/serp/google/organic/live/regular" \
  -u "YOUR_LOGIN:YOUR_API_PASSWORD" \
  -H "Content-Type: application/json" \
  -d @docs/serp_organic_test_payload.json
```

**Sandbox:**
```bash
curl -X POST "https://sandbox.dataforseo.com/v3/serp/google/organic/live/regular" \
  -u "YOUR_LOGIN:YOUR_API_PASSWORD" \
  -H "Content-Type: application/json" \
  -d @docs/serp_organic_test_payload.json
```

**Inline JSON:**
```bash
curl -X POST "https://api.dataforseo.com/v3/serp/google/organic/live/regular" \
  -u "YOUR_LOGIN:YOUR_API_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '[{"keyword":"Netlinking","location_name":"Belgium","language_name":"French","device":"desktop","depth":100}]'
```

---

## Response – where Serpixa gets data

- **`tasks[0].result[0].items`** – list of SERP items (organic, ads, etc.).
- Organic results have **`type`: `"organic"`**; we filter these and use the top 10 as “competitors”.
- Each item has **`title`**, **`url`**, **`domain`**, **`description`**, **`breadcrumb`**, etc.
- We use these for competitor titles/URLs and for a rough word-count benchmark (from snippet length).
