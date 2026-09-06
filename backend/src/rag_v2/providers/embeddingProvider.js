'use strict';

const { EmbeddingProvider } = require('./contracts');

class DenseEmbeddingProvider extends EmbeddingProvider {
    constructor(adapter) { super(); this.adapter = adapter; }
    embed(input, options) { return this.adapter.embed(input, options); }
    probeDimensions(options) { return this.adapter.probeDimensions(options); }
}

module.exports = { DenseEmbeddingProvider };
