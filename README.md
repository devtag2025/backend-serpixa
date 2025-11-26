# Serpixa Backend

Express.js REST API backend for Serpixa.

## Tech Stack

- **Runtime:** Node.js (ES Modules)
- **Framework:** Express 5
- **Database:** MongoDB (Mongoose)
- **Authentication:** JWT + bcrypt
- **Email:** SendGrid
- **Payments:** Stripe

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB instance
- SendGrid API key
- Stripe API keys

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
MONGODB_URI=mongodb://localhost:27017/serpixa
JWT_SECRET=your-jwt-secret
SENDGRID_API_KEY=your-sendgrid-key
STRIPE_SECRET_KEY=your-stripe-secret
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

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |

*More endpoints coming soon...*

## License

ISC

