require('dotenv').config();

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

const config = {
  use_env_variable: 'DATABASE_URL',
  dialect: 'postgres',
  logging: false,
};

module.exports = {
  development: config,
  test: config,
  production: config,
};
