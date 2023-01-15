export class WebTransportError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message)

    this.name = this[Symbol.toStringTag] = 'WebTransportError'
  }
}
