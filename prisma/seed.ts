import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main(){
  const currencies=[['LYD','الدينار الليبي','د.ل'],['USD','الدولار','$'],['USDT','تيثر','USDT'],['CNY','اليوان','¥']];
  for(const [code,name,symbol] of currencies) await prisma.currency.upsert({where:{code},update:{},create:{code,name,symbol,isDefault:code==='LYD'}});
  for(const name of ['نوع يدوي','USDT','عمليات بطاقة','حركة صندوق','صرف / تحويل عملة','حوالة مالية','كروت شي إن','مصروف / دفع فاتورة']) await prisma.transactionType.upsert({where:{name},update:{},create:{name}});
  await prisma.systemSetting.upsert({where:{key:'office'},update:{},create:{key:'office',value:{name:'المكتب المالي',phone:'',address:'',sessionMinutes:60,inactivityMinutes:15}}});
}
main().finally(()=>prisma.$disconnect());
