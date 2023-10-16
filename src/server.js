// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { ReadableStream } from 'node:stream/web'
import { WTWSSession, WTWSStream } from './common.js'
import { WebSocketServer } from 'ws'
import WebCrypto from 'tiny-webcrypto'
import { URL } from 'url'
import { decode as decodeBase64 } from 'base64-arraybuffer'
// @ts-ignore
import { defer } from './utils.js'

export class WebTransportSocketServer {
  constructor(args) {
    this.serverargs = args
    if (!args.server) throw new Error('no server object passed')
    this.server = args.server
    this.sessionStreams = {}
    this.sessionController = {}
    this.sessionWSSs = {}
    this.streamWSSs = {}
    this.orderedStreams = {}

    this._ready = defer()
    this.ready = this._ready.promise

    this._closed = defer()
    this.closed = this._closed.promise

    this.onUpgrade = this.onUpgrade.bind(this)
    this.orderedStreamsCleanUp = this.orderedStreamsCleanUp.bind(this) // cleanup objs
    this.server.on('upgrade', this.onUpgrade)
    this.onServerClose = this.onServerClose.bind(this)
    this.server.on('close', this.onServerClose)
    this.onServerError = this.onServerError.bind(this)
    this.server.on('error', this.onServerError)
    this.onServerListening = this.onServerListening.bind(this)
    this.server.on('listening', this.onServerListening)

    // this.address = this.server.address
    this.orderedStreamsCleanUpInterval = setInterval(
      this.orderedStreamsCleanUp,
      1000
    )

    this.onServerPing = this.onServerPing.bind(this)
    this.pingInterval = setInterval(this.onServerPing, 1000)
  }

  address() {
    const { address, family, port } = this.server.address()

    return { host: address, family, port }
  }

  /**
   */
  onServerError() {
    this._ready.reject()
  }

  /**
   */
  onServerListening() {
    this._ready.resolve()
  }

  /**
   */
  onServerClose() {
    console.log('server closed')
    clearInterval(this.pingintervak)
    this._closed.resolve()
  }

  onServerPing() {
    // send pings to check if connections are still alive
    const wssping = (wss) => {
      wss.clients.forEach(function each(ws) {
        if (ws.isAlive === false) return ws.terminate()
        ws.isAlive = false
        ws.ping()
      })
    }
    Object.values(this.sessionWSSs).forEach(wssping)
    Object.values(this.streamWSSs).forEach(wssping)
  }

  orderedStreamsCleanUp() {
    const now = Date.now()
    for (const nonce in this.orderedStreams) {
      const obj = this.orderedStreams[nonce]
      if (now - obj.orderTime > 1000 * 20) delete obj[nonce]
    }
  }

  onUpgrade(request, socket, head) {
    const { pathname } = new URL('http://' + request.headers.host + request.url)
    // TODO filter out streams
    let wss
    // console.log('debug onUpgrade', pathname)
    if (pathname.endsWith('/stream')) {
      const orgpathname = pathname.substring(0, pathname.length - 7)
      wss = this.streamWSSs[orgpathname] // get the matching session
    } else {
      wss = this.sessionWSSs[pathname] // get the matching session
    }
    if (wss) {
      wss.handleUpgrade(request, socket, head, function done(ws) {
        wss.emit('connection', ws, request)
      })
    } else {
      socket.destroy()
    }
  }

  startServer() {
    this.server.listen(this.serverargs.port)
  }

  stopServer() {
    for (const i in this.sessionController) {
      this.sessionController[i].close() // inform the controller, that we are closing
      delete this.sessionController[i]
    }
    for (const i in this.sessionWSSs) {
      // inform the controller, that we are closing
      this.sessionWSSs[i].close()
      delete this.sessionWSSs[i]
    }
    for (const i in this.streamWSSs) {
      // inform the controller, that we are closing
      this.streamWSSs[i].close()
      delete this.streamWSSs[i]
    }
    // may be close the server
    this.server.close()
    this.stopped = true
    clearInterval(this.orderedStreamsCleanUpInterval)
  }

  newStream(orderer, order) {
    // console.log('newStream', order.nonce)

    this.orderedStreams[order.nonce] = {
      orderer,
      bidirectional: order.bidirectional,
      incoming: order.incoming,
      nonce: order.nonce,
      orderTime: Date.now()
    }
  }

  async initStream(args) {
    if (!args.nonce) {
      console.log('missing nonce')
      return null
    }
    const nonce = args.nonce
    // ok first fetch the right order
    const order = this.orderedStreams[nonce]
    if (!order) {
      console.log('no stream ordered')
      return null
    }
    delete this.orderedStreams[nonce]
    // we have the order, is it still valid
    if (Date.now() - order.orderTime > 1000 * 20) return null
    // now we can use the orderer's key to verify the message
    let verified
    try {
      verified = await WebCrypto.subtle.verify(
        {
          name: 'ECDSA',
          hash: { name: 'SHA-384' }
        },
        await order.orderer.verifyKey,
        decodeBase64(args.signature),
        new TextEncoder('utf-8').encode(nonce)
      )
    } catch (error) {
      console.log('stream verification failed', error)
      console.log('stream nonce type:', typeof nonce, 'nonce:', nonce)
    }
    if (!verified) {
      console.log('connection not verified')
      return
    }
    // ok everything ok
    return order // this is the parent, the caller is responsible for calling the onStream function
  }

  sessionStream(path) {
    if (path in this.sessionStreams) {
      return this.sessionsStreams[path]
    }
    const serverargs = { ...this.serverargs }
    serverargs.perMessageDeflate = false
    serverargs.noServer = true
    delete serverargs.port
    delete serverargs.server

    this.sessionWSSs[path] = new WebSocketServer(serverargs)

    const heartbeat = function () {
      this.isAlive = true
    }

    this.sessionWSSs[path].on('connection', (ws) => {
      ws.isAlive = true
      ws.on('pong', heartbeat)
      // we create a new session object, it handles all session stuff
      const sesobj = new WTWSSession({
        parentobj: this,
        ws,
        role: 'server'
      })
      if (this.sessionController[path])
        this.sessionController[path].enqueue(sesobj)
    })

    const streamserverargs = { ...serverargs }

    this.streamWSSs[path] = new WebSocketServer(streamserverargs)

    this.streamWSSs[path].on('connection', (ws) => {
      ws.isAlive = true
      ws.on('pong', heartbeat)
      // we create a new stream object, it handles all stream stuff
      // it needs to attach to a session later
      WTWSStream.createStream({
        serverobj: this,
        ws,
        role: 'server'
      })
    })

    this.sessionStreams[path] = new ReadableStream({
      start: (controller) => {
        this.sessionController[path] = controller
      }
    })
    return this.sessionStreams[path]
  }
}
