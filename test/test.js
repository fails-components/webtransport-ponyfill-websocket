// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// this file runs various tests

// import { generateWebTransportCertificate } from './certificate.js'
import { createServer } from 'http'
import { WebTransportSocketServer, WebTransport } from '../src/node.js'
import { echoTestsConnection, runEchoServer } from './testsuite.js'

let testfin = false

async function run() {
  setTimeout(() => {
    if (!testfin) {
      console.log('tests took too long, probably hanging')
      process.exit(1)
    } else {
      console.log('tests passed, everything alright')
      process.exit(0)
    }
  }, 10 * 1000)
  console.log('start generating self signed certificate')

  /*
  const attrs = [
    { shortName: 'C', value: 'DE' },
    { shortName: 'ST', value: 'Berlin' },
    { shortName: 'L', value: 'Berlin' },
    { shortName: 'O', value: 'WebTransport Test Server' },
    { shortName: 'CN', value: '127.0.0.1' }
  ]
  let certificate

  certificate = await generateWebTransportCertificate(attrs, {
    days: 13
  }) */

  console.log('start WebSocketServer and startup echo tests')
  // now ramp up the server
  const server = createServer()
  const wtsserver = new WebTransportSocketServer({
    server,
    port: 8080,
  })

  runEchoServer(wtsserver)
  wtsserver.startServer() // actually it is just listen....

  console.log('server started now wait 2 seconds')

  await new Promise((resolve) => setTimeout(resolve, 2000))
  console.log('now startup client')

  const url = 'ws://127.0.0.1:8080/echo'

  let client = new WebTransport(url)
  client.closed
    .then(() => {
      console.log('The Websocket connection to ', url, 'closed gracefully.')
    })
    .catch((error) => {
      console.error(
        'The Websocket connection to',
        url,
        'closed due to ',
        error,
        '.'
      )
    })
  console.log('wait for client to be ready')
  await client.ready
  console.log('client is ready')
  await echoTestsConnection(client)
  console.log('client test finished, now close the client but wait 2 seconds')

  await new Promise((resolve) => setTimeout(resolve, 2000))

  client.close({ closeCode: 0, reason: 'tests finished' })

  client = null

  console.log('client closes now wait 2 seconds')

  await new Promise((resolve) => setTimeout(resolve, 2000))

  console.log('now stop server')

  wtsserver.stopServer()
  console.log('tests finished!')
  testfin = true
}
run()
