import { Sequelize } from 'sequelize';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://blueprint:password@localhost:5432/_test_';

export const sequelize = new Sequelize(DATABASE_URL, {
  logging: false,
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
