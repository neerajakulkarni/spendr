// server/prisma/seed.js
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const email = 'demo@example.com';
  const passwordHash = await bcrypt.hash('demo1234', 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, password: passwordHash }
  });

  const types = ['income','checking','savings','credit'];
  const acct = {};
  for (const t of types) {
    const a = await prisma.account.upsert({
      where: { userId_name: { userId: user.id, name: t } },
      update: {},
      create: { userId: user.id, type: t, name: t, balance: 0 }
    });
    acct[t] = a.id;
  }

  const dataDir = path.join(__dirname, '../data');
  const txFile = path.join(dataDir, 'transactions.json');
  let txns = [];
  if (fs.existsSync(txFile)) {
    txns = JSON.parse(fs.readFileSync(txFile, 'utf8'));
  } else {
    // minimal fallback example
    txns = [
      { date: '2025-07-01', amount: 1900, merchant: 'Payroll', category: 'income', account_type: 'income' },
      { date: '2025-07-02', amount: -1600, merchant: 'Rent', category: 'housing', account_type: 'checking' },
      { date: '2025-07-04', amount: -65, merchant: 'CoffeeCo', category: 'coffee', account_type: 'credit' },
    ];
  }

  await prisma.transaction.createMany({
    data: txns.map(t => ({
      userId: user.id,
      accountId: acct[t.account_type || 'checking'],
      date: new Date(t.date),
      amount: Number(t.amount),
      merchant: t.merchant || 'Unknown',
      category: t.category || 'other',
      isRecurring: !!t.is_recurring
    }))
  });

  // Default budget
  await prisma.budget.upsert({
    where: { userId: user.id },
    update: { untouchablePct: 0.2 },
    create: { userId: user.id, untouchablePct: 0.2 }
  });

  console.log('Seed complete. Login as:', email, 'password: demo1234');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
