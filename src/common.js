// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { ReadableStream, WritableStream } from 'isomorphic-streams'
import WebCrypto from 'tiny-webcrypto'
import { encode as encodeBase64 } from 'base64-arraybuffer'

const bufferSize = 1024 * 512 // buffersize before blocking

const onnode = typeof window === 'undefined'

export class WTWSStream {
  constructor(args) {
    this.ws = args.ws
    this.ws.binaryType = 'arraybuffer'
    this.role = args.role
    if (this.role === 'server') {
      this.serverobj = args.serverobj
    } else {
      this.parentobj = args.parentobj
      this.bidirectional = args.bidirectional
      this.incoming = args.incoming
      this.nonce = args.nonce
    }

    this.closed = false

    this.connected = new Promise((res, rej) => {
      this.connectedres = res
      this.connectedrej = rej
    })

    this.pendingoperation = null
    this.pendingres = null

    this.ws.binaryType = 'arraybuffer'

    this.writeChunk = this.writeChunk.bind(this)

    this.wsOpen = this.wsOpen.bind(this)
    this.wsClose = this.wsClose.bind(this)
    this.wsMessage = this.wsMessage.bind(this)
    this.wsError = this.wsError.bind(this)

    this.ws.onopen = this.wsOpen // only cllient
    this.ws.onclose = this.wsClose
    this.ws.onmessage = this.wsMessage
    this.ws.onerror = this.wsError

    if (this.parentobj) {
      this.initStream()
      this.streamReadyProm = Promise.resolve()
    } else {
      this.initialIncomingPakets = []
      this.streamReadyProm = new Promise((res, rej) => {
        this.streamReadyPromRes = res
        this.streamReadyPromRej = rej
      })
    }
  }

  // called after we have a parent
  initStream() {
    console.log('initStream called', this.role)
    if (this.bidirectional || this.incoming) {
      this.readable = new ReadableStream(
        {
          start: async (controller) => {
            try {
              console.log('before wait connected', this.role)
              await this.connected
              console.log('after wait connected', this.role)
              this.readableController = controller
              this.parentobj.addReceiveStream(this.readable, controller)

              this.startReading()
            } catch (error) {
              console.log('start readable failed')
            }
          },
          pull: async (controller) => {
            if (this.initialIncomingPakets) {
              console.log('send initial packets')
              this.initialIncomingPakets.forEach((el) => {
                console.log('send initial packets loop', el)
                controller.enqueue(new Uint8Array(el))
              })
              delete this.initialIncomingPakets
            }
            if (this.readableclosed) {
              return Promise.resolve()
            }
            try {
              await this.connected
              this.startReading()
            } catch (error) {
              console.log('pull readable failed')
            }
          },
          cancel: (reason) => {
            const promise = new Promise((res, rej) => {
              this.cancelres = res
            })
            let code = 0
            if (reason && reason.code) {
              if (reason.code < 0) code = 0
              else if (reason.code > 255) code = 255
              else code = reason.code
            }
            this.readableclosed = true
            this.stopSending(code)
            return promise
          }
        },
        { highWaterMark: 4 }
      )
    }
    if (this.bidirectional || !this.incoming) {
      this.writable = new WritableStream(
        {
          start: (controller) => {
            this.writableController = controller
            this.parentobj.addSendStream(this.writable, controller)
          },
          write: (chunk, controller) => {
            console.log('write start', this.role, chunk)
            if (this.writableclosed) {
              return Promise.resolve()
            }
            if (chunk instanceof Uint8Array) {
              this.pendingoperation = new Promise((res, rej) => {
                this.pendingres = res
                this.pendingrej = rej
              })
              this.connected.then(() => {
                this.writeChunk(chunk)
              })
              return this.pendingoperation
            } else throw new Error('chunk is not of instanceof Uint8Array ')
          },
          close: (controller) => {
            console.log('before streamFinal pre')
            if (this.writableclosed) {
              return Promise.resolve()
            }
            console.log('before streamFinal')
            this.streamFinal()
            this.pendingoperation = new Promise((res, rej) => {
              this.pendingres = res
            })
            return this.pendingoperation
          },
          abort: (reason) => {
            console.log('before abort')
            if (this.writableclosed) {
              return new Promise((res, rej) => {
                res()
              })
            }
            let code = 0
            if (reason && reason.code) {
              if (reason.code < 0) code = 0
              else if (reason.code > 255) code = 255
              else code = reason.code
            }
            const promise = new Promise((res, rej) => {
              this.abortres = res
            })
            this.resetStream(code)
            return promise
          }
        },
        { highWaterMark: 4 }
      )
    }
    console.log('initStream ready ', this.streamReadyPromRes)
    if (this.streamReadyPromRes) {
      // finally we are ready
      const messres = this.streamReadyPromRes
      delete this.streamReadyPromRes
      delete this.streamReadyPromRej
      messres()
    }
    console.log('initStream done ', this.streamReadyProm)
  }

  async wsOpen(event) {
    // TODO send auth token to server
    console.log('stream wsOpen', this.role)

    if (this.role === 'client') {
      // should only be called on client side
      const autoken = {
        cmd: 'initStream',
        nonce: this.nonce,
        signature: encodeBase64(
          await WebCrypto.subtle.sign(
            {
              name: 'ECDSA',
              hash: { name: 'SHA-384' }
            },
            (
              await this.parentobj.signKeyPair
            ).privateKey,
            this.nonce
          )
        )
      }
      console.log('autoken', autoken)
      this.sendCommand(autoken)
      this.connectedres()
    }
  }

  wsClose(event) {
    if (this.writable && !this.writableclosed) {
      this.parentobj.removeSendStream(this.writable, this.writableController)
      this.writableclosed = true
      this.writableController.error(event.code || 0) // there is no way to exit cleanly
    }

    if (this.readable && !this.readableclosed) {
      this.parentobj.removeReceiveStream(this.readable, this.readableController)
      this.readableclosed = true
      if (event.wasClean) this.readableController.close(event.code || 0)
      else this.readableController.error(event.code || 0)
    }
  }

  wsError(event) {
    if (this.writable) {
      this.parentobj.removeSendStream(this.writable, this.writableController)
      this.writableclosed = true
      this.writableController.error(event)
    }

    if (this.readable) {
      this.parentobj.removeReceiveStream(this.readable, this.readableController)
      this.readableclosed = true
      this.readableController.error(event)
    }
  }

  async wsMessage(event) {
    if (event.data) {
      if (event.data instanceof ArrayBuffer) {
        console.log('before wait streamReadyProm', this.streamReadyProm)
        await this.streamReadyProm // prevent execution before initial message
        console.log('after wait streamReadyProm', this.streamReadyProm)
        // ok this is binary data
        console.log('readable', this.readableController, this.role, event.data)
        if (!this.readableclosed) {
          if (this.readableController) {
            this.readableController.enqueue(new Uint8Array(event.data))
            if (this.readableController.desiredSize < 0) this.stopReading()
          } else {
            this.initialIncomingPakets.push(event.data)
          }
        }
      } else if (typeof event.data === 'string') {
        const mess = JSON.parse(event.data)
        this.onMessage(mess)
      } else {
        console.log(
          'unsupported data type websocket',
          typeof event.data,
          event.data
        )
      }
    }
  }

  close(closeInfo) {
    // console.log('closeinfo', closeInfo)
    let reason = 'inknown'
    let code = 0
    if (closeInfo) {
      if (closeInfo.closecode) code = closeInfo.closecode
      if (closeInfo.reason) reason = closeInfo.reason.substring(0, 1023)
    }
    if (code === 0) code = 1000
    else code += 3000
    this.ws.close(code, reason)
  }

  sendCommand(cmdobj) {
    let res, rej
    const prom = new Promise((resolve, reject) => {
      res = resolve
      rej = reject
    })
    const strsend = JSON.stringify(cmdobj)
    if (onnode) {
      this.ws.send(strsend, { binary: false }, (err) => {
        if (err) {
          console.log('wtws: error sending stream cmd: ', err)
          rej(err)
        } else res()
      })
    } else {
      try {
        this.ws.send(strsend)
      } catch (err) {
        console.log('wtws: error sending stream cmd: ', err)
        rej(err)
        return prom
      }
      res()
    }
    return prom
  }

  startReading() {
    // we can signal that we want to start reading something, used for blocking
    if (onnode) {
      if (this.ws.isPaused) this.ws.resume()
    }
  }

  async stopSending(code) {
    // send the stop sending code
    try {
      await this.sendCommand({ cmd: 'stopSending', code })
    } catch (error) {
      console.log('stopSending failed', error)
    }
    if (this.cancelres) {
      const res = this.cancelres
      this.cancelres = null
      res()
    }
  }

  writeChunk(chunk) {
    // send a chunk of data and we have to clear pending operation
    if (onnode) {
      this.ws.send(chunk, { binary: true }, (err) => {
        if (err) this.pendingrej(err)
        else this.pendingres()
        console.log('writable', this.writableController)
      })
    } else {
      if (ws.bufferedAmount > bufferSize) {
        // block !
        setTimeout(this.writeChunk, 100, chunk)
        return
      }
      try {
        this.ws.send(chunk)
      } catch (err) {
        this.pendingrej(err)
        return
      }
      this.pendingres()
    }
  }

  async streamFinal() {
    // send stream final
    // again we need to clear pending operation
    try {
      await this.sendCommand({ cmd: 'streamFinal' })
    } catch (error) {
      console.log('resetStream failed', error)
    }
    if (this.pendingoperation) {
      const res = this.pendingres
      this.pendingoperation = null
      this.pendingres = null
      res()
    }
  }

  async resetStream(code) {
    // we need to send resetStream
    // and resolve abortres
    try {
      await sendCommand({ cmd: 'resetStream', code })
    } catch (error) {
      console.log('resetStream failed', error)
    }
    if (this.abortres) {
      const res = this.abortres
      this.abortres = null
      res()
    }
  }

  // pause reading the stream
  stopReading() {
    if (onnode) {
      if (!this.ws.isPaused) this.ws.pause()
    }
  }

  async onMessage(args) {
    // console.log('onMessage', args)
    // check if transport is closed
    if (
      !this.parentobj &&
      args.cmd === 'initStream' &&
      this.role === 'server'
    ) {
      // TODO get parentobj and call init stream
      try {
        console.log('enter initStream serverobj')
        const order = await this.serverobj.initStream(args)
        console.log('leave initStream serverobj')
        if (!order) {
          const messrej = this.streamReadyPromRej
          delete this.streamReadyPromRes
          delete this.streamReadyPromRej
          messrej()
          this.close()
          console.log('initStream failed')
          return
        }
        this.bidirectional = order.bidirectional
        this.incoming = order.incoming
        this.parentobj = order.orderer
        console.log('SERVER onStream')
        this.initStream()
        this.parentobj.onStream({
          incoming: order.incoming,
          bidirectional: order.bidirectional,
          strobj: this
        })
        this.connectedres()
      } catch (error) {
        console.log('problem after receiving initStream', error)
      }
      return
    }
    if (!this.parentobj) await this.streamReadyProm

    const parentstate = this.parentobj.state
    if (parentstate === 'closed' || parentstate === 'failed') return
    let clearpendingop = false
    switch (args.cmd) {
      case 'resetStream':
        if (this.readable) {
          this.parentobj.removeReceiveStream(
            this.readable,
            this.readableController
          )
          if (!this.readableclosed) {
            this.readableclosed = true
            this.readableController.error(args.code || 0)
          }
        } else console.log('stopSending wihtout readable')
        clearpendingop = true
        break

      case 'stopSending':
        if (this.writable) {
          this.parentobj.removeSendStream(
            this.writable,
            this.writableController
          )
          if (!this.writableclosed) {
            this.writableclosed = true
            this.writableController.error(args.code || 0)
          }
        } else console.log('stopSending wihtout writable')
        clearpendingop = true
        break
      case 'streamFinal':
        if (!this.readableclosed) {
            this.readableController.close()
            this.readableclosed = true
        }
        break
      default:
        console.log('unhandled onMessage')
    }

    if (clearpendingop && this.pendingoperation) {
      const res = this.pendingres
      this.pendingoperation = null
      this.pendingres = null
      res()
    }
  }
}

export class WTWSSession {
  constructor(args) {
    this.ws = args.ws
    this.parentobj = args.parentobj
    this.role = args.role // server or client
    this.state = 'connected'

    this.ws.binaryType = 'arraybuffer'

    this.wsOpen = this.wsOpen.bind(this)
    this.wsClose = this.wsClose.bind(this)
    this.wsMessage = this.wsMessage.bind(this)
    this.wsError = this.wsError.bind(this)

    this.ws.onopen = this.wsOpen // only client!!
    this.ws.onclose = this.wsClose
    this.ws.onmessage = this.wsMessage
    this.ws.onerror = this.wsError

    this.ready = new Promise((res, rej) => {
      this.readyResolve = res
      this.readyReject = rej
    }).catch(() => {}) // add default handler if no one cares
    this.closed = new Promise((res, rej) => {
      this.closedResolve = res
      this.closedReject = rej
    }).catch(() => {}) // add default handler if no one cares

    this.incomingBidirectionalStreams = new ReadableStream({
      start: (controller) => {
        this.incomBiDiController = controller
      }
    })

    this.incomingUnidirectionalStreams = new ReadableStream({
      start: (controller) => {
        this.incomUniDiController = controller
      }
    })

    this.datagrams = {}
    this.datagrams.readable = new ReadableStream({
      start: (controller) => {
        this.incomDatagramController = controller
      }
    })
    this.datagrams.writable = new WritableStream({
      start: (controller) => {
        this.outgoDatagramController = controller
      },
      write: async (chunk, controller) => {
        if (this.state === 'closed') throw new Error('Session is closed')
        if (chunk instanceof Uint8Array) {
          try {
            await this.writeDatagram(chunk)
          } catch (error) {
            console.log('writeDatagram failed', error)
            throw new Error('writeDatagram failed')
          }
          return
        } else throw new Error('chunk is not of type Uint8Array')
      },
      close: (controller) => {
        // do nothing
      }
    })

    this.resolveBiDi = []
    this.resolveUniDi = []
    this.rejectBiDi = []
    this.rejectUniDi = []

    this.sendStreams = new Set()
    this.receiveStreams = new Set()
    this.streamObjs = new Set()

    this.sendStreamsController = new Set()
    this.receiveStreamsController = new Set()
    if (this.role === 'client') {
      this.signKeyPair = WebCrypto.subtle.generateKey(
        {
          name: 'ECDSA',
          namedCurve: 'P-384'
        },
        true,
        ['sign', 'verify']
      )
    } else if (this.role === 'server') {
      this.verifyKey = new Promise((res) => {
        this.verifyKeyRes = res
      })
      this.serverStartup()
    } else throw new Error('unknown role ' + this.role)
  }

  async serverStartup() {
    try {
      await this.verifyKey
      this.onReady()
    } catch (error) {
      console.log('serverStartup failed', error)
    }
  }

  async wsOpen(event) {
    // actually only called for the client
    try {
      if (this.role === 'client') {
        const keypair = await this.signKeyPair
        const sendkey = await WebCrypto.subtle.exportKey(
          'jwk',
          keypair.publicKey
        )
        this.sendCommand({
          cmd: 'setSignKey',
          publicKey: sendkey
        })

        this.onReady()
      }
    } catch (error) {
      console.log('failure starting session', error)
    }
  }

  wsClose(event) {
    this.onClose(event.code, event.reason)
  }

  wsError(event) {
    this.onClose(255, event)
    if (this.readyReject) this.readyReject()
  }

  wsMessage(event) {
    //console.log('wsMessage session', this.role, event.data)
    if (event.data) {
      if (event.data instanceof ArrayBuffer) {
        // ok this is binary data
        this.incomDatagramController.enqueue(new Uint8Array(event.data))
      } else if (typeof event.data === 'string') {
        const mess = JSON.parse(event.data)
        this.onMessage(mess)
      } else {
        console.log(
          'unsupported data type websocket',
          typeof event.data,
          event.data
        )
      }
    }
  }

  // this is copied , but probably the only function, that works the same way
  sendCommand(cmdobj) {
    //console.log('sendCommand session', this.role, cmdobj)
    let res, rej
    const prom = new Promise((resolve, reject) => {
      res = resolve
      rej = reject
    })
    const strsend = JSON.stringify(cmdobj)
    if (onnode) {
      this.ws.send(strsend, { binary: false }, (err) => {
        if (err) {
          console.log('wtws: error sending stream cmd: ', err)
          rej(err)
        } else res()
      })
    } else {
      try {
        this.ws.send(strsend)
      } catch (err) {
        console.log('wtws: error sending stream cmd: ', err)
        rej(err)
        return prom
      }
      res()
    }
    return prom
  }

  async writeDatagram(chunk) {
    // we need to write the datagram
    try {
      if (onnode) {
        await new Promise((resolve, reject) => {
          this.ws.send(chunk, { binary: true }, (err) => {
            if (err) reject(err)
            else resolve()
          })
        })
      } else {
        if (ws.bufferedAmount > bufferSize) {
          // block !
          await new Promise((resolve, reject) => {
            setTimeout(async () => {
              try {
                await this.writeDatagram(chunk)
                resolve()
              } catch (error) {
                reject(error)
              }
            }, 100)
          })
          return
        }
        this.ws.send(chunk)
      }
    } catch (error) {
      throw new Error(error)
    }
  }

  createNonce() {
    const randombytes = new Uint8Array(16)
    WebCrypto.getRandomValues(randombytes)
    return Array.from(new Uint16Array(randombytes.buffer))
      .map((el) => String(el).padStart(6, '0'))
      .join('')
  }

  orderBidiStream() {
    const nonce = this.createNonce()
    // console.log('log nonce', nonce, this.role)
    this.sendCommand({
      cmd: 'orderStream',
      bidirectional: true,
      incoming: true,
      nonce
    })
    this.parentobj.newStream(this, {
      bidirectional: true,
      incoming: false,
      nonce
    })
  }

  orderUnidiStream() {
    const nonce = this.createNonce()
    this.sendCommand({
      cmd: 'orderStream',
      bidirectional: false,
      incoming: true,
      nonce
    })
    this.parentobj.newStream(this, {
      bidirectional: false,
      incoming: false,
      nonce
    })
  }

  addStreamObj(stream) {
    this.streamObjs.add(stream)
  }

  removeStreamObj(stream) {
    this.streamObjs.delete(stream)
  }

  addSendStream(stream, controller) {
    this.sendStreams.add(stream)
    this.sendStreamsController.add(controller)
  }

  removeSendStream(stream, controller) {
    this.sendStreams.delete(stream)
    this.sendStreamsController.delete(controller)
  }

  addReceiveStream(stream, controller) {
    this.receiveStreams.add(stream)
    this.receiveStreamsController.add(controller)
  }

  removeReceiveStream(stream, controller) {
    this.receiveStreams.delete(stream)
    this.receiveStreamsController.delete(controller)
  }

  createBidirectionalStream() {
    const prom = new Promise((res, rej) => {
      this.resolveBiDi.push(res)
      this.rejectBiDi.push(rej)
    })
    this.orderBidiStream()
    return prom
  }

  createUnidirectionalStream() {
    const prom = new Promise((res, rej) => {
      this.resolveUniDi.push(res)
      this.rejectUniDi.push(rej)
    })
    this.orderUnidiStream()
    return prom
  }

  close(closeInfo) {
    // console.log('closeinfo', closeInfo)
    if (this.state === 'closed' || this.state === 'failed') return

    this.ws.close(closeInfo.closecode, closeInfo.reason.substring(0, 1023))
    this.streamObjs.forEach((ele) => ele.close(closeInfo))
  }

  onReady(error) {
    console.log('onReady', this.role)
    if (this.readyResolve) this.readyResolve()
    delete this.readyResolve
    delete this.readyReject
  }

  onClose(errorcode, error) {
    // console.log('onClose')
    for (const rej of this.rejectBiDi) rej()
    for (const rej of this.rejectUniDi) rej()
    this.resolveBiDi = []
    this.resolveUniDi = []
    this.rejectBiDi = []
    this.rejectUniDi = []

    this.incomBiDiController.close()
    this.incomUniDiController.close()
    this.incomDatagramController.close()
    // this.outgoDatagramController.error(errorcode)
    this.state = 'closed'

    this.sendStreamsController.forEach((ele) => ele.error(errorcode))
    this.receiveStreamsController.forEach((ele) => ele.error(errorcode))
    this.streamObjs.forEach((ele) => (ele.readableclosed = true))

    this.sendStreams.clear()
    this.receiveStreams.clear()
    this.sendStreamsController.clear()
    this.receiveStreamsController.clear()
    this.streamObjs.clear()

    if (this.closedResolve) this.closedResolve(errorcode)
    if (this.closeHook) {
      this.closeHook()
      delete this.closeHook
    }
  }

  onStream(args) {
    this.addStreamObj(args.strobj)
    if (args.incoming) {
      console.log('onStream inspect mark1')
      if (args.bidirectional) {
        console.log(
          'onStream inspect mark2',
          args.strobj.readable,
          args.strobj.writable
        )
        this.incomBiDiController.enqueue(args.strobj)
      } else {
        console.log('onStream inspect mark3', args.strobj.readable)
        this.incomUniDiController.enqueue(args.strobj.readable)
      }
    } else {
      if (args.bidirectional) {
        if (this.resolveBiDi.length === 0)
          throw new Error('Got bidirectional stream without asking for it')
        this.rejectBiDi.shift()
        const curres = this.resolveBiDi.shift()
        curres(args.strobj)
      } else {
        if (this.resolveUniDi.length === 0)
          throw new Error('Got unidirectional stream without asking for it')
        this.rejectUniDi.shift()
        const curres = this.resolveUniDi.shift()
        curres(args.strobj.writable)
      }
    }
  }

  async onMessage(args) {
    // console.log('onMessage', this.role, args)
    // check if transport is closed
    const state = this.state
    if (state === 'closed' || state === 'failed') return

    switch (args.cmd) {
      case 'orderStream':
        console.log('orderStream arrived', this.role, args.nonce)
        this.parentobj.newStream(this, {
          bidirectional: args.bidirectional,
          incoming: true,
          nonce: args.nonce
        })
        break
      case 'setSignKey':
        if (args.publicKey && this.verifyKeyRes && this.role === 'server') {
          try {
            const verKey = await WebCrypto.subtle.importKey(
              'jwk',
              args.publicKey,
              {
                name: 'ECDSA',
                namedCurve: 'P-384'
              },
              true,
              ['verify']
            )

            this.verifyKeyRes(verKey)
            delete this.verifyKeyRes
          } catch (error) {
            console.log('setSignKey failed', error)
          }
        } else {
          console.log('setSignKey ignored!')
        }
        break
      default:
        console.log('unhandled onMessage', args)
    }
  }
}
