/**
 * Seed (create or update) an admin user from env.
 * Usage: npm run db:seed
 * Env: SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD (required); SEED_ADMIN_NAME, SEED_ADMIN_FORCE (optional).
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;
const name = process.env.SEED_ADMIN_NAME ?? null;
const force = process.env.SEED_ADMIN_FORCE === '1' || process.argv.includes('--force');

async function main() {
  if (!email || !password) {
    console.error(
      'Missing SEED_ADMIN_EMAIL or SEED_ADMIN_PASSWORD. Set them in .env or export before running.'
    );
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const existing = await prisma.admin.findUnique({ where: { email } });
  if (existing) {
    if (!force) {
      console.log(`Admin already exists for ${email}. Skipping (use SEED_ADMIN_FORCE=1 or --force to update password).`);
      return;
    }
    await prisma.admin.update({
      where: { email },
      data: {
        passwordHash,
        ...(name !== null && { name }),
      },
    });
    console.log(`Admin updated: ${email}`);
  } else {
    await prisma.admin.create({
      data: {
        email,
        passwordHash,
        name: name ?? undefined,
      },
    });
    console.log(`Admin created: ${email}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
