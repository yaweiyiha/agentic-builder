import express from 'express'
import cors from 'cors'
import helmet from 'helmet'

const app = express()
const PORT = process.env.PORT || 3001

app.use(helmet())
app.use(cors())
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'api', timestamp: new Date().toISOString() })
})

app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`)
})

export default app
