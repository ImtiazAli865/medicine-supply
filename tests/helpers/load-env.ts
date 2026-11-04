import { config } from "dotenv";

// Test-only configuration. Integration tests use a dedicated TEST Supabase project.
config({ path: ".env.test.local" });
