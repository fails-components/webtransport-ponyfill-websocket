// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { WebTransport } from './client.js'
import { WebTransportSocketServer } from './server.js'
import { setStreamFactory } from './common.js'
import { ReadableStream, WritableStream } from 'node:stream/web'
import { WebSocket } from 'ws'

class StreamFactory {
  newReadableStream(args) {
    return new ReadableStream(args)
  }

  newWritableStream(args) {
    return new WritableStream(args)
  }

  newWebsocket(args) {
    const heartbeat = function () {
      clearTimeout(this.pingTimeout)
      this.pingTimeout = setTimeout(() => {
        this.terminate()
      }, 1000 + 1000)
    }
    const ws = new WebSocket(args, {
      perMessageDeflate: false
    })
    ws.on('ping', heartbeat)
    ws.heartbeat = heartbeat
    return ws
  }

  isNode() {
    return true
  }
}

setStreamFactory(new StreamFactory())

export { WebTransport }
export { WebTransportSocketServer }
