import { neon } from '@neondatabase/serverless';
import { NextResponse } from 'next/server';

const sql = neon(process.env.DATABASE_URL);

export const dynamic = 'force-dynamic'; // don't cache, so new reviews show up

export async function GET() {
  const rows = await sql`SELECT * FROM canteen_reviews ORDER BY created_at DESC`;
  return NextResponse.json(rows);
}

export async function POST(req) {
  const { name, rating, comment } = await req.json();
  if (!comment || !rating) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }
  const rows = await sql`
    INSERT INTO canteen_reviews (name, rating, comment)
    VALUES (${name || 'Anonymous'}, ${rating}, ${comment})
    RETURNING *`;
  return NextResponse.json(rows[0]);
}
