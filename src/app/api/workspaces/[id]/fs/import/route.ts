import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import nodePath from 'path'
import { getProjectPath, getWorkspacePath, GLOBAL_WORKSPACE_ID } from '@/lib/workspace-fs'

// Helper function to recursively copy directories with better error handling
function copyDirRecursive(src: string, dest: string) {
  // Create destination directory
  fs.mkdirSync(dest, { recursive: true })

  // Read source directory
  const entries = fs.readdirSync(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = nodePath.join(src, entry.name)
    const destPath = nodePath.join(dest, entry.name)

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

// POST /api/workspaces/[id]/fs/import — import files from absolute paths (Finder paste/drop)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const body = await req.json()
  const { sourcePaths, destinationFolder } = body as {
    sourcePaths?: string[]  // Absolute paths from OS
    destinationFolder?: string  // Relative path within project (or within .claude/ for global)
  }

  console.log('[import] Request received:', { id, sourcePaths, destinationFolder })

  if (!sourcePaths?.length || !destinationFolder) {
    return NextResponse.json({ error: 'sourcePaths and destinationFolder required' }, { status: 400 })
  }

  try {
    // Global workspace: resolve relative to ~/.claude/; project: relative to project root
    const root = id === GLOBAL_WORKSPACE_ID ? getWorkspacePath(id) : getProjectPath(id)
    const dstDir = nodePath.resolve(root, destinationFolder)
    console.log('[import] Resolved paths:', { root, dstDir })

    // Safety: destination must be within root
    if (!dstDir.startsWith(root)) {
      return NextResponse.json({ error: 'path traversal not allowed' }, { status: 400 })
    }

    fs.mkdirSync(dstDir, { recursive: true })
    console.log('[import] Destination directory created')

    const imported: string[] = []
    for (const srcPath of sourcePaths) {
      console.log('[import] Processing source:', srcPath)
      if (!fs.existsSync(srcPath)) {
        console.log('[import] Source does not exist, skipping')
        continue
      }

      const basename = nodePath.basename(srcPath)
      const dest = nodePath.join(dstDir, basename)
      console.log('[import] Destination:', dest)

      // Avoid overwriting: append (copy) suffix if exists
      let finalDest = dest
      if (fs.existsSync(dest)) {
        const ext = nodePath.extname(basename)
        const nameNoExt = nodePath.basename(basename, ext)
        let counter = 1
        while (fs.existsSync(finalDest)) {
          finalDest = nodePath.join(dstDir, `${nameNoExt} (${counter})${ext}`)
          counter++
        }
        console.log('[import] Destination exists, using:', finalDest)
      }

      console.log('[import] Starting copy...')
      try {
        // Use a more robust copy method for Windows with Chinese paths
        const stat = fs.statSync(srcPath)
        if (stat.isDirectory()) {
          // For directories, copy recursively with better error handling
          copyDirRecursive(srcPath, finalDest)
        } else {
          // For files, simple copy
          fs.copyFileSync(srcPath, finalDest)
        }
        console.log('[import] Copy completed')
        imported.push(nodePath.basename(finalDest))
      } catch (copyErr) {
        console.error('[import] Copy failed for', srcPath, ':', copyErr)
        // Continue with other files even if one fails
      }
    }

    console.log('[import] All files imported:', imported)
    return NextResponse.json({ ok: true, imported }, { status: 201 })
  } catch (err) {
    console.error('[import] Error:', err)
    return NextResponse.json({ error: String(err) }, { status: 400 })
  }
}
