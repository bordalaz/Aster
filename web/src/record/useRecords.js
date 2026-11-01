import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api.js'

// Виртуальные поля, которые API отдаёт: вычисляемые (считает сам), связи (названиями), вложения.
const SERVED = new Set(['formula', 'rollup', 'multipleLookupValues', 'count', 'multipleRecordLinks', 'multipleAttachments'])
// Сервер пересчитывает формулы в фоне (~6 с на всю базу) — после правки перечитываем строки.
// ponytail: фиксированная задержка; если пересчёт станет дольше — отдавать версию расчёта и ждать её
const REFRESH_MS = 7000

// Поля таблицы + строки + точечный PATCH.
export function useRecords(tableId, refreshMs = REFRESH_MS) {
  const [fields, setFields] = useState([])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [fs, rs] = await Promise.all([
      api(`/api/tables/${tableId}/fields`),
      api(`/api/tables/${tableId}/records`),
    ])
    setFields(fs.filter(f => !f.options?.virtual || SERVED.has(f.kind) || f.options?.computed))
    setRows(rs)
    setLoading(false)
  }, [tableId])

  useEffect(() => { load() }, [load])

  // тихо, без «Загрузка…»: строки меняются на месте
  const refreshRows = useCallback(async () => {
    setRows(await api(`/api/tables/${tableId}/records`))
  }, [tableId])
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  // row — строка, которую видел пользователь (нужен её updated_at для оптимистичной блокировки).
  const patch = useCallback(async (row, values) => {
    try {
      const res = await api(`/api/tables/${tableId}/records/${row.id}`, {
        method: 'PATCH', body: { updated_at: row.updated_at, values },
      })
      setRows(rs => rs.map(r => r.id === row.id ? { ...r, ...values, updated_at: res.updated_at } : r))
      clearTimeout(timer.current)   // серия правок — одно перечитывание после последней
      timer.current = setTimeout(refreshRows, refreshMs)
    } catch (e) {
      if (e.status === 409) await load()  // кто-то изменил запись — показываем свежую
      throw e
    }
  }, [tableId, load, refreshRows, refreshMs])

  // Пакет правок (вставка из Excel): edits — [{row, values}]; одна транзакция на сервере, всё или ничего.
  const patchMany = useCallback(async edits => {
    try {
      const res = await api(`/api/tables/${tableId}/records`, {
        method: 'PATCH', body: { items: edits.map(e => ({ id: e.row.id, updated_at: e.row.updated_at, values: e.values })) },
      })
      const by = new Map(edits.map((e, i) => [e.row.id, { ...e.values, updated_at: res[i].updated_at }]))
      setRows(rs => rs.map(r => (by.has(r.id) ? { ...r, ...by.get(r.id) } : r)))
      clearTimeout(timer.current)
      timer.current = setTimeout(refreshRows, refreshMs)
    } catch (e) {
      if (e.status === 409) await load()
      throw e
    }
  }, [tableId, load, refreshRows, refreshMs])

  return { fields, rows, loading, patch, patchMany, reload: load, refresh: refreshRows }
}
