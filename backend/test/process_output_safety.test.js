const assert = require('assert');
const { EventEmitter } = require('events');
const { describe, it } = require('node:test');
const {
    installProcessOutputGuards,
    isDetachedOutputError
} = require('../src/config/processOutputSafety');

describe('process output safety', () => {
    it('recognizes only detached terminal and pipe errors', () => {
        assert.strictEqual(isDetachedOutputError({ code: 'EIO' }), true);
        assert.strictEqual(isDetachedOutputError({ code: 'EPIPE' }), true);
        assert.strictEqual(isDetachedOutputError({ code: 'ECONNRESET' }), false);
        assert.strictEqual(isDetachedOutputError(new Error('write EIO')), false);
    });

    it('installs process output guards idempotently', () => {
        const stdoutListeners = process.stdout.listenerCount('error');
        const stderrListeners = process.stderr.listenerCount('error');

        installProcessOutputGuards();
        installProcessOutputGuards();

        assert.ok(process.stdout.listenerCount('error') <= stdoutListeners + 1);
        assert.ok(process.stderr.listenerCount('error') <= stderrListeners + 1);
    });

    it('documents that EIO is an error event produced by a detached stream', () => {
        const stream = new EventEmitter();
        let observed;
        stream.on('error', (error) => {
            observed = isDetachedOutputError(error);
        });
        stream.emit('error', Object.assign(new Error('write EIO'), { code: 'EIO' }));
        assert.strictEqual(observed, true);
    });
});
