import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/architecture/module/db/schema.js',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  verbose: true,
  strict: true,
});
