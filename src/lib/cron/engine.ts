/**
 * Cron execution engine.
 * Singleton scheduler that checks all enabled tasks every 60 seconds.
 */

import { getDb } from '@/lib/db'
import crypto from 'crypto'
import { matchesCron } from './cron-parser'
import { executeTask } from './executor'
import type { CronTaskRow } from '@/lib/types'

declare const globalThis: {
  __forgeCronEngine?: CronEngine
} & typeof global

class CronEngine {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private executingTasks = new Set<string>()

  start(): void {
    if (this.running) return
    this.running = true
    console.log('[CronEngine] Started')

    // Calculate delay to align with the next whole minute
    const now = new Date()
    const secondsUntilNextMinute = 60 - now.getSeconds()
    const msUntilNextMinute = secondsUntilNextMinute * 1000 - now.getMilliseconds()

    console.log(`[CronEngine] Aligning to next minute in ${secondsUntilNextMinute}s (${msUntilNextMinute}ms)`)

    // Wait until the next whole minute, then start checking every 60 seconds
    setTimeout(() => {
      if (!this.running) return
      console.log('[CronEngine] Aligned to minute boundary, starting periodic checks')
      this.tick()
      this.timer = setInterval(() => this.tick(), 60_000)
    }, msUntilNextMinute)
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    console.log('[CronEngine] Stopped')
  }

  isRunning(): boolean {
    return this.running
  }

  private async tick(): Promise<void> {
    if (!this.running) return

    const fs = require('fs')
    const logPath = require('path').join(require('os').homedir(), '.forge', 'cron-debug.log')
    const now = new Date()
    fs.appendFileSync(logPath, `\n[${now.toISOString()}] ========== TICK ==========\n`)

    const db = getDb()
    const tasks = db.prepare('SELECT * FROM cron_tasks WHERE enabled = 1').all() as CronTaskRow[]
    fs.appendFileSync(logPath, `[${now.toISOString()}] Found ${tasks.length} enabled tasks\n`)

    for (const task of tasks) {
      if (!task.schedule.trim()) {
        fs.appendFileSync(logPath, `[${now.toISOString()}] Task ${task.id}: empty schedule, skipping\n`)
        continue
      }
      if (this.executingTasks.has(task.id)) {
        fs.appendFileSync(logPath, `[${now.toISOString()}] Task ${task.id}: already executing, skipping\n`)
        continue
      }

      const matches = matchesCron(task.schedule, now)
      fs.appendFileSync(logPath, `[${now.toISOString()}] Task ${task.id} (${task.schedule}): matches=${matches}\n`)

      if (matches) {
        fs.appendFileSync(logPath, `[${now.toISOString()}] Task ${task.id}: TRIGGERING\n`)
        this.executingTasks.add(task.id)
        this.runTask(task).finally(() => {
          this.executingTasks.delete(task.id)
          fs.appendFileSync(logPath, `[${now.toISOString()}] Task ${task.id}: execution finished\n`)
        })
      }
    }
  }

  private async runTask(task: CronTaskRow): Promise<void> {
    const fs = require('fs')
    const logPath = require('path').join(require('os').homedir(), '.forge', 'cron-debug.log')
    fs.appendFileSync(logPath, `\n[${new Date().toISOString()}] ========== runTask START: ${task.id} ==========\n`)
    console.log(`[CronEngine] Executing task: ${task.id} (${task.name})`)

    const db = getDb()
    const startTime = new Date().toISOString()

    try {
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] Calling executeTask...\n`)
      const { status, result, sessionId } = await executeTask(task)
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] executeTask returned: status=${status}, sessionId=${sessionId}, result length=${result.length}\n`)

      // Record execution with session_id
      const execId = crypto.randomUUID()
      db.prepare(
        'INSERT INTO task_executions (id, task_id, task_name, result, status, session_id, executed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(execId, task.id, task.name, result, status, sessionId || '', startTime)

      // Update task last run
      db.prepare(
        "UPDATE cron_tasks SET last_run_at = ?, last_run_result = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(startTime, result.slice(0, 200), task.id)

      // Auto-disable "once" tasks (specific day+month in cron = one-time task)
      const cronParts = task.schedule.split(/\s+/)
      if (cronParts.length === 5 && cronParts[2] !== '*' && cronParts[3] !== '*') {
        db.prepare("UPDATE cron_tasks SET enabled = 0, updated_at = datetime('now') WHERE id = ?").run(task.id)
        console.log(`[CronEngine] One-time task ${task.id} auto-disabled after execution`)
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] One-time task auto-disabled\n`)
      }

      console.log(`[CronEngine] Task ${task.id}: ${status} — ${result.slice(0, 100)}`)
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] runTask SUCCESS\n`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      console.error(`[CronEngine] Task ${task.id} failed:`, errorMsg)
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] runTask EXCEPTION: ${errorMsg}\n`)
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] Stack: ${err instanceof Error ? err.stack : 'N/A'}\n`)

      const execId = crypto.randomUUID()
      db.prepare(
        'INSERT INTO task_executions (id, task_id, task_name, result, status, session_id, executed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(execId, task.id, task.name, errorMsg, 'error', '', startTime)

      db.prepare(
        "UPDATE cron_tasks SET last_run_at = ?, last_run_result = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(startTime, `Error: ${errorMsg}`, task.id)
    }
  }
}

export function getCronEngine(): CronEngine {
  if (!globalThis.__forgeCronEngine) {
    globalThis.__forgeCronEngine = new CronEngine()
    // Auto-start if there are any enabled tasks
    const db = getDb()
    const enabledCount = db.prepare('SELECT COUNT(*) as count FROM cron_tasks WHERE enabled = 1').get() as { count: number }
    if (enabledCount.count > 0) {
      globalThis.__forgeCronEngine.start()
      console.log(`[CronEngine] Auto-started (${enabledCount.count} enabled task(s))`)
    }
  }
  return globalThis.__forgeCronEngine
}
