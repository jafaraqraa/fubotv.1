const DETACHED_OUTPUT_ERROR_CODES = new Set(['EIO', 'EPIPE']);
const guardedStreams = new WeakSet();

function isDetachedOutputError(error) {
    return Boolean(error && DETACHED_OUTPUT_ERROR_CODES.has(error.code));
}

function guardOutputStream(stream) {
    if (!stream || typeof stream.on !== 'function' || guardedStreams.has(stream)) {
        return;
    }

    guardedStreams.add(stream);
    stream.on('error', (error) => {
        if (isDetachedOutputError(error)) {
            return;
        }

        // Do not write this error back to stdout/stderr: that can recurse when the
        // output device itself is broken. Preserve failure visibility via exitCode.
        process.exitCode = 1;
    });
}

function installProcessOutputGuards() {
    guardOutputStream(process.stdout);
    guardOutputStream(process.stderr);
}

module.exports = {
    installProcessOutputGuards,
    isDetachedOutputError
};
