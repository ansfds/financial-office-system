const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function customerNo(index) {
  return `#${String(index).padStart(4, '0')}`;
}

async function main() {
  const existing = await prisma.person.findMany({
    where: { customerNo: { not: null } },
    select: { customerNo: true },
  });
  const taken = new Set(existing.map((person) => person.customerNo).filter(Boolean));
  const people = await prisma.person.findMany({
    where: { customerNo: null },
    orderBy: { createdAt: 'asc' },
  });

  let index = 1;
  for (const person of people) {
    while (taken.has(customerNo(index))) index += 1;

    const next = customerNo(index);
    await prisma.person.update({
      where: { id: person.id },
      data: { customerNo: next },
    });

    taken.add(next);
    index += 1;
  }

  console.log(JSON.stringify({ updated: people.length }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
