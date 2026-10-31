import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'

// Поля таблицы (без виртуальных — у них нет данных в записях) + строки + точечный PATCH.
export function useRecords(tableId) {
  const [fields, setFields] = useState([])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [fs, rs] = await Promise.all([
      api(`/api/tables/${tableId}/fields`),
      api(`/api/tables/${tableId}/records`),
    ])
    setFields(fs.filter(f => !f.options?.virtual))
    setRows(rs)
    setLoading(false)
  }, [tableId])

  useEffect(() => { load() }, [load])

  // row — строка, которую видел пользователь (нужен её updated_at для оптимистичной блокировки).
  const patch = useCallback(async (row, values) => {
    try {
      const res = await api(`/api/tables/${tableId}/records/${row.id}`, {
        method: 'PATCH', body: { updated_at: row.updated_at, values },
      })
      setRows(rs => rs.map(r => r.id === row.id ? { ...r, ...values, updated_at: res.updated_at } : r))
    } catch (e) {
      if (e.status === 409) await load()  // кто-то изменил запись — показываем свежую
      throw e
    }
  }, [tableId, load])

  return { fields, rows, loading, patch, reload: load }
}
