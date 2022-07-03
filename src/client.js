// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { WTWSSession, WTWSStream } from './common.js'
import Websocket from 'isomorphic-ws'

export class WebTransport {
  constructor(url, args) {
    if (!url) throw new Error('no URL supplied')
    this.url = url

    this.ws = new Websocket(url, {
      perMessageDeflate: false
    })

    this.sessionint = new WTWSSession({
      ws: this.ws,
      parentobj: this,
      role: 'client'
    })

    this.ready = this.sessionint.ready
    this.closed = this.sessionint.closed

    this.datagrams = this.sessionint.datagrams

    this.incomingBidirectionalStreams =
      this.sessionint.incomingBidirectionalStreams

    this.incomingUnidirectionalStreams =
      this.sessionint.incomingUnidirectionalStreams
  }

  newStream(orderer, order) {
    const wsstream = new Websocket(this.url + '/stream', {
      perMessageDeflate: false
    })
    const stream = new WTWSStream({
      ws: wsstream,
      parentobj: this.sessionint,
      bidirectional: order.bidirectional,
      incoming: order.incoming,
      nonce: order.nonce,
      role: 'client'
    })

    this.sessionint.onStream({
      incoming: order.incoming,
      bidirectional: order.bidirectional,
      strobj: stream
    })
  }

  close(closeinfo) {
    return this.sessionint.close(closeinfo)
  }

  createBidirectionalStream() {
    return this.sessionint.createBidirectionalStream()
  }

  createUnidirectionalStream() {
    return this.sessionint.createUnidirectionalStream()
  }
}
