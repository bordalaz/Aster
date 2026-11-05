import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api.js'

// Виртуальные поля, которые API отдаёт: вычисляемые (считает сам), связи (названиями), вложения.
export const SERVED = new Set(['formula', 'rollup', 'multipleLookupValues', 'count', 'multipleRecordLinks', 'multipleAttachments', 'button'])   // button — значения нет, только действие (card/ButtonField.jsx)
// Сервер пересчитывает зависящие от правки формулы в фоне (обычно < 1 с) — после правки перечитываем
// строки с ?fresh=1: сервер отвечает, когда пересчёт закончен. Пауза склеивает серию правок в одно чтение.
const REFRESH_MS = 300
// Связи в интерфейсе — [{id, name}], на сервер уходят списком id; в строке остаются с названиями до перечитывания.
export const wire = values => Object.fromEntries(Object.entries(values).map(([k, v]) =>
  [k, Array.isArray(v) && v.length && v[0] !== null && typeof v[0] === 'object' && 'id' in v[0] ? v.map(x => x.id) : v]))

// Недавно открытые таблицы — в памяти: вернулся в «Оборудование» — строки сразу, изменения догружаются.
// ponytail: 6 таблиц (у «Оборудования» в памяти ~десятки МБ); больше — старые выбрасываются
const CACHE = new Map()   // tableId → {fields, rows, token}
const KEEP = 6
const remember = (id, v) => { CACHE.delete(id); CACHE.set(id, v); if (CACHE.size > KEEP) CACHE.delete(CACHE.keys().next().value) }

// Изменившиеся строки — поверх прежних (новые — в конец): не перерисовывать всю таблицу
export const mergeRows = (rows, changed) => {
  if (!changed.length) return rows
  const by = new Map(changed.map(r => [r.id, r]))
  const out = rows.map(r => by.get(r.id) ?? r)
  const have = new Set(rows.map(r => r.id))
  for (const r of changed) if (!have.has(r.id)) out.push(r)
  return out
}

// Поля таблицы + строки + точечный PATCH.
// Строки читаются с меткой (?since=): после правки сервер отдаёт только изменившиеся записи, а не всю таблицу.
export function useRecords(tableId, refreshMs = REFRESH_MS) {
  const cached = CACHE.get(tableId)
  const [fields, setFields] = useState(cached?.fields ?? [])
  const [rows, setRows] = useState(cached?.rows ?? [])
  const [loading, setLoading] = useState(!cached)
  const token = useRef(cached?.token ?? null)

  // fresh — дождаться пересчёта формул на сервере; без метки (или сервер сказал full) — вся таблица
  const refreshRows = useCallback(async (fresh = true) => {
    const res = await api(`/api/tables/${tableId}/records?since=${encodeURIComponent(token.current ?? '0')}${fresh ? '&fresh=1' : ''}`)
    if (Array.isArray(res)) { token.current = null; setRows(res); return }   // сервер без меток — вся таблица
    token.current = res.token
    setRows(rs => (res.full ? res.rows : mergeRows(rs, res.rows)))
  }, [tableId])

  const load = useCallback(async () => {
    const c = CACHE.get(tableId)
    if (c) {   // из памяти сразу; поля и изменения — тихо
      token.current = c.token
      setFields(c.fields); setRows(c.rows); setLoading(false)
      api(`/api/tables/${tableId}/fields`).then(fs => setFields(fs.filter(f => !f.options?.virtual || SERVED.has(f.kind)))).catch(() => {})
      await refreshRows(false).catch(() => {})
      return
    }
    setLoading(true)
    token.current = null
    const [fs] = await Promise.all([api(`/api/tables/${tableId}/fields`), refreshRows(false)])
    setFields(fs.filter(f => !f.options?.virtual || SERVED.has(f.kind)))
    setLoading(false)
  }, [tableId, refreshRows])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (!loading) remember(tableId, { fields, rows, token: token.current }) }, [tableId, fields, rows, loading])
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  // row — строка, которую видел пользователь (нужен её updated_at для оптимистичной блокировки).
  const patch = useCallback(async (row, values) => {
    try {
      const res = await api(`/api/tables/${tableId}/records/${row.id}`, {
        method: 'PATCH', body: { updated_at: row.updated_at, values: wire(values) },
      })
      setRows(rs => rs.map(r => r.id === row.id ? { ...r, ...values, updated_at: res.updated_at } : r))
      clearTimeout(timer.current)   // серия правок — одно перечитывание после последней
      timer.current = setTimeout(refreshRows, refreshMs)
    } catch (e) {
      if (e.status === 409) await refreshRows(false)  // кто-то изменил запись — показываем свежую
      throw e
    }
  }, [tableId, load, refreshRows, refreshMs])

  // Пакет правок (вставка из Excel): edits — [{row, values}]; одна транзакция на сервере, всё или ничего.
  const patchMany = useCallback(async edits => {
    try {
      const res = await api(`/api/tables/${tableId}/records`, {
        method: 'PATCH', body: { items: edits.map(e => ({ id: e.row.id, updated_at: e.row.updated_at, values: wire(e.values) })) },
      })
      const by = new Map(edits.map((e, i) => [e.row.id, { ...e.values, updated_at: res[i].updated_at }]))
      setRows(rs => rs.map(r => (by.has(r.id) ? { ...r, ...by.get(r.id) } : r)))
      clearTimeout(timer.current)
      timer.current = setTimeout(refreshRows, refreshMs)
    } catch (e) {
      if (e.status === 409) await refreshRows(false)
      throw e
    }
  }, [tableId, load, refreshRows, refreshMs])

  // удалённые — из сетки сразу, не дожидаясь пересчёта формул (как Airtable)
  const dropRows = useCallback(ids => setRows(rs => rs.filter(r => !ids.includes(r.id))), [])

  // новая запись — в сетку сразу, не дожидаясь перечитывания всей таблицы
  const addRow = useCallback(row => setRows(rs => (rs.some(r => r.id === row.id) ? rs : [...rs, row])), [])

  return { fields, rows, loading, patch, patchMany, reload: load, refresh: refreshRows, dropRows, addRow }
}
