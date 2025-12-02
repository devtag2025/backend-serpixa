# Serpixa Backend

Express.js REST API backend for Serpixa.

## Tech Stack

- **Runtime:** Node.js (ES Modules)
- **Framework:** Express 5
- **Database:** MongoDB (Mongoose)
- **Authentication:** JWT + bcrypt
- **Email:** SendGrid
- **Payments:** Stripe
- **SERP Data:** DataForSEO API

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB instance
- SendGrid API key
- Stripe API keys
- DataForSEO account (email and API password)

### Installation

```bash
# Install dependencies
npm install

# Create environment file
cp .env.example .env
# Edit .env with your configuration
```

### Environment Variables

Create a `.env` file in the root directory:

```env
NODE_ENV=development
PORT=5000
MONGO_URI=mongodb://localhost:27017/serpixa
JWT_SECRET=your-jwt-secret
ACCESS_TOKEN_SECRET=your-access-token-secret
REFRESH_TOKEN_SECRET=your-refresh-token-secret
SENDGRID_API_KEY=your-sendgrid-key
STRIPE_SECRET_KEY=your-stripe-secret
STRIPE_WEBHOOK_SECRET=your-stripe-webhook-secret
CLIENT_URL=http://localhost:3000
DATAFORSEO_EMAIL=your-email@example.com
DATAFORSEO_API_PASSWORD=your-dataforseo-api-password
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

### Running the Server

```bash
# Development (with hot reload)
npm run dev

# Production
npm start
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start production server |
| `npm run dev` | Start development server with nodemon |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Fix ESLint errors |
| `npm run format` | Format code with Prettier |

## Project Structure

```
src/
├── config/         # Configuration files
├── controllers/    # Route controllers
├── jobs/           # Background jobs
├── middlewares/    # Express middlewares
├── models/         # Mongoose models
├── routes/         # API routes
├── services/       # Business logic
├── templates/      # Email templates
├── utils/          # Utility functions
├── validators/     # Request validators
├── app.js          # Express app setup
└── server.js       # Server entry point
```

## API Endpoints

### Health Check
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |

### Authentication
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/v1/auth/register` | Register new user | No |
| POST | `/api/v1/auth/login` | Login user | No |
| GET | `/api/v1/auth/profile` | Get user profile | Yes |
| POST | `/api/v1/auth/logout` | Logout user | Yes |

### SERP (Search Engine Results Page)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/v1/serp/search` | Get competitor results for a keyword | Yes |
| POST | `/api/v1/serp/bulk-search` | Get competitor results for multiple keywords (max 10) | Yes |

#### SERP API Usage

**Single Keyword Search:**
```bash
POST /api/v1/serp/search
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "keyword": "best seo tools",
  "locationName": "United States",
  "languageName": "English",
  "device": "desktop",
  "depth": 100
}
```

**Bulk Keyword Search:**
```bash
POST /api/v1/serp/bulk-search
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "keywords": ["seo tools", "keyword research", "backlink checker"],
  "locationName": "United States",
  "languageName": "English",
  "device": "desktop"
}
```

**Response Format:**
```json
{
  "statusCode": 200,
  "success": true,
  "message": "Competitor results retrieved successfully",
  "data": {
    "keyword": "best seo tools",
    "location": "United States",
    "language": "English",
    "device": "desktop",
    "competitors": [
      {
        "position": 1,
        "title": "10 Best SEO Tools in 2024",
        "url": "https://example.com/seo-tools",
        "domain": "example.com",
        "description": "Comprehensive list of the best SEO tools...",
        "breadcrumb": "Home > Tools > SEO"
      }
    ],
    "totalResults": 10,
    "searchInfo": {
      "seResultsCount": 1000000,
      "checkUrl": "https://www.google.com/search?q=best+seo+tools",
      "datetime": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

## License

ISC

