/**
 * Seed an initial admin user.
 * Usage: ADMIN_EMAIL=you@hoichoi.com ADMIN_PASSWORD=changeme ADMIN_NAME="Hoichoi Admin" npm run seed:admin
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME ?? 'Admin';
  if (!email || !password) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD env vars first.');
    process.exit(1);
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`User ${email} already exists. Promoting to admin.`);
    await prisma.user.update({ where: { email }, data: { role: 'admin' } });
  } else {
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.create({ data: { email, name, passwordHash, role: 'admin' } });
    console.log(`Created admin: ${email}`);
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
