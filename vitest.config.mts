import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': import.meta.dirname } },
  test: { include: ['tests/**/*.test.ts'], fileParallelism: false, env: { DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://snapflow:snapflow@localhost:5432/snapflow', RESEND_API_KEY: '', ANTHROPIC_API_KEY: '' } },
});
