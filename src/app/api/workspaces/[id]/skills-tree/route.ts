import { NextRequest, NextResponse } from 'next/server'
import { getWorkspacePath, getProjectPath, GLOBAL_WORKSPACE_ID } from '@/lib/workspace-fs'
import fs from 'fs'
import path from 'path'

interface SkillTreeNode {
  name: string
  type: 'file' | 'folder'
  path: string
  children?: SkillTreeNode[]
  enabled?: boolean
  isSymlink?: boolean
}

function buildSkillsTree(dirPath: string, basePath = '', maxDepth = 6, depth = 0): SkillTreeNode[] {
  if (depth >= maxDepth || !fs.existsSync(dirPath)) return []

  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    .filter(e => !e.name.startsWith('.'))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1
      if (!a.isDirectory() && b.isDirectory()) return 1
      return a.name.localeCompare(b.name)
    })

  return entries.map(entry => {
    const relPath = basePath ? `${basePath}/${entry.name}` : entry.name
    const fullPath = path.join(dirPath, entry.name)

    // Check if it's a symlink
    let isSymlink = false
    try {
      const stats = fs.lstatSync(fullPath)
      isSymlink = stats.isSymbolicLink()
    } catch {
      // Ignore errors
    }

    if (entry.isDirectory()) {
      // Check if skill folder has SKILL.md → mark as enabled
      const skillMd = path.join(dirPath, entry.name, 'SKILL.md')
      const hasSkillMd = fs.existsSync(skillMd)
      let enabled: boolean | undefined
      if (hasSkillMd) {
        // Parse enabled from frontmatter
        try {
          const content = fs.readFileSync(skillMd, 'utf-8')
          enabled = !content.includes('enabled: false')
        } catch {
          enabled = true
        }
      }
      return {
        name: entry.name,
        type: 'folder' as const,
        path: relPath,
        children: buildSkillsTree(path.join(dirPath, entry.name), relPath, maxDepth, depth + 1),
        ...(hasSkillMd && { enabled }),
        ...(isSymlink && { isSymlink: true }),
      }
    }
    return {
      name: entry.name,
      type: 'file' as const,
      path: relPath,
      ...(isSymlink && { isSymlink: true }),
    }
  })
}

// GET /api/workspaces/[id]/skills-tree — full directory tree of .claude/skills/
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    // Check if project folder still exists (skip for global workspace)
    if (id !== GLOBAL_WORKSPACE_ID) {
      try {
        const projectPath = getProjectPath(id)
        if (!fs.existsSync(projectPath)) return NextResponse.json({ tree: [] })
      } catch {
        return NextResponse.json({ tree: [] })
      }
    }
    const skillsDir = path.join(getWorkspacePath(id), 'skills')
    const tree = buildSkillsTree(skillsDir)
    return NextResponse.json({ tree })
  } catch {
    return NextResponse.json({ tree: [] })
  }
}
