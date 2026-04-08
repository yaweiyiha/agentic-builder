import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, generateSessionToken } from './auth';

describe('auth utilities', () => {
  const plainPassword = 'mySecurePassword123!';

  describe('hashPassword', () => {
    it('should return a string', async () => {
      const hashedPassword = await hashPassword(plainPassword);
      expect(typeof hashedPassword).toBe('string');
      expect(hashedPassword.length).toBeGreaterThan(0);
    });

    it('should return different hashes for the same password due to salting', async () => {
      const hashedPassword1 = await hashPassword(plainPassword);
      const hashedPassword2 = await hashPassword(plainPassword);
      expect(hashedPassword1).not.toBe(hashedPassword2);
    });

    it('should throw an error if password is empty', async () => {
      await expect(hashPassword('')).rejects.toThrow('Password cannot be empty');
    });

    it('should throw an error if password is null or undefined (type-level check, runtime might convert to string)', async () => {
      // @ts-ignore - testing runtime behavior with invalid input
      await expect(hashPassword(null)).rejects.toThrow();
      // @ts-ignore - testing runtime behavior with invalid input
      await expect(hashPassword(undefined)).rejects.toThrow();
    });
  });

  describe('verifyPassword', () => {
    let hashedPassword: string;

    beforeAll(async () => {
      hashedPassword = await hashPassword(plainPassword);
    });

    it('should return true for a correct password', async () => {
      const isMatch = await verifyPassword(plainPassword, hashedPassword);
      expect(isMatch).toBe(true);
    });

    it('should return false for an incorrect password', async () => {
      const isMatch = await verifyPassword('wrongPassword', hashedPassword);
      expect(isMatch).toBe(false);
    });

    it('should return false if the hashed password is incorrect', async () => {
      const isMatch = await verifyPassword(plainPassword, 'invalidHash');
      expect(isMatch).toBe(false);
    });

    it('should return false if plain password is empty', async () => {
      const isMatch = await verifyPassword('', hashedPassword);
      expect(isMatch).toBe(false);
    });

    it('should return false if hashed password is empty', async () => {
      const isMatch = await verifyPassword(plainPassword, '');
      expect(isMatch).toBe(false);
    });

    it('should return false if either password is null or undefined', async () => {
      // @ts-ignore
      expect(await verifyPassword(null, hashedPassword)).toBe(false);
      // @ts-ignore
      expect(await verifyPassword(plainPassword, null)).toBe(false);
      // @ts-ignore
      expect(await verifyPassword(undefined, hashedPassword)).toBe(false);
      // @ts-ignore
      expect(await verifyPassword(plainPassword, undefined)).toBe(false);
    });
  });

  describe('generateSessionToken', () => {
    it('should return a string', () => {
      const userId = 'user-123';
      const token = generateSessionToken(userId);
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });

    it('should include the user ID in the token (mock specific)', () => {
      const userId = 'user-456';
      const token = generateSessionToken(userId);
      expect(token).toContain(userId);
    });

    it('should generate different tokens on subsequent calls (mock specific, due to timestamp)', () => {
      const userId = 'user-789';
      const token1 = generateSessionToken(userId);
      const token2 = generateSessionToken(userId);
      expect(token1).not.toBe(token2);
    });
  });
});
