/* eslint-disable no-undef */
import { createServer } from './fixtures/server.js'
import { getReaderValue } from './fixtures/reader-value.js'
import { WebTransport } from '../src/node.js'
import { expect } from 'chai'
import { readStream } from './fixtures/read-stream.js'
import { writeStream } from './fixtures/write-stream.js'
import { defer } from '../src/utils.js'

/**
 * @template T
 * @typedef {import('../lib/types').Deferred<T>} Deferred<T>
 */

const SERVER_PATH = '/datagrams'

describe('datagrams', function () {
  /** @type {import('../lib/server').Http3Server} */
  let server
  /** @type {import('../lib/dom').WebTransport | undefined} */
  let client
  /** @type {string} */
  let url

  this.timeout(35000)

  beforeEach(async () => {
    ;({ server } = await createServer())
    server.startServer()
    await server.ready

    const address = server.address()

    if (address == null || address.port == null) {
      throw new Error('No address')
    }

    if (address.host === '::') address.host = '[::1]'
    if (address.host === '0.0.0.0') address.host = '127.0.0.1'

    url = `ws://${address.host}:${address.port}`
  })

  afterEach(async () => {
    if (client != null) {
      client.close()
    }

    if (server != null) {
      server.stopServer()
      await server.closed
    }
  })

  it('client sends datagrams to the server', async () => {
    this.timeout(200)
    // server context - waits for the client to connect and pipes their datagrams back to them
    Promise.resolve().then(async () => {
      const session = await getReaderValue(server.sessionStream(SERVER_PATH))

      // redirect input to output
      await session.datagrams.readable.pipeTo(session.datagrams.writable)
      session.close()
    })

    // client context - connects to the server, sends some datagrams and reads the response
    client = new WebTransport(`${url}${SERVER_PATH}`)
    await client.ready

    const input = [
      Uint8Array.from([0, 1, 2, 3, 4]),
      Uint8Array.from([5, 6, 7, 8, 9]),
      Uint8Array.from([10, 11, 12, 13, 14])
    ]

    await writeStream(client.datagrams.writable, input)

    const output = await readStream(client.datagrams.readable, input.length)
    await client.close()
    expect(output).to.deep.equal(
      input,
      'Did not receive the same bytes we sent'
    )
  })

  it('receives datagrams from the server', async () => {
    this.timeout(200)
    /** @type {Deferred<Uint8Array[]>} */
    const serverData = defer()
    const input = [
      Uint8Array.from([0, 1, 2, 3, 4]),
      Uint8Array.from([5, 6, 7, 8, 9]),
      Uint8Array.from([10, 11, 12, 13, 14])
    ]

    // server context - waits for the client to connect, sends some datagrams and reads the response
    Promise.resolve().then(async () => {
      const session = await getReaderValue(server.sessionStream(SERVER_PATH))
      await writeStream(session.datagrams.writable, input)

      const output = await readStream(session.datagrams.readable, input.length)
      serverData.resolve(output)
      // have to close the session to end the client's datagram stream
      session.close()
    })

    // client context - pipes the server's datagrams back to them
    client = new WebTransport(`${url}${SERVER_PATH}`)
    await client.ready

    // redirect input to output
    await client.datagrams.readable.pipeTo(client.datagrams.writable)

    const received = await serverData.promise
    expect(received).to.deep.equal(
      input,
      'Did not receive the same bytes we sent'
    )
  })
})
