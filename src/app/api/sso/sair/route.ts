import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/sso/sair
 *
 * Saída única: o Sistema iBox chama esta rota (num quadro invisível) quando
 * a pessoa clica em "Sair", para encerrar também a sessão do CRM.
 */
export async function GET() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  return new NextResponse('ok', { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } })
}
