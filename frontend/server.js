require('dotenv').config();
const express = require('express');
const path = require('path');
const app = express();

const PORT = process.env.FRONTEND_PORT || 5173;
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3005/api/v1';
const SOCKET_URL = process.env.SOCKET_URL || 'http://localhost:3005';

// Serve config.js dynamically
app.get('/config.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`window.ENV = {
  API_BASE_URL: ${JSON.stringify(API_BASE_URL)},
  SOCKET_URL: ${JSON.stringify(SOCKET_URL)}
};`);
});

// Serve static assets
app.use(express.static(path.join(__dirname, 'public')));

// Maintain compatibility and clean routing
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/login.html', (req, res) => {
    res.redirect('/login');
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/dashboard.html', (req, res) => {
    res.redirect('/dashboard');
});

// Fallback redirect for other unknown UI requests to /login
app.get('/', (req, res) => {
    res.redirect('/login');
});

app.listen(PORT, () => {
    console.log(`💻 Frontend application running on: http://localhost:${PORT}`);
});
