import { z } from 'zod';

const boolFromEnv = z.preprocess((v) => typeof v === 'string' ? v.toLowerCase() === 'true' : v, z.boolean());
const identifier = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/);
const schemaTable = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*$/);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  ENABLE_TEST_ENDPOINTS: boolFromEnv.default(false),
  ALLOW_DESTRUCTIVE_TEST_FIXTURES: boolFromEnv.default(false),
  DATABASE_URL: z.string().url().optional(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  IDENTITY_MAPPING_VERIFIED: boolFromEnv.default(false),
  IDENTITY_SCHEMA: identifier.default('public'),
  IDENTITY_TABLE: identifier.optional(),
  IDENTITY_USER_ID_COLUMN: identifier.optional(),
  IDENTITY_SCHOOL_ID_COLUMN: identifier.optional(),
  IDENTITY_ROLE_COLUMN: identifier.optional(),
  IDENTITY_ACTIVE_COLUMN: identifier.optional(),
  TEST_ALLOWED_ROLES: z.string().default(''),
  SYNTHETIC_SCHOOL_A_ID: z.string().uuid().optional(),
  SYNTHETIC_SCHOOL_B_ID: z.string().uuid().optional(),
  REQUIRED_SCHEMA_TABLES: z.string().default('')
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // Do not print invalid values: they may contain secrets.
  throw new Error(`Invalid environment configuration: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
}
export const config = parsed.data;

export function identityMappingConfigured(): boolean {
  return config.IDENTITY_MAPPING_VERIFIED && Boolean(
    config.IDENTITY_TABLE && config.IDENTITY_USER_ID_COLUMN && config.IDENTITY_SCHOOL_ID_COLUMN && config.IDENTITY_ROLE_COLUMN && config.IDENTITY_ACTIVE_COLUMN &&
    config.TEST_ALLOWED_ROLES.split(',').map((role) => role.trim()).filter(Boolean).length > 0
  );
}

export function allowedTestRoles(): string[] {
  return config.TEST_ALLOWED_ROLES.split(',').map((role) => role.trim()).filter(Boolean);
}

export function requiredTables(): Array<{ schema: string; table: string }> {
  if (!config.REQUIRED_SCHEMA_TABLES.trim()) return [];
  return config.REQUIRED_SCHEMA_TABLES.split(',').map((raw) => {
    const value = raw.trim();
    const parsedName = schemaTable.safeParse(value);
    if (!parsedName.success) throw new Error('REQUIRED_SCHEMA_TABLES contains an invalid table identifier');
    const [schema, table] = value.split('.') as [string, string];
    return { schema, table };
  });
}

export function assertSafeIdentifier(value: string): string {
  return identifier.parse(value);
}
