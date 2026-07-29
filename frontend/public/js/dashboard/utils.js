// Dashboard Utility Functions Module
window.Dashboard = window.Dashboard || {};

window.Dashboard.utils = {
    setSanitizedHTML: function(element, markup) {
        if (!element) return;
        if (!window.DOMPurify || typeof window.DOMPurify.sanitize !== 'function') {
            throw new Error('DOMPurify is required for approved HTML rendering.');
        }
        element.innerHTML = window.DOMPurify.sanitize(String(markup || ''), {
            FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
            FORBID_ATTR: [
                'onclick', 'onload', 'onerror', 'onmouseover', 'onmouseenter',
                'onmouseleave', 'onchange', 'oninput', 'onsubmit', 'srcdoc',
                'data-legacy-click', 'data-legacy-change'
            ],
            ALLOW_UNKNOWN_PROTOCOLS: false
        });
    },

    createElement: function(tagName, options = {}) {
        const element = document.createElement(tagName);
        if (options.className) element.className = options.className;
        if (options.text !== undefined && options.text !== null) {
            element.textContent = String(options.text);
        }
        if (options.attributes) {
            Object.entries(options.attributes).forEach(([name, value]) => {
                if (value !== undefined && value !== null) {
                    element.setAttribute(name, String(value));
                }
            });
        }
        return element;
    },

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

    createCustomerAvatar: function(user, className, fallbackText) {
        const avatar = this.createElement('span', {
            className,
            text: fallbackText || '?'
        });
        const avatarUrl = typeof user?.avatarUrl === 'string' ? user.avatarUrl.trim() : '';
        if (!/^\/uploads\/profile_[a-f0-9]{24}\.(?:jpg|png|webp|gif)$/.test(avatarUrl)) {
            return avatar;
        }

        const image = this.createElement('img', {
            className: 'customer-profile-image',
            attributes: {
                src: this.resolveUrl(avatarUrl),
                alt: user?.name || 'صورة العميل',
                loading: 'lazy',
                referrerpolicy: 'no-referrer'
            }
        });
        image.addEventListener('error', () => image.remove(), { once: true });
        avatar.appendChild(image);
        return avatar;
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
