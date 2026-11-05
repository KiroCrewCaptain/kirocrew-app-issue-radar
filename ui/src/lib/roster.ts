// The crew editor's agent roster and model list.
//
// The built-in read both through the dashboard's shared hooks (`useAgents`,
// `useAvailableModels`), which call `GET /api/agents/catalog` and `GET /api/models`
// -- paths outside this app's API grant. This copy asks its own backend, which
// answers each with the gateway's own handler for the same request, and keeps the
// subset of each hook's contract the editor reads.
import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { issueRadarApi } from '../api'
import { isPricedMultiplier } from '../host/models'

export interface RosterAgent {
  name: string
}

/** `useAgents(refreshTrigger)`: the roster, a load-failure flag and a retry. */
export function useAgents(refreshTrigger: number): {
  agents: RosterAgent[]
  defaultAgent: string
  error: boolean
  reload: () => void
  reloading: boolean
} {
  const [agents, setAgents] = useState<RosterAgent[]>([])
  const [defaultAgent, setDefaultAgent] = useState('')
  const [error, setError] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => {
    setReloading(true)
    setTick(t => t + 1)
  }, [])
  useEffect(() => {
    let cancelled = false
    issueRadarApi.agents().then(d => {
      if (cancelled) return
      const rows = Array.isArray(d?.agents) ? d.agents.filter(a => a && typeof a.name === 'string') : []
      setAgents(rows.map(a => ({ name: a.name })))
      setDefaultAgent(typeof d?.default_agent === 'string' ? d.default_agent : '')
      setError(false)
      setReloading(false)
    }).catch(() => {
      if (cancelled) return
      setError(true)
      setReloading(false)
    })
    return () => { cancelled = true }
  }, [refreshTrigger, tick])
  return { agents, defaultAgent, error, reload, reloading }
}

export interface ModelInfo {
  name: string
  displayName?: string
  rateMultiplier?: number
}

const AUTO_ONLY: ModelInfo[] = [{ name: 'auto' }]

/** `useAvailableModels({ enabled })`: the served models, `auto` first. */
export function useAvailableModels({ enabled }: { enabled?: boolean } = {}): ModelInfo[] {
  const query = useQuery({
    queryKey: ['issue-radar', 'models'],
    queryFn: async (): Promise<ModelInfo[]> => {
      const raw = await issueRadarApi.models()
      if (!Array.isArray(raw) || raw.length === 0) return AUTO_ONLY
      const rows = raw
        .filter(m => m && typeof m.model_name === 'string')
        .map(m => ({
          name: m.model_name,
          displayName: m.model_name !== 'auto' && m.display_name && m.display_name !== m.model_name ? m.display_name : undefined,
          rateMultiplier: isPricedMultiplier(m.rate_multiplier) ? m.rate_multiplier : undefined,
        }))
      return rows.some(m => m.name === 'auto') ? rows : [...AUTO_ONLY, ...rows]
    },
    ...(enabled === undefined ? {} : { enabled }),
  })
  return query.data ?? AUTO_ONLY
}
