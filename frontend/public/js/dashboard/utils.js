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

    // Table rows must be parsed inside a real table context. Parsing a bare <tr>
    // through an ordinary container makes browsers discard its <td> structure.
    setSanitizedTableRows: function(tbody, rowMarkup) {
        if (!tbody) return;
        const container = document.createElement('div');
        this.setSanitizedHTML(
            container,
            `<table><tbody>${String(rowMarkup || '')}</tbody></table>`
        );
        const sanitizedBody = container.querySelector('tbody');
        if (!sanitizedBody) {
            tbody.replaceChildren();
            return;
        }
        tbody.replaceChildren(...Array.from(sanitizedBody.children));
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

    userFacingError: function(error, fallback = 'تعذر إكمال العملية. حاول مرة أخرى.') {
        const raw = typeof error === 'string' ? error : error?.message;
        if (!raw) return fallback;
        const value = String(raw).trim();
        if (/\b(?:ECONNREFUSED|ETIMEDOUT|EADDRINUSE|Internal Server Error|TypeError|undefined|\[object Object\])\b/i.test(value)) {
            return fallback;
        }
        if (/^HTTP\s*\d+$/i.test(value) || /Unexpected token|Failed to fetch|NetworkError/i.test(value)) {
            return 'تعذر الاتصال بالخادم. تحقق من الاتصال ثم حاول مرة أخرى.';
        }
        return value.length > 220 ? `${value.slice(0, 217)}…` : value;
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

    // Resolves protected API media and legacy upload paths to the decoupled backend.
    resolveUrl: function(url) {
        if (!url) return '';
        if (url.startsWith('/api/media/')) return url;
        if (url.startsWith('/api/') && window.Dashboard.api
            && typeof window.Dashboard.api.resolveUrl === 'function') {
            return window.Dashboard.api.resolveUrl(url);
        }
        if (url.startsWith('/uploads/')) {
            const socketUrl = window.ENV ? window.ENV.SOCKET_URL : '';
            return `${socketUrl}${url}`;
        }
        return url;
    },

    isProtectedApiUrl: function(url) {
        if (!url || !window.Dashboard.api) return false;
        if (String(url).startsWith('/api/media/')) return true;
        return String(url).startsWith(window.Dashboard.api.resolveUrl('/'));
    },

    setAuthenticatedMediaSource: async function(element, url) {
        if (!element || !url) return;
        if (!this.isProtectedApiUrl(url)) {
            element.src = url;
            return;
        }
        try {
            let response;
            if (String(url).startsWith('/api/media/')) {
                const sessionId = localStorage.getItem('futh_session_id');
                response = await fetch(url, {
                    credentials: 'include',
                    headers: sessionId ? { 'X-Session-ID': sessionId } : {}
                });
                if (response.status === 401) {
                    window.location.href = '/login';
                    return;
                }
            } else {
                response = await window.Dashboard.api.request(url);
            }
            if (!response.ok) throw new Error(`Media request failed (${response.status})`);
            const objectUrl = URL.createObjectURL(await response.blob());
            const release = () => URL.revokeObjectURL(objectUrl);
            element.addEventListener('load', release, { once: true });
            element.addEventListener('error', release, { once: true });
            element.src = objectUrl;
        } catch (error) {
            element.dataset.mediaError = error.message;
            element.dispatchEvent(new Event('error'));
        }
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
