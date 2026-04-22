import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import nodePath from 'path'
import {
  createForgeFile, createForgeFolder, renameForgeEntry, deleteForgeEntry,
  createProjectFile, createProjectFolder, renameProjectEntry, deleteProjectEntry,
  getProjectPath, getWorkspacePath, GLOBAL_WORKSPACE_ID,
} from '@/lib/workspace-fs'

/** Guard: reject project scope on global workspace (would expose entire home directory) */
function rejectGlobalProjectScope(id: string, scope: string): NextResponse | null {
  if (scope === 'project' && id === GLOBAL_WORKSPACE_ID) {
    return NextResponse.json(
      { error: 'project scope not allowed for global workspace' },
      { status: 400 },
    )
  }
  return null
}

// POST /api/workspaces/[id]/fs — create file or folder
// scope: 'forge' (default, relative to .claude/) or 'project' (relative to project root)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const { path: relPath, type, content, scope = 'forge' } = body as {
    path?: string; type?: 'file' | 'folder'; content?: string; scope?: 'forge' | 'project'
  }

  if (!relPath || !type) {
    return NextResponse.json({ error: 'path and type required' }, { status: 400 })
  }

  const guard = rejectGlobalProjectScope(id, scope)
  if (guard) return guard

  try {
    if (scope === 'project') {
      type === 'folder' ? createProjectFolder(id, relPath) : createProjectFile(id, relPath, content || '')
    } else {
      type === 'folder' ? createForgeFolder(id, relPath) : createForgeFile(id, relPath, content || '')
    }
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 })
  }
}

// PATCH /api/workspaces/[id]/fs — rename file or folder
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const { oldPath, newPath, scope = 'forge' } = body as {
    oldPath?: string; newPath?: string; scope?: 'forge' | 'project'
  }

  if (!oldPath || !newPath) {
    return NextResponse.json({ error: 'oldPath and newPath required' }, { status: 400 })
  }

  const guard = rejectGlobalProjectScope(id, scope)
  if (guard) return guard

  try {
    if (scope === 'project') {
      renameProjectEntry(id, oldPath, newPath)
    } else {
      renameForgeEntry(id, oldPath, newPath)
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 })
  }
}

// PUT /api/workspaces/[id]/fs — copy or move file/folder
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const { source, destination, action } = body as {
    source?: string; destination?: string; action?: 'copy' | 'move'
  }

  if (!source || !destination || !action) {
    return NextResponse.json({ error: 'source, destination, and action required' }, { status: 400 })
  }

  // source and destination are relative paths from project root (or .claude/ for global workspace)
  try {
    const root = id === GLOBAL_WORKSPACE_ID ? getWorkspacePath(id) : getProjectPath(id)
    const srcAbs = nodePath.resolve(root, source)
    const dstAbs = nodePath.resolve(root, destination)

    // Safety: both paths must be within root
    if (!srcAbs.startsWith(root) || !dstAbs.startsWith(root)) {
      return NextResponse.json({ error: 'path traversal not allowed' }, { status: 400 })
    }

    if (!fs.existsSync(srcAbs)) {
      return NextResponse.json({ error: 'source does not exist' }, { status: 404 })
    }

    // If destination is an existing folder, place the source inside it
    let finalDst = dstAbs
    if (fs.existsSync(dstAbs) && fs.statSync(dstAbs).isDirectory()) {
      finalDst = nodePath.join(dstAbs, nodePath.basename(srcAbs))
    }

    // Ensure parent directory exists
    fs.mkdirSync(nodePath.dirname(finalDst), { recursive: true })

    // Prevent moving a folder into itself
    if (action === 'move' && fs.statSync(srcAbs).isDirectory() && finalDst.startsWith(srcAbs + '/')) {
      return NextResponse.json({ error: 'cannot move folder into itself' }, { status: 400 })
    }

    // Handle name conflicts for copy: append (copy) suffix
    if (action === 'copy' && fs.existsSync(finalDst)) {
      const ext = nodePath.extname(finalDst)
      const base = finalDst.slice(0, finalDst.length - ext.length)
      let counter = 1
      while (fs.existsSync(finalDst)) {
        finalDst = `${base} (${counter})${ext}`
        counter++
      }
    }

    if (action === 'copy') {
      fs.cpSync(srcAbs, finalDst, { recursive: true })
    } else {
      // Move: try rename first (atomic on same device), fall back to copy+delete
      try {
        fs.renameSync(srcAbs, finalDst)
      } catch {
        fs.cpSync(srcAbs, finalDst, { recursive: true })
        fs.rmSync(srcAbs, { recursive: true, force: true })
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 })
  }
}

// DELETE /api/workspaces/[id]/fs — delete file or folder
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { searchParams } = req.nextUrl
  const relPath = searchParams.get('path')
  const scope = (searchParams.get('scope') || 'forge') as 'forge' | 'project'

  console.log('[DELETE /api/workspaces/[id]/fs]', { id, relPath, scope })

  if (!relPath) {
    return NextResponse.json({ error: 'path query param required' }, { status: 400 })
  }

  const guard = rejectGlobalProjectScope(id, scope)
  if (guard) return guard

  try {
    if (scope === 'project') {
      deleteProjectEntry(id, relPath)
    } else {
      deleteForgeEntry(id, relPath)
    }
    console.log('[DELETE /api/workspaces/[id]/fs] Success:', relPath)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[DELETE /api/workspaces/[id]/fs] Error:', err)
    return NextResponse.json({ error: String(err) }, { status: 400 })
  }
}
