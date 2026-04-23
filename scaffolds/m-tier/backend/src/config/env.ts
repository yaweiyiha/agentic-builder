import "dotenv/config";

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
export const PORT = Number(process.env.PORT || 4000);
