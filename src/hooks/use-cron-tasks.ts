'use client'

import { useState, useEffect, useCallback } from 'react'
import type { CronTask, TaskActionType } from '@/lib/types'

interface DbCronTask {
  id: string
  name: string
  schedule: string
  action: string
  action_type: string
  agent_name: string
  skill_name: string
  workspace_id: string
  model: string
  enabled: number
  is_heartbeat: number
  config: string
  last_run_at: string | null
  last_run_result: string | null
  created_at: string
  updated_at: string
}

function mapTask(row: DbCronTask): CronTask {
  let config: Record<string, string> = {}
  try { config = JSON.parse(row.config) } catch { /* empty */ }

  return {
    id: row.id,
    name: row.name,
    schedule: row.schedule,
    action: row.action,
    actionType: (row.action_type || 'custom-prompt') as TaskActionType,
    agentName: row.agent_name || '',
    skillName: row.skill_name || '',
    workspaceId: row.workspace_id || '',
    model: row.model || '',
    enabled: row.enabled === 1,
    isHeartbeat: row.is_heartbeat === 1,
    config,
    lastRunAt: row.last_run_at,
    lastRunResult: row.last_run_result,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function useCronTasks(workspaceId?: string) {
  const [tasks, setTasks] = useState<CronTask[]>([])
  const [loading, setLoading] = useState(true)

  const fetchTasks = useCallback(async () => {
    try {
      const qs = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ''
      const res = await fetch(`/api/cron-tasks${qs}`)
      const data = (await res.json()) as DbCronTask[]
      setTasks(data.map(mapTask))
    } catch (err) {
      console.error('Failed to fetch cron tasks:', err)
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  const heartbeat = tasks.find((t) => t.isHeartbeat) || null

  const createTask = useCallback(async (opts: {
    name: string
    schedule?: string
    action?: string
    action_type?: TaskActionType
    agent_name?: string
    skill_name?: string
    workspace_id?: string
    model?: string
    config?: Record<string, string>
  }) => {
    const res = await fetch('/api/cron-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    })
    if (!res.ok) throw new Error(`Failed to create task: ${res.status}`)
    const data = mapTask(await res.json())
    setTasks((prev) => [...prev, data])
    return data
  }, [])

  const updateTask = useCallback(async (id: string, updates: Record<string, unknown>) => {
    const res = await fetch(`/api/cron-tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    if (!res.ok) throw new Error(`Failed to update task: ${res.status}`)
    const data = mapTask(await res.json())
    setTasks((prev) => prev.map((t) => (t.id === id ? data : t)))
    return data
  }, [])

  const deleteTask = useCallback(async (id: string) => {
    const res = await fetch(`/api/cron-tasks/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(`Failed to delete task: ${res.status}`)
    setTasks((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const executeTask = useCallback(async (id: string) => {
    const res = await fetch(`/api/cron-tasks/${id}/execute`, { method: 'POST' })
    if (!res.ok) throw new Error(`Failed to execute task: ${res.status}`)
    await fetchTasks()
    return res.json()
  }, [fetchTasks])

  return { tasks, heartbeat, loading, createTask, updateTask, deleteTask, executeTask, refreshTasks: fetchTasks }
}
