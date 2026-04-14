import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'

const app = Fastify({ logger: true })
const PORT = Number(process.env.PORT) || 3001

async function start() {
  await app.register(cors)
  await app.register(helmet)

  app.get('/api/health', async () => {
    return { ok: true, service: 'api', timestamp: new Date().toISOString() }
  })

  await app.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`Fastify server running on port ${PORT}`)
}

start().catch((err) => {
  console.error(err)
  process.exit(1)
})

export default app
