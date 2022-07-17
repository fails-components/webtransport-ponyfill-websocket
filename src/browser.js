// Copyright (c) 2022 Marten Richter or other contributers (see commit). All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { WebTransport } from './client.js'
import { setStreamFactory } from './common.js'

// eslint-disable-next-line no-undef
const { ReadableStream, WritableStream } = self

class StreamFactory {
  newReadableStream(args) {
    return new ReadableStream(args)
  }

  newWritableStream(args) {
    return new WritableStream(args)
  }
}

setStreamFactory(new StreamFactory())

export { WebTransport }
