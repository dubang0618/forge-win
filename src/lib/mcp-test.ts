import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

/**
 * Test MCP server connectivity.
 * - stdio: check if command binary exists (absolute path or via `which`)
 * - SSE/HTTP: fetch the URL and accept 2xx or 405
 */
export async function testMcpServer(
  protocol: string,
  config: Record<string, unknown>
): Promise<'connected' | 'disconnected' | 'error'> {
  try {
    switch (protocol) {
      case 'stdio': {
        const command = String(config.command || '')
        if (!command) return 'disconnected'
        const mainCmd = command.split(/\s+/)[0]
        if (mainCmd.startsWith('/')) {
          return fs.existsSync(mainCmd) ? 'connected' : 'error'
        }
        execFileSync('/usr/bin/which', [mainCmd], { timeout: 3000, encoding: 'utf-8' })
        return 'connected'
      }

      case 'sse':
      case 'http': {
        const url = String(config.url || '')
        if (!url) return 'disconnected'
        let headers: Record<string, string> = {}
        if (typeof config.headers === 'string') {
          try { headers = JSON.parse(config.headers) } catch { /* ignore */ }
        } else if (typeof config.headers === 'object' && config.headers) {
          headers = config.headers as Record<string, string>
        }
        const res = await fetch(url, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(10000),
        })
        // Accept 2xx, 400 (MCP protocol error), or 405 (method not allowed)
        return (res.ok || res.status === 400 || res.status === 405) ? 'connected' : 'error'
      }

      default:
        return 'disconnected'
    }
  } catch {
    return 'error'
  }
}
