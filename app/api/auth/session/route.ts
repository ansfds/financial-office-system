import {getSession} from '@/lib/auth';import {ok,fail} from '@/lib/http';export async function GET(){return await getSession()?ok({authenticated:true}):fail('غير مصرح',401)}
