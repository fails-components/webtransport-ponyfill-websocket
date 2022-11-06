import { createServer as createServerHttp } from 'http'
import { WebTransportSocketServer } from '../../src/node.js'

export async function createServer() {
  const server = createServerHttp()
  const wtsserver = new WebTransportSocketServer({
    server,
    port: 0
  })

  return {
    server: wtsserver,
    httpserver: server
  }
}

/**
 * @param {import('../../lib/server.js').Http3Server} server
 * @param {string} path
 */
export async function getServerSession(server, path) {
  const sessionStream = await server.sessionStream(path)
  const sessionReader = sessionStream.getReader()

  try {
    const { done, value } = await sessionReader.read()

    if (done) {
      throw new Error('Server is gone')
    }

    if (!value) {
      throw new Error('Session was undefined')
    }

    return value
  } finally {
    sessionReader.releaseLock()
  }
}
