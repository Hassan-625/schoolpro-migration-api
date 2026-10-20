// Unit tests must never inherit Render's staging or production database credentials.
// This syntactically valid loopback URL is intentionally non-routable for test purposes;
// the suite injects mocked database clients and must not open a real connection.
process.env.DATABASE_URL = 'postgresql://unit_test:unit_test@127.0.0.1:1/unit_test?sslmode=disable';
