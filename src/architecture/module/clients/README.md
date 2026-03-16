# Tafseer Caching System

This directory contains the implementation of the tafseer caching system for Tadabbur AI. The caching system is designed to store and retrieve AI-generated tafseer explanations from a database to improve performance and reduce API costs.

## Components

### 1. dbClient.js

The main database client implementation that provides:

- **Database Connection**: Creates and manages the connection to the PostgreSQL database using Neon serverless.
- **Cache Key Generation**: Generates unique cache keys based on tafseer text and metadata.
- **Get Cached Tafseer**: Retrieves existing tafseer explanations from the cache.
- **Save Tafseer to Cache**: Stores newly generated tafseer explanations.
- **Get or Generate Tafseer**: High-level function that checks cache first and generates new tafseer if not found.

### 2. db/schema.js

Defines the database schema for the `generated_tafsir_cache` table using Drizzle ORM. This table stores:

- **Key Information**: surah, ayah, verse key, tafsir ID, author, slug
- **Content**: original tafseer, plain text version, explained version
- **Metadata**: language, model used, prompt version, additional context
- **Timestamps**: createdAt and updatedAt fields for tracking
- **Hash**: Source hash for cache key validation

## Configuration

1. Create a `.env` file in the `tadabbur-be` directory
2. Add your database URL:
   ```
   DATABASE_URL="postgresql://username:password@host:port/database?sslmode=require"
   ```

## Usage

The caching system is integrated into the AI layer in `ai.js`:

```javascript
export async function generateExplanation(tafseerText, verse, tafseerAuthor) {
    return await getOrGenerateTafseer(tafseerText, verse, tafseerAuthor, async () => {
        // Existing AI generation logic
    });
}
```

## Performance Benefits

- **Reduced API Costs**: Avoids re-generating the same tafseer multiple times
- **Faster Response Times**: Returns cached results instantly
- **Scalability**: Handles increased traffic with cached responses
- **Consistent Results**: Ensures the same explanation is returned for identical inputs

## Integration Points

1. **AI Layer**: Checks cache before generating new explanations
2. **API Endpoint**: `/generate-explanation` endpoint uses cached results
3. **Database**: Stores and retrieves cached tafseer explanations

## Database Requirements

- PostgreSQL database (Neon serverless recommended)
- Drizzle ORM migrations
- Database URL configuration in `.env` file
