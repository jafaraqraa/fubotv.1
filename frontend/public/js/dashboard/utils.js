// Dashboard Utility Functions Module
window.Dashboard = window.Dashboard || {};

window.Dashboard.utils = {
    // Escapes potentially dangerous text characters to mitigate dynamic XSS risks
    escapeHTML: function(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },

    // Resolves relative /uploads/ media paths to the decoupled backend server
    resolveUrl: function(url) {
        if (!url) return '';
        if (url.startsWith('/uploads/')) {
            const socketUrl = window.ENV ? window.ENV.SOCKET_URL : '';
            return `${socketUrl}${url}`;
        }
        return url;
    },

    // Check if the file name represents a supported image
    isImage: function(filename) {
        if (!filename) return false;
        const lower = String(filename).toLowerCase();
        return lower.endsWith('.jpg') || lower.endsWith('.png') || lower.endsWith('.jpeg') || lower.endsWith('.gif');
    },

    // Check if the file name represents a supported video
    isVideo: function(filename) {
        if (!filename) return false;
        const lower = String(filename).toLowerCase();
        return lower.endsWith('.mp4') || lower.endsWith('.webm');
    },

    // Check if the file name represents a supported audio track
    isAudio: function(filename) {
        if (!filename) return false;
        const lower = String(filename).toLowerCase();
        return lower.endsWith('.mp3') || lower.endsWith('.wav') || lower.endsWith('.ogg') || lower.endsWith('.m4a') || lower.endsWith('.amr');
    },

    // Check if the file name represents a supported document
    isDocument: function(filename) {
        if (!filename) return false;
        const lower = String(filename).toLowerCase();
        return lower.endsWith('.pdf');
    }
};
