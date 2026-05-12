import "dotenv/config";
import { Sequelize } from 'sequelize';
import { enableTimescaleExtension } from './utils/timescale';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

export const sequelize = new Sequelize(DATABASE_URL, {
  dialect: "postgres",
  logging: process.env.NODE_ENV === "development" ? console.log : false,
  dialectOptions: {
    ssl:
      process.env.DB_SSL === "true"
        ? {
            require: true,
            rejectUnauthorized: false,
          }
        : false,
  },
});

export async function initDb(): Promise<void> {
  try {
    await sequelize.authenticate();
    console.log("Database connection has been established successfully.");
  } catch (error) {
    console.error("Unable to connect to the database:", error);
    throw error;
  }

  // TimescaleDB — handled by the helper (src/utils/timescale.ts) so the
  // server starts on plain Postgres too. NEVER call `CREATE EXTENSION` or
  // `create_hypertable` directly anywhere in this project: route every
  // such call through one of:
  //   - enableTimescaleExtension(sequelize)
  //   - createHypertableIfPossible(queryInterface, table, timeColumn)
  //   - runTimescaleQuery(sequelize, sql, description)
  // Each helper respects TIMESCALE_DISABLED=1 and catches the missing-
  // extension error, so a fresh Postgres install never crashes startup.
  await enableTimescaleExtension(sequelize);
}
