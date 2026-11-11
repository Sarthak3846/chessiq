import { Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import Play from './pages/Play'
import PlayCoach from './pages/PlayCoach'
import Login from './pages/Login'
import Profile from './pages/Profile'
import Coach from './pages/Coach'
import Puzzles from './pages/Puzzles'
import Openings from './pages/Openings'
import Analysis from './pages/Analysis'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="play" element={<Play />} />
        <Route path="play-coach" element={<PlayCoach />} />
        <Route path="login" element={<Login />} />
        <Route path="profile" element={<Profile />} />
        <Route path="coach" element={<Coach />} />
        <Route path="puzzles" element={<Puzzles />} />
        <Route path="openings" element={<Openings />} />
        <Route path="analysis" element={<Analysis />} />
        <Route path="*" element={<Home />} />
      </Route>
    </Routes>
  )
}