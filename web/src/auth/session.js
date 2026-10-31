import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api.js'

// Статусы: 'loading' | 'in' | 'out'. При 401 — 'out' (показываем вход).
export function useSession() {
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState('loading')

  const refresh = useCallback(async () => {
    try {
      setUser(await api('/api/auth/me'))
      setStatus('in')
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setStatus('out')
      else throw e
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const login = useCallback(async (login, password) => {
    await api('/api/auth/login', { method: 'POST', body: { login, password } })
    await refresh()
  }, [refresh])

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' })
    setUser(null)
    setStatus('out')
  }, [])

  return { user, status, login, logout, refresh }
}
