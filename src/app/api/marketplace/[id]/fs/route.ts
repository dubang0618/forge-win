import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getTemplatePath } from '@/lib/marketplace-fs'
import fs from 'fs'
import nodePath from 'path'

/** Resolve a relative path within the template dir and validate it stays within bounds */
function resolveTemplatePath(templateId: string, relPath: string): { abs: string; templateDir: string } | null {
  const templateDir = getTemplatePath(templateId)
  const abs = nodePath.resolve(templateDir, relPath)
  if (abs !== templateDir && !abs.startsWith(templateDir + nodePath.sep)) return null
  return { abs, templateDir }
}

// POST /api/marketplace/[id]/fs — create file or folder
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const existing = db.prepare('SELECT * FROM marketplace_templates WHERE id = ?').get(id)
  if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { path: relPath, type, content } = body as {
    path?: string; type?: 'file' | 'folder'; content?: string
  }

  if (!relPath || !type) {
    return NextResponse.json({ error: 'path and type required' }, { status: 400 })
  }

  if (relPath.includes('..')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  const resolved = resolveTemplatePath(id, relPath)
  if (!resolved) return NextResponse.json({ error: 'path traversal not allowed' }, { status: 400 })

  try {
    if (type === 'folder') {
      fs.mkdirSync(resolved.abs, { recursive: true })
    } else {
      fs.mkdirSync(nodePath.dirname(resolved.abs), { recursive: true })
      fs.writeFileSync(resolved.abs, content || '', 'utf-8')
    }

    db.prepare("UPDATE marketplace_templates SET updated_at = datetime('now') WHERE id = ?").run(id)
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 })
  }
}

// PATCH /api/marketplace/[id]/fs — rename file or folder
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const existing = db.prepare('SELECT * FROM marketplace_templates WHERE id = ?').get(id)
  if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { oldPath, newPath } = body as { oldPath?: string; newPath?: string }

  if (!oldPath || !newPath) {
    return NextResponse.json({ error: 'oldPath and newPath required' }, { status: 400 })
  }

  if (oldPath.includes('..') || newPath.includes('..')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  const resolvedOld = resolveTemplatePath(id, oldPath)
  const resolvedNew = resolveTemplatePath(id, newPath)
  if (!resolvedOld || !resolvedNew) {
    return NextResponse.json({ error: 'path traversal not allowed' }, { status: 400 })
  }

  try {
    if (!fs.existsSync(resolvedOld.abs)) {
      return NextResponse.json({ error: 'Source path does not exist' }, { status: 404 })
    }

    fs.mkdirSync(nodePath.dirname(resolvedNew.abs), { recursive: true })
    fs.renameSync(resolvedOld.abs, resolvedNew.abs)

    db.prepare("UPDATE marketplace_templates SET updated_at = datetime('now') WHERE id = ?").run(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 })
  }
}

// PUT /api/marketplace/[id]/fs — copy or move file or folder
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const existing = db.prepare('SELECT * FROM marketplace_templates WHERE id = ?').get(id)
  if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { source, destination, action } = body as {
    source?: string; destination?: string; action?: 'copy' | 'move'
  }

  if (!source || destination == null || !action) {
    return NextResponse.json({ error: 'source, destination, and action required' }, { status: 400 })
  }

  if (source.includes('..') || destination.includes('..')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  const resolvedSource = resolveTemplatePath(id, source)
  const resolvedDestination = resolveTemplatePath(id, destination)
  if (!resolvedSource || !resolvedDestination) {
    return NextResponse.json({ error: 'path traversal not allowed' }, { status: 400 })
  }

  try {
    if (!fs.existsSync(resolvedSource.abs)) {
      return NextResponse.json({ error: 'source does not exist' }, { status: 404 })
    }

    let finalDest = resolvedDestination.abs
    if (fs.existsSync(finalDest) && fs.statSync(finalDest).isDirectory()) {
      finalDest = nodePath.join(finalDest, nodePath.basename(resolvedSource.abs))
    }

    fs.mkdirSync(nodePath.dirname(finalDest), { recursive: true })

    if (action === 'move' && fs.statSync(resolvedSource.abs).isDirectory() && finalDest.startsWith(resolvedSource.abs + nodePath.sep)) {
      return NextResponse.json({ error: 'cannot move folder into itself' }, { status: 400 })
    }

    if (action === 'copy' && fs.existsSync(finalDest)) {
      const ext = nodePath.extname(finalDest)
      const base = finalDest.slice(0, finalDest.length - ext.length)
      let counter = 1
      while (fs.existsSync(finalDest)) {
        finalDest = `${base} (${counter})${ext}`
        counter++
      }
    }

    if (action === 'copy') {
      fs.cpSync(resolvedSource.abs, finalDest, { recursive: true })
    } else {
      try {
        fs.renameSync(resolvedSource.abs, finalDest)
      } catch {
        fs.cpSync(resolvedSource.abs, finalDest, { recursive: true })
        fs.rmSync(resolvedSource.abs, { recursive: true, force: true })
      }
    }

    db.prepare("UPDATE marketplace_templates SET updated_at = datetime('now') WHERE id = ?").run(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 })
  }
}

// DELETE /api/marketplace/[id]/fs — delete file or folder
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const existing = db.prepare('SELECT * FROM marketplace_templates WHERE id = ?').get(id)
  if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

  const relPath = req.nextUrl.searchParams.get('path')
  if (!relPath) {
    return NextResponse.json({ error: 'path query param required' }, { status: 400 })
  }

  if (relPath.includes('..')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  const resolved = resolveTemplatePath(id, relPath)
  if (!resolved) return NextResponse.json({ error: 'path traversal not allowed' }, { status: 400 })

  try {
    if (!fs.existsSync(resolved.abs)) {
      return NextResponse.json({ error: 'Path does not exist' }, { status: 404 })
    }

    fs.rmSync(resolved.abs, { recursive: true, force: true })

    db.prepare("UPDATE marketplace_templates SET updated_at = datetime('now') WHERE id = ?").run(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 })
  }
}
