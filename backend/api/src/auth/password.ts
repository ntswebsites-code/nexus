import bcrypt from 'bcryptjs';
import { config } from '../config';

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, config.bcryptRounds);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// A valid bcrypt hash of a random string, compared against when the account
// does not exist so that response time does not reveal which emails are registered.
export const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-' + Math.random(), config.bcryptRounds);
