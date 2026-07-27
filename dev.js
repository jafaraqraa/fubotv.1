const { spawn } = require('child_process');

const backend = spawn('npm', ['start'], { cwd: 'backend', stdio: 'inherit', shell: true });
const frontend = spawn('npm', ['start'], { cwd: 'frontend', stdio: 'inherit', shell: true });

console.log('🚀 Starting FUThing Backend and Frontend in decoupled mode...');

process.on('SIGINT', () => {
    backend.kill();
    frontend.kill();
    process.exit();
});
