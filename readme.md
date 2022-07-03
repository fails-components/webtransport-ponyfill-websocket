!["FAILS logo"](failslogo.svg)
# Fancy automated internet lecture system (**FAILS**) - components (Webtransport module)

Tests on master ![master](https://github.com/fails-components/webtransport-ponyfill-websocket/actions/workflows/libtest.yml/badge.svg?branch=master)

(c) 2022- Marten Richter

This package is part of FAILS.
A web based lecture system developed out of university lectures.

The package provides a Webtransport ponyfill using websocket as transport to node.js and the browser. In this way you can support WebTransport and Websocket with the same code basis.
It is useful, if a browser does not support WebTransport or if the network blocks UDP to your server.
If you search for webtransport support in node.js use our webtransport package
build using libquiche [https://github.com/google/quiche](https://github.com/google/quiche).

While FAILS as a whole is licensed via GNU Affero GPL version 3.0, this package is licensed under a BSD-style license that can be found in the LICENSE file.
This package is licensed more permissive, since it can be useful outside of the FAILS environment, and FAILS will benefit from the feedback of a larger developer base.

This packages a WebTransport interface similar to the browser side and our webtransport node.js packages, but uses internally websocket over http.
So you must use on the client  and server side (but not all webtransport features are implemented). For server as well as for client, see `test/test.js`, `test/testsuite.js`, `test/echoclient.js`, `test/echoserver.js`  for examples.

PR request are welcome and will be supported by advise from the author.



## Installation and using
You can install the package directly via npm from node.js or github packages:

```bash
npm install @fails-components/webtransport-ponyfill-websocket
```
In case of github packages, please add to your `.npmrc` file
```
@fails-components:registry=https://npm.pkg.github.com
```
In this case you need to be authenticated against github.

You need also to install the package `ws`, if you are using the package with node.

In the directory `test` you find a simple echo server code. That answers to a series of WebTransport echos transported via Websocket. Furthermore some example browser code and finally a unit test of the library. 

