export default function TableList({ tables, activeId, onPick }) {
  return (
    <nav style={{ flex: '0 0 240px', overflowY: 'auto', background: 'var(--panel)', borderRight: '1px solid var(--line)', padding: 10 }}>
      {tables.map(t => (
        <button
          key={t.id}
          onClick={() => onPick(t.id)}
          aria-current={t.id === activeId ? 'true' : undefined}
          style={{
            display: 'block', width: '100%', textAlign: 'left', border: 0, borderRadius: 6,
            height: 30, padding: '0 8px', cursor: 'pointer',
            background: t.id === activeId ? 'var(--accent-tint)' : 'transparent',
            color: t.id === activeId ? 'var(--accent-dark)' : 'var(--text)',
            fontWeight: t.id === activeId ? 500 : 400,
          }}
        >{t.title}</button>
      ))}
    </nav>
  )
}
