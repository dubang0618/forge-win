import { NextRequest, NextResponse } from 'next/server'
import { getWorkspacePath } from '@/lib/workspace-fs'
import fs from 'fs'
import path from 'path'

/**
 * GET /api/workspaces/:id/skill-files?skillPath=xxx
 * 获取 skill 文件夹内的所有文件列表
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { searchParams } = req.nextUrl
  const skillPath = searchParams.get('skillPath')

  if (!skillPath) {
    return NextResponse.json({ error: 'skillPath required' }, { status: 400 })
  }

  try {
    const workspacePath = getWorkspacePath(id)
    const fullPath = path.join(workspacePath, 'skills', skillPath)

    console.log('[GET /api/workspaces/[id]/skill-files]', { id, skillPath, fullPath })

    if (!fs.existsSync(fullPath)) {
      return NextResponse.json({ error: 'Path not found' }, { status: 404 })
    }

    const stat = fs.statSync(fullPath)

    // 如果是文件，返回单个文件
    if (stat.isFile()) {
      return NextResponse.json({
        type: 'file',
        files: [{ name: path.basename(fullPath), path: skillPath, isDirectory: false }]
      })
    }

    // 如果是文件夹，递归读取所有文件
    const files: Array<{ name: string; path: string; isDirectory: boolean }> = []

    function scanDir(dirPath: string, relativePath: string) {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })

      for (const entry of entries) {
        // 跳过 node_modules 和隐藏文件
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
          continue
        }

        const entryRelPath = relativePath ? `${relativePath}/${entry.name}` : entry.name

        if (entry.isDirectory()) {
          files.push({
            name: entry.name,
            path: entryRelPath,
            isDirectory: true
          })
          // 递归扫描子文件夹
          scanDir(path.join(dirPath, entry.name), entryRelPath)
        } else {
          files.push({
            name: entry.name,
            path: entryRelPath,
            isDirectory: false
          })
        }
      }
    }

    scanDir(fullPath, '')

    console.log('[GET /api/workspaces/[id]/skill-files] Found files:', files.length)

    return NextResponse.json({
      type: 'directory',
      files
    })
  } catch (err) {
    console.error('[GET /api/workspaces/[id]/skill-files] Error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
