import "dotenv/config";
import { Sequelize } from 'sequelize';

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
    console.log('Database connection has been established successfully.');
  } catch (error) {
    console.error('Unable to connect to the database:', error);
    throw error;
  }
}
