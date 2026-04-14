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
  await sequelize.sync();
}
