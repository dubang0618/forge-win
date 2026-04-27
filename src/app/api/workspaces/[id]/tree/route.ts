import { NextRequest, NextResponse } from 'next/server'
import { getProjectPath, getWorkspacePath, ensureWorkspaceDir, GLOBAL_WORKSPACE_ID } from '@/lib/workspace-fs'
import { getDb } from '@/lib/db'
import fs from 'fs'
import path from 'path'

interface TreeNode {
  name: string
  type: 'file' | 'folder'
  children?: TreeNode[]
}

// Directories to hide from the project tree (not useful for browsing)
const HIDDEN_DIRS = new Set(['node_modules', '__pycache__', 'dist', 'build', 'out', '.next', '.nuxt'])

function buildTree(dirPath: string, maxDepth = 8, depth = 0): TreeNode[] {
  if (depth >= maxDepth) return []
  if (!fs.existsSync(dirPath)) return []

  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    .filter(e => {
      if (e.name === '.claude') return true // Always include .claude
      if (e.name.startsWith('.')) return false
      if (e.isDirectory() && HIDDEN_DIRS.has(e.name)) return false
      return true
    })
    .sort((a, b) => {
      // .claude always first
      if (a.name === '.claude') return -1
      if (b.name === '.claude') return 1
      // Folders first, then alphabetical
      if (a.isDirectory() && !b.isDirectory()) return -1
      if (!a.isDirectory() && b.isDirectory()) return 1
      return a.name.localeCompare(b.name)
    })

  return entries.map((entry) => {
    if (entry.isDirectory()) {
      return {
        name: entry.name,
        type: 'folder' as const,
        children: buildTree(path.join(dirPath, entry.name), maxDepth, depth + 1),
      }
    }
    return { name: entry.name, type: 'file' as const }
  })
}

// GET /api/workspaces/[id]/tree — show project directory contents
// For global workspace, shows unified .claude/ tree
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    if (id === GLOBAL_WORKSPACE_ID) {
      // Global mode: always safe — ~/.claude/ always exists
      ensureWorkspaceDir(id)
      const forgePath = getWorkspacePath(GLOBAL_WORKSPACE_ID)
      const tree = buildTree(forgePath, 8)
      return NextResponse.json({ tree })
    }

    // Project mode: check if folder still exists on disk before proceeding
    const row = getDb().prepare('SELECT path FROM workspaces WHERE id = ?').get(id) as { path: string } | undefined
    if (!row) {
      return NextResponse.json({ tree: [], folderMissing: true })
    }

    const projectPath = row.path
    if (!fs.existsSync(projectPath)) {
      // Folder was deleted from Finder — return empty tree with flag
      // Do NOT call ensureWorkspaceDir (would recreate the deleted directory)
      return NextResponse.json({ tree: [], folderMissing: true })
    }

    ensureWorkspaceDir(id)
    const tree = buildTree(projectPath)
    return NextResponse.json({ tree })
  } catch {
    return NextResponse.json({ tree: [] })
  }
}
