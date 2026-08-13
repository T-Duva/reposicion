import { useEffect } from 'react'
import { Shell } from './components/Shell'
import { UpdateBanner } from './components/UpdateBanner'
import { Login } from './screens/Login'
import { Home } from './screens/Home'
import { Planificar } from './screens/Planificar'
import { Comprar } from './screens/Comprar'
import { Descuentos } from './screens/Descuentos'
import { Repartir } from './screens/Repartir'
import { Cuentas } from './screens/Cuentas'
import { Historial } from './screens/Historial'
import { ScreenErrorBoundary } from './components/ErrorBoundary'
import { useApp } from './state/store'
import { parseUserId, userScreens } from './lib/userAccess'

export default function App() {
  const user = useApp((s) => s.user)
  const screen = useApp((s) => s.screen)
  const login = useApp((s) => s.login)
  const setScreen = useApp((s) => s.setScreen)

  useEffect(() => {
    const id = parseUserId(localStorage.getItem('reposicion.user'))
    if (id) login(id)
  }, [login])

  useEffect(() => {
    if (!user) return
    if (!userScreens(user).includes(screen)) setScreen('home')
  }, [user, screen, setScreen])

  if (!user) {
    return (
      <div className="frame">
        <UpdateBanner />
        <Login />
      </div>
    )
  }

  return (
    <div className="frame">
      <UpdateBanner />
      <Shell>
        <ScreenErrorBoundary screen={screen}>
          {screen === 'home' && <Home />}
          {screen === 'plan' && <Planificar />}
          {screen === 'buy' && <Comprar />}
          {screen === 'discounts' && <Descuentos />}
          {screen === 'split' && <Repartir />}
          {screen === 'accounts' && <Cuentas />}
          {screen === 'audit' && <Historial />}
        </ScreenErrorBoundary>
      </Shell>
    </div>
  )
}
