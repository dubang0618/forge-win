import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getCronEngine } from '@/lib/cron/engine'
import crypto from 'crypto'

export async function GET(req: NextRequest) {
  const db = getDb()
  const { searchParams } = new URL(req.url)
  const workspaceId = searchParams.get('workspace_id')

  let rows
  if (workspaceId) {
    // Return tasks for the specified workspace + global heartbeat task
    rows = db.prepare(
      'SELECT * FROM cron_tasks WHERE workspace_id = ? OR is_heartbeat = 1 ORDER BY is_heartbeat DESC, updated_at DESC'
    ).all(workspaceId)
  } else {
    rows = db.prepare('SELECT * FROM cron_tasks ORDER BY is_heartbeat DESC, updated_at DESC').all()
  }
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const db = getDb()
  const body = await req.json()
  const id = crypto.randomUUID()

  db.prepare(`
    INSERT INTO cron_tasks (id, name, schedule, action, action_type, agent_name, skill_name, workspace_id, model, enabled, config)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    body.name || 'New Task',
    body.schedule || '',
    body.action || '',
    body.action_type || 'custom-prompt',
    body.agent_name || '',
    body.skill_name || '',
    body.workspace_id || '',
    body.model || '',
    body.enabled !== undefined ? (body.enabled ? 1 : 0) : 1,
    typeof body.config === 'string' ? body.config : JSON.stringify(body.config || {})
  )

  const created = db.prepare('SELECT * FROM cron_tasks WHERE id = ?').get(id)

  // Auto-start cron engine when a task is created (it may not have started
  // at boot if there were no enabled tasks at that time)
  const engine = getCronEngine()
  if (!engine.isRunning()) engine.start()

  return NextResponse.json(created, { status: 201 })
}
