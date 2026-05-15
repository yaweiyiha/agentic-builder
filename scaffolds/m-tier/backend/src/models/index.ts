import {
  CreationOptional,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model,
} from "sequelize";
import { sequelize } from "../db";
/**
 * Model Definition Demo
 */
// export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
//   declare id: CreationOptional<number>;
//   declare name: string;
//   declare email: string;
//   declare passwordHash: string;
// }

// User.init(
//   {
//     id: {
//       type: DataTypes.INTEGER,
//       autoIncrement: true,
//       primaryKey: true,
//     },
//     name: {
//       type: DataTypes.STRING,
//       allowNull: false,
//     },
//     email: {
//       type: DataTypes.STRING,
//       allowNull: false,
//       unique: true,
//     },
//     passwordHash: {
//       type: DataTypes.STRING,
//       allowNull: false,
//     },
//   },
//   {
//     sequelize,
//     modelName: 'User',
//   }
// );

export async function syncModels(): Promise<void> {
  // Without `alter`, existing tables are never updated when models gain columns.
  // Enable `alter` in non-production (or when DB_SYNC_ALTER=true) so local DBs
  // stay aligned with the Sequelize models after codegen iterations.
  const syncAlter =
    process.env.DB_SYNC_ALTER === "true" ||
    (process.env.NODE_ENV !== "production" &&
      process.env.DB_SYNC_ALTER !== "false");
  await sequelize.sync({ alter: syncAlter });
}
