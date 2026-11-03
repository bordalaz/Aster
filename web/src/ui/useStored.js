import { useEffect, useState } from 'react'

// Состояние, которое помнится в этом браузере (режим календаря, масштаб таймлайна — как в Airtable,
// у каждого вида своё). Нет хранилища (приватный режим) — просто состояние; чужое значение — начальное.
export function useStored(key, initial, allowed) {
  const [v, setV] = useState(() => {
    try { const s = key && localStorage.getItem(key); return s != null && (!allowed || allowed.includes(s)) ? s : initial } catch { return initial }
  })
  useEffect(() => { if (key) try { localStorage.setItem(key, v) } catch { /* приватный режим */ } }, [key, v])
  return [v, setV]
}
