/**
 * Execute a cron task: run through the Claude Agent SDK and optionally notify via IM.
 * Each execution creates a new Session visible in the chat list.
 */

import { getDb } from '@/lib/db'
import crypto from 'crypto'
import { createForgeQuery } from '@/lib/sdk/client'
import { readWorkspaceFile } from '@/lib/workspace-fs'
import { getBridgeManager } from '@/lib/im/bridge-manager'
import { emitImEvent } from '@/lib/im/im-events'
import type { CronTaskRow } from '@/lib/types'

interface TaskConfig {
  check_interval?: string
  notify_channel?: string
  checklist_path?: string
}

interface TaskResult {
  status: 'ok' | 'alert' | 'error'
  result: string
  sessionId: string
}

export async function executeTask(task: CronTaskRow): Promise<TaskResult> {
  const fs = require('fs')
  const logPath = require('path').join(require('os').homedir(), '.forge', 'cron-debug.log')
  fs.appendFileSync(logPath, `\n[${new Date().toISOString()}] ========== executeTask START ==========\n`)
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] Task ID: ${task.id}, Name: ${task.name}, Type: ${task.action_type}\n`)

  try {
    if (task.is_heartbeat) {
      return await executeHeartbeat(task)
    }

    const actionType = task.action_type || 'custom-prompt'

    switch (actionType) {
      case 'run-agent':
        return await executeRunAgent(task)
      case 'run-skill':
        return await executeRunSkill(task)
      case 'custom-prompt':
      default:
        return await executeCustomPrompt(task)
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error'
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] EXCEPTION in executeTask: ${errorMsg}\n`)
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] Stack: ${err instanceof Error ? err.stack : 'N/A'}\n`)
    return { status: 'error', result: errorMsg, sessionId: '' }
  }
}

/**
 * Resolve the workspace_id to use for this task.
 * For heartbeat: uses the task's workspace_id or falls back to most recently opened.
 * For others: uses the task's workspace_id (required).
 */
function resolveWorkspaceId(task: CronTaskRow): string | null {
  if (task.workspace_id) return task.workspace_id

  // Fallback for heartbeat: use most recently opened workspace
  if (task.is_heartbeat) {
    const db = getDb()
    const recentWs = db.prepare('SELECT id FROM workspaces ORDER BY last_opened_at DESC LIMIT 1').get() as { id: string } | undefined
    return recentWs?.id || null
  }

  return null
}

async function executeHeartbeat(task: CronTaskRow): Promise<TaskResult> {
  const config = parseConfig(task.config)
  const workspaceId = resolveWorkspaceId(task)
  if (!workspaceId) {
    return { status: 'ok', result: 'No workspace configured', sessionId: '' }
  }

  // Load HEARTBEAT.md checklist
  const checklistPath = config.checklist_path || 'HEARTBEAT.md'
  const checklist = readWorkspaceFile(workspaceId, checklistPath)
  if (!checklist || !checklist.trim()) {
    return { status: 'ok', result: 'HEARTBEAT_OK (no checklist configured)', sessionId: '' }
  }

  const systemPrompt = [
    'You are a heartbeat agent performing routine checks.',
    'Execute each item in the checklist below using the available tools.',
    'After checking all items, summarize your findings.',
    'If everything is normal, respond with exactly: HEARTBEAT_OK',
    'If you find issues or items that need attention, list them clearly.',
    'Be concise — your output will be automatically delivered via IM notification.',
    'Do NOT try to send messages yourself or ask for API credentials.',
  ].join('\n')

  const userMessage = `Run the following heartbeat checklist:\n\n${checklist}`
  const sessionTitle = `[Scheduled] ${task.name}`

  const { text, sessionId } = await runAgentTask(systemPrompt, userMessage, workspaceId, sessionTitle, task.model)

  const isOk = text.includes('HEARTBEAT_OK')
  const status = isOk ? 'ok' : 'alert'

  if (!isOk && config.notify_channel) {
    await notifyIm(config.notify_channel, `📢 Heartbeat Alert\n\n${text}`)
  }

  return { status, result: text.slice(0, 500), sessionId }
}

async function executeRunAgent(task: CronTaskRow): Promise<TaskResult> {
  const fs = require('fs')
  const logPath = require('path').join(require('os').homedir(), '.forge', 'cron-debug.log')
  fs.appendFileSync(logPath, `\n[${new Date().toISOString()}] executeRunAgent START - task: ${task.name}\n`)

  const config = parseConfig(task.config)
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] Config parsed: ${JSON.stringify(config)}\n`)

  const workspaceId = resolveWorkspaceId(task)
  if (!workspaceId) {
    return { status: 'error', result: 'No workspace configured for this task', sessionId: '' }
  }

  // Load the agent's AGENT.md (or CLAUDE.md) from workspace or global
  const agentName = task.agent_name
  if (!agentName) {
    return { status: 'error', result: 'No agent specified', sessionId: '' }
  }

  // Try loading agent file from project, then global
  let agentPrompt = readWorkspaceFile(workspaceId, `agents/${agentName}/AGENT.md`)
  if (!agentPrompt) {
    agentPrompt = readWorkspaceFile(workspaceId, `agents/${agentName}/CLAUDE.md`)
  }

  const systemPrompt = agentPrompt
    ? `You are running as the "${agentName}" agent.\n\n${agentPrompt}`
    : `You are running as the "${agentName}" scheduled agent. Execute the task and report results concisely.`

  const userMessage = task.action || `Execute the ${agentName} agent task.`
  const sessionTitle = `[Scheduled] ${task.name}`

  fs.appendFileSync(logPath, `[${new Date().toISOString()}] About to call runAgentTask\n`)
  const { text, sessionId } = await runAgentTask(systemPrompt, userMessage, workspaceId, sessionTitle, task.model)
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] runAgentTask completed - sessionId: ${sessionId}, text length: ${text.length}\n`)

  if (config.notify_channel) {
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] Notification channel configured: ${config.notify_channel}\n`)
    await notifyIm(config.notify_channel, `⏰ ${task.name}\n\n${text.slice(0, 1000)}`)
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] notifyIm call completed\n`)
  } else {
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] No notification channel configured\n`)
  }

  return { status: 'ok', result: text.slice(0, 500), sessionId }
}

async function executeRunSkill(task: CronTaskRow): Promise<TaskResult> {
  const config = parseConfig(task.config)
  const workspaceId = resolveWorkspaceId(task)
  if (!workspaceId) {
    return { status: 'error', result: 'No workspace configured for this task', sessionId: '' }
  }

  const skillName = task.skill_name
  if (!skillName) {
    return { status: 'error', result: 'No skill specified', sessionId: '' }
  }

  // Load skill file
  const skillContent = readWorkspaceFile(workspaceId, `skills/${skillName}/SKILL.md`)

  const systemPrompt = skillContent
    ? `You are executing the "${skillName}" skill.\n\n${skillContent}`
    : `You are executing the "${skillName}" scheduled skill. Execute the task and report results concisely.`

  const userMessage = task.action || `Execute the ${skillName} skill.`
  const sessionTitle = `[Scheduled] ${task.name}`

  const { text, sessionId } = await runAgentTask(systemPrompt, userMessage, workspaceId, sessionTitle, task.model)

  if (config.notify_channel) {
    await notifyIm(config.notify_channel, `⏰ ${task.name}\n\n${text.slice(0, 1000)}`)
  }

  return { status: 'ok', result: text.slice(0, 500), sessionId }
}

async function executeCustomPrompt(task: CronTaskRow): Promise<TaskResult> {
  const fs = require('fs')
  const logPath = require('path').join(require('os').homedir(), '.forge', 'cron-debug.log')
  fs.appendFileSync(logPath, `\n[${new Date().toISOString()}] executeCustomPrompt START - task: ${task.name}\n`)

  const config = parseConfig(task.config)
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] Config parsed: ${JSON.stringify(config)}\n`)

  const workspaceId = resolveWorkspaceId(task)
  if (!workspaceId) {
    return { status: 'error', result: 'No workspace configured for this task', sessionId: '' }
  }

  const notifyTarget = config.notify_channel ? ` Your output will be automatically delivered to the user via ${config.notify_channel} — do NOT try to send messages yourself, just produce the content.` : ''
  const systemPrompt = [
    'You are a scheduled task agent running on behalf of the user.',
    'Execute the following action and report the result concisely.',
    `IMPORTANT: Your text output IS the deliverable.${notifyTarget}`,
    'Do NOT ask for API credentials, webhooks, or try to call any IM APIs.',
    'If the task is to send a message, just output that message directly.',
  ].join('\n')

  const sessionTitle = `[Scheduled] ${task.name}`
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] About to call runAgentTask\n`)
  const { text, sessionId } = await runAgentTask(systemPrompt, task.action, workspaceId, sessionTitle, task.model)
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] runAgentTask completed - sessionId: ${sessionId}, text length: ${text.length}\n`)

  if (config.notify_channel) {
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] Notification channel configured: ${config.notify_channel}\n`)
    await notifyIm(config.notify_channel, `⏰ ${task.name}\n\n${text.slice(0, 1000)}`)
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] notifyIm call completed\n`)
  } else {
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] No notification channel configured\n`)
  }

  return { status: 'ok', result: text.slice(0, 500), sessionId }
}

/**
 * Run a task via the Claude Agent SDK.
 * Creates a persistent session (visible in chat list) with [Scheduled] prefix.
 */
async function runAgentTask(
  systemPrompt: string,
  userMessage: string,
  workspaceId: string,
  sessionTitle: string,
  taskModel?: string,
): Promise<{ text: string; sessionId: string }> {
  const db = getDb()
  const sessionId = crypto.randomUUID()

  // Priority: task.model > default_model setting > fallback
  let model = 'claude-sonnet-4-6'
  if (taskModel && taskModel.trim()) {
    model = taskModel
  } else {
    const modelSetting = db.prepare("SELECT value FROM settings WHERE key = 'default_model'").get() as { value: string } | undefined
    if (modelSetting?.value) {
      // Try to parse as JSON first (for backward compatibility), fallback to raw string
      try {
        model = JSON.parse(modelSetting.value)
      } catch {
        model = modelSetting.value
      }
    }
  }

  // Create a persistent session in the database so it appears in the chat list
  db.prepare(
    "INSERT INTO sessions (id, title, workspace, model, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', datetime('now'), datetime('now'))"
  ).run(sessionId, sessionTitle, workspaceId, model)

  // Store the user message
  const userMsgId = crypto.randomUUID()
  db.prepare(
    "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, 'user', ?, datetime('now'))"
  ).run(userMsgId, sessionId, JSON.stringify([{ type: 'text', text: userMessage }]))

  // Debug logging to file
  const fs = require('fs')
  const logPath = require('path').join(require('os').homedir(), '.forge', 'cron-debug.log')
  fs.appendFileSync(logPath, `\n[${new Date().toISOString()}] Cron Executor - Model: ${model}\n`)

  const q = createForgeQuery({
    prompt: userMessage,
    sessionId,
    model,
    workspaceId,
    bypassPermissions: true,
    customSystemPrompt: systemPrompt,
    skipMcpServers: true,
  })

  const allTextBlocks: string[] = []

  for await (const msg of q) {
    if (msg.type === 'assistant') {
      for (const block of msg.message.content) {
        if (block.type === 'text') allTextBlocks.push(block.text)
      }
    }
  }

  const resultText = allTextBlocks.join('\n\n') || '(no output)'

  // Store the assistant response
  const assistantMsgId = crypto.randomUUID()
  db.prepare(
    "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, datetime('now'))"
  ).run(assistantMsgId, sessionId, JSON.stringify([{ type: 'text', text: resultText }]))

  // Notify desktop UI to refresh session list via SSE
  emitImEvent('im:session-changed', { sessionId, workspaceId })

  return { text: resultText, sessionId }
}

/**
 * Send a notification message through IM.
 * Resolves the target chat from channel_bindings:
 *   1. Prefer DM (p2p) bindings for that channel
 *   2. Fall back to any bound chat (group)
 */
async function notifyIm(channelId: string, message: string): Promise<void> {
  const fs = require('fs')
  const logPath = require('path').join(require('os').homedir(), '.forge', 'cron-debug.log')
  fs.appendFileSync(logPath, `\n[${new Date().toISOString()}] notifyIm START - channelId: ${channelId}\n`)

  const manager = getBridgeManager()
  const isConnected = manager.isConnected(channelId)
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] Channel connected: ${isConnected}\n`)

  if (!isConnected) {
    console.log(`[Cron] IM channel ${channelId} not connected, skipping notification`)
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] Channel not connected, returning\n`)
    return
  }

  // Find target chat from bindings
  const db = getDb()
  const bindings = db.prepare(
    'SELECT chat_id FROM channel_bindings WHERE channel_id = ? ORDER BY created_at DESC',
  ).all(channelId) as { chat_id: string }[]

  fs.appendFileSync(logPath, `[${new Date().toISOString()}] Found ${bindings.length} bindings\n`)

  if (bindings.length === 0) {
    console.log(`[Cron] No chat bindings for channel ${channelId}, skipping notification`)
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] No bindings found, returning\n`)
    return
  }

  // Send to the first (most recent) bound chat
  const targetChatId = bindings[0].chat_id
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] Target chat_id: ${targetChatId}\n`)

  try {
    const { DeliveryLayer } = await import('@/lib/im/delivery')
    const delivery = new DeliveryLayer()
    const adapters = manager.getAdapters()
    const adapter = adapters.get(channelId)

    fs.appendFileSync(logPath, `[${new Date().toISOString()}] Adapter found: ${!!adapter}\n`)

    if (!adapter) {
      console.log(`[Cron] No adapter for channel ${channelId}`)
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] No adapter, returning\n`)
      return
    }

    fs.appendFileSync(logPath, `[${new Date().toISOString()}] About to call delivery.deliver\n`)
    await delivery.deliver(adapter, targetChatId, message)
    console.log(`[Cron] Notification sent to ${channelId}:${targetChatId}: ${message.slice(0, 80)}`)
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] Notification sent successfully\n`)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(`[Cron] Failed to send notification to ${channelId}:`, errMsg)
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ERROR: ${errMsg}\n`)
  }
}

function parseConfig(configStr: string): TaskConfig {
  try {
    return JSON.parse(configStr) as TaskConfig
  } catch {
    return {}
  }
}
