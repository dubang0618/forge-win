import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getCronEngine } from '@/lib/cron/engine'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()
  const row = db.prepare('SELECT * FROM cron_tasks WHERE id = ?').get(id)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(row)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const existing = db.prepare('SELECT id FROM cron_tasks WHERE id = ?').get(id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()

  const allowedFields = [
    'name', 'schedule', 'action', 'action_type', 'agent_name', 'skill_name',
    'workspace_id', 'model', 'enabled', 'config', 'last_run_at', 'last_run_result',
  ]
  const sets: string[] = []
  const values: unknown[] = []

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      let val = body[field]
      if (field === 'config' && typeof val === 'object') val = JSON.stringify(val)
      if (field === 'enabled' && typeof val === 'boolean') val = val ? 1 : 0
      sets.push(`${field} = ?`)
      values.push(val)
    }
  }

  if (sets.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 })

  sets.push("updated_at = datetime('now')")
  values.push(id)

  db.prepare(`UPDATE cron_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  const updated = db.prepare('SELECT * FROM cron_tasks WHERE id = ?').get(id)

  // Auto-start cron engine when a task is enabled
  if (body.enabled === true || body.enabled === 1) {
    const engine = getCronEngine()
    if (!engine.isRunning()) engine.start()
  }

  return NextResponse.json(updated)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const row = db.prepare('SELECT is_heartbeat FROM cron_tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (row?.is_heartbeat) return NextResponse.json({ error: 'Cannot delete heartbeat task' }, { status: 400 })

  db.prepare('DELETE FROM cron_tasks WHERE id = ?').run(id)
  return NextResponse.json({ ok: true })
}
