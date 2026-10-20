// Vitest runs this before importing application modules. Override inherited
// deployment variables so unit tests validate code, not Render secret syntax.
// This is a deliberately local, non-routable test URL; tests mock database access.
process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'development';
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:5432/schoolpro_test';
