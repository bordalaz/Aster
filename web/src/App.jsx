import { useSession } from './auth/session.js'
import Login from './auth/Login.jsx'
import Workspace from './Workspace.jsx'

export default function App() {
  const session = useSession()
  if (session.status === 'loading') return <div style={{ padding: 20 }}>Загрузка…</div>
  if (session.status === 'out') return <Login onLogin={session.login} />
  return <Workspace user={session.user} onLogout={session.logout} />
}
