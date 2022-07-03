// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { WebTransportSocketServer } from '../src/webtransport-ponyfill.js'
import { runEchoServer } from './testsuite.js'
import { createServer } from 'http'
// import { existsSync, readFileSync, writeFile } from 'node:fs'
//import { generateWebTransportCertificate } from './certificate.js'

/*
let certificate = null

if (existsSync('./certificatecache.json')) {
  certificate = JSON.parse(
    readFileSync('./certificatecache.json', { encoding: 'utf8', flag: 'r' })
  )
}

if (!certificate) {
  const attrs = [
    { shortName: 'C', value: 'DE' },
    { shortName: 'ST', value: 'Berlin' },
    { shortName: 'L', value: 'Berlin' },
    { shortName: 'O', value: 'webtransport Test Server' },
    { shortName: 'CN', value: '127.0.0.1' }
  ]
  certificate = await generateWebTransportCertificate(attrs, {
    days: 13
  })
  writeFile('./certificatecache.json', JSON.stringify(certificate),(err)=>{
    if (err) console.log('write certificate cache error', err)
  })
}

console.log('certificate hash ', certificate.fingerprint)
*/



try {
  const server = createServer()
  const wtsserver = new WebTransportSocketServer({
    server,
    port: 8080,
  })
  
  runEchoServer(wtsserver)
  wtsserver.startServer() 
} catch (error) {
  console.log('websocket', error)
}
