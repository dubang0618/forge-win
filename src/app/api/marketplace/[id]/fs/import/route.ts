import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getTemplatePath } from '@/lib/marketplace-fs'
import fs from 'fs'
import nodePath from 'path'

// Recursive copy helper to avoid fs.cpSync crashes with Chinese paths on Windows
function copyDirRecursive(src: string, dest: string) {
  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true })
    }
    const entries = fs.readdirSync(src, { withFileTypes: true })
    for (const entry of entries) {
      copyDirRecursive(
        nodePath.join(src, entry.name),
        nodePath.join(dest, entry.name)
      )
    }
  } else {
    fs.copyFileSync(src, dest)
  }
}

// POST /api/marketplace/[id]/fs/import — import files from absolute paths into template
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const existing = db.prepare('SELECT * FROM marketplace_templates WHERE id = ?').get(id)
  if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { sourcePaths, destinationFolder } = body as {
    sourcePaths?: string[]
    destinationFolder?: string
  }

  if (!sourcePaths?.length || typeof destinationFolder !== 'string') {
    return NextResponse.json({ error: 'sourcePaths and destinationFolder required' }, { status: 400 })
  }

  if (destinationFolder.includes('..')) {
    return NextResponse.json({ error: 'Invalid destination' }, { status: 400 })
  }

  try {
    const templateDir = getTemplatePath(id)
    const dstDir = nodePath.resolve(templateDir, destinationFolder)

    // Safety: destination must be within template directory (or be the dir itself)
    if (dstDir !== templateDir && !dstDir.startsWith(templateDir + nodePath.sep)) {
      return NextResponse.json({ error: 'path traversal not allowed' }, { status: 400 })
    }

    fs.mkdirSync(dstDir, { recursive: true })

    const imported: string[] = []
    for (const srcPath of sourcePaths) {
      if (!fs.existsSync(srcPath)) continue

      const basename = nodePath.basename(srcPath)
      let finalDest = nodePath.join(dstDir, basename)

      // Avoid overwriting: append (copy) suffix if exists
      if (fs.existsSync(finalDest)) {
        const ext = nodePath.extname(basename)
        const nameNoExt = nodePath.basename(basename, ext)
        let counter = 1
        while (fs.existsSync(finalDest)) {
          finalDest = nodePath.join(dstDir, `${nameNoExt} (${counter})${ext}`)
          counter++
        }
      }

      copyDirRecursive(srcPath, finalDest)
      imported.push(nodePath.basename(finalDest))
    }

    db.prepare("UPDATE marketplace_templates SET updated_at = datetime('now') WHERE id = ?").run(id)
    return NextResponse.json({ ok: true, imported }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 })
  }
}
