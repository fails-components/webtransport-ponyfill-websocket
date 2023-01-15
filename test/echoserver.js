// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { WebTransportSocketServer } from '../src/webtransport-ponyfill.js'
import { runEchoServer } from './testsuite.js'
import { createServer } from 'http'

try {
  const server = createServer()
  const wtsserver = new WebTransportSocketServer({
    server,
    port: 8080
  })
  runEchoServer(wtsserver)
  wtsserver.startServer()
} catch (error) {
  console.log('websocket', error)
}
