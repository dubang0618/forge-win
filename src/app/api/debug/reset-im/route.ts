import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function POST() {
  try {
    const db = getDb()

    // Delete all channel bindings
    db.prepare('DELETE FROM channel_bindings').run()

    // Delete all sessions
    db.prepare('DELETE FROM sessions').run()

    // Delete all messages
    db.prepare('DELETE FROM messages').run()

    return NextResponse.json({
      success: true,
      message: 'IM bindings and sessions cleared'
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: String(error)
    }, { status: 500 })
  }
}
